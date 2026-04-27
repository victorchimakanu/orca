/**
 * Demo trick: prints what the fixture-seeded arb looks like.
 *
 * In M4 this flag mutates live orderbooks locally to guarantee the demo hits.
 * Until then it's an alias of replay.ts with a louder header.
 */

import "./replay";

console.log("\n── seeded demo: the fixture is already engineered to yield a 100 bps arb ──");
console.log("run `pnpm dev` and watch the reasoning log for the proposal.");
