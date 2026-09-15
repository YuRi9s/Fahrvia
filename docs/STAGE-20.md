# Stage 20 — Private files and scanner qualification

Version 0.1.20 improves scanner error handling and adds an operator probe. Live storage/scanner qualification remains pending. No new migration is required.

## Behaviour

Production PDF uploads require a scanner. Its executable path must be absolute. A clean exit permits further processing; detection (exit 1) rejects the file with HTTP 422. Missing executables, other failures and timeouts return HTTP 503 so an unavailable scanner is not described as malware. The 30-second timeout terminates the scanner process. Temporary files use private permissions and are removed after success or failure.

This command contract is intended for a trusted ClamAV-compatible executable. Merely configuring any executable that returns zero is not adequate qualification. Images continue through bounded decoding and JPEG re-encoding. File metadata is marked READY only after validation and storage succeed. Production storage never falls back to local disk.

## Check your host

Build the updated project. Keep your existing database and configuration. In the project directory run:

```bash
npm run files:check
```

This scans benign diagnostic bytes using the configured executable. It prints INCOMPLETE until the storage probe is also run. Missing configuration is a useful finding; do not substitute a dummy scanner to make it pass.

After configuring a private S3-compatible bucket and its credentials, run:

```bash
npm run files:check -- --storage-probe
```

The flag explicitly enables writing one randomly named diagnostic object, reading and comparing its bytes, and deleting it. It does not create application records or upload user files. The scanner and storage probes run independently; diagnostic storage is not the application's PDF upload pipeline. If cleanup fails, the report includes the diagnostic object key for manual deletion. A failed provider PUT may leave an object after a transport interruption; inspect diagnostic activity in provider logs if necessary.

The command forces production storage/scanner policy and never prints credentials or raw provider errors. It requires source dependencies, including tsx. PROBES_PASSED establishes only the tested scanner response and byte round trip, not bucket privacy, real malware detection or complete application permissions.

## Scanner setup details

`MALWARE_SCANNER` is an absolute executable path, such as `/usr/bin/clamscan` when installed there. Verify with `command -v clamscan`. Keep signatures updated and test under the same operating-system user as the app.

ClamAV documents that clamscan loads signatures itself, whereas clamdscan needs a running daemon. With clamdscan's default path mode, the daemon needs permission to read the temporary file. Fahriva deliberately uses private temporary files; do not make them world-readable. A reviewed wrapper using a local socket and fd-passing or streaming may be required for a separate daemon user. Qualify that wrapper and preserve scanner exit codes. See [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html).

Scanner limits can skip files, and encrypted PDFs may not be inspectable. Configure and test limits and encrypted-document policy with your scanner operator. A clean process exit alone is not evidence that every byte of every possible PDF was inspected.

## Live acceptance checklist

1. Verify a known benign PDF upload and download in the app; verify that a JPG/PNG is re-encoded and downloadable.
2. Under administrator control, use a recognised harmless antivirus test fixture to establish real detection. Confirm rejection creates no READY record. Do not use real malware.
3. Temporarily use an unavailable scanner in a disposable test deployment. Confirm PDFs fail with an unavailable message, no downloadable object is created, and restoring the scanner restores uploads.
4. Verify the configured bucket/object cannot be fetched anonymously. Check provider public-access configuration separately; encryption and a successful authenticated round trip do not prove privacy.
5. Test allowed administrator, dispatcher and driver downloads. Verify cross-organisation objects, peer driver documents, non-visible vehicle documents, unlinked objects and archived replacements are denied.
6. Verify downloaded PDFs use attachment disposition and responses include private/no-store and nosniff headers. Check that ending an assignment removes driver access to vehicle-visible documents on subsequent requests.
7. Test interrupted storage, database rejection after storage and cleanup failures with disposable data. The existing upload cleanup is best effort; orphan reconciliation and monitoring are later operational requirements.

## Status

No real S3 service or ClamAV installation was accessed in the development workspace. Automated subprocess stand-ins and a mocked S3 SDK verify contracts, not actual malware detection or provider privacy. Stage 20 remains open until host results are supplied.

Your supplied Stage 19 log confirms native PostgreSQL 18.6 installation, all 15 migrations, an idempotent rerun, matching checksums, runtime grants and administrator creation. HTTPS startup and backup-upgrade rehearsal remain outstanding. There are still 23 unqualified/deferred/optional stages including stages 19 and 20; source-tooling delivery does not close production gates.
