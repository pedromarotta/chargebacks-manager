// Retry pending network messages from the outbox. Safe to run any time: the network dedupes by idempotency key.
// Usage: npm run outbox
import { prisma } from "../src/server/db";
import { deliverOutbox } from "../src/server/network";

deliverOutbox()
  .then(({ sent, failed }) => {
    console.log(`Sent ${sent}; still pending ${failed}`);
    if (failed > 0) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
