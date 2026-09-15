# PHR and Concessions details

PHR records the supplied date, intended delivery location and actual delivery location. Concessions records a supplied complaint category and optional notes. The application does not infer the meaning of PHR or calculate a complaint, score or penalty from these entries. Administrators transcribe a source and must identify that source in a reference field. This workflow is independent of score workbook imports; it does not claim a workbook was imported.

## API

`GET /api/v1/delivery-details?week=2026-W53&driverId=…&kind=PHR&page=1` returns current entries, 50 per page. `kind` is optional and accepts `PHR` or `CONCESSION`. Admins can query their organization; drivers can query only their own details. Dispatchers cannot read score details. The week is required and validated as an ISO week.

`POST /api/v1/delivery-details` accepts `{action:"create"|"update",id?:string,data:{driverId,kind,date,intendedLocation?,actualLocation?,category?,notes?,sourceReference,correctionReason?}}`. Dates are exact `YYYY-MM-DD`; the server derives the ISO week. Updates require the current entry ID and a correction reason. Driver and kind cannot change during correction. There is deliberately no arbitrary source-method, tenancy, revision or week field in the input.

Creation and corrections require a live ADMIN or SUPER_ADMIN membership, an active driver in the same organization, authenticated session, same-origin request and mutation rate limit. Each change and its audit record commit together. Row locks protect the source revision from concurrent edits. A correction creates the next revision and marks its predecessor historical; stale update attempts return a conflict. Database triggers prevent history payload changes and deletion. An operational retention process must account for those deliberate controls.

## Integration

Import `DeliveryPanel` from `src/components/delivery-panel.tsx`. Supply `driverId`, `week`, optional `driverName`, `canEdit`, and optional `onSaved`. Key the component by driver ID and week so pagination/edit state resets when changing the selection. Render it independently of score rows, including weeks with no imported score, to preserve access to source details. Only admin roles should receive `canEdit=true`; the API enforces this independently.

The pre-existing score query must add `isCurrent:true` to its DeliveryDetail lookup. Its embedded PHR/concession DTOs may include `id`, `revision` and `sourceReference` if the shared score view needs provenance. The dedicated panel already fetches these fields securely.

The component uses a local German text dictionary. Move that dictionary into the central messages file when consolidating translations. Source references may contain operational details and have the same driver visibility as their associated delivery record; administrators should enter a useful reference without unrelated personal data.

## Validation

`tests/delivery.test.ts` checks ISO year boundaries, mandatory source fields and complaint/location data, strict rejection of server-owned fields, and driver/dispatcher scopes. `tests/delivery.integration.test.ts` executes every migration in sorted order against PGlite with the Prisma adapter and checks create/audit, tenant boundaries, driver visibility, immutable corrections and revoked membership. This local database harness complements real PostgreSQL CI; it does not establish production concurrency behavior.

No workbook detail import is implemented here. Automatic detail ingestion requires an explicit business mapping and source format; this manual workflow provides a usable, traceable path without inventing such a mapping.
