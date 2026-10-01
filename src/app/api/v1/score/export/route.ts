import { principalFromHeaders } from "../../../../../server/auth";
import { failure, mutationLimit } from "../../../../../server/http";
import { exportScores } from "../../../../../features/score/export";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    const result = await exportScores(p, new URL(request.url).searchParams);
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
