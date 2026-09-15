import { auth } from "../../../../server/auth";
import { failure } from "../../../../server/http";
export async function GET(request: Request) {
  try {
    return await auth().handler(request);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    return await auth().handler(request);
  } catch (e) {
    return failure(e);
  }
}
