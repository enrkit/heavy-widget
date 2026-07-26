# heavy-widget

Автоматическая синхронизация фото из Instagram (Business/Creator аккаунт) в `data/feed.json`,
который сайт подтягивает через CDN (jsDelivr) и рендерит как непрерывную бегущую ленту.

## Как это работает

1. GitHub Actions раз в сутки (и по кнопке "Run workflow") запускает `scripts/fetch-instagram.mjs`.
2. Скрипт:
   - обновляет (`refresh`) долгоживущий access token через `graph.instagram.com`,
   - забирает последние посты через `/me/media`,
   - пишет их в `data/feed.json`,
   - если токен обновился — передаёт новое значение в workflow, который сохраняет его обратно в GitHub Secrets (`gh secret set`), чтобы токен никогда не протухал сам по себе.
3. Обновлённый `data/feed.json` коммитится в репозиторий и становится доступен всему миру через:
   `https://cdn.jsdelivr.net/gh/enrkit/heavy-widget@main/data/feed.json`

## Нужные GitHub Secrets (Settings → Secrets and variables → Actions)

| Имя | Назначение |
|---|---|
| `IG_ACCESS_TOKEN` | Долгоживущий (60 дней) access token Instagram аккаунта. Первый раз получается вручную, дальше обновляется автоматически. |
| `GH_PAT` | Classic Personal Access Token с правами `repo` — нужен, чтобы workflow мог сам обновлять секрет `IG_ACCESS_TOKEN` после его refresh. |

## Локальный запуск (для теста)

```bash
IG_ACCESS_TOKEN=xxx node scripts/fetch-instagram.mjs
```

Проверить результат: `cat data/feed.json`
