import { principalFromHeaders } from "../../../../../server/auth";
import { download } from "../../../../../features/uploads/service";
import { failure } from "../../../../../server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const p = await principalFromHeaders(request.headers),
      { id } = await params,
      file = await download(p, id);
    return new Response(new Uint8Array(file.bytes).buffer, {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `${file.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
