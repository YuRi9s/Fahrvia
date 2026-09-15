import { principalFromHeaders } from "@/server/auth";
import { response, failure } from "@/server/http";
import { notificationDetails } from "@/features/notifications/service";
export async function GET(request: Request) {
  try {
    return response(
      await notificationDetails(
        await principalFromHeaders(request.headers),
        new URL(request.url).searchParams.get("id") || "",
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
