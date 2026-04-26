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
        const [strings, ...values] = args as [TemplateStringsArray, ...unknown[]]
        const preview = strings.raw.join('?').replace(/\s+/g, ' ').trim().slice(0, 120)
        const t0 = Date.now()
        const result = Reflect.apply(target, thisArg, args) as Promise<unknown>
        Promise.resolve(result).then(
          (rows) => console.log(`[sql] ${preview} → ${Array.isArray(rows) ? rows.length + ' rows' : 'ok'} (${Date.now() - t0}ms)`),
          (err) => console.error(`[sql] ${preview} → ERROR (${Date.now() - t0}ms)`, err),
        )
        return result
      },
    }) as ReturnType<typeof neon>
  }
  return _sql
}
