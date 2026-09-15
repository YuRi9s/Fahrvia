# Application API

All private routes resolve a live Better Auth session and exactly one active organization membership. The caller never supplies an authoritative organization, role or driver identity. Driver-specific reads apply the authenticated profile before pagination. A resource ID alone never grants access.

## Shared module routes

`GET /api/v1/{module}` returns `{items,total,page,pageSize}`. Supported modules include drivers, vehicles, assignments, keys, planning, waves, work-times, inventory, score, documents, photos, messages, notifications, categories, reports and profile. Dashboard returns a separate aggregate DTO. `recipients` returns a restricted recipient lookup.

Common filters are `q`, `status`, `page` and `pageSize` (maximum 100). `week=2026-W37` is validated as an ISO week, including the actual number of weeks in that ISO year. Weekly filtering applies to assignments, planning, waves, work-times and scores. Reports optionally use the week as their work-time reporting period. Not every module supports every filter; unsupported controls should not be treated as server filtering.

`POST /api/v1/{module}` accepts:

```json
{ "action": "update", "id": "resource-id", "data": { "field": "value" } }
```

Creation omits `id`. Successful mutations return `{ok:true,item:{id}}`. Field validation, role checks and scoped record lookup happen on the server. Business writes and audit records share a transaction.

| Module        | Actions                                                             |
| ------------- | ------------------------------------------------------------------- |
| drivers       | create, update, archive, reactivate                                 |
| vehicles      | create, update, archive, reactivate                                 |
| assignments   | create, close                                                       |
| keys          | create, update custody, replace, retire                             |
| categories    | create, update, archive, reactivate                                 |
| planning      | create, update, delete (soft deletion)                              |
| waves         | create, update, transition                                          |
| work-times    | create, update with correction reason, approve with expectedVersion |
| inventory     | create, update metadata, adjust with signed quantity and reason     |
| messages      | create/reply, read                                                  |
| notifications | read                                                                |
| documents     | archive; upload/renew through upload route                          |
| photos        | resolve damage; upload through upload route                         |

Dispatchers cannot create/archive driver accounts or vehicles, import scores, approve work time or access personnel files. Driver writes are restricted to own authorized uploads, messages and notification state. Hiding a button is supplementary; the API enforces these rules independently.

## Imports and files

- `GET /api/v1/score-imports`: organization import history, admin only.
- `POST /api/v1/score-imports`: multipart `file`, `week`, optional `mapping` JSON. Produces a draft and validation results; it never commits automatically.
- `POST /api/v1/score-imports/{id}`: `{action:"commit"}` or `{action:"revert"}`.
- `GET /api/v1/score-imports/{id}/source`: private original source download, admin only.
- `POST /api/v1/uploads`: multipart `kind` (`photo`/`document`), `files`, subject ID, title/notes and optional expiry. `replacesId` renews a same-subject document atomically. Non-driver vehicle-document uploads may set `driverVisible=true`.
- `GET /api/v1/files/{id}`: checks the actual owning document/report and its visibility before reading bytes.

See `SCORE_IMPORT.md` for source mapping and `DELIVERY_DETAILS.md` for the independent PHR/Concessions API.

## Conversations

`GET /api/v1/conversations?q=...&page=1` groups only conversations in which the authenticated user participates. It returns the latest message, participant display name and unread count per thread. `GET /api/v1/conversations/{id}?page=1` returns at most 30 messages. Reply through the messages module with `threadId`; changing participants on an existing thread is rejected.

## Errors and abuse controls

Errors return `{error,requestId}` with German text. 401 means no session, 403 means the operation is not permitted, 404 conceals unavailable or unauthorized subjects, 409 indicates a conflicting state or stale revision, 422 indicates invalid input, and 429 asks the caller to retry later. Internal stack traces and database errors are not serialized.

Mutations require an Origin matching the configured authentication origin. JSON is limited by actual streamed bytes, not only Content-Length. Upload parsing has a separate byte cap. Mutation and authentication rate limits are database backed. Private responses use `Cache-Control: private, no-store`.

## Account administration (Stage 4)

`GET /api/v1/accounts?q=...&page=1&status=disabled` returns 25 organization memberships per page. `status` is `active`, `disabled` or omitted. Only current administrators can list accounts. DTOs include name, email, role, access state, MFA-enrollment flag, version and linked driver ID/status; never credentials or session tokens.

`POST /api/v1/accounts` accepts the following direct body (not the generic module action envelope):

```json
{
  "id": "membership-id",
  "version": 1,
  "role": "DISPATCHER",
  "active": false,
  "reason": "Access ended after offboarding"
}
```

The transaction checks live actor privileges, tenant scope and the expected version, applies the new role/access state, deletes all target-user sessions and records before/after values and reason. Stale edits return 409. Same-origin protection and the existing mutation rate limit apply. Self changes and super-administrator changes are forbidden. Only super-administrators can manage existing administrators or grant ADMIN. DRIVER requires an existing linked profile, and active driver access requires an ACTIVE profile. Restoring access cannot create a second active organization membership.

Membership version changes invalidate pending invitation links issued at an earlier version. The invitation list reports `INVALIDATED`; an authorized administrator can resend to issue a new link. No driver profile is created, relinked or reactivated by this endpoint.

## Driver reactivation (Stage 5)

`POST /api/v1/drivers` uses the existing module envelope:

```json
{
  "action": "reactivate",
  "id": "driver-id",
  "data": {
    "expectedUpdatedAt": "2026-09-09T12:00:00.000Z",
    "reason": "Returned after leave"
  }
}
```

Use the exact `updatedAt` returned by the driver list. Only a current active administrator/super-administrator in the same organization can restore an INACTIVE profile. The row is locked, the timestamp is checked and the status change and audit are committed atomically. A stale or already-active record returns 409; missing/short reason or invalid timestamp returns 422. This action preserves membership access, profile identity, documents, scores and assignments. Account restoration remains a separate operation under Konten & Rollen.

## Category lifecycle (Stage 6)

`GET /api/v1/categories?q=...&type=BRAND&status=ACTIVE&page=1&pageSize=25` returns scoped categories with `version`, `status` and `usageCount` (linked vehicles). Types are BRAND, PROVIDER, STATION and GROUP. Stable type/name/id ordering supports pagination.

Create uses the existing `{action:"create",data:{type,name}}` envelope. Update uses `{action:"update",id,data:{name,version,reason}}`; archive/reactivate use `{action:"archive",id,data:{version,reason}}` and `{action:"reactivate",id,data:{version,reason}}`. Version is an integer from the list; reason is 3–500 trimmed characters. Category types cannot be changed. No hard-delete endpoint exists. Duplicate names within a tenant/type are rejected case-insensitively, including archived names.

Vehicle create/update accepts optional `brandCategoryId` and `providerCategoryId` alongside the existing label fields. IDs are resolved by organization and expected category type; current canonical names are stored. Existing archived links may be retained, but new links to inactive categories are rejected. Owned vehicles clear provider and its link. Text-only callers match existing categories; unmatched legacy/custom text remains supported. Category creation attaches exact matching unlinked legacy vehicle labels. Rename updates labels only on linked vehicles.

Category and vehicle mutations take an organization-scoped transaction advisory lock before row locks, serializing assignment against category rename/archive. Category changes check live administrator membership and append before/after/reason audit data in the same transaction. Foreign references, wrong types, stale revisions and unauthorized changes are rejected.

## Physical key lifecycle (Stage 7)

`GET /api/v1/keys` now includes `status` (ACTIVE/RETIRED), `version` and `replacesKeyId`. Status filters apply before pagination. Vehicle DTO `keyCount` counts active keys only.

`POST /api/v1/keys` uses the existing module envelope:

- Create: `{action:"create",data:{vehicleId,reason}}`.
- Update custody: `{action:"update",id,data:{version,reason,location,driverId?}}`.
- Retire or replace: `{action:"retire",id,data:{version,reason}}` or `{action:"replace",id,data:{version,reason}}`.

A reason of 3–500 trimmed characters is required. Custody mutations now require the current version, so API clients must use the version returned by the list. Missing versions return 422; stale versions return 409. Locations remain OFFICE, DRIVER and MISSING. Driver location requires an active same-tenant driver and active vehicle; other locations clear driverId.

Only current administrators can create, replace or retire keys. Dispatchers may change custody. New keys take the first free active slot from 1–4. Replacement atomically retires the old key and creates a new key in the same slot, linked through replacesKeyId. Driver-held keys must be returned or marked missing before retirement/replacement. Retired keys cannot be modified; replacement and creation require an active vehicle. Every change records an immutable custody event and an audit entry.

`GET /api/v1/keys/{id}/history?page=1` returns `{key,items,total,page,pageSize}` with 25 events per page, newest first. The key DTO includes previous/replacement IDs for navigation; events contain action, location, driver name, actor name, reason and timestamp. Administrators and dispatchers can access same-tenant histories. Drivers cannot access the full staff custody history.

The migration preserves existing keys/custody, initializes key status/version and labels old custody events TRANSFER without fabricating missing reasons or events. The database permits only one active key per vehicle slot and prevents editing/deleting custody history. Vehicle-first transaction locks serialize slot allocation and lifecycle against custody and fleet archival.

## Stage 8: assignment board

`GET /api/v1/assignment-board` requires staff assignment-read access. Optional parameters: `week` (ISO week), `q` (plate search), `availability` (`AVAILABLE`, `ASSIGNED`, `INACTIVE`, or empty), and `page` (25 vehicles). Returns seven Berlin day boundaries, complete daily assignment counts for each vehicle, current driver, availability totals and `asOf`. Availability totals cover the organization, independently of the plate filter.

Pass `vehicleId` to retrieve assignment history, optionally `date` within that week and `page` (25 assignments). Tenant scope is enforced. Day overlap uses start before the interval end and assignment end strictly after the interval start, or an open assignment. Open assignments carry forward; this is not future reservation availability.

Driver listing accepts `availableForAssignment=1` for active drivers with no open assignment. Creation and return use the existing assignment mutation endpoints and recheck live staff permissions. Duplicate returns return a conflict after the first succeeds.

## Stage 9: record history

`GET /api/v1/record-history?module=drivers|vehicles&id=...` returns `record` (current title and selected fields), available `types`, `items`, `total`, `page`, `pageSize` (25) and `week`. Optional `type`: `ASSIGNMENT`, `DOCUMENT`, `KEY`, `LIFECYCLE`, or vehicle-only `PHOTO`. Empty type selects all permitted events. Optional `week` filters event timestamps to the half-open Berlin ISO-week interval. Empty week selects all time. Events sort by timestamp descending, then unique event ID descending. Summary, page and count share a repeatable-read transaction.

Staff can read records within their organization, including archived records. Drivers can request only their own driver record and assignment events; full vehicle histories and other event types are denied. Live session validation remains mandatory. Responses contain no storage keys, raw audit details or file download URLs.

## Stage 10: multi-participant waves

Wave mutations remain `POST /api/v1/waves`. Create data: `{name,startAt,packages,delivered,participants:[{driverId,vehicleId}]}`. Timestamps require an explicit offset. Numeric counts are integers 0–1,000,000; delivered cannot exceed packages. Participants are bounded to 100 distinct driver/vehicle pairs. Empty drafts are allowed. New partial pairs and duplicate drivers/vehicles are rejected.

Update is allowed only while PLANNED and requires the full create payload plus `expectedVersion`. Progress is allowed only while ACTIVE with `{delivered,expectedVersion}`. Transition requires `{status,expectedVersion}` and allows PLANNED → ACTIVE → COMPLETED only. Starting requires complete active pairs with no participant already in another active wave. Completing requires delivered equal to packages. Every successful write increments the version and appends an audit entry in the same transaction. Stale writes return 409.

GET results include `version`, `participantCount`, and `participants` with scoped driver names and vehicle plates. Driver-role access to waves remains denied. Legacy top-level driver/vehicle columns mirror the first pair for compatibility; the participants relation is authoritative and legacy-only writes are no longer accepted.

## Stage 11: inventory custody

`GET /api/v1/inventory-custody?itemId=...` requires inventory-read permission. Optional `status=OPEN|CLOSED|ALL` (default OPEN) and `page` (25 rows) filter the custody list. Returns the item and available stock, `issued` (outstanding quantity across all custody records regardless of filter), page metadata, and custody rows with holder, issue reason/time, original quantity, returned quantity, remaining quantity and version. Count, balance and page share a repeatable-read transaction.

Use the existing `POST /api/v1/inventory` mutation endpoint. For `action: "issue"`, `id` is the item ID and data is `{requestId,quantity,reason,driverId}` or `{requestId,quantity,reason,vehicleId}`. The UUID requestId must remain stable when retrying the same issue. Replaying the same actor/payload returns the original custody ID without another stock change; changed payloads conflict. Exactly one active same-organization recipient is required. Quantity is an integer 1–1,000,000 and reason is required (max 500 characters).

For `action: "return"`, `id` is the custody record ID and data is `{quantity,reason,expectedVersion}`. Return quantities cannot exceed the balance; successful returns increment version. A stale version conflicts, including a duplicate retry after a successful return. Refresh and check the balance before another action. Returns remain possible for archived recipients.

New movement records carry ISSUE/RETURN types and the custody ID; existing movements retain their quantity/reason with ADJUST type. Every issue/return rechecks live staff permission and commits stock, custody, movement and audit records atomically. Driver-role access remains denied.

## Stage 12: inventory movement history

`GET /api/v1/inventory-movements` requires inventory-read permission; drivers are denied. Optional parameters: `itemId` (one item; omitted means all organization inventory), `q` (literal text search, max 120 characters), `type=ADJUST|ISSUE|RETURN`, `week` (Berlin ISO week), and `page` (25 records). Text search covers item name/SKU, reason, recipient name/plate and staff name. Week boundaries are half-open. Sorting is newest timestamp, then movement ID descending.

Returns `item` (current summary or null), `items`, `total`, `increase`, `decrease`, `net`, `page` and `pageSize`. Aggregated quantity totals are decimal strings to preserve integer precision; they cover the full filter, not just one page. They describe recorded quantity changes, not historical stock balances or valuation. Names and item metadata reflect current records. Staff names are resolved only through a membership in the same organization; missing attribution uses a fallback label.

The additive migration creates a movement lookup index and a trigger rejecting changes/deletions of existing movement rows. Normal issue, return and stock correction operations continue to append records. No update/delete endpoint is added.

## Stage 13: low-stock alerts

Use `POST /api/v1/inventory` with `action: "alert-settings"`, the item ID, and `{expectedVersion,recipientId,minimumStock}`. The recipient is an active same-organization administrator or dispatcher, or null to disable new notifications. Self-selection is allowed. Minimum stock is an integer 0–1,000,000. A stale settings version returns 409. Inventory GET rows include `alertRecipientId`, `alertVersion`, `alertRecipientName` and `alertStatus`. General inventory edits that change the minimum must supply `expectedAlertVersion`.

`GET /api/v1/recipients?purpose=stock-alert` returns eligible staff, including the current user, with existing search/pagination/ID resolution. This purpose requires inventory-read permission. Notification results include stock alert state and an inventory link target. Driver sessions cannot read stock alerts even after role demotion.

Shortage means available stock strictly below minimum. Stock recovery is stock greater than or equal to minimum; it resolves open alerts for that item. Each shortage episode and recipient has a deterministic notification identity, so retries and concurrent reconciliations do not duplicate alerts or reset read state. Changing the recipient during a shortage can create one alert for the new recipient; returning to an already-notified recipient in the same episode does not create another. New notifications are suppressed for unavailable recipients. Existing notifications remain historical records, resolved when stock recovers.

`npm run jobs:stock` scans candidate items in cursor batches and locks/evaluates each in its own transaction. Schedule periodically in deployment; the code does not install a scheduler. Immediate stock-write evaluation remains active without the periodic job. No external email or push integration is part of this stage.

## Stage 16: operational notifications

`GET /api/v1/notifications` lists notifications received by or assigned to the current user, with text search across title/body/next action and stable pagination. Driver sessions exclude stock/staff-only records. `GET /api/v1/notification-details?id=...` returns the same scoped record with owner and workflow details. Ownership does not grant access to unrelated notifications.

`POST /api/v1/notifications` supports `read`, `acknowledge`, `assign`, `complete` and `retry`. All except read require `{expectedVersion}`; repeated acknowledgement by the current owner is idempotent. Assignment additionally requires `{ownerId,nextAction,dueAt?}`; the optional deadline is an ISO timestamp with offset or null. Only staff may assign an active same-organization staff owner. Assignment resets acknowledgement/read state and the reminder cycle. Completion requires a prior acknowledgement and `{outcome}`. Only the current owner may acknowledge/complete. Stock alerts cannot be manually completed.

Read state is shared for a notification record; acknowledgement records the acting owner separately. Workflow actions recheck live membership, serialize on the notification and append audit entries. Stale edits return 409. Reminder records direct workflow actions to their original notification.

`npm run jobs:reminders` processes due original notifications in cursor batches. It creates one durable in-app reminder and marks the parent CREATED in the same transaction; this status means a record was created, not that a person saw it. Reminder records do not schedule further reminders. Unavailable recipients retry after 5, 10, 20 and 40 minutes; a fifth failed attempt becomes FAILED with no further automatic attempt. `retry` requeues RETRY/FAILED records and increments the workflow version. Unexpected database failures abort the transaction and the job exits with an error; the deployment scheduler must rerun it.

New original notifications schedule a reminder after 24 hours. Acknowledgement cancels a generic reminder, but an assigned next action retains its due reminder (24 hours if no due date). Completion prevents further reminders and resolves reminder records. Historical notifications keep no schedule unless explicitly assigned a next action. External email/push delivery is outside this stage.

## Audit and security investigation (Stage 17)

`GET /api/v1/audit` requires a live active ADMIN/SUPER_ADMIN membership and scopes all records to its organisation. Parameters: `source=audit|security` (default audit), inclusive Berlin dates `from`/`to` (`YYYY-MM-DD`), exact `actor` account ID, exact `action` action/kind, exact `record` resource ID, `request` event reference (security only), and integer `page` (1–100000). Text filters are limited to 200 characters. Invalid parameters return 400; insufficient privileges return 403. No write operation is granted.

Response contains `items`, `total`, `page`, `pageSize` (25), `source`. Rows include metadata with sensitive keys redacted, current tenant-member actor names and recorded identifiers. Date/ID descending ordering is stable for equal timestamps; totals and rows share a repeatable-read snapshot per request. Separate page requests can reflect newly appended events. New account-access changes atomically create `account-access-changed` security events; the `requestId` field is an event reference, not an HTTP trace. Historical security events without organisation attribution are excluded. See `STAGE-17.md` for coverage limitations.

## Generic list sorting/filtering (Stage 18)

Generic lists support allowlisted `sort` and `dir=asc|desc`; the client shares the field allowlist in `src/lib/list-options.ts`. Sorting is applied before database pagination, with an ID tie-breaker. Unsupported sort fields/directions/statuses and invalid nonempty `page`/`pageSize` return 400. Pages are 1–100000, sizes 1–100. Nullable database fields follow PostgreSQL defaults (ascending: null last; descending: null first).

Document `status=VALID|EXPIRING|EXPIRED` filters match the displayed expiry calculation, using one timestamp per request. Score `status` matches the exact source-defined status string, up to 120 characters, within the selected committed week. Generic statuses use fixed allowlists rather than choices from the current page. Driver vehicle filters intersect with assignment ownership. Planning defaults to the current Berlin week when no week is supplied.

Reports apply `q` to the complete bounded aggregate list, then order and paginate it. The UI CSV link preserves `q`, `week`, `sort` and `dir`, requests page 1 with size 100, and exports all matching report aggregates. It does not export underlying operational records. Accounts, invitations, audit and the staff assignment board retain their specialised contracts.
