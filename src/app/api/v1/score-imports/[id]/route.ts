import { principalFromHeaders } from "../../../../../server/auth";
import {
  failure,
  response,
  sameOrigin,
  mutationLimit,
  jsonBody,
} from "../../../../../server/http";
import { changeScoreImport } from "../../../../../features/score/service";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    const body = await jsonBody(request);
    return response(
      await changeScoreImport(p, (await params).id, body?.action),
    );
  } catch (e) {
    return failure(e);
  }
}
