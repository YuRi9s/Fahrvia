import { listOptions } from "../lib/list-options";
import { AppError } from "./policy";
export function parseListOptions(module: string, params: URLSearchParams) {
  const config = listOptions[module];
  if (!config) return null;
  const sort = params.get("sort") || config.defaultSort;
  const dir = params.get("dir") || config.defaultDir;
  const status = params.get("status") || "";
  if (!config.sorts.includes(sort) || !["asc", "desc"].includes(dir))
    throw new AppError(400, "Ungültige Sortierung.");
  if (
    status &&
    (module === "score"
      ? status.length > 120
      : !config.statuses?.includes(status))
  )
    throw new AppError(400, "Ungültiger Statusfilter.");
  for (const [key, max] of [
    ["page", 100000],
    ["pageSize", 100],
  ] as const) {
    const value = params.get(key);
    if (value && (!/^\d+$/.test(value) || +value < 1 || +value > max))
      throw new AppError(400, "Ungültige Seitenauswahl.");
  }
  const direction = dir as "asc" | "desc";
  const orderBy: Record<string, "asc" | "desc">[] = [{ [sort]: direction }];
  // A deterministic tie-breaker prevents unstable page boundaries for equal values.
  if (module === "drivers" && sort === "lastName")
    orderBy.push({ firstName: direction });
  if (module === "categories" && sort === "type")
    orderBy.push({ name: direction });
  orderBy.push({ id: direction });
  return { sort, dir: direction, status, orderBy };
}
