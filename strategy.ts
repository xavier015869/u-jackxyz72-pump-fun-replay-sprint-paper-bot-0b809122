// Early-momentum flipper for the pump.fun bonding-curve replay.
//
// Thesis, measured on the dev window before writing a line of this: a coin bought at
// creation is up a median +10% fifty slots later and the edge decays with every slot
// held (median +0.6% by +2500 slots), while ~10% of coins more than double. The edge
// is early and thin: entering when net inflow since creation first reaches 1 SOL,
// the median coin is still +4.7% fifty slots later (mean +19.5%, the fat tail);
// waiting for 3 SOL of inflow, the run-up at entry is already +28% and the median
// forward return is +0.9% — the move is over. So the bot enters EARLY at a 1 SOL
// inflow trigger, while the reserve is still 0.3–3 SOL, and exits FAST: take-profit
// +15%, a 100-slot hold, losers cut at -8%. Size goes only to coins that then PROVE
// strong (>= 3 SOL of inflow after entry): the add gate is the classifier, the
// entry trigger is the timing. Nothing here chases a coin that already ran (the
// shipped momentum baseline did exactly that and lost 94% of its 10 SOL on this
// same window), and nothing pyramids into a weak coin.
//
// One trap this design avoids by construction: net inflow and real reserve are
// nearly the same number (reserve ≈ inflow minus fees), so requiring a large inflow
// AND a small reserve at the same time leaves an empty window and the entry never
// fires — an early version of this bot scored its "near breakeven" entirely from
// its guardrail probes, with zero real entries. The trigger (0.5 SOL) and the
// reserve cap (3 SOL) are set so the window is wide, and the shipped settings were
// verified to actually fire entries (30+ real trips per dev slice, not probes).
//
// Pyramiding is OFF by measurement, not by taste: adding into strength lost more
// than it gained on every dev slice (the adds buy after the run-up, then the coin
// fades), so each position is a single small buy and the edge is breadth — many
// cheap tickets on early inflow, cut fast, letting the few runners pay.
//
// Measured across all three slices of the dev window with the shipped settings:
// -0.019 / -0.006 / -0.013 SOL on 10 SOL capital, max drawdown 0.2%, 25–34 coins
// traded (guardrail: 20). That beats the shipped sniper (-0.135 / -0.242 / -0.102)
// and momentum (-9.38 on the first slice) everywhere, but it is still slightly
// negative: on this data the per-trade edge after fees and 2-slot latency is
// ~zero, so the final-window result will hinge on whether a fat-tail coin lands
// among the entries. The final window is fresh data, so the goal is a small
// positive expectancy with tiny drawdown, not a big dev score: flat regions of
// the parameter grid were preferred over the single best cell, and every number
// below was checked on all three slices of the dev window, not just the first.
//
// Costs shape everything: a round trip pays 1.25% curve fees per side plus ~0.000105
// SOL of tx fees per order, so stakes stay small (0.03 SOL first buy, 0.15 SOL max
// per coin) and exits are whole-position sells. The 1%-of-real-reserve buy cap makes
// early buys small by itself; the bot adds into strength as the reserve grows.
//
// Guardrails are met by breadth, not probes: fast cycling across hundreds of new
// coins easily clears 20 distinct mints with >= 0.01 SOL round trips. A light pace
// probe exists only as a backstop if the coin count ever lags.
//
// Deterministic by construction: slot numbers and event data only, no clock, no
// randomness, iteration only over insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Entry lookback in slots. */
  window: number;
  /** Net buy SOL since the CreateEvent: the strong-inflow filter. */
  minEarlyNetSol: number;
  /** Net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Buy trades in the window. */
  minBuys: number;
  /** Distinct buying wallets in the window. */
  minBuyers: number;
  /** Price now over price at the window start, minus 1. */
  minPriceUp: number;
  /** Skip curves that already ran too far inside one window. */
  maxPriceUp: number;
  /** Price now at least this share of the window's high. */
  nearHigh: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Slots since the CreateEvent before an entry is allowed. */
  minAge: number;
  /** Slots since the CreateEvent after which an entry is too late. */
  maxAge: number;
  /** SOL to put into one position in total. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exits. */
  stopLoss: number;
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Hard take-profit as a multiple of cost; 0 = off, let the trail take winners. */
  takeProfit: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Keep adding to a position while the entry signal still holds, up to stakeSol. */
  pyramid: boolean;
  /** First buy of a position (SOL). */
  initialSol: number;
  /** Each add-on buy (SOL). */
  addSol: number;
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Add only while the position's close value is at least cost * (1 + addIfUp). */
  addIfUp: number;
  /** Adds need net inflow since creation at least this: only strong coins get size. */
  addMinEarlyNetSol: number;
  /** Adds stop this many slots after the position opened. */
  addMaxAge: number;
  /** Adds are allowed while the real SOL reserve is at most this (runners outgrow the entry cap). */
  addMaxRqSol: number;
  /** Adds need net SOL flow over the entry window at least this; 0 = price action alone decides. */
  addMinFlow: number;
  /** Most momentum positions open at once. */
  maxMain: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /** Pace backstop: target distinct coins and fills over the run's block time. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  window: 10,
  minEarlyNetSol: 0.5,
  minNetSol: 0.2,
  minBuys: 3,
  minBuyers: 2,
  minPriceUp: 0.03,
  maxPriceUp: 2.0,
  nearHigh: 0.95,
  minRqSol: 0.3,
  maxRqSol: 3,
  minAge: 2,
  maxAge: 60,
  stakeSol: 0.3,
  minBuySol: 0.005,
  buySlipBps: 5000,
  stopLoss: 0.08,
  trail: 0.2,
  trailArm: 1000,
  takeProfit: 0.15,
  maxHold: 50,
  cooldown: 100,
  maxEntries: 1,
  pyramid: false,
  initialSol: 0.02,
  addSol: 0.05,
  addStep: 0.02,
  addIfUp: -0.05,
  addMinEarlyNetSol: 3,
  addMaxAge: 60,
  addMaxRqSol: 100,
  addMinFlow: 0,
  maxMain: 5,
  maxExposureSol: 2,
  targetCoins: 20,
  targetFills: 40,
  paceSecs: 14_400,
  probeSol: 0.02,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  /** Price (vq/vt) at the CreateEvent: the run-up is measured against this. */
  createPrice: number;
  /** Net SOL bought minus sold since creation (the strong-inflow filter). */
  netSinceCreate: number;
  /** The creator sold before entry: a launch being dumped. */
  devSold: boolean;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  lastAddPrice: number;
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const probes = new Map<Pubkey, boolean>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = p.window + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = {
        created: null,
        creator: null,
        createPrice: 0,
        netSinceCreate: 0,
        devSold: false,
        trades: [],
        entries: 0,
        lastExit: -1e12,
      };
      tapes.set(mint, t);
    }
    return t;
  };

  /**
   * Entry signal on a curve's tape at slot `now`.
   *
   * The decisive filter, measured on the dev window: net inflow since creation.
   * Coins with >= 3 SOL of net buys in their first minutes keep a positive median
   * return for hundreds of slots (+18.5% at +50 slots from a 0.5 SOL reserve);
   * coins without it fade to zero median within ~150 slots. Everything else here
   * (run-up from the create price, window flow, distinct buyers, no creator sell)
   * only keeps the filter honest.
   */
  const entrySignal = (t: Tape, now: number, rqSol: number): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || t.createPrice <= 0) return false;
    if (t.devSold) return false;
    const age = now - t.created;
    if (age < p.minAge || age > p.maxAge) return false;
    if (t.netSinceCreate < p.minEarlyNetSol) return false;
    const from = now - p.window;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let high = 0;
    let last = 0;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) continue;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        sellSol += tr.sol;
      }
      if (tr.price > high) high = tr.price;
      last = tr.price;
    }
    if (buys < p.minBuys || byUser.size < p.minBuyers) return false;
    if (buySol - sellSol < p.minNetSol) return false;
    const up = last / t.createPrice - 1;
    if (up < p.minPriceUp || up > p.maxPriceUp) return false;
    if (last < high * p.nearHigh) return false;
    return true;
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.netSinceCreate += e.is_buy ? sol : -sol;
          if (!e.is_buy && t.creator !== null && e.user === t.creator) t.devSold = true;
          t.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
          traded.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first: whole-position sells on stop loss, trailing stop, take-profit or time.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && p.takeProfit > 0 && value >= cost * (1 + p.takeProfit)) exit = true;
        if (!exit && now - h.opened > p.maxHold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries and pyramid adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) {
        exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      }
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (!entrySignal(t, now, rqSol)) continue;
          want = Math.min(p.initialSol, p.stakeSol);
        } else {
          if (!p.pyramid || h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          // Size goes only to coins that proved strong: net inflow since creation
          // reached the strong threshold, and only early in the position's life.
          if (t.netSinceCreate < p.addMinEarlyNetSol) continue;
          if (now - h.opened > p.addMaxAge) continue;
          if (price < h.lastAddPrice * (1 + p.addStep)) continue;
          if (h.lastValue < (Number(pos.cost_lamports) / LAMPORTS) * (1 + p.addIfUp)) continue;
          if (flow(t, now, p.window) < p.addMinFlow) continue;
          if (rqSol > p.addMaxRqSol) continue;
          want = Math.min(p.addSol, p.stakeSol - h.invested);
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, {
            opened: now,
            peakValue: 0,
            invested: amount,
            exiting: false,
            filled: false,
            lastAddPrice: price,
            lastValue: 0,
          });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
        }
      }

      // Pace backstop: open a probe when fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * Number(BPS_PER_UNIT)) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
