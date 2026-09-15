"use client";
import { useEffect, useRef, useState } from "react";
import { request, type ListData, type Row } from "./api";
import { valueLabel, de } from "@/messages/de";
export function AccountsPanel({
  initialData,
  currentUserId,
  isSuperAdmin,
}: {
  initialData?: unknown;
  currentUserId: string;
  isSuperAdmin: boolean;
}) {
  const [data, setData] = useState(initialData as ListData);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [role, setRole] = useState("DISPATCHER");
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      request<ListData>(
        `/api/v1/accounts?${new URLSearchParams({ q: query, status, page: String(page) })}`,
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
  }, [query, status, page, epoch]);
  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/v1/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          version: editing.version,
          role,
          active,
          reason,
        }),
      });
      dialog.current?.close();
      setEditing(null);
      setNotice(
        "Konto aktualisiert. Bestehende Sitzungen wurden beendet; eine neue Anmeldung ist erforderlich.",
      );
      setEpoch((v) => v + 1);
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
          type="search"
          aria-label="Benutzerkonten suchen"
          placeholder="Name oder E-Mail suchen …"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Zugangsstatus filtern"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Alle Zugänge</option>
          <option value="active">Aktiv</option>
          <option value="disabled">Gesperrt</option>
        </select>
        <button onClick={() => setEpoch((v) => v + 1)}>Aktualisieren</button>
      </div>
      <p className="muted">
        Rollen und Zugang verwalten. Fahrerprofile und ihre Historie bleiben
        erhalten. Das eigene Konto und Superadministratoren sind geschützt.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert account-notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel" aria-busy={loading}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name / E-Mail</th>
                <th>Rolle</th>
                <th>Zugang</th>
                <th>Zwei-Faktor</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => {
                const protectedAccount =
                  row.userId === currentUserId ||
                  row.role === "SUPER_ADMIN" ||
                  (!isSuperAdmin && row.role === "ADMIN");
                return (
                  <tr key={String(row.id)}>
                    <td>
                      <strong>{String(row.name)}</strong>
                      <br />
                      {String(row.email)}
                      {row.driverStatus === "INACTIVE" && (
                        <p className="muted">Fahrerprofil archiviert</p>
                      )}
                    </td>
                    <td>{valueLabel(String(row.role))}</td>
                    <td>{row.active ? "Aktiv" : "Gesperrt"}</td>
                    <td>
                      {row.twoFactorEnabled ? "Aktiviert" : "Nicht aktiviert"}
                    </td>
                    <td>
                      {protectedAccount ? (
                        <span className="muted">
                          {row.userId === currentUserId
                            ? "Eigenes Konto"
                            : "Geschützt"}
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(row);
                            setRole(String(row.role));
                            setActive(Boolean(row.active));
                            setReason("");
                            setError("");
                            dialog.current?.showModal();
                          }}
                        >
                          Verwalten
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data?.items.length && (
          <p className="empty-state">Keine Benutzerkonten gefunden.</p>
        )}
        <div className="table-toolbar">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((v) => v - 1)}
          >
            Zurück
          </button>
          <span>
            Seite {page} · {data?.total || 0} Konten
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
        aria-labelledby="account-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="dialog-heading">
            <h2 id="account-title">Konto verwalten</h2>
          </div>
          <p className="invitation-copy">
            <strong>{String(editing?.name || "")}</strong>
            <br />
            {String(editing?.email || "")}
          </p>
          <fieldset disabled={busy} className="invitation-fields">
            <div className="form-grid">
              <label>
                Rolle
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="DISPATCHER">Disponent</option>
                  {Boolean(editing?.driverId) && (
                    <option value="DRIVER">Fahrer</option>
                  )}
                  {isSuperAdmin && <option value="ADMIN">Administrator</option>}
                </select>
              </label>
              <label>
                Zugang
                <select
                  value={active ? "active" : "disabled"}
                  onChange={(e) => setActive(e.target.value === "active")}
                >
                  <option value="active">Aktiv</option>
                  <option value="disabled">Gesperrt</option>
                </select>
              </label>
              <label className="span-two">
                Grund der Änderung
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <p className="invitation-copy">
            {valueLabel(String(editing?.role || ""))} → {valueLabel(role)} ·{" "}
            {editing?.active ? "Aktiv" : "Gesperrt"} →{" "}
            {active ? "Aktiv" : "Gesperrt"}
          </p>
          <p className="invitation-copy">
            Alle bestehenden Sitzungen werden beendet. Offene Einladungslinks
            dieses Kontos werden ungültig und müssen erneut gesendet werden. Die
            Änderung und ihr Grund werden protokolliert.
          </p>
          {role === "ADMIN" && (
            <p className="invitation-copy">
              Administratoren benötigen im Produktivbetrieb eine bestätigte
              Zwei-Faktor-Anmeldung.
            </p>
          )}
          {role === "DRIVER" &&
            active &&
            editing?.driverStatus !== "ACTIVE" && (
              <p className="invitation-copy">
                Das Fahrerprofil muss zuerst reaktiviert werden.
              </p>
            )}
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
            <button
              className="primary"
              disabled={
                busy ||
                reason.trim().length < 3 ||
                (role === editing?.role && active === editing?.active) ||
                (role === "DRIVER" &&
                  active &&
                  editing?.driverStatus !== "ACTIVE")
              }
            >
              {busy ? de.loading : "Änderung bestätigen"}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
