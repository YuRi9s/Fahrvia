import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, type Principal } from "./policy";
import { database } from "./db";
/** Bound actual bytes, not only the client-controlled Content-Length header. */
export async function bytes(request: Request, limit = 65536) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(413, "Die Datei oder Anfrage ist zu groß.");
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
export async function jsonBody(request: Request) {
  try {
    return JSON.parse(new TextDecoder().decode(await bytes(request)));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "Ungültige Anfrage.");
  }
}
export async function formBody(request: Request) {
  const data = await bytes(request, 25 * 1024 * 1024);
  try {
    return await new Response(data, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new AppError(400, "Ungültiger Datei-Upload.");
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !process.env.BETTER_AUTH_URL ||
    origin !== new URL(process.env.BETTER_AUTH_URL).origin
  )
    throw new AppError(403, "Die Herkunft der Anfrage ist nicht erlaubt.");
}
export async function mutationLimit(p: Principal) {
  const key = `mutation:${p.userId}:${Math.floor(Date.now() / 60000)}`;
  const row = await database().rateLimit.upsert({
    where: { key },
    create: {
      id: randomUUID(),
      key,
      count: 1,
      lastRequest: BigInt(Date.now()),
    },
    update: { count: { increment: 1 }, lastRequest: BigInt(Date.now()) },
  });
  if (row.count > 100)
    throw new AppError(429, "Zu viele Anfragen. Bitte kurz warten.");
}
export function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function failure(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof AppError)
    return response({ error: error.message, requestId }, error.status);
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (["P2002", "P2003", "P2004", "P2010", "P2034"].includes(code))
    return response(
      {
        error:
          "Der Eintrag steht im Konflikt mit vorhandenen Daten. Bitte neu laden und prüfen.",
        requestId,
      },
      409,
    );
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      event: "request_failed",
      code: code || "unexpected",
    }),
  );
  return response(
    {
      error:
        "Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.",
      requestId,
    },
    500,
  );
}
