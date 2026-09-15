import { sameOrigin, jsonBody, response, failure } from "../../../server/http";
import {
  previewInvitation,
  acceptInvitation,
  publicInvitationLimit,
} from "../../../features/invitations/service";
import { AppError } from "../../../server/policy";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await jsonBody(request);
    if (
      !body ||
      typeof body.token !== "string" ||
      !["preview", "accept"].includes(body.action)
    )
      throw new AppError(422, "Ungültige Einladung.");
    await publicInvitationLimit(body.action, body.token);
    return response(
      body.action === "preview"
        ? await previewInvitation(body.token)
        : await acceptInvitation({
            token: body.token,
            password: body.password,
          }),
    );
  } catch (e) {
    return failure(e);
  }
}
