import { principalFromHeaders } from "../../../../server/auth";
import {
  sameOrigin,
  mutationLimit,
  jsonBody,
  response,
  failure,
} from "../../../../server/http";
import {
  listAccounts,
  changeAccount,
} from "../../../../features/accounts/service";
export async function GET(request: Request) {
  try {
    return response(
      await listAccounts(
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
    const principal = await principalFromHeaders(request.headers);
    await mutationLimit(principal);
    return response(await changeAccount(principal, await jsonBody(request)));
  } catch (e) {
    return failure(e);
  }
}
