/**
 * Offline verification: run the full reasoning pipeline once against the
 * fixture and print the proposal. No network, no LLM, no execution.
 */

import { defaultPolicy } from "../src/policy/schema";
import { extractConstraints } from "../src/reasoning/constraints";
import { evaluateConstraint } from "../src/reasoning/arb";
import { groupByCorrelation, marketMap } from "../src/reasoning/grouper";
import { scan } from "../src/scanner/polymarket";

const policy = defaultPolicy();
console.log("policy:", policy);

const scans = await scan(policy);
const clusters = await groupByCorrelation(scans);

for (const cluster of clusters) {
  console.log(`\ncluster: ${cluster.cluster}`);
  for (const m of cluster.markets) console.log(`  - ${m.title}  YES ${m.yesBestBid}/${m.yesBestAsk}`);

  const constraints = await extractConstraints(cluster);
  for (const constraint of constraints) {
    console.log(`  constraint (${constraint.relation}): ${constraint.explanation}`);
    const proposal = evaluateConstraint(constraint, marketMap(cluster.markets), policy);
    if (!proposal) {
      console.log(`  → no arb`);
      continue;
    }
    console.log(`  → ARB ${(proposal.evBps / 100).toFixed(2)}% EV, $${proposal.sizeUsd.toFixed(2)}`);
    for (const leg of proposal.legs) {
      console.log(`     ${leg.action} ${leg.side} ${leg.conditionId}  @ ${leg.price}  size $${leg.sizeUsd.toFixed(2)}`);
    }
  }
}
