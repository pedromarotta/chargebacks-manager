import { importDisputes } from "@/server/disputes/service";
import { handleJson } from "@/server/http";

export async function POST(req: Request) {
  return handleJson(req, (actor, body) => importDisputes(actor, body));
}
