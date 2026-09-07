# mfcryptoanalytics — working agreements

## API route checklist

Every new route under `app/api/` must satisfy all nine points. They exist because
each one was, at some point, a real hole in this codebase.

1. **Auth first.** `requireUser()` / `requireAdmin()` from `lib/auth/session.ts` as
   the first statement:
   ```ts
   const user = await requireUser()
   if (user instanceof Response) return user
   ```
   Never add a path to `PUBLIC_API` in `proxy.ts` unless it is genuinely public.

2. **Identity comes from the session, never the client.** No route may read a
   `telegramId` from the query string or body. The whole app was impersonatable
   this way.

3. **Ownership in SQL.** Scope the statement (`WHERE ... AND telegram_id = $n`)
   even though the guard already ran. Return **404, not 403**, for another user's
   row, so ids cannot be probed.

4. **Qualify every table as `public.<table>`** — routes, lib, migrations, ad-hoc
   psql. It is the only form that survives a pooler that sets `search_path = ''`.

5. **Validate input.** Parse `request.json()` in try/catch → 400. Check
   `typeof`, bound string lengths, allowlist enumerated values.

6. **Cap the body before reading it**:
   ```ts
   const tooLarge = enforceBodyLimit(request)   // 32 KB default
   if (tooLarge) return tooLarge
   ```
   Anything accepting an array must also bound the array length — `Content-Length`
   is absent on chunked requests.

7. **Never leak internals.** Use `serverError(route, err)` from `lib/api/errors.ts`.
   Returning `String(err)` hands out SQL, table names and driver detail.

8. **Cache-Control.** `/api/*` is `no-store` globally via `next.config.ts`. Only
   loosen it for a payload identical for every user.

9. **Errors log server-side** with a `[route]` prefix; the client gets a generic
   message.

## Database

- Neon HTTP driver. It returns a **bare array** — there is no `.count` or
  `.rowCount`. To know whether a write happened, add `RETURNING id` and check
  `rows.length`. Two separate bugs came from assuming postgres.js semantics.
- `timestamptz` comes back as a `Date`, not a string.
- **Two roles, deliberately.** `DATABASE_URL` is `app_frontend`: CRUD on
  `public` only, `statement_timeout=5s`, no DDL, no ownership — so an injection
  or a leaked deploy key cannot drop a table. `MIGRATION_DATABASE_URL` is the
  owner and is used only by the `db:*` scripts (`dbmate --env MIGRATION_DATABASE_URL`).
  Never point the app at the owner again; see `db/roles.sql`.
- Nothing hard-deletes user data. Soft delete via `deleted_at`.

## Client state

- The dashboard's `notes`, `overrides` and `deletedTrades` are each written by
  **two** things: a loader that replaces the whole collection when it answers,
  and an optimistic per-item handler. A loader that lands after a save used to
  overwrite data that had already reached Postgres — the row reverted on screen
  and exported blank. Any new loader of this shape must merge through
  `mergeServerSnapshot` / `mergeServerList` (`lib/services/snapshot.ts`) and
  record touched keys in a ref, never `setState(serverData)` directly.
- A plain `{ ...server, ...local }` is not a fix: it restores a value the user
  just wrote but resurrects one they just deleted. The set of touched keys is
  what distinguishes "not edited" from "cleared".
- `trades` and `importedTrades` are exempt: their rows — and so the controls
  that mutate them — do not exist until their own loader has resolved.

## Security

- Guards live in `lib/auth/session.ts`; the closed-by-default edge gate is
  `proxy.ts`. Adding a path to `PUBLIC_API` makes it world-readable.
- `lib/security-alert.ts` watches for floods (per-IP, distributed, per-user) and
  Telegram-messages every `role='ADMIN'` user. **Alerts only leave the process in
  production** (or with `SECURITY_ALERTS_LOCAL=1`), so test suites firing bursts
  of 401s cannot page anyone. Detectors never throw into the request path.
- Open items and deliberate trade-offs are tracked in `doc/KNOWN-ISSUES.md` —
  read it before "fixing" the report-only CSP or the localStorage API keys, both
  of which are considered decisions rather than oversights.

## Testing

`doc/ui-testing.md` has the full setup. In short: `npm test` (unit, no server),
`npm run test:integration|test:security|test:cleanup` (needs `npm run dev`),
`npm run test:ui*` (needs dev + global Playwright). Every test uses a synthetic
`telegram_id` in the `99000000xxxx` range and tears down in a `finally` block.
