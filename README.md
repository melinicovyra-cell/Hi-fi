# 🔐 Ultra-Secure Chat Server v4.0

Защищённый сервер чата с хранением данных в **PostgreSQL** (сообщения, баны/блокировки пользователей, муты), готовый к деплою на **Render**.

## Возможности

- **SQL-хранилище (PostgreSQL)** — сообщения, баны, муты и whisper-ы переживают перезапуски сервера.
- **Шифрование контента в БД (AES-256-GCM)** — даже при утечке базы текст сообщений зашифрован.
- **JWT-аутентификация** с подписью HMAC-SHA256.
- **Защита от подмены админа** — привилегированные аккаунты входят только с `ADMIN_SECRET`.
- **Принудительный бан** — проверка бана при каждом сообщении (работает даже с валидным токеном).
- **Rate limiting**, фильтр мата/ссылок, анти-webhook/бот фильтр, Helmet, CORS, защита от prototype pollution.
- **Авто-fallback на in-memory** при локальной разработке без БД.

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET  | `/health` | Проверка статуса |
| POST | `/auth/login` | Вход → JWT-токен (`{ player, adminSecret? }`) |
| GET  | `/chat` | Публичные сообщения (auth) |
| POST | `/chat` | Отправить сообщение `{ message }` (auth) |
| POST | `/whisper` | Личное зашифрованное сообщение `{ target, message }` |
| GET  | `/whispers` | Свои личные сообщения |
| POST | `/admin/ban` | Бан `{ secret, target, reason? }` |
| POST | `/admin/unban` | Разбан `{ secret, target }` |
| GET  | `/admin/bans?secret=...` | Список банов |
| POST | `/admin/mute` | Мут `{ secret, target, duration }` |
| POST | `/admin/unmute` | Размут `{ secret, target }` |
| POST | `/admin/announce` | Объявление `{ secret, message }` |
| POST | `/admin/clear` | Очистить чат `{ secret }` |
| GET  | `/stats?secret=...` | Статистика |

Аутентификация передаётся в заголовке `X-Auth-Token: <jwt>`.

## Деплой на Render (через Blueprint)

1. Запушь репозиторий на GitHub.
2. В Render: **New → Blueprint**, выбери этот репозиторий.
3. Render прочитает `render.yaml`, создаст **PostgreSQL** и **web-сервис**, и сам сгенерирует секреты (`MASTER_KEY`, `JWT_SECRET`, `ADMIN_SECRET`, `HMAC_SECRET`).
4. Готово. `DATABASE_URL` подключается автоматически.

> ⚠️ Не меняй `MASTER_KEY` после запуска — иначе ранее сохранённые сообщения нельзя будет расшифровать.
> `ADMIN_SECRET` смотри в Render → сервис → **Environment**.

## Локальный запуск

```bash
npm install
npm run generate-keys      # скопируй ключи в .env
cp .env.example .env       # пропиши DATABASE_URL и ключи
npm start
```

Без `DATABASE_URL` сервер запустится на in-memory хранилище (данные не сохраняются — только для отладки).

## Роли

Админы задаются в `index.js` (`USER_ROLES`). Вход под админ-именем требует `adminSecret`.
