import { database } from "../../../server/db";
export async function GET() {
  try {
    await database().$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
