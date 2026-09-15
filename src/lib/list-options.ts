/** Shared UI/API contract: only supported database fields are offered for sorting. */
export const listOptions: Record<
  string,
  {
    sorts: string[];
    statuses?: string[];
    defaultSort: string;
    defaultDir: "asc" | "desc";
  }
> = {
  drivers: {
    sorts: ["lastName", "firstName", "email", "transporterId", "status"],
    statuses: ["ACTIVE", "INACTIVE"],
    defaultSort: "lastName",
    defaultDir: "asc",
  },
  vehicles: {
    sorts: [
      "plate",
      "brand",
      "model",
      "year",
      "vin",
      "ownership",
      "provider",
      "status",
    ],
    statuses: ["ACTIVE", "INACTIVE", "AVAILABLE", "ASSIGNED"],
    defaultSort: "plate",
    defaultDir: "asc",
  },
  assignments: {
    sorts: ["startAt", "endAt"],
    statuses: ["ACTIVE", "CLOSED"],
    defaultSort: "startAt",
    defaultDir: "desc",
  },
  keys: {
    sorts: ["slot", "status", "location"],
    statuses: ["ACTIVE", "RETIRED"],
    defaultSort: "slot",
    defaultDir: "asc",
  },
  planning: {
    sorts: ["title", "startAt", "endAt"],
    defaultSort: "startAt",
    defaultDir: "asc",
  },
  waves: {
    sorts: ["name", "startAt", "packages", "delivered", "status"],
    statuses: ["PLANNED", "ACTIVE", "COMPLETED"],
    defaultSort: "startAt",
    defaultDir: "desc",
  },
  "work-times": {
    sorts: ["startAt", "endAt", "breakMinutes", "status"],
    statuses: ["OPEN", "SUBMITTED", "APPROVED"],
    defaultSort: "startAt",
    defaultDir: "desc",
  },
  inventory: {
    sorts: ["name", "sku", "category", "stock", "minimumStock", "location"],
    defaultSort: "name",
    defaultDir: "asc",
  },
  documents: {
    sorts: ["title", "expiresAt"],
    statuses: ["VALID", "EXPIRING", "EXPIRED"],
    defaultSort: "expiresAt",
    defaultDir: "asc",
  },
  photos: {
    sorts: ["createdAt", "damage"],
    defaultSort: "createdAt",
    defaultDir: "desc",
  },
  score: {
    sorts: ["week", "totalScore", "rank", "packages", "bonus", "status"],
    defaultSort: "rank",
    defaultDir: "asc",
  },
  messages: {
    sorts: ["subject", "createdAt"],
    defaultSort: "createdAt",
    defaultDir: "desc",
  },
  notifications: {
    sorts: ["title", "dueAt", "readAt", "createdAt"],
    defaultSort: "createdAt",
    defaultDir: "desc",
  },
  categories: {
    sorts: ["type", "name", "status"],
    statuses: ["ACTIVE", "INACTIVE"],
    defaultSort: "type",
    defaultDir: "asc",
  },
  reports: {
    sorts: ["type", "label", "value"],
    defaultSort: "type",
    defaultDir: "asc",
  },
};
