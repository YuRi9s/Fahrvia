import { principalFromHeaders } from "../../../../../../server/auth";
import { database } from "../../../../../../server/db";
import { demand, AppError } from "../../../../../../server/policy";
import { failure } from "../../../../../../server/http";
import { retrieveBytes } from "../../../../../../features/uploads/storage";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const p = await principalFromHeaders(request.headers);
    demand(p, "score-imports", "read");
    const { id } = await params;
    const source = await database().scoreImport.findFirst({
      where: { id, organizationId: p.organizationId },
      select: { sourceKey: true, filename: true },
    });
    if (!source?.sourceKey)
      throw new AppError(404, "Quelldatei nicht verfügbar.");
    const bytes = await retrieveBytes(source.sourceKey);
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
