import { principalFromHeaders } from "../../../../server/auth";
import {
  correctionCommand,
  corrections,
} from "../../../../features/work-time/corrections";
import {
  failure,
  jsonBody,
  mutationLimit,
  response,
  sameOrigin,
} from "../../../../server/http";
export async function GET(request: Request) {
  try {
    return response(
      await corrections(
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
    return response(await correctionCommand(p, await jsonBody(request)));
  } catch (e) {
    return failure(e);
  }
}
