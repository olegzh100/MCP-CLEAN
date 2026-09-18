# Multi-market Job Bridge

This directory is a command queue for the multi-market server.

Only the following request shapes are accepted by the server worker:

- `trading/backtest` with parameters `runner` and optional `days`
- `trading/paper-health` with no parameters
- `crm/diagnostics` with no parameters

Request files live under `job-bridge/requests/<request_id>.json`.

The server validates request IDs, job kinds, parameter names and ranges, records processed request IDs to prevent replay, and forwards accepted work only to the local Secure Job API on `127.0.0.1:8878`.

No API tokens, broker credentials, reports or private trading data are stored in this repository.
