import { principalFromHeaders } from "../../../../../../server/auth";
import { response, failure } from "../../../../../../server/http";
import { keyHistory } from "../../../../../../features/keys/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return response(
      await keyHistory(
        await principalFromHeaders(request.headers),
        id,
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
