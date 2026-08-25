# MCP-CLEAN

MCP-CLEAN is a local control center for approved project folders on this machine.

## MCP-CLEAN Dashboard

- URL: `http://127.0.0.1:3210`
- Start: `dashboard\start.cmd` or `dashboard\MCP-CLEAN-Dashboard.exe`
- Default mode: Browser Auto Mode
- Browser Auto polls the live Edge context, combines the local Edge bridge (`127.0.0.1:8767`) and MCP Edge CDP (`127.0.0.1:9222`), recognizes open services and automatically activates only safe read-only module checks.
- Automatic browser mappings:
  - GitHub tab -> `github`
  - CRM tab -> `crm`
  - configured site -> `deploy`
  - eLama -> `elama`
  - Яндекс Директ -> `direct`
  - any supported web tab -> `browser`
- Manual mode remains available for forced checks independent of open tabs.
- Auto settings: `config/dashboard-auto.json`
- Auto log: `logs/auto-browser.log`
- API:
  - `GET /api/full`
  - `GET /api/status`
  - `GET /api/modules`
  - `GET /api/projects`
  - `GET /api/github`
  - `GET /api/tasks`
  - `GET /api/logs`
  - `GET /api/context`
  - `POST /api/auto/refresh`
  - `POST /api/auto/toggle`
  - `POST /api/module/run`
- Safety: localhost-only, no cookies or tokens stored by Dashboard; automatic execution is read-only. Restore, deploy and advertising changes are not auto-applied.
- Quick access: run `dashboard\create-shortcut.ps1` to create `MCP-CLEAN Dashboard` on the visible desktop and Start menu.

## Repository Layout

- `server.mjs` - MCP server and tool implementations
- `dashboard/` - local control center UI and API
- `dashboard/browser-auto.mjs` - live Edge tab detection and automatic module activation
- `config/allowed-roots.json` - source of allowed project roots
- `config/projects.json` - registry of managed projects
- `config/github-registry.json` - GitHub-backed project registry state
- `config/recovery.json` - recovery state snapshot
- `config/dashboard-auto.json` - Dashboard browser-auto settings
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
