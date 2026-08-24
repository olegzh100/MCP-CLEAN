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

## Browser Automation

- MCP-CLEAN подключается к существующему рабочему Edge-профилю, а не поднимает отдельный технический браузер.
- `browser_status` показывает состояние Edge и управляемого профиля.
- `browser_checkpoint` сохраняет список вкладок и профиль в `config/browser-state.json`.
- `browser_restore` восстанавливает сохранённые вкладки из `config/browser-state.json`.
- Безопасность ограничивает работу разрешёнными сайтами и запрещает удаление профилей, очистку cookies, выход из аккаунтов и изменение паролей.

## CRM Module

- `crm_status` проверяет CRM backend, API, HTTPS и состояние проекта.
- `crm_api_check` проверяет `/health` и пишет результат в `logs/crm.log`.
- `crm_leads_check` читает состояние лидов без изменения данных.
- `crm_checkpoint` использует backup и git checkpoint перед изменениями CRM.

## Deploy Module

- `deploy_status` показывает сайты, сервер и последнее состояние публикации.
- `deploy_check` проверяет доступность сайта, HTTPS, HTTP статус и время ответа.
- `deploy_prepare` создает backup, checkpoint и проверяет Git перед публикацией.
- `deploy_history` показывает последние публикации по сайтам.
- Реальный deploy не выполняется без явной команды.
- `config/deploy.json` хранит список сайтов, включая `выпускной-альбом.москва`, `kids.ostankino-studio.ru`, `Site-universe` и `Site-wedding`.

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
## Advertising Automation

- `elama_status` показывает доступность кабинета, состояние Edge и сохранённый state eLama.
- `elama_open` открывает eLama в существующем Edge-профиле.
- `elama_campaigns_check` читает кампании eLama без изменений.
- `elama_checkpoint` сохраняет state eLama в `config/elama-state.json`.
- `elama_prepare_change` подготавливает изменения без автоматического применения.
- `direct_status` показывает доступность Яндекс Директ, состояние Edge и сохранённый state.
- `direct_open` открывает Директ в существующем Edge-профиле.
- `direct_campaign_check` читает кампании Директа без изменений.
- `direct_checkpoint` сохраняет state Директа в `config/direct-state.json`.
- `direct_prepare_change` подготавливает изменения без автоматического применения.
- `advertising_status` собирает единый статус eLama и Яндекс Директ.
- `config/elama.json` и `config/direct.json` хранят URL, аккаунт и разрешённые действия.
- Безопасные изменения выполняются через checkpoint и сохранение state в `config/*.json`.

## Module Registry

- `registry/modules.json` хранит список модулей, версий, инструментов и возможностей.
- `module_list` показывает все зарегистрированные модули.
- `module_status` показывает активность, ошибки и время последней проверки.
- `module_register` добавляет или обновляет модуль в registry.
- `module_check` проверяет доступность файлов, инструментов и корректность регистрации.
- Registry нужен для того, чтобы MCP-CLEAN знал, какие модули установлены и что они умеют.

## Task Orchestrator

- `orchestrator/tasks.json` хранит историю задач и планы.
- `orchestrator/rules.json` хранит правила выбора модулей.
- `task_analyze` определяет нужные модули и порядок запуска.
- `task_plan` формирует план выполнения задачи.
- `task_run_plan` запускает выбранные модули в безопасном режиме по умолчанию.
- `task_history` показывает задачи, модули и результаты.

## Как добавлять новые модули

1. Добавьте запись в `registry/modules.json`.
2. Укажите инструменты и возможности модуля.
3. Проверьте `module_check`.
4. При необходимости обновите `system_status` и smoke-тесты.

## Как запускать задачи

1. Описать задачу текстом.
2. Выполнить `task_analyze` или `task_plan`.
3. Проверить выбранные модули.
4. Запустить `task_run_plan` только если нужен реальный запуск.
