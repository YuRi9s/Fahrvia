import { principalFromHeaders } from "@/server/auth";
import { response, failure } from "@/server/http";
import { inventoryCustody } from "@/features/inventory/custody";
export async function GET(request: Request) {
  try {
    return response(
      await inventoryCustody(
        await principalFromHeaders(request.headers),
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
