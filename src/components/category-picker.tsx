"use client";
import { useEffect, useState } from "react";
import { request, type ListData } from "./api";
export function CategoryPicker({
  name,
  label,
  initialName = "",
  initialId = "",
  required,
}: {
  name: "brand" | "provider";
  label: string;
  initialName?: string;
  initialId?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(initialName);
  const [selectedId, setSelectedId] = useState(initialId);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ key: string; data: ListData } | null>(
    null,
  );
  const [error, setError] = useState("");
  const key = `${value}:${page}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      request<ListData>(
        `/api/v1/categories?${new URLSearchParams({ type: name === "brand" ? "BRAND" : "PROVIDER", status: "ACTIVE", q: value, page: String(page), pageSize: "25" })}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult({ key, data });
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error
                ? e.message
                : "Kategorien konnten nicht geladen werden.",
            );
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, name, value, page, key]);
  const data = result?.key === key ? result.data : null;
  return (
    <div className="record-picker">
      <label>
        {label}
        {required ? " *" : ""}
        <input
          name={name}
          required={required}
          maxLength={name === "brand" ? 80 : 500}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSelectedId("");
            setPage(1);
            setOpen(true);
          }}
        />
      </label>
      <input type="hidden" name={`${name}CategoryId`} value={selectedId} />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Auswahl schließen" : "Aktive Kategorien suchen"}
      </button>
      {open && (
        <div className="category-results">
          <p className="muted">
            Eine Kategorie auswählen oder einen eigenen Wert eingeben. Passende
            vorhandene Kategorien werden automatisch verknüpft.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <p role="status">Kategorien werden geladen …</p>}
          {data?.items.map((row) => (
            <button
              type="button"
              key={String(row.id)}
              onClick={() => {
                setValue(String(row.name));
                setSelectedId(String(row.id));
                setOpen(false);
              }}
            >
              {String(row.name)}
            </button>
          ))}
          {data?.total === 0 && (
            <p className="muted">Keine aktive Kategorie gefunden.</p>
          )}
          <div className="invitation-actions">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Zurück
            </button>
            <span>Seite {page}</span>
            <button
              type="button"
              disabled={!data || page * 25 >= data.total}
              onClick={() => setPage((v) => v + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
