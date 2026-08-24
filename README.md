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

## MCP Tools

- `ping`
- `list_directory`
- `read_file`
- `write_file`
- `project_status`
- `backup_project`
- `health_check`
- `git_status_all`
- `git_checkpoint`
- `restore_project`

## Access Rules

- Only paths under `config/allowed-roots.json` are allowed.
- Working projects are not modified by status checks.
- `backup_project` stores archives only in `backups/`.
- `git_checkpoint` and `restore_project` operate only on `F:\MCP-CLEAN`.
- `restore_project` creates a backup before rollback.

## Checkpoints

- `git_checkpoint` stages all changes, creates a commit, and pushes `origin main`.
- Use `dryRun: true` to preview the operation without changing state.

## Rollback

- `restore_project` lists recent checkpoint commits when `commit` is omitted.
- Provide a commit hash to restore that checkpoint.
- The tool creates a backup archive first, then resets the project to the selected commit.

## Backups

- Project archives and file backups are stored in `F:\MCP-CLEAN\backups`.
- Archive names include timestamps to avoid collisions.
- Backup results include project info, archive size, and the current list of backup archives.

## Scheme

1. Read health with `health_check`.
2. Inspect projects with `project_status` or `git_status_all`.
3. Create a checkpoint with `git_checkpoint`.
4. Roll back with `restore_project` when needed.
5. Verify with `smoke-test.mjs` before committing.
