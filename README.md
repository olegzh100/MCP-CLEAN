# MCP-CLEAN

MCP-CLEAN is a local control center for approved project folders on this machine.

## MCP-CLEAN Dashboard

- URL: `http://127.0.0.1:3210`
- Start: `dashboard\start.cmd`
- Modes: `Mixed`, `Manual`, `Auto`
- API:
  - `GET /api/status`
  - `GET /api/modules`
  - `GET /api/projects`
  - `GET /api/github`
  - `GET /api/tasks`
  - `GET /api/logs`
- Safety: localhost-only, no cookies, no tokens, no external bind
- Quick access: run `dashboard\create-shortcut.ps1` to create `MCP-CLEAN Dashboard` on the desktop

## Repository Layout

- `server.mjs` - MCP server and tool implementations
- `dashboard/` - local control center UI and API
- `config/allowed-roots.json` - source of allowed project roots
- `config/projects.json` - registry of managed projects
- `config/github-registry.json` - GitHub-backed project registry state
- `config/recovery.json` - recovery state snapshot
- `backups/` - project archives and file backups
- `logs/` - operational logs
- `exchange/projects/<project-name>/` - control structure per project
- `exchange/registry.json` - registry mirror for MCP state
- `temp/` - temporary runtime files
- `smoke-test.mjs` - local smoke test

## Modules

- `browser`
- `github`
- `crm`
- `deploy`
- `elama`
- `direct`
- `project_manager`
- `recovery`
