# ChatGPT ↔ Secure Job API: verified operational path (2026-11-08)

## Verified end-to-end (read-only)

- The ChatGPT GitHub connector created a single operational request in `main`:
  `job-bridge/requests/ac0e20b1-73dd-4d10-a4a1-0ef5caa82026.json`.
- Request: `schema_version:1`, `domain:crm`, `kind:diagnostics`, empty `parameters`.
- The server bridge processed the request; GitHub Actions published the sanitized receipt:
  `job-bridge/results/ac0e20b1-73dd-4d10-a4a1-0ef5caa82026.json`.
- Receipt status: `SUCCEEDED`, job ID `45d9ca5c-85b1-4b5f-8b8b-eeca279d9e67`.
- The CRM health subcheck returned `HTTP 200`, status `ok`, and latency `2.17 ms`.
- The request file was removed by the results-collection flow. This is expected.
- No CRM data, secrets, shell operations, LIVE trading, or deployment were requested.

## How ChatGPT can execute an allowed job

1. Use the connected GitHub integration, repository `olegzh100/MCP-CLEAN`.
2. For an explicitly permitted **read-only** job, generate a fresh UUID; create exactly one JSON file
   `job-bridge/requests/<uuid>.json` on `main`. This is an **operational queue**,
   not a source-code development change.
3. Use the strict envelope:

```json
{
  "schema_version": 1,
  "request_id": "<fresh-uuid>",
  "domain": "crm",
  "kind": "diagnostics",
  "parameters": {}
}
```

4. Read `job-bridge/results/<uuid>.json` with GitHub once the collector publishes it.
5. Only `SUCCEEDED` is a successful job execution; distinguish `FAILED`, `REJECTED`, and `BRIDGE_TIMEOUT`.
   Check the internal `result.ok` and relevant checks, not just the receipt's presence.
6. Never reuse a request UUID. Do not include tokens, customer details, shell commands,
   arbitrary code, or broker orders in request files.
7. Server worker polls only `main`, and collector workflow responds only to requests
   pushed to `main`; requests in feature branches are *not* executed.

## Scope and limits

The current MCP-CLEAN queue README documents `crm/diagnostics`, not arbitrary `crm/test`
or `crm/full-check` execution. Do not claim those operations work until they are
implemented, allow-listed end-to-end, and tested. The existing GitHub connector itself
is sufficient for the operational queue transport; no desktop agent is required.

**Production safety:** changes to bridge/server implementation remain in isolated
development branches, under code review and tests. Any production deploy requires a
separate explicit user instruction.
