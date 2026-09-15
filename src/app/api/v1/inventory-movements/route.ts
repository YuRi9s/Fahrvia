import { principalFromHeaders } from "@/server/auth";
import { response, failure } from "@/server/http";
import { inventoryMovements } from "@/features/inventory/history";
export async function GET(request: Request) {
  try {
    return response(
      await inventoryMovements(
        await principalFromHeaders(request.headers),
        new URL(request.url).searchParams,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
