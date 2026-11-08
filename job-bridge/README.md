# Multi-market Job Bridge

This directory is a command queue for the multi-market server.

Only the following request shapes are accepted by the server worker:

- `trading/backtest`
  - research runner: `{"runner":"strategy_research","experiment":{...}}`
  - infrastructure smoke runner: `{"runner":"nautilus_ema_spike"}`
- `trading/paper-health` with no parameters
- `trading/reports-new` with optional `{"limit":1..200}`
- `trading/report-get` with exactly `{"report_id":"..."}`
- `trading/report-processed` with exactly `{"report_id":"..."}`
- `crm/diagnostics` with no parameters

Research hypotheses are sent as JSON data in `parameters.experiment`. The experiment schema is versioned (`schema_version: 1`) and is validated again by the Secure Job API. The bridge does not accept arbitrary Python modules, shell commands, broker controls, or LIVE trading switches.

Request files live under `job-bridge/requests/<request_id>.json`.

The server validates request IDs, job kinds and top-level parameter names, records processed request IDs to prevent replay, and forwards accepted work only to the local Secure Job API on `127.0.0.1:8878`.

Successful research jobs automatically publish a report into the PAPER read service. The report is then addressable by the server-side route:

`GET /paper/backtests/<job_id>`

No manual download is required before reading a completed report.

API tokens and broker credentials are never stored in this repository. For non-backtest read jobs, the terminal receipt may temporarily contain the sanitized Job API `result` needed by ChatGPT, including requested report data. Request parameters remain strictly allow-listed and LIVE controls are unavailable.

For report pickup, the normal sequence is `reports-new` → `report-get` → `report-processed`. Backtest-only published-report verification is not applied to these read jobs.


## CRM check jobs: staged, NOT YET ALLOWED in the live server bridge

Proposed strict additions, only after a separately approved server deployment:

- `crm/test` with exactly `"parameters": {}`
- `crm/build` with exactly `"parameters": {}`
- `crm/full-check` with exactly `"parameters": {}`

The handlers are implemented in `olegzh100/multi-market-platform` and are
being hardened in protected PR #95. The server-side worker has a distinct
allowlist; modifying this README or a GitHub request **does not enable** it.

Live observations, 2026-11-08:

- `crm/diagnostics`: `SUCCEEDED` (CRM HTTP 200).
- `crm/test`: `REJECTED`, `ValueError: job type is not allowed`.
- `crm/not-allowlisted`: `REJECTED`, same error (negative security test).

Only activate these commands after provisioning a dedicated
`/opt/crm-checkouts/<release-id>` checkout with no production database
credentials, a non-root `crm-job-checker` account and an updated sandbox
unit. The API rejects any parameters and only invokes its three fixed
commands without a shell. The bridge must keep replay protection, strict
request validation and sanitized output; do not deploy this work as a
blanket wildcard for `crm/*` or arbitrary command execution.

The operational queue must remain on `main` because the server reads only
that branch. All bridge/API **source changes** belong in protected feature
branches until verified and explicitly authorized for production deployment.
