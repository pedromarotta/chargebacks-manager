import { bulkWriteOff } from "@/server/disputes/service";
import { handleJson } from "@/server/http";

export async function POST(req: Request) {
  return handleJson(req, (actor, body) => bulkWriteOff(actor, body));
}
