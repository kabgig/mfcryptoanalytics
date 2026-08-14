import { neon } from '@neondatabase/serverless'

let _sql: ReturnType<typeof neon> | null = null

export function getSql(): ReturnType<typeof neon> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    const client = neon(process.env.DATABASE_URL)
    _sql = new Proxy(client, {
      apply(target, thisArg, args) {
        const [strings] = args as [TemplateStringsArray, ...unknown[]]
        const preview = strings.raw.join('?').replace(/\s+/g, ' ').trim().slice(0, 120)
        const t0 = Date.now()
        const result = Reflect.apply(target, thisArg, args) as Promise<unknown>

        // neon's tagged template returns a *lazy* thenable: the query runs when
        // something first calls .then() on it. Logging via
        // `Promise.resolve(result).then(…)` and then returning the raw `result`
        // meant two independent .then() calls — the log's and the caller's await
        // — so every query executed twice. Returning the chained promise keeps
        // exactly one execution and passes the resolved value (including neon's
        // `.count`) straight through.
        return Promise.resolve(result).then(
          (rows) => {
            console.log(`[sql] ${preview} → ${Array.isArray(rows) ? rows.length + ' rows' : 'ok'} (${Date.now() - t0}ms)`)
            return rows
          },
          (err) => {
            console.error(`[sql] ${preview} → ERROR (${Date.now() - t0}ms)`, err)
            throw err
          },
        )
      },
    }) as ReturnType<typeof neon>
  }
  return _sql
}
