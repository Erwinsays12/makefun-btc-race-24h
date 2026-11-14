// Slow-momentum CBBTC trend bot with take-profit and trailing stop.
//
// Idea: on 1-minute bars BTC is mostly noise — a full-size round trip costs
// about 26 bps in fees, slippage and pool impact, while the typical 1-minute
// move is ~5 bps. So this bot trades rarely, only when a real multi-hour
// trend is under way, and then it banks the move instead of giving it back:
//
//   Entry: the 150-bar (2.5-hour) return exceeds +1.2%. A move that big over
//     2.5 hours is a genuine trend, not minute noise; smaller thresholds
//     fire on bounces inside a falling market and lose money (measured).
//   Exit (first of): take-profit at +1.5% over cost, a trailing stop 0.6%
//     below the best value the position has reached, the 150-bar return
//     rolling over below -0.5%, or a hard stop at 2% below cost (a crash
//     can turn the 150-bar return negative only after the damage is done).
//
// The bot is long only, holds at most one position, and spends its whole
// cash on entry (at most 100% of equity). It is fully deterministic: every
// decision is float64 arithmetic on the closes the harness sent plus exact
// integer arithmetic on the position's value and cost, no wall clock, no
// randomness, no network. Orders fill at the next bar's open, one bar after
// the decision, exactly as the replay models it.
//
// Tuning (measured on the dev window with a local simulator that reproduces
// the kit's fill math bit for bit — validated to match grade-local exactly
// on the previous competition's bot: net PnL -20.872415, 6 trades, 0.41%
// drawdown reproduced to the micro-USDC):
//   - Dev window (24h to the opening): BTC fell ~4.9% (71,409 -> 67,901)
//     with one slow climb in the middle. This bot catches that climb:
//     buy 08:32 UTC at $68,825, sell 13:37 UTC at $69,747, net +$12.59
//     on the $1,000 start, 2 trades, max drawdown 0.54%.
//   - The same structure also survives the previous competition's dev
//     window (a different 24h, also a down day) at -$5.83 — a losing
//     single trade, but the smallest loss of every variant that is
//     positive on this window; the two-window sum (+$6.76) is the best
//     found. No momentum variant is profitable on both windows: both
//     were steady downtrends, so any long-only trend bot's fate on an
//     unseen day is whether a real climb shows up. This one waits for
//     a strong one and exits on a short leash.
//   - Rejected by measurement: 75-min momentum entry (this window:
//     -$20.87, 6 whipsaw trades), short-window momentum (best -$6.27),
//     EMA crosses (worst -$179.95, 106 trades), RSI and Bollinger
//     mean-reversion (no trade or a loss), Donchian breakouts (loss),
//     take-profit above 1.5% (gives the climb back), trailing stop
//     above 0.6% (same), trailing stop 0.5% (exits too early, +$1.91),
//     entry below 1.1% (extra losing round trips on this window).
//   - Honest caveat: the dev window contains a single tradeable climb,
//     so this tuning is one sample, not a proof. The structure (slow
//     momentum + take-profit + trailing stop + hard stop) is the point;
//     the numbers are the least-bad fit across two different down days.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Momentum window, in bars (1 bar = 1 minute). */
const MOMENTUM_BARS = 150;
/** Enter when the 150-bar return is above this (1.2%). */
const ENTRY_RETURN = 0.012;
/** Exit when the 150-bar return falls below this (-0.5%). */
const EXIT_RETURN = -0.005;
/** Take profit when the position is worth this much over its cost (1.5%). */
const TAKE_PROFIT_NUM = 1015n;
const TAKE_PROFIT_DEN = 1000n;
/** Trailing stop: sell when the position falls this far below its peak value (0.6%). */
const TRAIL_NUM = 994n;
const TRAIL_DEN = 1000n;
/** Hard stop: sell when the position is worth this much of its cost (98%). */
const STOP_NUM = 98n;
const STOP_DEN = 100n;
/** Max slippage vs the latest close, in bps (1%). */
const MAX_SLIPPAGE_BPS = 100;

/** Closes as received, in bar order (raw price integers as float64). */
const closes: number[] = [];
/** Best value (quote units) the current position has reached since entry. */
let peakValue = 0n;

function barReturn(now: number, back: number): number | null {
  const n = closes.length;
  if (n <= back) return null;
  const then = closes[n - 1 - back]!;
  return closes[now]! / then - 1;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];
    const n = closes.length;
    if (n <= MOMENTUM_BARS) return [];
    const momentum = barReturn(n - 1, MOMENTUM_BARS);
    if (momentum === null) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      if (value > peakValue) peakValue = value;
      // Take profit, trailing stop, hard stop, then trend rollover — first hit wins.
      if (
        value * TAKE_PROFIT_DEN >= held.cost * TAKE_PROFIT_NUM ||
        value * TRAIL_DEN <= peakValue * TRAIL_NUM ||
        value * STOP_DEN <= held.cost * STOP_NUM ||
        momentum < EXIT_RETURN
      ) {
        peakValue = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (momentum <= ENTRY_RETURN) return [];
    if (state.cash <= 0n) return [];
    peakValue = 0n;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
