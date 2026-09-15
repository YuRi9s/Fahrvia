/** Identity is assembled from a live session and membership, never client role claims. */
export interface Principal {
  userId: string;
  organizationId: string;
  role: "SUPER_ADMIN" | "ADMIN" | "DISPATCHER" | "DRIVER";
  driverId: string | null;
  name: string;
  email: string;
  organizationName: string;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
const modules = new Set([
  "audit",
  "dashboard",
  "drivers",
  "vehicles",
  "assignments",
  "keys",
  "photos",
  "planning",
  "waves",
  "work-times",
  "inventory",
  "score",
  "documents",
  "reports",
  "messages",
  "notifications",
  "profile",
  "categories",
  "invitations",
  "accounts",
  "recipients",
  "score-imports",
]);
/** Permissions grant operations only; repositories must also apply tenant and ownership scope. */
export function allowed(
  p: Principal,
  module: string,
  operation: "read" | "write",
): boolean {
  if (!modules.has(module)) return false;
  if (module === "audit")
    return operation === "read" && ["ADMIN", "SUPER_ADMIN"].includes(p.role);
  if (p.role === "ADMIN" || p.role === "SUPER_ADMIN") return true;
  if (p.role === "DISPATCHER")
    return (
      !["score", "score-imports", "invitations", "accounts"].includes(module) &&
      (operation === "read" || !["categories", "profile"].includes(module))
    );
  if (p.role !== "DRIVER" || !p.driverId) return false;
  return operation === "write"
    ? ["messages", "notifications", "photos", "documents", "profile"].includes(
        module,
      )
    : [
        "dashboard",
        "drivers",
        "vehicles",
        "assignments",
        "photos",
        "planning",
        "work-times",
        "score",
        "documents",
        "messages",
        "notifications",
        "profile",
        "recipients",
        "keys",
      ].includes(module);
}
export function demand(
  p: Principal,
  module: string,
  operation: "read" | "write",
) {
  if (!allowed(p, module, operation))
    throw new AppError(403, "Für diese Aktion fehlt die Berechtigung.");
}
/** Missing ownership is a denial for drivers, not a wildcard. */
export function assertScope(
  p: Principal,
  record: { organizationId: string; driverId?: string | null },
) {
  if (
    record.organizationId !== p.organizationId ||
    (p.role === "DRIVER" && (!p.driverId || record.driverId !== p.driverId))
  )
    throw new AppError(404, "Der Eintrag wurde nicht gefunden.");
}
