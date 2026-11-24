// Pump.fun Replay Sprint — early-momentum flipper.
//
// Runs the strategy in strategy.ts through the kit's replay shim (vendor/makefun-bot.ts).
// The grader executes `node /bot/main.ts` with Node 22; this file has no dependencies
// and no build step. All trading logic lives in strategy.ts; this file only wires it
// to the harness and keeps the run deterministic (no clock, no randomness, no network).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

// Diagnostics go to stderr only: stdout carries the harness replies and nothing else.
const bot = createStrategy();
const onHello = bot.onHello;
bot.onHello = (state) => {
  console.error(`pumpfun-replay bot up: capital ${state.hello.capital.lamports} lamports, seed ${state.hello.seed}`);
  console.error(`params: ${JSON.stringify(DEFAULT_PARAMS)}`);
  onHello?.(state);
};

await runBot(bot);
