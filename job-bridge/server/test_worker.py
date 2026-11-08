"""Deny-by-default regression tests for the server-side Job Bridge allowlist."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from uuid import uuid4


def load_worker():
    spec = importlib.util.spec_from_file_location(
        "job_bridge_worker_under_test", Path(__file__).with_name("worker.py")
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load_worker()


def request(domain, kind, parameters=None):
    rid = str(uuid4())
    return (
        {
            "schema_version": 1,
            "request_id": rid,
            "domain": domain,
            "kind": kind,
            "parameters": {} if parameters is None else parameters,
        },
        rid + ".json",
    )


class WorkerAllowlistTests(unittest.TestCase):
    def test_exact_three_crm_checks_are_allowed(self):
        expected = {("crm", "test"), ("crm", "build"), ("crm", "full-check")}
        self.assertTrue(expected.issubset(worker.ALLOWED))
        for domain, kind in expected:
            payload, filename = request(domain, kind)
            rid, actual_domain, actual_kind, params = worker.validate(payload, filename)
            self.assertEqual(actual_domain, domain)
            self.assertEqual(actual_kind, kind)
            self.assertEqual(params, {})

    def test_crm_checks_reject_any_parameters(self):
        for kind in ("test", "build", "full-check"):
            with self.subTest(kind=kind):
                payload, filename = request("crm", kind, {"command": "id"})
                with self.assertRaisesRegex(ValueError, "accepts no parameters"):
                    worker.validate(payload, filename)

    def test_unknown_crm_jobs_and_shell_are_denied(self):
        for domain, kind in (
            ("crm", "shell"), ("crm", "exec"), ("crm", "not-allowlisted"),
            ("trading", "live-order"),
        ):
            with self.subTest(domain=domain, kind=kind):
                payload, filename = request(domain, kind)
                with self.assertRaisesRegex(ValueError, "not allowed"):
                    worker.validate(payload, filename)

    def test_mismatched_filename_and_schema_are_denied(self):
        payload, filename = request("crm", "test")
        with self.assertRaises(ValueError):
            worker.validate(payload, str(uuid4()) + ".json")
        payload["schema_version"] = 2
        with self.assertRaisesRegex(ValueError, "schema_version"):
            worker.validate(payload, filename)


if __name__ == "__main__":
    unittest.main()
