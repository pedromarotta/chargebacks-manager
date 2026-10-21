import { PrismaClient } from "@prisma/client";
import { seed } from "../src/server/seed";

const prisma = new PrismaClient();
seed(prisma)
  .then(({ created }) => console.log(created.length ? `Seeded ${created.join(", ")}` : "Seed data already present"))
  .finally(() => prisma.$disconnect());
