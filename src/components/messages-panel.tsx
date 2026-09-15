"use client";
import { useState, useEffect, type FormEvent } from "react";
import { request, mutate, formatValue, type Row, type ListData } from "./api";
import { EntityDialog } from "./entity-dialog";
export function MessagesPanel({ currentUserId }: { currentUserId: string }) {
  const [data, setData] = useState<ListData | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [history, setHistory] = useState<ListData | null>(null),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [messagePage, setMessagePage] = useState(1),
    [epoch, setEpoch] = useState(0),
    [compose, setCompose] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      request<ListData>(
        `/api/v1/conversations?${new URLSearchParams({ q, page: String(page) })}`,
        { signal: c.signal },
      )
        .then(setData)
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, page, epoch]);
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    request<ListData>(
      `/api/v1/conversations/${encodeURIComponent(String(selected.id))}?page=${messagePage}`,
      { signal: c.signal },
    )
      .then(setHistory)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [selected, messagePage, epoch]);
  async function read() {
    if (!history) return;
    setBusy(true);
    try {
      for (const row of history.items.filter(
        (r) => r.recipientId === currentUserId && !r.readAt,
      ))
        await mutate("messages", "read", String(row.id));
      setEpoch((e) => e + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Lesestatus konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await mutate("messages", "create", undefined, {
        threadId: selected.id,
        recipientId: selected.participantId,
        subject: selected.subject,
        body: String(new FormData(form).get("body")),
      });
      form.reset();
      setMessagePage(1);
      setEpoch((x) => x + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Nachricht konnte nicht gesendet werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="table-toolbar">
        <input
          aria-label="Unterhaltungen durchsuchen"
          placeholder="Unterhaltungen durchsuchen"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <button className="primary" onClick={() => setCompose(true)}>
          Neue Unterhaltung
        </button>
        <button onClick={() => setEpoch((e) => e + 1)}>Aktualisieren</button>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <section className="panel conversation-layout">
        <div className="conversation-list" aria-label="Unterhaltungen">
          {data?.items.length ? (
            data.items.map((row) => (
              <button
                className="conversation-item"
                key={String(row.id)}
                aria-pressed={selected?.id === row.id}
                onClick={() => {
                  setSelected(row);
                  setMessagePage(1);
                  setHistory(null);
                }}
              >
                <strong>
                  {String(row.participantName)}{" "}
                  {Number(row.unread) > 0 && (
                    <span className="badge">
                      {String(row.unread)} ungelesen
                    </span>
                  )}
                </strong>
                <span>{String(row.subject)}</span>
                <small>{String(row.body)}</small>
                <small>{formatValue("createdAt", row.createdAt)}</small>
              </button>
            ))
          ) : (
            <p>Keine Unterhaltungen.</p>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Zurück
            </button>
            <button
              disabled={!data || page * data.pageSize >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
        <div className="conversation-detail">
          {selected ? (
            <>
              <h2>{String(selected.subject)}</h2>
              <p>{String(selected.participantName)}</p>
              {history ? (
                <>
                  {[...history.items].reverse().map((row) => (
                    <article
                      className={`message-bubble ${row.senderId === currentUserId ? "sent" : ""}`}
                      key={String(row.id)}
                    >
                      <small>
                        {row.senderId === currentUserId
                          ? "Sie"
                          : String(selected.participantName)}{" "}
                        · {formatValue("createdAt", row.createdAt)}
                      </small>
                      <p>{String(row.body)}</p>
                    </article>
                  ))}
                  <div className="pagination">
                    <button
                      disabled={messagePage === 1}
                      onClick={() => setMessagePage((p) => p - 1)}
                    >
                      Neuere
                    </button>
                    <button
                      disabled={messagePage * history.pageSize >= history.total}
                      onClick={() => setMessagePage((p) => p + 1)}
                    >
                      Ältere
                    </button>
                    <button
                      disabled={
                        busy ||
                        !history.items.some(
                          (r) => r.recipientId === currentUserId && !r.readAt,
                        )
                      }
                      onClick={read}
                    >
                      Als gelesen markieren
                    </button>
                  </div>
                </>
              ) : (
                <p role="status">Nachrichten werden geladen …</p>
              )}
              <form onSubmit={reply}>
                <label>
                  Antwort
                  <textarea name="body" required maxLength={10000} rows={4} />
                </label>
                <button className="primary" disabled={busy}>
                  Senden
                </button>
              </form>
            </>
          ) : (
            <p>Wählen Sie eine Unterhaltung aus.</p>
          )}
        </div>
      </section>
      {compose && (
        <EntityDialog
          module="messages"
          onClose={() => setCompose(false)}
          onSaved={() => setEpoch((e) => e + 1)}
        />
      )}
    </>
  );
}
