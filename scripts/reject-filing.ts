// Dev only: simulate the network rejecting a filed chargeback.
// Usage: npm run reject-filing -- <case_id> "<reason>"
import { prisma } from "../src/server/db";
import { NETWORK_ACTOR, rejectFiling } from "../src/server/disputes/service";

const [id, ...words] = process.argv.slice(2);
if (process.env.NODE_ENV === "production" || !id || words.length === 0) {
  console.error('Usage (dev only): npm run reject-filing -- <case_id> "<reason>"');
  process.exit(1);
}
rejectFiling(NETWORK_ACTOR, id, { reason: words.join(" ") })
  .then((r) => {
    if (r.ok) console.log(`${r.value.id} is now ${r.value.status}`);
    else {
      console.error(`Refused (${r.code}): ${r.message}`);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
