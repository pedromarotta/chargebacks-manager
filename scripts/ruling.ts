// Dev only: simulate the network's ruling on a pre-arbitration case.
// Usage: npm run ruling -- <case_id> WON|LOST
import { prisma } from "../src/server/db";
import { NETWORK_ACTOR, recordRuling } from "../src/server/disputes/service";

const [id, outcome] = process.argv.slice(2);
if (process.env.NODE_ENV === "production" || !id || !outcome) {
  console.error("Usage (dev only): npm run ruling -- <case_id> WON|LOST");
  process.exit(1);
}
recordRuling(NETWORK_ACTOR, id, { outcome: outcome.toUpperCase() })
  .then((r) => {
    if (r.ok) console.log(`${r.value.id} is now ${r.value.status}`);
    else {
      console.error(`Refused (${r.code}): ${r.message}`);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
