# MCP-CLEAN

MCP-CLEAN is a local control center for approved project folders on this machine.

## Архитектура MCP-CLEAN

- `server.mjs` - MCP server and tool implementations
- `config/allowed-roots.json` - source of allowed project roots
- `config/projects.json` - registry of managed projects
- `config/projects.json` - GitHub-backed project registry state
- `config/recovery.json` - recovery state snapshot
- `backups/` - project archives and file backups
- `logs/` - operational logs
- `logs/actions.log` - action audit trail
- `logs/projects.log` - project registry log
- `exchange/projects/<project-name>/` - control structure per project
- `exchange/registry.json` - registry mirror for MCP state
- `temp/` - temporary runtime files
- `smoke-test.mjs` - local smoke test

## Все доступные инструменты

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
- `system_status`
- `project_scan`
- `safe_change`
- `register_project`
- `unregister_project`
- `project_manager`
- `discover_projects`
- `github_status`
- `sync_projects`
- `recovery_check`
- `sync_project_state`
- `github_status_all`
- `github_checkpoint_all`
- `github_sync_check`

## Работа с проектами

- Все операции ограничены путями из `config/allowed-roots.json`.
- `system_status` показывает текущее состояние всех зарегистрированных проектов.
- `project_scan` выполняет глубокую проверку структуры без изменений.
- `safe_change` готовит backup и checkpoint перед изменениями.
- `project_manager` дает единый интерфейс для списка, проверки, backup, checkpoint и health.
- `github_status` показывает remote, branch, commit и divergence local/GitHub.
- `sync_projects` синхронизирует MCP registry state с GitHub-backed metadata.
- `recovery_check` проверяет готовность проекта к восстановлению.

## GitHub Project Registry

- `config/projects.json` хранит текущие GitHub-ориентированные метаданные проектов.
- Этот слой служит источником состояния, если MCP временно недоступен.
- `sync_projects` обновляет локальный registry и зеркалирует его в GitHub через обычный commit/push workflow.
- `github_status` можно использовать для проверки доступности remote и расхождения локального состояния с GitHub.
- `recovery_check` помогает понять, можно ли безопасно восстановить состояние проекта из текущего registry.
- `sync_project_state` показывает local, remote и difference без автоматического merge.

## GitHub Manager

- `github_status_all` дает единый статус всех GitHub-проектов из `config/projects.json`.
- `github_checkpoint_all` создает массовую точку сохранения, если проект изменен.
- `github_sync_check` показывает `LOCAL`, `REMOTE` и `DIFFERENCE` без автоматического merge.
- `config/github-registry.json` хранит GitHub registry snapshot и служит рабочим слоем для manager-операций.
- Восстановление и продолжение работы выполняются через проверку статуса, checkpoint и последующий push.

## Восстановление после сбоя MCP

1. Если MCP недоступен, откройте `config/recovery.json` как последний локальный снимок состояния.
2. Проверьте GitHub через `recovery_check` и `sync_project_state`.
3. Сравните local commit, remote commit и ветку.
4. После восстановления доступности продолжайте работу через `sync_projects` и обычные project tools.

## MCP-CLEAN Golden Stable Version

- Архитектура состоит из `server.mjs`, `config/allowed-roots.json`, `config/projects.json`, `config/recovery.json`, `exchange/`, `backups/` и `logs/`.
- Набор инструментов покрывает диагностику, registry, backup, restore, recovery и GitHub state tracking.
- Восстановление после сбоя MCP выполняется через `recovery_check`, `sync_project_state` и `config/recovery.json`.
- Работа через GitHub остается доступной даже при временной недоступности MCP благодаря локальному registry и GitHub-backed state.
- Новые проекты подключаются через `register_project`, затем попадают в `config/projects.json` и `exchange/projects/<project-name>/`.

## Подключение новых проектов

1. Вызвать `register_project` с `name` и `path`.
2. При необходимости сначала использовать `dryRun: true`.
3. После регистрации проект добавляется в `config/allowed-roots.json`.
4. Создается структура `exchange/projects/<project-name>/`.
5. Для Git-проектов фиксируются branch, last commit и remote.

## Backup

- Все архивы и file-backups сохраняются только в `F:\MCP-CLEAN\backups`.
- Имена архивов содержат timestamp.
- Результаты backup включают путь, размер, информацию о проекте и список созданных архивов.

## Git checkpoint

- `git_checkpoint` выполняет stage, commit и push в `origin main`.
- Поддерживается `dryRun` для безопасной проверки без изменений.

## Rollback

- `restore_project` показывает доступные checkpoint commit'ы, если commit не указан.
- Перед откатом создается backup.
- Затем выполняется `git reset --hard` на выбранный commit.

## Логи

- `logs/mcp-clean.log` - операционные записи.
- `logs/actions.log` - журнал действий с датой, инструментом, проектом, действием и результатом.
- `logs/projects.log` - журнал добавления, удаления, backup, checkpoint и restore для проектов.

## Схема работы

1. Проверить здоровье через `health_check`.
2. Посмотреть систему через `system_status`.
3. Проанализировать проект через `project_scan`.
4. Подготовить изменение через `safe_change`.
5. При необходимости зарегистрировать проект через `register_project`.
6. Создать checkpoint через `git_checkpoint`.
7. Вернуть проект через `restore_project`, если нужен rollback.
