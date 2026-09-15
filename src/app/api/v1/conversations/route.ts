import { principalFromHeaders } from "../../../../server/auth";
import { response, failure } from "../../../../server/http";
import { conversations } from "../../../../features/messages/service";
export async function GET(request: Request) {
  try {
    return response(
      await conversations(
        await principalFromHeaders(request.headers),
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
