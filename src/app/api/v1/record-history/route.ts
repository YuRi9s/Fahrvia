import { principalFromHeaders } from "@/server/auth";
import { response, failure } from "@/server/http";
import { recordHistory } from "@/features/fleet/history";
export async function GET(request: Request) {
  try {
    const p = await principalFromHeaders(request.headers);
    const params = new URL(request.url).searchParams;
    return response(
      await recordHistory(
        p,
        params.get("module") || "",
        params.get("id") || "",
        params,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
