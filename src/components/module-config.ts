export type Field = {
  key: string;
  type?: string;
  options?: string[];
  required?: boolean;
};
const f = (key: string, type = "text", required = false): Field => ({
  key,
  type,
  required,
});
const select = (key: string, options: string[]): Field => ({ key, options });
export const configs: Record<
  string,
  { columns: string[]; fields: Field[]; create?: boolean }
> = {
  drivers: {
    columns: [
      "firstName",
      "lastName",
      "email",
      "phone",
      "transporterId",
      "status",
    ],
    fields: [
      f("firstName", "text", true),
      f("lastName", "text", true),
      f("email", "email", true),
      f("phone"),
      f("transporterId"),
    ],
    create: true,
  },
  vehicles: {
    columns: [
      "plate",
      "brand",
      "model",
      "year",
      "vin",
      "ownership",
      "provider",
      "driverName",
      "status",
    ],
    fields: [
      f("plate", "text", true),
      f("vin"),
      f("brand", "text", true),
      f("model", "text", true),
      f("year", "number"),
      select("ownership", ["OWNED", "RENTED", "LEASED"]),
      f("provider"),
      f("inFleet", "date"),
      f("deFleet", "date"),
      f("keyCount", "number"),
    ],
    create: true,
  },
  assignments: {
    columns: ["plate", "driverName", "startAt", "endAt"],
    fields: [f("vehicleId", "vehicle", true), f("driverId", "driver", true)],
    create: true,
  },
  keys: {
    columns: ["plate", "slot", "status", "location", "driverName"],
    fields: [
      select("location", ["OFFICE", "DRIVER", "MISSING"]),
      f("driverId", "driver"),
    ],
  },
  planning: {
    columns: ["title", "startAt", "endAt", "notes"],
    fields: [
      f("title", "text", true),
      f("startAt", "datetime-local", true),
      f("endAt", "datetime-local", true),
      f("driverId", "driver"),
      f("vehicleId", "vehicle"),
      f("notes", "textarea"),
    ],
    create: true,
  },
  waves: {
    columns: [
      "name",
      "startAt",
      "packages",
      "delivered",
      "participantCount",
      "status",
    ],
    fields: [
      f("name", "text", true),
      f("startAt", "datetime-local", true),
      f("packages", "number", true),
      f("delivered", "number"),
      f("driverId", "driver"),
      f("vehicleId", "vehicle"),
    ],
    create: true,
  },
  "work-times": {
    columns: [
      "driverName",
      "startAt",
      "endAt",
      "breakMinutes",
      "totalHours",
      "status",
    ],
    fields: [
      f("driverId", "driver", true),
      f("startAt", "datetime-local", true),
      f("endAt", "datetime-local"),
      f("breakMinutes", "number"),
    ],
    create: true,
  },
  inventory: {
    columns: [
      "name",
      "sku",
      "category",
      "stock",
      "minimumStock",
      "alertStatus",
      "alertRecipientName",
      "location",
    ],
    fields: [
      f("name", "text", true),
      f("sku", "text", true),
      f("category"),
      f("stock", "number", true),
      f("minimumStock", "number"),
      f("location"),
    ],
    create: true,
  },
  documents: {
    columns: ["title", "filename", "expiresAt", "status"],
    fields: [],
  },
  photos: {
    columns: ["plate", "reporterName", "notes", "damage", "createdAt"],
    fields: [],
  },
  score: {
    columns: [
      "driverName",
      "week",
      "totalScore",
      "rank",
      "packages",
      "bonus",
      "focusArea",
      "status",
    ],
    fields: [],
  },
  messages: {
    columns: ["subject", "body", "senderName", "createdAt"],
    fields: [
      f("recipientId", "recipient", true),
      f("subject", "text", true),
      f("body", "textarea", true),
    ],
    create: true,
  },
  notifications: {
    columns: [
      "title",
      "body",
      "ownerName",
      "workflowState",
      "dueAt",
      "readAt",
      "createdAt",
    ],
    fields: [],
  },
  reports: { columns: ["type", "label", "value"], fields: [] },
  categories: {
    columns: ["type", "name", "status", "usageCount"],
    fields: [
      select("type", ["BRAND", "PROVIDER", "STATION", "GROUP"]),
      f("name", "text", true),
    ],
    create: true,
  },
};
