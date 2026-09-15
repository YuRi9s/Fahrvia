> Design baseline. Read `RELEASE_STATUS.md`, `API.md` and `OPERATIONS.md` for the current implementation and remaining gaps. Some decisions below describe the intended v1 target.

# Initial threat model

Design-stage assessment. No penetration test or security scan has run.

## Assets and actors

Assets: employee identity, sessions, performance metrics, bonuses, customer delivery details, documents, vehicle history, key custody, messages, database integrity and service availability.

Actors: anonymous attacker, malicious authenticated driver, compromised dispatcher, compromised administrator, cross-tenant user, hostile upload source and operator with infrastructure access.

Trust boundaries: browser→server; authentication→domain policy; server→database; server→private storage; parser→untrusted bytes; application→email; application→logs/monitoring. Administrative roles remain subject to scope and audit.

## Threats, controls and required verification

| Threat                                         | Proposed control                                                                             | Required evidence                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Driver reads another score                     | Principal-derived driver scope and minimal DTO                                               | Modified ID/week/API/action requests return no foreign rows or identifiers   |
| Cross-tenant relation injection                | Server organization scope plus composite foreign keys                                        | Attempt linking a foreign vehicle, driver, document and object               |
| Privilege escalation                           | Central deny-by-default policy; field allowlists; session invalidation                       | Forged role fields, direct requests and post-revocation access denied        |
| Partial MFA session used as admin              | Privileged operations require completed MFA state                                            | Call protected APIs before second factor and after recovery/revocation       |
| Credential attack or reset abuse               | Mature auth, durable rate limits, generic recovery responses, expiring one-use tokens        | Concurrent attempts across app instances; token reuse and expiry             |
| XSS and stored hostile text                    | React escaping, strict CSP, no arbitrary HTML                                                | Hostile names/messages/source labels rendered as text                        |
| CSRF and origin spoofing                       | Supported auth/framework origin protections; explicit trusted origin; no mutating GET        | Cross-origin form/fetch attempts and forged forwarding headers               |
| SQL injection                                  | Parameterized ORM/SQL; allowlisted sorting                                                   | Injection strings in search, filters and exports                             |
| Upload code execution or path traversal        | Generated object names, allowlists, byte validation, private non-executable storage          | Double extensions, spoofed MIME, traversal filenames, executable payloads    |
| XLSX decompression or parser denial of service | Compressed AND expanded size, sheet/row/cell limits, CPU/memory budget and process isolation | Highly compressed archives, corrupt ZIP, enormous strings/cell counts        |
| Formula or external-reference abuse            | No formula evaluation; reject formula cells in imported data; no link resolution             | Formula, macro-enabled, external-link and cached-formula fixtures            |
| Image decoder attack                           | Patched decoder, pixel/byte limits, re-encode accepted raster formats                        | Malformed/oversized dimensions, deceptive signature, rejected unsafe formats |
| Public/private file confusion                  | Quarantine states; subject authorization on retrieval; short-lived signed access             | Guessing keys, foreign object attachment, accessing rejected files           |
| Assignment or inventory race                   | Transactional lock/check/write with DB constraints                                           | Parallel assignments and decrements allow only valid outcomes                |
| Import replay or partial publication           | Draft version, idempotency, transaction and revision pointer                                 | Double-click/retry/crash leaves one complete revision or none                |
| Sensitive cache leakage                        | No public caching of private payloads; scoped memoization                                    | Alternating users/tenants never reuse sensitive output                       |
| SSRF via remote image/file URLs                | No arbitrary URL imports; restricted outbound destinations where needed                      | Loopback, metadata, redirected and encoded destination attempts              |
| Audit tampering or secret leakage              | Append-only app privileges; redaction and bounded event schema                               | Mutation role cannot edit/delete audit; canary secrets absent from logs      |
| CSV formula injection                          | Safe export encoding and formula-prefix handling                                             | Open/inspect exported dangerous text, including whitespace/control prefixes  |
| Lost data or unavailable dependencies          | Backups, restore procedure, job retry/dead-letter and health checks                          | Restore rehearsal; dependency outage produces safe useful errors             |

## Initial limits to test and tune

Proposed policy: photos 10 MiB each, 20 per report and 25 megapixels; PDF documents 20 MiB; score imports 10 MiB compressed, 100 MiB expanded, 10 sheets, 20,000 rows and 100 columns. Bound individual cell length and aggregate parsed text as well. These are starting product limits, not OWASP-prescribed values. Enforce stream limits before full buffering. The parser must have a hard runtime/memory budget sized for deployment.

Accept JPEG/PNG initially; AVIF, SVG, HTML and macro-enabled workbooks are not required by the brief. Add formats only after dependency/security review. PDFs remain private downloads with appropriate content disposition; do not treat a malware scan as proof that a PDF is harmless.

## Security baseline

Use [OWASP Top 10:2025](https://owasp.org/Top10/2025/) to categorize risk and [ASVS](https://owasp.org/www-project-application-security-verification-standard/) for testable controls. Target the brief's ASVS 5.0.0 baseline, verifying the current published revision when building the control checklist. Neither reference establishes compliance by itself.

[OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) supports layered validation and protected storage. Content type supplied by a client is not trustworthy. Our numerical limits and quarantine workflow are application design choices.

Do not log credentials, tokens, raw documents, raw auth headers or full import rows. Log actor identifiers, resource identifiers, action, outcome and correlation ID with bounded redacted metadata. Restrict log readers and retention.

## Residual risks and release gates

Infrastructure operators can access systems outside application controls; infrastructure IAM and audit must address that separately. A stolen short-lived signed URL remains usable until expiry unless the storage architecture supports stronger revocation. Use server-proxied downloads when immediate revocation is required.

Retention, lawful personnel-data processing and contractual terms need deployment-specific decisions. This package provides privacy-conscious engineering, not a legal compliance finding.

Before production: finish dependency assessment, implement the controls, execute negative tests, scan exact locked dependencies and container images, review failed findings, rehearse recovery and record remaining risks. A drafted threat model is not a completed security review.
