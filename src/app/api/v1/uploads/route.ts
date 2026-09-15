import { principalFromHeaders } from "../../../../server/auth";
import {
  sameOrigin,
  mutationLimit,
  formBody,
  response,
  failure,
} from "../../../../server/http";
import { upload } from "../../../../features/uploads/service";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    return response({
      ok: true,
      item: await upload(p, await formBody(request)),
    });
  } catch (e) {
    return failure(e);
  }
}
