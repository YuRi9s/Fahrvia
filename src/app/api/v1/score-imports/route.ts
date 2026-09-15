import { principalFromHeaders } from "../../../../server/auth";
import {
  failure,
  response,
  sameOrigin,
  mutationLimit,
  formBody,
} from "../../../../server/http";
import { scoreHistory, previewScore } from "../../../../features/score/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return response(
      await scoreHistory(await principalFromHeaders(request.headers)),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    return response(await previewScore(p, await formBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
