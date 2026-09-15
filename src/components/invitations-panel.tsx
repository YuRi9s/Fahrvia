"use client";
import { useEffect, useRef, useState } from "react";
import { request, formatValue, type ListData, type Row } from "./api";
import { RecordPicker } from "./record-picker";
import { de, valueLabel } from "@/messages/de";
const statuses: Record<string, string> = {
  PENDING: "Offen",
  EXPIRED: "Abgelaufen",
  ACCEPTED: "Angenommen",
  REVOKED: "Widerrufen",
  INVALIDATED: "Berechtigung geändert – erneut senden",
};
const delivery: Record<string, string> = {
  PENDING: "Versand läuft",
  SENT: "An E-Mail-Dienst übergeben",
  FAILED: "Versand nicht bestätigt",
  MANUAL: "Lokaler Testlink",
};
export function InvitationsPanel({
  initialData,
  isSuperAdmin,
}: {
  initialData?: unknown;
  isSuperAdmin: boolean;
}) {
  const [data, setData] = useState(initialData as ListData);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localLink, setLocalLink] = useState("");
  const [role, setRole] = useState("DRIVER");
  const [revoke, setRevoke] = useState<Row | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      request<ListData>(
        `/api/v1/invitations?${new URLSearchParams({ q: query, page: String(page) })}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setData(result);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : de.error);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, epoch]);
  async function act(action: string, id?: string, payload?: Row) {
    setBusy(true);
    setError("");
    setNotice("");
    setLocalLink("");
    try {
      const result = await request<{
        localLink?: string;
        notice?: string;
        invitation: Row;
      }>("/api/v1/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, data: payload }),
      });
      setLocalLink(result.localLink || "");
      setNotice(
        result.notice ||
          (action === "revoke"
            ? "Einladung widerrufen."
            : result.localLink
              ? "Lokaler Testlink erstellt. Er wird nur jetzt angezeigt und ist 72 Stunden gültig."
              : "Einladung an den E-Mail-Dienst übergeben. Gültig für 72 Stunden."),
      );
      dialog.current?.close();
      confirm.current?.close();
      setRevoke(null);
      setEpoch((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="table-toolbar">
        <input
          aria-label="Einladungen suchen"
          type="search"
          placeholder="Name oder E-Mail suchen …"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <button
          className="primary"
          onClick={() => {
            setError("");
            dialog.current?.showModal();
          }}
        >
          Mitarbeiter einladen
        </button>
        <button onClick={() => setEpoch((value) => value + 1)}>
          Aktualisieren
        </button>
      </div>
      <p className="muted">
        Einladungen gelten 72 Stunden. Erneutes Senden macht den vorherigen Link
        ungültig.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {localLink && (
        <div className="panel invitation-link">
          <label>
            Lokaler Testlink
            <input
              readOnly
              value={localLink}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(localLink);
                setNotice("Testlink kopiert.");
              } catch {
                setNotice("Bitte den Testlink markieren und kopieren.");
              }
            }}
          >
            Link kopieren
          </button>
        </div>
      )}
      <section className="panel" aria-busy={loading}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name / E-Mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Versand</th>
                <th>Gültig bis</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr key={String(row.id)}>
                  <td>
                    <strong>{String(row.name)}</strong>
                    <br />
                    {String(row.email)}
                  </td>
                  <td>{valueLabel(String(row.role))}</td>
                  <td>{statuses[String(row.status)]}</td>
                  <td>{delivery[String(row.delivery)]}</td>
                  <td>
                    {formatValue("expiresAt", row.expiresAt)}
                    <br />
                    {new Intl.DateTimeFormat("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Berlin",
                    }).format(new Date(String(row.expiresAt)))}
                  </td>
                  <td>
                    {["PENDING", "EXPIRED", "INVALIDATED"].includes(
                      String(row.status),
                    ) &&
                      (row.role !== "ADMIN" || isSuperAdmin) && (
                        <div className="invitation-actions">
                          <button
                            disabled={busy}
                            onClick={() => act("resend", String(row.id))}
                          >
                            Erneut senden
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setRevoke(row);
                              confirm.current?.showModal();
                            }}
                          >
                            Widerrufen
                          </button>
                        </div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data?.items.length && (
          <p className="empty-state">Keine Einladungen gefunden.</p>
        )}
        <div className="table-toolbar">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((v) => v - 1)}
          >
            Zurück
          </button>
          <span>
            Seite {page} · {data?.total || 0} Einladungen
          </span>
          <button
            disabled={loading || page * 25 >= (data?.total || 0)}
            onClick={() => setPage((v) => v + 1)}
          >
            Weiter
          </button>
        </div>
      </section>
      <dialog
        ref={dialog}
        className="entity-dialog"
        aria-labelledby="invite-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void act(
              "create",
              undefined,
              role === "DRIVER"
                ? { role, driverId: String(form.get("driverId")) }
                : {
                    role,
                    name: String(form.get("name")),
                    email: String(form.get("email")),
                  },
            );
          }}
        >
          <div className="dialog-heading">
            <h2 id="invite-title">Mitarbeiter einladen</h2>
          </div>
          <fieldset disabled={busy} className="invitation-fields">
            <div className="form-grid">
              <label className="span-two">
                Rolle
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="DRIVER">Fahrer</option>
                  <option value="DISPATCHER">Disponent</option>
                  {isSuperAdmin && <option value="ADMIN">Administrator</option>}
                </select>
              </label>
              {role === "DRIVER" ? (
                <div className="span-two">
                  <RecordPicker
                    name="driverId"
                    kind="driver"
                    eligibleDriver
                    label="Fahrer"
                    required
                  />
                  <p className="muted">
                    Nur aktive Fahrer ohne Benutzerkonto. Name und E-Mail werden
                    aus dem Fahrerprofil übernommen.
                  </p>
                </div>
              ) : (
                <>
                  <label>
                    Name
                    <input name="name" required maxLength={160} />
                  </label>
                  <label>
                    E-Mail
                    <input name="email" type="email" required maxLength={200} />
                  </label>
                </>
              )}
            </div>
          </fieldset>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <footer className="dialog-footer">
            <button
              type="button"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Abbrechen
            </button>
            <button className="primary" disabled={busy}>
              {busy ? de.loading : "Einladung erstellen"}
            </button>
          </footer>
        </form>
      </dialog>
      <dialog
        ref={confirm}
        className="entity-dialog"
        aria-labelledby="revoke-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <h2 id="revoke-title">Einladung widerrufen?</h2>
        </div>
        <p className="invitation-copy">
          Der Link für {String(revoke?.email || "")} wird sofort ungültig.
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button disabled={busy} onClick={() => confirm.current?.close()}>
            Abbrechen
          </button>
          <button
            disabled={busy}
            onClick={() => revoke && act("revoke", String(revoke.id))}
          >
            Widerrufen
          </button>
        </footer>
      </dialog>
    </>
  );
}
