"use client";
import { listOptions } from "@/lib/list-options";
import { NotificationDialog } from "./notification-dialog";
import { StockAlertDialog } from "./stock-alert-dialog";
import { InventoryHistoryDialog } from "./inventory-history-dialog";
import { InventoryCustodyDialog } from "./inventory-custody-dialog";
import { WaveDialog } from "./wave-dialog";
import { shiftWeek } from "@/lib/berlin-time";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { de, fieldLabel, valueLabel } from "@/messages/de";
import { configs } from "./module-config";
import { request, mutate, Row, ListData, formatValue } from "./api";
import { ReactivateDriverDialog } from "./reactivate-driver-dialog";
import { CategoryDialog } from "./category-dialog";
import { KeyDialog } from "./key-dialog";
import { RecordHistoryDialog } from "./record-history-dialog";
import { KeyHistoryDialog } from "./key-history-dialog";
import { EntityDialog } from "./entity-dialog";
import { PlanningCalendar } from "./planning-calendar";
import { DeliveryPanel } from "./delivery-panel";
import { isoWeek } from "@/server/validation";
import { DriverScore, ScoreImport, DeliveryBrowser } from "./score-panel";
export function ModuleTable({
  module,
  initialData,
  isDriver,
  isAdmin,
  initialQuery = "",
  ownDriverId,
}: {
  module: string;
  initialData?: unknown;
  isDriver: boolean;
  isAdmin: boolean;
  initialQuery?: string;
  ownDriverId?: string;
}) {
  const [data, setData] = useState<ListData>(
    (initialData as ListData) || { items: [], total: 0, page: 1, pageSize: 25 },
  );
  const params = new URLSearchParams(initialQuery);
  const options = listOptions[module];
  const [sort, setSort] = useState(
    params.get("sort") || options?.defaultSort || "",
  );
  const [direction, setDirection] = useState(
    params.get("dir") || options?.defaultDir || "asc",
  );
  const [detailDriver, setDetailDriver] = useState<Row | null>(null);
  const [query, setQuery] = useState(params.get("q") || "");
  const [status, setStatus] = useState(params.get("status") || "");
  const [week, setWeek] = useState(
    params.get("week") ||
      (["planning", "score"].includes(module) ? isoWeek(new Date()) : ""),
  );
  const [page, setPage] = useState(Number(params.get("page")) || 1);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(
    String((initialData as ListData & { error?: string })?.error || ""),
  );
  const [dialog, setDialog] = useState<{ row?: Row; action?: string } | null>(
    null,
  );
  const [keyDialog, setKeyDialog] = useState<{
    row?: Row;
    action: "create" | "update" | "retire" | "replace";
  } | null>(null);
  const [notificationId, setNotificationId] = useState<string | null>(null);
  const [stockAlertRow, setStockAlertRow] = useState<Row | null>(null);
  const [inventoryHistory, setInventoryHistory] = useState<{
    itemId?: string;
  } | null>(null);
  const [custodyItemId, setCustodyItemId] = useState<string | null>(null);
  const [waveDialog, setWaveDialog] = useState<{
    row?: Row;
    action?: "edit" | "view" | "transition";
  } | null>(null);
  const [recordHistoryId, setRecordHistoryId] = useState<string | null>(null);
  const [keyHistoryId, setKeyHistoryId] = useState<string | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{
    row: Row;
    action: "update" | "archive" | "reactivate";
  } | null>(null);
  const [restoreDriver, setRestoreDriver] = useState<Row | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);
  const config = configs[module];
  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q: query,
      status,
      page: String(page),
      ...(sort ? { sort, dir: direction } : {}),
    });
    if (week) params.set("week", week);
    try {
      const result = await request<ListData>(`/api/v1/${module}?${params}`);
      if (requestId !== latestRequest.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setData(result);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params}`,
      );
    } catch (e) {
      if (requestId === latestRequest.current)
        setError(e instanceof Error ? e.message : de.error);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [module, query, status, page, week, sort, direction]);
  useEffect(() => {
    const timer = setTimeout(reload, 250);
    const invalidate = () => {
      latestRequest.current++;
    };
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [reload]);
  async function act(action: string, row: Row, extra?: Row) {
    setBusy(true);
    setError("");
    try {
      await mutate(module, action, String(row.id), extra);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  if (!config) return <p className="alert">{de.unavailable}</p>;
  const editable =
    !isDriver &&
    (module !== "categories" || isAdmin) &&
    config.fields.length > 0 &&
    !["assignments", "messages"].includes(module);
  return (
    <>
      {notificationId && (
        <NotificationDialog
          key={notificationId}
          id={notificationId}
          onClose={() => setNotificationId(null)}
          onChanged={() => void reload()}
        />
      )}
      {stockAlertRow && (
        <StockAlertDialog
          row={stockAlertRow}
          onClose={() => setStockAlertRow(null)}
          onSaved={() => {
            setNotice("Warnungseinstellungen gespeichert.");
            void reload();
          }}
        />
      )}
      {inventoryHistory && (
        <InventoryHistoryDialog
          key={inventoryHistory.itemId || "all"}
          {...inventoryHistory}
          onClose={() => setInventoryHistory(null)}
          onCustody={(id) => {
            setInventoryHistory(null);
            setCustodyItemId(id);
          }}
        />
      )}
      {custodyItemId && (
        <InventoryCustodyDialog
          key={custodyItemId}
          itemId={custodyItemId}
          onClose={() => setCustodyItemId(null)}
          onChanged={() => void reload()}
        />
      )}
      {waveDialog && (
        <WaveDialog
          {...waveDialog}
          onClose={() => setWaveDialog(null)}
          onSaved={() => {
            setNotice("Welle aktualisiert.");
            void reload();
          }}
        />
      )}
      {recordHistoryId && (
        <RecordHistoryDialog
          key={`${module}-${recordHistoryId}`}
          module={module}
          id={recordHistoryId}
          isDriver={isDriver}
          onClose={() => setRecordHistoryId(null)}
        />
      )}
      {keyDialog && (
        <KeyDialog
          {...keyDialog}
          onClose={() => setKeyDialog(null)}
          onSaved={() => {
            setNotice("Schlüssel aktualisiert. Der Verlauf wurde gespeichert.");
            void reload();
          }}
        />
      )}
      {keyHistoryId && (
        <KeyHistoryDialog
          key={keyHistoryId}
          id={keyHistoryId}
          onClose={() => setKeyHistoryId(null)}
          onNavigate={setKeyHistoryId}
        />
      )}
      {categoryDialog && (
        <CategoryDialog
          {...categoryDialog}
          onClose={() => setCategoryDialog(null)}
          onSaved={() => {
            setNotice("Kategorie aktualisiert.");
            void reload();
          }}
        />
      )}
      {notice && (
        <p className="alert account-notice" role="status">
          {notice}
        </p>
      )}
      {restoreDriver && (
        <ReactivateDriverDialog
          row={restoreDriver}
          onClose={() => setRestoreDriver(null)}
          onSaved={() => {
            setNotice(
              "Fahrer reaktiviert. Kontozugang bei Bedarf unter „Konten & Rollen“ freigeben.",
            );
            void reload();
          }}
        />
      )}
      {module === "vehicles" && (
        <nav className="tabs">
          <Link className={!status ? "active" : ""} href="/vehicles">
            {de.vehicles}
          </Link>
          <Link href="/photos">{de.photoTab}</Link>
          <Link href="/assignments">{de.assignmentTab}</Link>
          <Link href="/vehicles?status=INACTIVE">{de.inactiveTab}</Link>
          <Link href="/keys">{de.keyTab}</Link>
        </nav>
      )}
      <div className="table-toolbar">
        <div className="filters">
          <input
            className="search"
            aria-label={de.search}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            maxLength={120}
            placeholder={de.search}
          />
          {options?.statuses && (
            <select
              aria-label={de.status}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{de.all}</option>
              {options.statuses.map((value) => (
                <option key={value} value={value}>
                  {valueLabel(value)}
                </option>
              ))}
            </select>
          )}
          {module === "score" && (
            <input
              aria-label="Score-Status (exakt)"
              placeholder="Score-Status (exakt)"
              maxLength={120}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
          )}
          {options && (
            <>
              <select
                aria-label="Sortieren nach"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
              >
                {options.sorts.map((key) => (
                  <option key={key} value={key}>
                    {fieldLabel(key)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sortierrichtung"
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  setPage(1);
                }}
              >
                <option value="asc">Aufsteigend</option>
                <option value="desc">Absteigend</option>
              </select>
            </>
          )}
          {[
            "score",
            "assignments",
            "planning",
            "waves",
            "work-times",
            "reports",
          ].includes(module) && (
            <input
              type="week"
              aria-label={de.week}
              value={week}
              onChange={(e) => {
                setWeek(
                  e.target.value ||
                    (["score", "planning"].includes(module)
                      ? isoWeek(new Date())
                      : ""),
                );
                setPage(1);
              }}
            />
          )}{" "}
          {(query ||
            status ||
            week ||
            sort !== options?.defaultSort ||
            direction !== options?.defaultDir) && (
            <button
              onClick={() => {
                setSort(options?.defaultSort || "");
                setDirection(options?.defaultDir || "asc");
                setQuery("");
                setStatus("");
                setWeek(
                  ["score", "planning"].includes(module)
                    ? isoWeek(new Date())
                    : "",
                );
                setPage(1);
              }}
            >
              {de.clear}
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {module === "inventory" && !isDriver && (
            <button onClick={() => setInventoryHistory({})}>
              Bestandsverlauf
            </button>
          )}
          {module === "keys" && isAdmin && (
            <button
              className="primary"
              onClick={() => setKeyDialog({ action: "create" })}
            >
              Schlüssel hinzufügen
            </button>
          )}
          {config.create &&
            ((!isDriver &&
              (!["drivers", "vehicles", "categories"].includes(module) ||
                isAdmin)) ||
              module === "messages") && (
              <button
                className="primary"
                onClick={() =>
                  module === "waves" ? setWaveDialog({}) : setDialog({})
                }
              >
                + {de.create}
              </button>
            )}
          {["photos", "documents"].includes(module) && (
            <button
              className="primary"
              onClick={() => setDialog({ action: "upload" })}
            >
              + {de.upload}
            </button>
          )}
          {module === "reports" && (
            <a
              className="button primary"
              href={`/api/v1/reports?${new URLSearchParams({ format: "csv", q: query, ...(week ? { week } : {}), sort, dir: direction, pageSize: "100" })}`}
              download
            >
              {de.export}
            </a>
          )}
        </div>
      </div>
      {module === "score" && isAdmin && <ScoreImport onSaved={reload} />}
      {module === "score" && (
        <DeliveryBrowser
          week={week || isoWeek(new Date())}
          ownDriverId={ownDriverId}
          isAdmin={isAdmin}
          onSaved={reload}
        />
      )}{" "}
      {module === "planning" && (
        <div className="tabs">
          <button
            onClick={() => {
              setWeek(shiftWeek(week || isoWeek(new Date()), -1));
              setPage(1);
            }}
          >
            Vorige KW
          </button>
          <button
            onClick={() => {
              setWeek(isoWeek(new Date()));
              setPage(1);
            }}
          >
            Heute
          </button>
          <button
            onClick={() => {
              setWeek(shiftWeek(week || isoWeek(new Date()), 1));
              setPage(1);
            }}
          >
            Nächste KW
          </button>
        </div>
      )}
      {detailDriver && module === "score" && (
        <section className="panel">
          <button onClick={() => setDetailDriver(null)}>
            Details schließen
          </button>
          <DeliveryPanel
            key={`${detailDriver.id}:${week}`}
            driverId={String(detailDriver.id)}
            driverName={String(detailDriver.name)}
            week={week || isoWeek(new Date())}
            canEdit={isAdmin}
            onSaved={reload}
          />
        </section>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error} <button onClick={reload}>{de.retry}</button>
        </div>
      )}
      {loading && (
        <p className="loading" role="status">
          {de.loading}
        </p>
      )}
      {loading || error ? null : data.items?.length === 0 ? (
        <div className="empty-state">
          <div className="empty-symbol">◇</div>
          <h2>{de.empty}</h2>
          <p>{de.emptyHelp}</p>
        </div>
      ) : module === "planning" ? (
        <PlanningCalendar
          items={data.items || []}
          week={week}
          editable={!isDriver}
          onEdit={(row) => setDialog({ row })}
        />
      ) : module === "score" && isDriver ? (
        <DriverScore items={data.items || []} />
      ) : (
        <div className="table-container" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                {config.columns.map((key) => (
                  <th
                    key={key}
                    aria-sort={
                      sort === key
                        ? direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    {options?.sorts.includes(key) ? (
                      <button
                        className="table-sort"
                        onClick={() => {
                          setSort(key);
                          setDirection(
                            sort === key && direction === "asc"
                              ? "desc"
                              : "asc",
                          );
                          setPage(1);
                        }}
                      >
                        {fieldLabel(key)}
                        {sort === key
                          ? direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    ) : (
                      fieldLabel(key)
                    )}
                  </th>
                ))}
                <th>{de.actions}</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((row, i) => (
                <tr key={String(row.id || i)}>
                  {config.columns.map((key) => (
                    <td key={key}>
                      {["status", "ownership", "location"].includes(key) ? (
                        <span
                          className={`badge badge-${String(row[key]).toLowerCase()}`}
                        >
                          {valueLabel(row[key])}
                        </span>
                      ) : key === "plate" ? (
                        <span className="plate">{String(row[key] || "—")}</span>
                      ) : key === "body" || key === "notes" ? (
                        <details>
                          <summary>
                            {String(row[key] || "—").slice(0, 70)}
                          </summary>
                          <p>{String(row[key] || "")}</p>
                        </details>
                      ) : typeof row[key] === "boolean" ? (
                        valueLabel(row[key])
                      ) : (
                        formatValue(key, row[key])
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {(module === "drivers" ||
                        (module === "vehicles" && !isDriver)) && (
                        <button
                          onClick={() => setRecordHistoryId(String(row.id))}
                        >
                          Details & Verlauf
                        </button>
                      )}
                      {module === "score" && (
                        <button
                          onClick={() =>
                            setDetailDriver({
                              id: row.driverId,
                              name: row.driverName,
                            })
                          }
                        >
                          PHR / Concessions
                        </button>
                      )}
                      {module === "waves" && (
                        <>
                          <button
                            onClick={() =>
                              setWaveDialog({ row, action: "view" })
                            }
                          >
                            Teilnehmer & Details
                          </button>
                          {row.status !== "COMPLETED" && (
                            <button onClick={() => setWaveDialog({ row })}>
                              {row.status === "ACTIVE"
                                ? "Fortschritt"
                                : "Bearbeiten"}
                            </button>
                          )}
                        </>
                      )}
                      {editable && !["keys", "waves"].includes(module) && (
                        <button
                          onClick={() =>
                            module === "categories"
                              ? setCategoryDialog({ row, action: "update" })
                              : setDialog({ row })
                          }
                        >
                          {de.edit}
                        </button>
                      )}
                      {!isDriver && module === "keys" && (
                        <>
                          <button
                            onClick={() => setKeyHistoryId(String(row.id))}
                          >
                            Verlauf
                          </button>
                          {row.status === "ACTIVE" && (
                            <button
                              onClick={() =>
                                setKeyDialog({ row, action: "update" })
                              }
                            >
                              Verwahrung ändern
                            </button>
                          )}
                          {isAdmin && row.status === "ACTIVE" && (
                            <>
                              <button
                                disabled={row.location === "DRIVER"}
                                title={
                                  row.location === "DRIVER"
                                    ? "Zuerst zurücknehmen oder als vermisst melden"
                                    : undefined
                                }
                                onClick={() =>
                                  setKeyDialog({ row, action: "replace" })
                                }
                              >
                                Ersetzen
                              </button>
                              <button
                                disabled={row.location === "DRIVER"}
                                title={
                                  row.location === "DRIVER"
                                    ? "Zuerst zurücknehmen oder als vermisst melden"
                                    : undefined
                                }
                                onClick={() =>
                                  setKeyDialog({ row, action: "retire" })
                                }
                              >
                                Ausmustern
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {isAdmin && module === "categories" && (
                        <button
                          onClick={() =>
                            setCategoryDialog({
                              row,
                              action:
                                row.status === "INACTIVE"
                                  ? "reactivate"
                                  : "archive",
                            })
                          }
                        >
                          {row.status === "INACTIVE"
                            ? de.reactivate
                            : "Archivieren"}
                        </button>
                      )}
                      {isAdmin && ["drivers", "vehicles"].includes(module) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            module === "drivers" && row.status === "INACTIVE"
                              ? setRestoreDriver(row)
                              : act(
                                  row.status === "INACTIVE"
                                    ? "reactivate"
                                    : "archive",
                                  row,
                                )
                          }
                        >
                          {row.status === "INACTIVE"
                            ? de.reactivate
                            : de.archive}
                        </button>
                      )}
                      {!isDriver && module === "assignments" && !row.endAt && (
                        <button
                          disabled={busy}
                          onClick={() => act("close", row)}
                        >
                          {de.return}
                        </button>
                      )}
                      {!isDriver &&
                        module === "waves" &&
                        row.status !== "COMPLETED" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              setWaveDialog({ row, action: "transition" })
                            }
                          >
                            {row.status === "PLANNED"
                              ? "Starten"
                              : "Abschließen"}
                          </button>
                        )}
                      {!isDriver && module === "planning" && (
                        <button
                          disabled={busy}
                          onClick={() => act("delete", row)}
                        >
                          {de.delete}
                        </button>
                      )}
                      {!isDriver && module === "inventory" && (
                        <button onClick={() => setStockAlertRow(row)}>
                          Bestandswarnung
                        </button>
                      )}
                      {!isDriver && module === "inventory" && (
                        <button
                          onClick={() =>
                            setInventoryHistory({ itemId: String(row.id) })
                          }
                        >
                          Verlauf
                        </button>
                      )}
                      {!isDriver && module === "inventory" && (
                        <button
                          onClick={() => setCustodyItemId(String(row.id))}
                        >
                          Ausgabe & Rückgabe
                        </button>
                      )}
                      {!isDriver && module === "inventory" && (
                        <button
                          onClick={() => setDialog({ row, action: "adjust" })}
                        >
                          {de.adjust}
                        </button>
                      )}
                      {isAdmin &&
                        module === "work-times" &&
                        row.status === "SUBMITTED" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              act("approve", row, {
                                expectedVersion: row.version,
                              })
                            }
                          >
                            {de.approve}
                          </button>
                        )}
                      {module === "notifications" &&
                        row.stockItemId != null && (
                          <a
                            className="button"
                            href={`/inventory?q=${encodeURIComponent(String(row.stockSku || ""))}`}
                          >
                            Inventar öffnen
                          </a>
                        )}
                      {module === "notifications" && (
                        <button
                          onClick={() =>
                            setNotificationId(
                              String(row.reminderOfId || row.id),
                            )
                          }
                        >
                          {row.reminderOfId
                            ? "Ursprungsmeldung öffnen"
                            : "Nächste Schritte"}
                        </button>
                      )}
                      {module === "notifications" && !row.readAt && (
                        <button
                          disabled={busy}
                          onClick={() => act("read", row)}
                        >
                          {de.read}
                        </button>
                      )}
                      {module === "documents" && (
                        <button
                          onClick={() => setDialog({ row, action: "upload" })}
                        >
                          Erneuern
                        </button>
                      )}
                      {module === "photos" &&
                      !isDriver &&
                      row.damage &&
                      !row.resolvedAt ? (
                        <button
                          disabled={busy}
                          onClick={() => act("resolve", row)}
                        >
                          Schaden erledigt
                        </button>
                      ) : null}
                      {module === "documents" && row.objectId != null && (
                        <a
                          href={`/api/v1/files/${encodeURIComponent(String(row.objectId))}`}
                        >
                          {de.download}
                        </a>
                      )}
                      {module === "photos" &&
                        Array.isArray(row.files) &&
                        (row.files as Row[]).map((file) => (
                          <a
                            key={String(file.id)}
                            href={`/api/v1/files/${encodeURIComponent(String(file.id))}`}
                          >
                            {String(file.name || de.download)}
                          </a>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>
          {data.total || 0} {de.total} · {de.page} {page} {de.of}{" "}
          {Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 25)))}
        </span>
        <div>
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {de.previous}
          </button>
          <button
            disabled={page * (data.pageSize || 25) >= data.total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {de.next}
          </button>
        </div>
      </div>
      {dialog && (
        <EntityDialog
          module={module}
          row={dialog.row}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
