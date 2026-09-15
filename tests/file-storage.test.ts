import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
import {
  scanPdf,
  storeBytes,
  retrieveBytes,
  removeBytes,
} from "../src/features/uploads/storage";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fahriva-storage-test-"));
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MALWARE_SCANNER", "");
  vi.stubEnv("S3_BUCKET", "");
  send.mockReset();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function scanner(code: number) {
  const path = join(dir, "scanner");
  await writeFile(
    path,
    `#!/bin/sh\nprintf '%s' "$2" > '${dir}/path'\nexit ${code}\n`,
    { mode: 0o700 },
  );
  vi.stubEnv("MALWARE_SCANNER", path);
}
async function cleaned() {
  const path = await readFile(join(dir, "path"), "utf8");
  await expect(access(path)).rejects.toThrow();
}
it("blocks production PDFs when scanning is not configured", async () => {
  await expect(scanPdf(Buffer.from("%PDF-test"))).rejects.toMatchObject({
    status: 503,
  });
});
it("rejects relative scanner paths and missing executables", async () => {
  vi.stubEnv("MALWARE_SCANNER", "clamscan");
  await expect(scanPdf(Buffer.from("%PDF-test"))).rejects.toMatchObject({
    status: 503,
  });
  vi.stubEnv("MALWARE_SCANNER", join(dir, "missing"));
  await expect(scanPdf(Buffer.from("%PDF-test"))).rejects.toMatchObject({
    status: 503,
  });
});
it("accepts scanner success and removes its private temporary file", async () => {
  await scanner(0);
  await scanPdf(Buffer.from("%PDF-test"));
  await cleaned();
});
it("rejects detection with 422 and removes the temporary file", async () => {
  await scanner(1);
  await expect(scanPdf(Buffer.from("%PDF-test"))).rejects.toMatchObject({
    status: 422,
  });
  await cleaned();
});
it("reports scanner operational failure as unavailable, not infected", async () => {
  await scanner(2);
  await expect(scanPdf(Buffer.from("%PDF-test"))).rejects.toMatchObject({
    status: 503,
  });
  await cleaned();
});
it("never falls back to local storage in production", async () => {
  await expect(
    storeBytes(Buffer.from("test"), "application/pdf"),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    retrieveBytes("00000000-0000-0000-0000-000000000000"),
  ).rejects.toMatchObject({ status: 503 });
  expect(send).not.toHaveBeenCalled();
});
it("requests encrypted storage without a public ACL and round-trips provider bytes", async () => {
  vi.stubEnv("S3_BUCKET", "test-private");
  send.mockResolvedValueOnce({});
  const key = await storeBytes(Buffer.from("test"), "application/pdf");
  expect(send.mock.calls[0][0].input).toMatchObject({
    Bucket: "test-private",
    Key: key,
    ServerSideEncryption: "AES256",
  });
  expect(send.mock.calls[0][0].input).not.toHaveProperty("ACL");
  send.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => Buffer.from("test") },
  });
  expect(Buffer.from(await retrieveBytes(key)).toString()).toBe("test");
  send.mockResolvedValueOnce({});
  await removeBytes(key);
  expect(send.mock.calls[2][0].input).toEqual({
    Bucket: "test-private",
    Key: key,
  });
});
it("propagates provider failures and rejects empty downloads", async () => {
  vi.stubEnv("S3_BUCKET", "test-private");
  send.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(
    storeBytes(Buffer.from("test"), "application/pdf"),
  ).rejects.toThrow("provider unavailable");
  send.mockResolvedValueOnce({});
  await expect(retrieveBytes("test")).rejects.toMatchObject({ status: 404 });
});
