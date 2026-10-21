// Dev only: simulate the acquirer's funds arriving on a won case.
// Usage: npm run funds-received -- <case_id>
import { prisma } from "../src/server/db";
import { NETWORK_ACTOR, recordFundsReceived } from "../src/server/disputes/service";

const [id] = process.argv.slice(2);
if (process.env.NODE_ENV === "production" || !id) {
  console.error('Usage (dev only): npm run funds-received -- <case_id>');
  process.exit(1);
}
recordFundsReceived(NETWORK_ACTOR, id)
  .then((r) => {
    if (r.ok) console.log(`${r.value.id} funds are now ${r.value.fundsStatus}`);
    else {
      console.error(`Refused (${r.code}): ${r.message}`);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
