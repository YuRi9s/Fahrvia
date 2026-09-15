import { principalFromHeaders } from "../../../../server/auth";
import {
  failure,
  response,
  sameOrigin,
  mutationLimit,
  jsonBody,
} from "../../../../server/http";
import {
  listDelivery,
  saveDelivery,
} from "../../../../features/delivery/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return response(
      await listDelivery(
        await principalFromHeaders(request.headers),
        new URL(request.url).searchParams,
      ),
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
    const body = await jsonBody(request);
    return response(await saveDelivery(p, body?.action, body?.id, body?.data));
  } catch (e) {
    return failure(e);
  }
}
