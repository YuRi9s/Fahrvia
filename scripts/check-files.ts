/** Opt-in provider probe: writes one disposable object, reads it, then deletes it. */
import {
  scanPdf,
  storeBytes,
  retrieveBytes,
  removeBytes,
} from "../src/features/uploads/storage";
Object.assign(process.env, { NODE_ENV: "production" });
const checks: { name: string; status: string; message: string }[] = [];
const bytes = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);
try {
  await scanPdf(bytes);
  checks.push({
    name: "scanner",
    status: "PASS",
    message: "Configured scanner accepted the benign diagnostic bytes.",
  });
} catch {
  checks.push({
    name: "scanner",
    status: "BLOCKED",
    message:
      "Scanner is absent, unavailable or rejected the diagnostic. Check path, permissions and signatures locally.",
  });
}
if (process.argv.includes("--storage-probe")) {
  let key: string | undefined;
  try {
    key = await storeBytes(bytes, "application/pdf");
    const actual = await retrieveBytes(key);
    if (!Buffer.from(actual).equals(bytes)) throw new Error("Mismatch");
    checks.push({
      name: "storage_round_trip",
      status: "PASS",
      message: "Diagnostic object stored and retrieved without byte changes.",
    });
  } catch {
    checks.push({
      name: "storage_round_trip",
      status: "BLOCKED",
      message:
        "Storage round trip failed. Check private bucket, credentials, permissions and encryption support locally.",
    });
  } finally {
    if (key)
      try {
        await removeBytes(key);
        checks.push({
          name: "cleanup",
          status: "PASS",
          message: "Diagnostic object deleted.",
        });
      } catch {
        checks.push({
          name: "cleanup",
          status: "BLOCKED",
          message: `Delete the remaining diagnostic object manually: ${key}`,
        });
      }
  }
} else
  checks.push({
    name: "storage_round_trip",
    status: "NOT_RUN",
    message:
      "Use --storage-probe to write/read/delete one diagnostic object in the configured bucket.",
  });
const passed = checks.every((c) => c.status === "PASS");
console.log(
  JSON.stringify(
    {
      stage: 20,
      status: passed ? "PROBES_PASSED" : "INCOMPLETE",
      checks,
      remaining: [
        "Verify anonymous bucket/object access is denied.",
        "Test allowed and denied application downloads with disposable role/tenant accounts.",
        "Verify actual scanner detection, unavailable-scanner behaviour and current signature maintenance.",
      ],
    },
    null,
    2,
  ),
);
process.exitCode = passed ? 0 : 1;
