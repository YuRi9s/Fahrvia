import { principalFromHeaders } from "../../../../../server/auth";
import { response, failure } from "../../../../../server/http";
import { conversationHistory } from "../../../../../features/messages/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return response(
      await conversationHistory(
        await principalFromHeaders(request.headers),
        (await params).id,
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
