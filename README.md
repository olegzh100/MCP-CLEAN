# MCP-CLEAN

MCP-CLEAN is a local control center for approved project folders on this machine.

## Structure

- `server.mjs` - MCP server and tool implementations
- `config/allowed-roots.json` - allowed project roots
- `backups/` - local archives and file backups
- `logs/` - operational log files
- `temp/` - temporary runtime files
- `exchange/` - exchange metadata and project notes
- `smoke-test.mjs` - local smoke test

## Tools

- `ping` - basic liveness check
- `list_directory` - list files in an allowed directory
- `read_file` - read a file from an allowed root
- `write_file` - write a file with a timestamped backup
- `project_status` - inspect git state for an allowed project
- `backup_project` - create a timestamped zip archive in `backups/`
- `health_check` - verify core MCP-CLEAN paths and tool availability

## Access Rules

- Only paths under `config/allowed-roots.json` are allowed.
- Working projects are not modified by status or backup checks.
- `backup_project` stores archives only in `backups/`.
- `write_file` stores file-level backups only in `backups/`.

## Backups

- Project archives are created in `F:\MCP-CLEAN\backups`.
- File backups created by `write_file` are also stored there.
- Archive names and file backup names include a timestamp to avoid collisions.

## Rollback

1. Inspect the relevant archive or file backup in `backups/`.
2. Restore the needed files into the project root manually.
3. Run `health_check` and `project_status` again.
4. Use `smoke-test.mjs` before committing changes.
