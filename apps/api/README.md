# @dealpilot/api

Express 5 chat API. It validates input with the Zod schemas from `@dealpilot/shared`. Long work never runs here: a message is stored, a `ChatTurnJob` is enqueued on the pg-boss queue `chat-turn`, and progress is streamed over SSE from the `thread_events` log.

Run: `pnpm tsx apps/api/src/main.ts` (reads `.env.local` / `.env`). Env: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `API_PORT` (4000), `WEB_ORIGINS` (comma-separated, default `http://localhost:3000`).

## Auth

`Authorization: Bearer <Neon Auth JWT>` (EdDSA, verified against `NEON_AUTH_JWKS_URL`; `iss`, when present, must be the origin of `NEON_AUTH_BASE_URL`). Anything invalid is `401 unauthorized`.
`GET /threads/:id/events` also accepts `?access_token=` because `EventSource` cannot set headers (the token can end up in logs and history; it is short-lived and honoured on that route only).

## Endpoints

| Method | Path | Body | Success | Notes |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | | 200 `{ok:true}` | no auth |
| POST | `/threads` | `{title?}` | 201 `Thread` | |
| GET | `/threads` | | 200 `Thread[]` | newest first (by `updatedAt`) |
| GET | `/threads/:id/messages` | | 200 `Message[]` | oldest first |
| POST | `/threads/:id/messages` | `{text}` (1 to 4000) | 202 `{userMessage, assistantMessage}` | assistant message starts `queued`; 429 `rate_limited` at 5 queued/running per user; 503 `queue_unavailable` if enqueue fails |
| GET | `/threads/:id/events` | | 200 `text/event-stream` | see below |
| GET | `/artifacts/:id` | | 302 to a presigned URL | owner only |

Errors always look like `{ "error": { "code", "message" } }`: `unauthorized` 401, `not_found` 404 (also for other users' resources), `validation_error` 422, `bad_json` 400, `rate_limited` 429, `internal_error` 500.

## SSE format

Replays `thread_events` with `id > Last-Event-ID` (header, or `?after=`), then tails. Every frame:

```
id: <thread_events.id>
event: <ChatEvent.type>        step | message | panel | cost | error | done
data: <ChatEvent as JSON>
```

`: ping` comments every 15 s. `done` and `error` do not close the stream (a thread has many turns). `retry: 3000` is sent once. Clients should reconnect with `Last-Event-ID` (EventSource does this itself).
