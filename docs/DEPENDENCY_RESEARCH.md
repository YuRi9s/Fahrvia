# Implemented dependency decisions — 2026-09-08

The notes below were research inputs. The locked implementation takes precedence over an earlier recommendation.

- Implemented CSV reader: `csv-parse` 7.0.2. Implemented XLSX reader: bounded `fflate` 0.8.3 plus `fast-xml-parser` 5.11.1. Papa Parse, SheetJS and ExcelJS are not installed. ExcelJS was rejected after deprecated transitive dependencies appeared during installation.
- TypeScript 6.0.3 is the compatible stable line for typescript-eslint 8.70.0. TypeScript 7 was tried and excluded because the installed lint ecosystem does not support it.
- Vitest 4.1.11 satisfies Better Auth 1.7.3's optional test peer range; Vitest 5 did not. ESLint 10.10.0 uses current individual Next/hooks plugins rather than the incompatible combined `eslint-config-next` dependency tree.
- PGlite 0.5.8 and `@electric-sql/pglite-socket` 0.2.11 provide disposable PostgreSQL/Prisma regression tests. The socket adapter is single-connection in these tests; it is not a substitute for native PostgreSQL concurrent-transaction testing.
- Scoped overrides: Prisma config's `deepmerge-ts` is pinned to 8.0.2, and Prisma's `mysql2` to 3.24.4. These address the [recursive-merge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) and [MySQL compression advisory](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3). The application uses PostgreSQL; audit still scans the installed dependency graph. Prisma generation, build and audit must pass with these overrides.
- Runtime in this workspace is Node 24.19.0. The supplied production image selects Node 24.20.0. No image-startup test has been performed here.
- `package.json` and `package-lock.json` contain the exact version inventory. See RELEASE_STATUS for the final executed checks.

## Earlier source research

# Dependency research (checked 2026-09-08)

This note covers only the remaining implementation dependencies. Versions are the stable versions visible in the cited upstream sources on the check date; pin exact versions in the lockfile and let the normal dependency-update process re-check them.

## Prisma ORM 7.10 / PostgreSQL 18

**Status.** Prisma ORM **7.10.0** is a stable Prisma 7 release (2026-08-25). Prisma's release notes explicitly say Prisma 7 remains published from the repository's `v7` branch; Prisma 8/“Prisma Next” now exists, so do not accidentally install an unbounded latest major. Use matching `prisma`, `@prisma/client`, and `@prisma/adapter-pg` 7.10.x packages. Sources: [Prisma 7.10.0 release](https://github.com/prisma/orm/releases/tag/7.10.0), [upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7), [database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [client setup](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction).

Recommended install:

```sh
npm install @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg
npm install --save-dev prisma@7.10.0
```

Prisma 7 is ESM-first and its default Rust-free client requires a driver adapter. Use generator provider `prisma-client` with an explicit output directory, leave the datasource URL out of `schema.prisma`, and put the CLI URL in `prisma.config.ts`:

```ts
// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
```

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

At runtime, import the generated client and pass the adapter explicitly:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
```

The `env()` helper fails while loading config when the variable is missing. This is useful for migration commands but means even some non-database CLI commands may require `.env`; Prisma documents config through `defineConfig`, and does not automatically load `.env`, hence the explicit `dotenv/config` import. Source: [Prisma config reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [environment variables](https://www.prisma.io/docs/orm/more/dev-environment/environment-variables). Normal commands remain `npx prisma generate`, `npx prisma migrate dev`, and production `npx prisma migrate deploy`.

## CSV and XLSX import

### CSV: Papa Parse 5.7.0

Papa Parse **5.7.0** is the current stable npm release (published 2026-08-25), has no runtime dependencies, and supports Node readable streams, row callbacks, pause/resume, and abort. Install `papaparse@5.7.0` (plus `@types/papaparse` if its declarations are still needed). Sources: [npm package/version](https://www.npmjs.com/package/papaparse?activeTab=versions), [Papa Parse documentation](https://www.papaparse.com/docs).

Use a readable stream and `step`; keep `dynamicTyping: false`, require an allowlisted delimiter/headers, and abort on the first structural error or when application limits are exceeded. Enforce limits outside the parser: compressed/upload bytes, decoded UTF-8 bytes, maximum row count, maximum columns, maximum cell characters, and a wall-clock deadline. Formula text is not executed by Papa Parse. Still reject or preserve as plain text leading `=`, `+`, `-`, `@`, tab, or carriage return when imported data may later be exported to spreadsheet software. `escapeFormulae` protects **unparse/export**, not import.

### XLSX: SheetJS CE, with a supply-chain caveat

SheetJS CE has the broadest, documented read API (`XLSX.read(buffer, options)` and `XLSX.utils.sheet_to_json`). However, npm's `xlsx` package is still **0.18.5, published four years ago**, while SheetJS distributes newer CE builds from its own CDN. Do not silently take `xlsx@latest` from npm as a maintained-current build. Either pin the exact upstream SheetJS tarball selected after security review (and its integrity hash) or choose a separately audited parser. Sources: [official Node installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), [read options](https://docs.sheetjs.com/docs/api/parse-options/), [stale npm package record](https://www.npmjs.com/package/xlsx?activeTab=versions).

For data-only import use `XLSX.read(buffer, { type: "buffer", dense: true, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, sheetRows: MAX_ROWS + 1 })`; accept only `.xlsx`, allowlist sheet names/count, then convert only the required sheet with `sheet_to_json(..., { header: 1, raw: true, defval: null, blankrows: false })`. Formula engines are not run by SheetJS CE; `cellFormula: false` avoids retaining formula expressions, but cached formula results remain attacker-controlled input and must be validated like every other cell.

`sheetRows` is a row cap, **not a ZIP-expansion or total-workbook memory guarantee**. Before parsing, cap the uploaded byte count and inspect the ZIP central directory with an archive library that exposes entry metadata: reject encrypted entries, paths outside the archive, unexpected file count/types, any entry or total uncompressed size over policy, and an excessive compression ratio. Also cap sheets, rows, columns, cells, shared strings, and cell length. Parse in a worker process/container with memory and time limits. This is required because the convenient SheetJS read API consumes a complete buffer and does not expose a global decompression budget.

## Images: sharp 0.35.4

The upstream changelog lists **sharp 0.35.4** as the current stable release (2026-08-26). Install `sharp@0.35.4`. Node 24 is supported; the Web Streams example specifically requires Node >=24.15, while ordinary Buffer/Node stream APIs do not. Sources: [sharp constructor and limits](https://sharp.pixelplumbing.com/api-constructor/), [sharp security policy](https://sharp.pixelplumbing.com/security/), [0.35.4 changelog](https://sharp.pixelplumbing.com/changelog/v0.35.4/).

For untrusted uploads, first cap transport bytes and identify allowed raster types from decoded metadata rather than extension/MIME alone. Construct with `failOn: "warning"`, a deliberately small `limitInputPixels` appropriate to fleet photos, `limitInputChannels: 4`, `pages: 1`, and never `unlimited: true` or `animated: true`. Reject SVG/PDF/TIFF and animation unless explicitly needed. Resize to bounded dimensions, remove metadata by default, and re-encode to JPEG/WebP/PNG. Keep sharp/libvips patched because image decoders are native attack surface. The built-in default pixel cap (268,402,689 pixels) is far too generous for ordinary vehicle/avatar uploads.

## Object storage: AWS SDK for JavaScript v3

Use modular AWS SDK v3 packages: `@aws-sdk/client-s3` for `S3Client`, `PutObjectCommand`, `GetObjectCommand`, `HeadObjectCommand`, and `DeleteObjectCommand`; `@aws-sdk/s3-request-presigner` for short-lived presigned URLs; and `@aws-sdk/lib-storage` only when server-side multipart upload is actually needed. Pin the same current stable patch for all `@aws-sdk/*` packages in the lockfile because AWS publishes frequently. Sources: [official S3 v3 examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html), [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html).

Instantiate one server-side `S3Client({ region })` and use the default credential provider chain/IAM role; do not embed keys. Use private buckets, Block Public Access, least-privilege bucket/prefix IAM, TLS, encryption at rest, opaque generated keys, and explicit `ContentType`. For browser uploads, presign a narrowly scoped `PutObjectCommand` with a short expiry and enforce upload size/type independently in the application; a presigned URL is a bearer credential and does not itself guarantee content validity. Record the object key in PostgreSQL only after confirming upload/processing, and make deletion idempotent. Multipart uploads should be completed or aborted and covered by an S3 lifecycle rule for abandoned parts.

## Brand collision screen (not trademark clearance)

This was a basic public-web and obvious-domain screen only. It does not search DPMA/EUIPO/WIPO registers, company-name registers in all jurisdictions, app stores, social handles, or unindexed uses.

- **Velqora: reject as a candidate.** `velqora.com` is an active European cross-border document-trust product, `velqora.net` is an AI visibility platform, `velqora.tech` is a software agency, and UK Companies House shows **VELQORA LTD**. These are obvious same-name software/company conflicts even though none appears to be fleet management. Sources: [velqora.com](https://velqora.com/en), [velqora.net](https://velqora.net/), [velqora.tech](https://www.velqora.tech/), [UK Companies House](https://find-and-update.company-information.service.gov.uk/company/16933258).
- **Fahriva: less obvious in this screen, but unvalidated.** Searches for the exact term plus software/fleet/domain did not surface an obvious operating product. That absence is weak evidence and domain availability was not reliably established. Before adoption, run exact and phonetic searches in DPMAregister, EUIPO eSearch/TMview and WIPO Global Brand Database, check German company registers and relevant Nice classes (especially 9, 35, 39, 42), and verify the desired domains/handles with registrars. Do not present this screen as legal clearance.

## Blockers / decisions still required

1. Select and pin an audited XLSX artifact. The public npm `xlsx` tag is stale, while current SheetJS CE distribution is outside npm; this is a real supply-chain decision.
2. Define product-specific import budgets (upload bytes, ZIP expanded bytes/ratio, sheets, rows, columns, cells, cell length, duration and worker memory). Parser flags alone cannot safely infer them.
3. Obtain professional German/EU trademark clearance for the final brand. The public-web screen only rules out the most obvious candidate conflict and strongly disfavors Velqora.

## Test database constraint: PGlite is not a drop-in Prisma/PostgreSQL server

`@electric-sql/pglite` **0.5.8** is a stable, maintained embedded PostgreSQL build for JavaScript/WASM. It runs in-process and exposes PGlite's JavaScript query API; it is useful for components written against that API and for browser/local embedded databases. It does **not** expose a PostgreSQL TCP/socket server. The registry check also found no published `@electric-sql/pglite-server` package. Sources: [PGlite documentation](https://pglite.dev/docs/), [PGlite Node API](https://pglite.dev/docs/api), [PGlite repository](https://github.com/electric-sql/pglite).

Prisma 7's PostgreSQL path here uses `@prisma/adapter-pg`, which wraps the `pg` driver and expects a PostgreSQL connection string/socket. Prisma does not list a PGlite driver adapter in its supported driver-adapter table. Therefore PGlite cannot provide meaningful Prisma migration/query integration tests through `PrismaPg`; changing application persistence to PGlite's API only for tests would test a different stack. Source: [Prisma driver adapters](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers).

Use unit tests around pure domain/import logic without a database, and run Prisma integration tests against an actual disposable PostgreSQL instance (CI service container, Testcontainers where Docker is available, or a separately provisioned ephemeral database). The current workspace cannot install/start PostgreSQL: the attempted system package installation was rejected due to sandbox user permissions, and that restriction should not be bypassed. Keep production on PostgreSQL 18.6.

## Better Auth test-runner peer constraint

The installed **better-auth 1.7.3** package declares an optional Vitest peer compatible with majors 2, 3, or 4. Use the selected stable **vitest 4.1.11**; do not force or ignore peer resolution. This is a package-metadata compatibility requirement rather than an application API choice.
