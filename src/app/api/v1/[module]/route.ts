import { principalFromHeaders } from "../../../../server/auth";
import { listModule } from "../../../../server/queries";
import { mutateFleet } from "../../../../features/fleet/service";
import { mutateOperations } from "../../../../features/operations/service";
import {
  jsonBody,
  sameOrigin,
  mutationLimit,
  response,
  failure,
} from "../../../../server/http";
import { csvCell } from "../../../../server/validation";
import { z } from "zod";
import { parse } from "../../../../server/validation";
const input = z.object({
  action: z.string().min(1).max(40),
  id: z.string().max(100).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export async function GET(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  try {
    const p = await principalFromHeaders(request.headers),
      { module } = await params,
      url = new URL(request.url);
    const data = await listModule(p, module, url.searchParams);
    if (
      module === "reports" &&
      url.searchParams.get("format") === "csv" &&
      "items" in data
    ) {
      return new Response(
        "\uFEFF" +
          [
            ["Bericht", "Wert"],
            ...(data.items as { label: string; value: number }[]).map((r) => [
              r.label,
              r.value,
            ]),
          ]
            .map((row) => row.map(csvCell).join(";"))
            .join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="fahriva-bericht.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    return response(data);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  try {
    sameOrigin(request);
    const p = await principalFromHeaders(request.headers);
    await mutationLimit(p);
    const { module } = await params,
      v = parse(input, await jsonBody(request));
    const item = await ([
      "drivers",
      "vehicles",
      "assignments",
      "keys",
      "categories",
    ].includes(module)
      ? mutateFleet(p, module, v.action, v.id, v.data)
      : mutateOperations(p, module, v.action, v.id, v.data));
    return response({ ok: true, item });
  } catch (e) {
    return failure(e);
  }
}
