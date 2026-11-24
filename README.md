# u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/xavier015869/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/xavier015869/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for the Pump.fun Replay Sprint on [make.fun](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122). It trades 10 SOL of paper money on a 24-hour replay of pump.fun bonding-curve activity; the highest net PnL wins. Free to enter, paper money only.

Built by my AI agent for the bounty — if you want to try make.fun yourself: https://make.fun/r/9d3wsaqp

## Strategy: early inflow, fast exit, no pyramiding

Measured on the kit's dev window before writing the strategy:

- A coin bought at creation is up a median +10% fifty slots later, but the edge decays fast (median +0.6% by +2500 slots) while ~10% of coins more than double.
- Entering when net inflow since creation first reaches 0.5 SOL, the median coin is still +4.7% fifty slots later. Waiting for 3 SOL of inflow, the run-up at entry is already +28% and the median forward return is +0.9% — the move is over.
- Net inflow and real reserve are nearly the same number, so the entry trigger (0.5 SOL) and the reserve cap (3 SOL) are set so the entry window is actually wide.

So the bot buys early on the first sign of real buy flow (net inflow ≥ 0.5 SOL, price up ≥ 3% from creation, at least 2 distinct buyers, creator hasn't sold), one small buy per coin (≤ 0.02 SOL, capped at 1% of the real reserve), and exits fast: take-profit +15%, a 50-slot hold, losers cut at −8%. Pyramiding is off by measurement — adding into strength lost more than it gained on every dev slice. A light pace probe only fires as a guardrail backstop if the coin count ever lags the 20-coin minimum.

## Measured results (dev window, all three dataset slices)

| Slice | Net PnL | Coins | Drawdown |
| --- | --- | --- | --- |
| part-00000 | −0.019 SOL | 37 | 0.20% |
| part-00001 | −0.006 SOL | 29 | 0.17% |
| part-00002 | −0.013 SOL | 25 | 0.13% |

Near breakeven with tiny drawdown — it beats the kit's shipped sniper (−0.135 / −0.242 / −0.102 SOL) and momentum (−9.38 SOL on the first slice) on every slice, but it is still slightly negative: after fees and the 2-slot latency, the per-trade edge on this data is ~zero, so the final-window result will hinge on whether a fat-tail coin lands among the entries. Deterministic: two runs on the same slice give byte-identical results.

## Files

- `main.ts` — entrypoint: wires the strategy to the replay harness. Runs as `node /bot/main.ts` (Node 22, no dependencies, no build step).
- `strategy.ts` — the strategy: entry signal, exits, guardrail pacing, all parameters in `DEFAULT_PARAMS`.
- `vendor/makefun-bot.ts` — the kit's replay shim (unmodified, as the kit instructs).

## License

MIT — see `LICENSE`.
