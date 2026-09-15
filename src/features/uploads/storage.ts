import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppError } from "../../server/policy";
const run = promisify(execFile);
function client() {
  return new S3Client({
    region: process.env.AWS_REGION ?? "eu-central-1",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
}
function local(key: string) {
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      503,
      "Der private Dateispeicher ist nicht eingerichtet.",
    );
  if (!/^[a-f0-9-]{36}$/.test(key))
    throw new AppError(404, "Datei nicht gefunden.");
  return join(join(process.cwd(), ".data", "files"), key);
}
/** Production PDF uploads fail closed when a scanner is unavailable. */
export async function scanPdf(bytes: Uint8Array) {
  const command = process.env.MALWARE_SCANNER;
  if (!command) {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        503,
        "Die Dokumentenprüfung ist derzeit nicht verfügbar.",
      );
    return;
  }
  if (!isAbsolute(command))
    throw new AppError(
      503,
      "Die Dokumentenprüfung ist nicht korrekt eingerichtet.",
    );
  const dir = await mkdtemp(join(tmpdir(), "fahriva-scan-"));
  try {
    const path = join(dir, "document.pdf");
    await writeFile(path, bytes, { mode: 0o600 });
    await run(command, ["--no-summary", path], {
      timeout: 30000,
      killSignal: "SIGKILL",
      maxBuffer: 4096,
    });
  } catch (error) {
    const detected =
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 1 &&
      !("signal" in error && error.signal) &&
      !("killed" in error && error.killed);
    throw new AppError(
      detected ? 422 : 503,
      detected
        ? "Die Datei hat die Sicherheitsprüfung nicht bestanden."
        : "Die Dokumentenprüfung ist derzeit nicht verfügbar. Bitte später erneut versuchen.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function storeBytes(bytes: Uint8Array, mime: string) {
  const key = randomUUID();
  if (process.env.S3_BUCKET) {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: mime,
        ServerSideEncryption: "AES256",
      }),
    );
  } else {
    const path = local(key);
    await mkdir(join(process.cwd(), ".data", "files"), { recursive: true });
    await writeFile(path, bytes, { mode: 0o600 });
  }
  return key;
}
export async function retrieveBytes(key: string) {
  if (process.env.S3_BUCKET) {
    const r = await client().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    if (!r.Body) throw new AppError(404, "Datei nicht gefunden.");
    return r.Body.transformToByteArray();
  }
  return readFile(/* turbopackIgnore: true */ local(key));
}
export async function removeBytes(key: string) {
  if (process.env.S3_BUCKET)
    await client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  else await rm(local(key), { force: true });
}
