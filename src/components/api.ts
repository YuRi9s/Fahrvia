import { de } from "@/messages/de";
export type Row = Record<string, unknown>;
export type ListData = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
};
export async function request<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? de.noPermission
        : typeof data.error === "string"
          ? data.error
          : de.error,
    );
  return data as T;
}
export const mutate = (
  module: string,
  action: string,
  id?: string,
  data?: Row,
) =>
  request(`/api/v1/${module}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, id, data }),
  });
export function formatValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (
    (key.endsWith("At") || ["date", "inFleet", "deFleet"].includes(key)) &&
    typeof value === "string"
  ) {
    const date = new Date(value);
    if (!isNaN(date.getTime()))
      return new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        ...(!["date", "inFleet", "deFleet", "expiresAt"].includes(key)
          ? { timeStyle: "short" as const }
          : {}),
      }).format(date);
  }
  return String(value);
}
