# Slow-Momentum BTC Trend Bot (with Take-Profit + Trailing Stop)

Entry for make.fun competition `btc-race-24h-20261113-2314` — race a BTC trading
bot live for 24 hours.

The bot trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, in
the `agent-fun/bars-replay/v1` replay. It starts with 1,000 USDC of paper money,
is long only, and holds at most one position. Nothing is traded for real.

## Strategy

1-minute bars are mostly noise: a full-size round trip costs about 26 bps in
fees, slippage and pool impact, while the typical 1-minute move is ~5 bps. So
the bot trades rarely, only when a real multi-hour trend is under way, and it
banks the move instead of giving it back:

- **Entry:** the 150-bar (2.5-hour) return exceeds +1.2%.
- **Exit (first of):** take-profit at +1.5% over cost, a trailing stop 0.6%
  below the best value the position has reached, the 150-bar return rolling
  over below -0.5%, or a hard stop at 2% below cost.

The bot spends its whole cash on entry (up to 100% of equity) and caps every
order's slippage at 100 bps vs the latest close.

## Files

- `main.ts` — the bot (Node 22, TypeScript with erasable syntax only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.

## Local grade

From the unpacked kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

Dev-window result: net PnL **+12.5899 USDC** on the $1,000 start, 2 trades
(1 round trip: buy 08:32 UTC at $68,825, sell 13:37 UTC at $69,747), max
drawdown 0.54%, guardrails met. The dev window fell ~4.9% overall
($71,409 → $67,901), so the profit comes from the one slow climb in the
middle of the day, not from the trend.

The same structure on the previous competition's dev window (a different
24 hours, also a down day) loses $5.83 on one trade — the smallest loss of
every variant that is positive on this window. No momentum variant is
profitable on both windows, so this is a least-bad fit across two down days,
not a proof: on an unseen day the bot's fate is whether a real climb shows
up. It waits for a strong one and exits on a short leash.
