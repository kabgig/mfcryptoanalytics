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
- Migrations run via `dbmate` as the owner; the app should connect as
  `app_frontend` (see `db/roles.sql`).
- Nothing hard-deletes user data. Soft delete via `deleted_at`.

## Testing

`doc/ui-testing.md` has the full setup. In short: `npm test` (unit, no server),
`npm run test:integration|test:security|test:cleanup` (needs `npm run dev`),
`npm run test:ui*` (needs dev + global Playwright). Every test uses a synthetic
`telegram_id` in the `99000000xxxx` range and tears down in a `finally` block.
