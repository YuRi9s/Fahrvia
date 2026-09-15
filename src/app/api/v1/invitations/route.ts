import { principalFromHeaders } from "../../../../server/auth";
import {
  sameOrigin,
  mutationLimit,
  jsonBody,
  response,
  failure,
} from "../../../../server/http";
import {
  createInvitation,
  changeInvitation,
  listInvitations,
} from "../../../../features/invitations/service";
import { AppError } from "../../../../server/policy";
export async function GET(request: Request) {
  try {
    return response(
      await listInvitations(
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
    const body = await jsonBody(request);
    if (!body || typeof body !== "object")
      throw new AppError(422, "Ungültige Einladungsaktion.");
    if (body.action === "create")
      return response(await createInvitation(principal, body.data), 201);
    if (
      ["resend", "revoke"].includes(body.action) &&
      typeof body.id === "string" &&
      body.id.length <= 200
    )
      return response(await changeInvitation(principal, body.id, body.action));
    throw new AppError(422, "Ungültige Einladungsaktion.");
  } catch (e) {
    return failure(e);
  }
}
