import { principalFromHeaders } from "../../../../server/auth";
import { response, failure } from "../../../../server/http";
import {
  assignmentBoard,
  assignmentDetails,
} from "../../../../features/assignments/board";
export async function GET(request: Request) {
  try {
    const p = await principalFromHeaders(request.headers);
    const params = new URL(request.url).searchParams;
    return response(
      await (params.has("vehicleId")
        ? assignmentDetails(p, params)
        : assignmentBoard(p, params)),
    );
  } catch (e) {
    return failure(e);
  }
}
