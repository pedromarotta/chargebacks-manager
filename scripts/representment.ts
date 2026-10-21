// Dev only: simulate the merchant's representment arriving from the network.
// Usage: npm run representment -- <case_id> "<merchant response>"
import { prisma } from "../src/server/db";
import { NETWORK_ACTOR, receiveRepresentment } from "../src/server/disputes/service";

const [id, ...words] = process.argv.slice(2);
if (process.env.NODE_ENV === "production" || !id || words.length === 0) {
  console.error('Usage (dev only): npm run representment -- <case_id> "<merchant response>"');
  process.exit(1);
}
receiveRepresentment(NETWORK_ACTOR, id, { merchantResponse: words.join(" ") })
  .then((r) => {
    if (r.ok) console.log(`${r.value.id} is now ${r.value.status}, due ${r.value.dueAt}`);
    else {
      console.error(`Refused (${r.code}): ${r.message}`);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
