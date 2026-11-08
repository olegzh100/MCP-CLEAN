from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

QUEUE_REPO = os.getenv("JOB_BRIDGE_QUEUE_REPO", "https://github.com/olegzh100/MCP-CLEAN.git")
QUEUE_DIR = Path(os.getenv("JOB_BRIDGE_QUEUE_DIR", "/var/lib/multi-market/job-bridge-queue"))
RESULT_DIR = Path(os.getenv("JOB_BRIDGE_RESULT_DIR", "/var/www/job-bridge-results"))
PROCESSED_DIR = Path(os.getenv("JOB_BRIDGE_PROCESSED_DIR", "/var/lib/multi-market/job-bridge-processed"))
POLL_SECONDS = int(os.getenv("JOB_BRIDGE_POLL_SECONDS", "10"))
JOB_API_BASE = os.getenv("JOB_BRIDGE_JOB_API_BASE", "http://127.0.0.1:8878")
TOKEN = os.getenv("JOB_API_TOKEN", "")

REQUEST_ID_RE = re.compile(r"^[a-f0-9-]{36}$")
REPORT_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")
ALLOWED = {
    ("trading", "backtest"),
    ("trading", "paper-health"),
    ("trading", "reports-new"),
    ("trading", "report-get"),
    ("trading", "report-processed"),
    ("trading", "report-consume"),
    ("crm", "diagnostics"),
    ("crm", "session-readiness"),
    ("crm", "test"),
    ("crm", "build"),
    ("crm", "full-check"),
}


def log(message: str) -> None:
    print(message, flush=True)


def git_sync() -> None:
    if not (QUEUE_DIR / ".git").is_dir():
        QUEUE_DIR.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", "main", QUEUE_REPO, str(QUEUE_DIR)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            timeout=60,
        )
        return
    subprocess.run(
        ["git", "-C", str(QUEUE_DIR), "fetch", "--depth", "1", "origin", "main"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        timeout=60,
    )
    subprocess.run(
        ["git", "-C", str(QUEUE_DIR), "reset", "--hard", "FETCH_HEAD"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        timeout=30,
    )


def validate(payload: dict, filename: str) -> tuple[str, str, str, dict]:
    allowed_keys = {"schema_version", "request_id", "domain", "kind", "parameters"}
    if set(payload) != allowed_keys:
        raise ValueError("request keys mismatch")
    if payload["schema_version"] != 1:
        raise ValueError("unsupported schema_version")

    request_id = str(payload["request_id"])
    if not REQUEST_ID_RE.fullmatch(request_id):
        raise ValueError("invalid request_id")
    if filename != f"{request_id}.json":
        raise ValueError("filename/request_id mismatch")

    domain = str(payload["domain"])
    kind = str(payload["kind"])
    if (domain, kind) not in ALLOWED:
        raise ValueError("job type is not allowed")

    parameters = payload["parameters"]
    if not isinstance(parameters, dict):
        raise ValueError("parameters must be an object")

    if (domain, kind) == ("trading", "backtest"):
        runner = parameters.get("runner", "strategy_research")
        if runner == "strategy_research":
            unexpected = set(parameters) - {"runner", "experiment"}
            if unexpected:
                raise ValueError(f"unsupported backtest parameters: {sorted(unexpected)}")
            if not isinstance(parameters.get("experiment"), dict):
                raise ValueError("strategy_research requires experiment JSON object")
        elif runner == "nautilus_ema_spike":
            unexpected = set(parameters) - {"runner"}
            if unexpected:
                raise ValueError(f"unsupported backtest parameters: {sorted(unexpected)}")
        else:
            raise ValueError("unsupported backtest runner; use strategy_research")
    elif (domain, kind) == ("trading", "reports-new"):
        unexpected = set(parameters) - {"limit"}
        if unexpected:
            raise ValueError(f"unsupported reports-new parameters: {sorted(unexpected)}")
        limit = parameters.get("limit", 50)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise ValueError("limit must be an integer from 1 to 200")
    elif (domain, kind) in {
        ("trading", "report-get"),
        ("trading", "report-processed"),
        ("trading", "report-consume"),
    }:
        if set(parameters) != {"report_id"}:
            raise ValueError("report job requires exactly report_id")
        report_id = parameters.get("report_id")
        if not isinstance(report_id, str) or not REPORT_ID_RE.fullmatch(report_id):
            raise ValueError("invalid report_id")
    elif parameters:
        raise ValueError("this job accepts no parameters")

    return request_id, domain, kind, parameters


def api_json(path: str, *, method: str = "GET", body: dict | None = None) -> dict:
    if len(TOKEN) < 32:
        raise RuntimeError("JOB_API_TOKEN is missing or too short")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(
        JOB_API_BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=35) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Job API HTTP {exc.code}: {detail[:300]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Job API unavailable: {exc.reason}") from exc


def atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def process_request(path: Path) -> None:
    request_id = path.stem
    marker_data: dict | None = None
    if REQUEST_ID_RE.fullmatch(request_id):
        marker = PROCESSED_DIR / f"{request_id}.json"
        if marker.exists():
            marker_data = json.loads(marker.read_text(encoding="utf-8"))
            if marker_data.get("state") in {"finished", "rejected", "timeout"}:
                return

    payload = json.loads(path.read_text(encoding="utf-8"))
    request_id, domain, kind, parameters = validate(payload, path.name)

    marker = PROCESSED_DIR / f"{request_id}.json"
    result_file = RESULT_DIR / f"{request_id}.json"

    if marker_data and marker_data.get("state") == "submitted":
        job_id = str(marker_data["job_id"])
        log(f"resuming request={request_id} job={job_id}")
    else:
        submitted = api_json(
            f"/v1/jobs/{domain}/{kind}",
            method="POST",
            body={"parameters": parameters},
        )
        job_id = str(submitted["job_id"])
        atomic_write(marker, {
            "request_id": request_id,
            "job_id": job_id,
            "domain": domain,
            "kind": kind,
            "state": "submitted",
        })
        atomic_write(result_file, {
            "request_id": request_id,
            "job_id": job_id,
            "domain": domain,
            "kind": kind,
            "status": submitted.get("status", "QUEUED"),
        })

    deadline = time.time() + 900
    while time.time() < deadline:
        record = api_json(f"/v1/jobs/{job_id}")
        status = record.get("status")
        if status in {"SUCCEEDED", "FAILED"}:
            public_record = {
                "schema_version": 1,
                "request_id": request_id,
                "job_id": job_id,
                "domain": domain,
                "kind": kind,
                "status": status,
                "created_at": record.get("created_at"),
                "started_at": record.get("started_at"),
                "finished_at": record.get("finished_at"),
                "result": record.get("result"),
                "error": record.get("error"),
            }
            atomic_write(result_file, public_record)
            atomic_write(marker, {**public_record, "state": "finished"})
            log(f"finished request={request_id} job={job_id} status={status}")
            return
        time.sleep(2)

    timeout_record = {
        "schema_version": 1,
        "request_id": request_id,
        "job_id": job_id,
        "domain": domain,
        "kind": kind,
        "status": "BRIDGE_TIMEOUT",
        "error": "bridge stopped polling before Job API reached a terminal state",
    }
    atomic_write(result_file, timeout_record)
    atomic_write(marker, {**timeout_record, "state": "timeout"})
    log(f"timeout request={request_id} job={job_id}")


def cleanup_delivered_results(request_dir: Path) -> None:
    """Remove transient public result files after GitHub has removed the delivered request."""
    for marker in PROCESSED_DIR.glob("*.json"):
        try:
            record = json.loads(marker.read_text(encoding="utf-8"))
        except Exception:
            continue
        if record.get("state") != "finished":
            continue
        request_id = str(record.get("request_id", marker.stem))
        if not REQUEST_ID_RE.fullmatch(request_id):
            continue
        if (request_dir / f"{request_id}.json").exists():
            continue
        result_file = RESULT_DIR / f"{request_id}.json"
        if result_file.exists():
            result_file.unlink()
            log(f"cleaned delivered result request={request_id}")


def main() -> None:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    while True:
        try:
            git_sync()
            request_dir = QUEUE_DIR / "job-bridge" / "requests"
            if request_dir.is_dir():
                for path in sorted(request_dir.glob("*.json")):
                    try:
                        process_request(path)
                    except Exception as exc:
                        request_id = path.stem if REQUEST_ID_RE.fullmatch(path.stem) else None
                        log(f"rejected file={path.name}: {type(exc).__name__}: {exc}")
                        if request_id and not (PROCESSED_DIR / f"{request_id}.json").exists():
                            atomic_write(
                                RESULT_DIR / f"{request_id}.json",
                                {
                                    "schema_version": 1,
                                    "request_id": request_id,
                                    "status": "REJECTED",
                                    "error": f"{type(exc).__name__}: {exc}"[:500],
                                },
                            )
                            atomic_write(
                                PROCESSED_DIR / f"{request_id}.json",
                                {
                                    "schema_version": 1,
                                    "request_id": request_id,
                                    "status": "REJECTED",
                                    "state": "rejected",
                                },
                            )
                cleanup_delivered_results(request_dir)
        except Exception as exc:
            log(f"bridge loop error: {type(exc).__name__}: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()