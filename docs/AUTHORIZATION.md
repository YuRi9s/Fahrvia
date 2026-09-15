> Design baseline. Read `RELEASE_STATUS.md`, `API.md` and `OPERATIONS.md` for the current implementation and remaining gaps. Some decisions below describe the intended v1 target.

# Proposed authorization policy

Default deny. A permission grants an operation within a resource scope; it does not grant access to every organization. Resolve active organization membership from the authenticated server session, verify it, then apply resource ownership checks.

## Initial permission matrix

“Organization” means the active organization only. “Own” means the session-linked driver. SUPER_ADMIN requires explicit organization context and audited access; it is not an unscoped data-query bypass.

| Operation                              | SUPER_ADMIN                   | ADMIN                                     | DISPATCHER                                  | DRIVER                                                 |
| -------------------------------------- | ----------------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Organization provisioning              | Yes                           | No                                        | No                                          | No                                                     |
| Manage admin roles/accounts            | Yes, audited                  | No                                        | No                                          | No                                                     |
| Provision/revoke driver accounts       | Organization                  | Organization                              | No                                          | No                                                     |
| Driver operational records             | Organization                  | Organization                              | Read/edit operational fields                | Own read                                               |
| Vehicle create/edit/archive/reactivate | Organization                  | Organization                              | Read/edit operational fields; no archive    | Assigned vehicle read                                  |
| Categories                             | Organization                  | Organization                              | Read                                        | No                                                     |
| Assignments and key custody            | Organization                  | Organization                              | Organization                                | Own read                                               |
| Photo/damage reports                   | Organization                  | Organization                              | Organization                                | Create/read own reports on authorized assigned vehicle |
| Score import/revert                    | Organization                  | Organization                              | No                                          | No                                                     |
| Score and delivery details             | Organization                  | Organization                              | No by default                               | Own read                                               |
| Plan and waves                         | Organization                  | Organization                              | Organization                                | Own assigned activities read                           |
| Work-time create/correct               | Organization                  | Organization                              | Organization, audited                       | Own read                                               |
| Work-time approve                      | Organization                  | Organization                              | No                                          | No                                                     |
| Inventory movements                    | Organization                  | Organization                              | Organization                                | Own custody read                                       |
| Driver documents                       | Organization                  | Organization                              | Status/expiry metadata only                 | Own authorized documents                               |
| Vehicle documents                      | Organization                  | Organization                              | Operational documents                       | Explicitly driver-visible assigned-vehicle documents   |
| Operational reports                    | Organization                  | Organization                              | Excluding restricted score/personnel fields | No                                                     |
| Internal messages                      | Participant only              | Participant only                          | Participant only                            | Participant only                                       |
| Notifications                          | Recipient only                | Recipient only                            | Recipient only                              | Recipient only                                         |
| Audit/security logs                    | Restricted organization scope | Organization audit; limited security view | No                                          | No                                                     |
| Profile/theme/logout                   | Own                           | Own                                       | Own                                         | Own                                                    |

Dispatchers have no implicit access to compensation, complete personnel documents or score reports. Permissions can be expanded later through an explicit role-policy change with tests. Platform administrators cannot silently read every private conversation.

## Enforcement contract

1. Authenticate and verify session validity and any required MFA state.
2. Verify organization membership and permission.
3. Validate input including route IDs and query parameters.
4. Query using organization scope plus driver/participant/subject restrictions.
5. Recheck state inside the write transaction when it can change concurrently.
6. Return a deliberately selected DTO. Cache keys and storage access must retain the same scope.

Driver routes accept a period, not an authoritative driverId. If an external contract includes a driverId, compare it with the principal and reject a mismatch before querying. Scope must also apply to exports, thumbnails, signed downloads, search suggestions and dashboard aggregates.

Role changes and account deactivation revoke or invalidate applicable sessions. A stale session must not retain revoked permissions through indefinite cached role claims.

## Required negative tests

Test every protected entrypoint unauthenticated, with a revoked session, wrong role, wrong organization and wrong resource owner. Include two drivers in one organization and a third in another. Inspect serialized responses for forbidden fields, rather than checking only visible text.

Exercise manipulated route IDs, duplicate parameters, direct Server Action requests, export endpoints, guessed object keys, old download links, pending-MFA sessions and access immediately after role revocation. A hidden navigation item is not test evidence.
