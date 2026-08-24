# MCP-CLEAN

MCP-CLEAN is a local control center for approved project folders on this machine.

## Архитектура MCP-CLEAN

- `server.mjs` - MCP server and tool implementations
- `config/allowed-roots.json` - source of allowed project roots
- `backups/` - project archives and file backups
- `logs/` - operational logs
- `logs/actions.log` - action audit trail
- `exchange/projects/<project-name>/` - control structure per project
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

## Работа с проектами

- Все операции ограничены путями из `config/allowed-roots.json`.
- `system_status` автоматически показывает текущие зарегистрированные проекты.
- `project_scan` выполняет глубокую проверку структуры без изменения файлов.
- `safe_change` подготавливает проект через backup и checkpoint.

## Подключение новых проектов

1. Вызвать `register_project` с `name` и `path`.
2. При необходимости сначала использовать `dryRun: true`.
3. После успешной регистрации проект добавляется в `allowed-roots.json`.
4. Создается структура `exchange/projects/<project-name>/`.
5. Для Git-проектов фиксируются branch, last commit и remote.

## Backup

- Все архивы и file-backups сохраняются только в `F:\MCP-CLEAN\backups`.
- Имена архивов содержат timestamp.
- Результаты backup включают путь, размер, информацию о проекте и список архивов.

## Git checkpoint

- `git_checkpoint` делает stage, commit и push в `origin main`.
- Поддерживается `dryRun` для безопасной проверки без изменений.

## Rollback

- `restore_project` показывает доступные checkpoint commit'ы, если commit не указан.
- Перед откатом создается backup.
- Затем выполняется `git reset --hard` на выбранный commit.

## Логи

- `logs/mcp-clean.log` - операционные записи.
- `logs/actions.log` - журнал действий с датой, инструментом, проектом, действием и результатом.

## Схема работы

1. Проверить здоровье через `health_check`.
2. Посмотреть систему через `system_status`.
3. Проанализировать проект через `project_scan`.
4. Подготовить изменение через `safe_change`.
5. Зарегистрировать новый проект через `register_project`.
6. При необходимости создать checkpoint через `git_checkpoint`.
7. При необходимости откатить проект через `restore_project`.
