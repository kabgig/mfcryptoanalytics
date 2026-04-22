import { Trade } from "@/types"
import { registry } from "@/lib/exchanges"

/**
 * Fetches trades from all registered exchange adapters,
 * merges and sorts them by closeTime ascending.
 *
 * Pass a walletAddress when real exchanges require it.
 */
export async function getAllTrades(walletAddress?: string): Promise<Trade[]> {
  const results = await Promise.all(
    registry.map((adapter) => adapter.fetchTrades(walletAddress))
  )

  const merged = results.flat()
  merged.sort(
    (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
  )

  return merged
}
