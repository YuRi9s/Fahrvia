import { principalFromHeaders } from "@/server/auth";
import {
  sameOrigin,
  mutationLimit,
  formBody,
  response,
  failure,
} from "@/server/http";
import {
  inspectionList,
  submitInspection,
} from "@/features/inspections/service";
export async function GET(request: Request) {
  try {
    return response(
      await inspectionList(
        await principalFromHeaders(request.headers),
        Number(new URL(request.url).searchParams.get("page") ?? 1),
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
    return response(await submitInspection(p, await formBody(request)));
  } catch (e) {
    return failure(e);
  }
}
