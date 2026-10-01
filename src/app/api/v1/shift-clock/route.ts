import { principalFromHeaders } from "../../../../server/auth";
import {
  clockCommand,
  clockSnapshot,
} from "../../../../features/work-time/clock";
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
      await clockSnapshot(await principalFromHeaders(request.headers)),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    return response(await clockCommand(p, await jsonBody(request)));
  } catch (error) {
    return failure(error);
  }
}
