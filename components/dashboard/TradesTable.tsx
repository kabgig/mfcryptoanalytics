"use client"

import { Trade } from "@/types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { motion, useInView } from "motion/react"
import { useRef } from "react"

interface TradesTableProps {
  trades: Trade[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function formatPrice(value: number | null) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  return `$${value.toLocaleString("en-US")}`
}

function AnimatedRow({ children, index, isProfit }: { children: React.ReactNode; index: number; isProfit: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" })
  return (
    <motion.tr
      ref={ref}
      initial={{ opacity: 0, x: -12 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.6) }}
      className={isProfit ? "bg-emerald-500/5 hover:bg-emerald-500/10" : "bg-red-500/5 hover:bg-red-500/10"}
    >
      {children}
    </motion.tr>
  )
}

export function TradesTable({ trades }: TradesTableProps) {
  const tableRef = useRef<HTMLTableSectionElement>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trade History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto pl-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="w-24">Ticker</TableHead>
                <TableHead className="w-24">Exchange</TableHead>
                <TableHead className="text-right">Position Size</TableHead>
                <TableHead className="text-right">TP</TableHead>
                <TableHead className="text-right">SL</TableHead>
                <TableHead>Open Time</TableHead>
                <TableHead>Close Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={tableRef}>
              {trades.map((trade, i) => {
                const isProfit = trade.pnl >= 0
                return (
                  <AnimatedRow key={trade.id} index={i} isProfit={isProfit}>
                    <TableCell
                      className={`text-right font-mono font-semibold ${
                        isProfit ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {isProfit ? "+" : ""}
                      {trade.pnl.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </TableCell>
                    <TableCell className="w-24 max-w-[6rem] font-mono font-medium">
                      <span className="block truncate" title={trade.ticker}>{trade.ticker}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {trade.exchange}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {trade.positionSize === 0 ? "—" : trade.positionSize.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatPrice(trade.tp)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatPrice(trade.sl)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(trade.openTime)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(trade.closeTime)}
                    </TableCell>
                  </AnimatedRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
