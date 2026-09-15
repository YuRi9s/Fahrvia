"use client";
import { useEffect, useId, useState } from "react";
import { de } from "@/messages/de";
import { request, type ListData, type Row } from "./api";

export type RecordKind = "driver" | "vehicle" | "recipient";
const endpoints: Record<RecordKind, string> = {
  driver: "drivers",
  vehicle: "vehicles",
  recipient: "recipients",
};
function option(row: Row) {
  const name = String(
    row.plate || row.name || `${row.firstName || ""} ${row.lastName || ""}`,
  ).trim();
  const detail = row.transporterId || row.email;
  return {
    id: String(row.userId || row.id),
    label: detail ? `${name} · ${detail}` : name,
  };
}

/** Keep the submitted selection separate from the paginated search results. */
export function RecordPicker({
  name,
  kind,
  label,
  required,
  initialValue = "",
  eligibleDriver = false,
  availableForAssignment = false,
  staffRecipient = false,
}: {
  name: string;
  kind: RecordKind;
  label: string;
  required?: boolean;
  initialValue?: string;
  eligibleDriver?: boolean;
  availableForAssignment?: boolean;
  staffRecipient?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<{ id: string; label: string }>({
    id: initialValue,
    label: de.picker.previousSelection,
  });
  const [selectionError, setSelectionError] = useState("");
  const [response, setResponse] = useState<{
    key: string;
    data?: ListData;
    error?: string;
  } | null>(null);
  const endpoint = endpoints[kind];
  const key = JSON.stringify([
    endpoint,
    query,
    page,
    retry,
    eligibleDriver,
    availableForAssignment,
    staffRecipient,
  ]);
  const current = response?.key === key ? response : null;
  const loading = !current;
  const items = current?.data?.items.map(option) || [];
  const pages = Math.max(1, Math.ceil((current?.data?.total || 0) / 25));
  const selectedVisible = items.some((item) => item.id === selected.id);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          q: query.trim(),
          page: String(page),
          pageSize: "25",
        });
        if (staffRecipient) params.set("purpose", "stock-alert");
        if (eligibleDriver) params.set("eligibleForInvitation", "1");
        if (availableForAssignment) {
          if (kind === "vehicle") params.set("status", "AVAILABLE");
          if (kind === "driver") params.set("availableForAssignment", "1");
        }
        request<ListData>(`/api/v1/${endpoint}?${params}`, {
          signal: controller.signal,
        })
          .then((data) => {
            if (!controller.signal.aborted) setResponse({ key, data });
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setResponse({
                key,
                error: error instanceof Error ? error.message : de.error,
              });
          });
      },
      query ? 250 : 0,
    );
    // Both debounce timers and in-flight responses belong to this particular search.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    endpoint,
    query,
    page,
    key,
    eligibleDriver,
    availableForAssignment,
    staffRecipient,
    kind,
  ]);

  useEffect(() => {
    if (!initialValue) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ id: initialValue, pageSize: "1" });
    if (staffRecipient) params.set("purpose", "stock-alert");
    request<ListData>(`/api/v1/${endpoint}?${params}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const record = data.items.find(
          (item) => String(item.userId || item.id) === initialValue,
        );
        if (record) {
          setSelected((value) =>
            value.id === initialValue ? option(record) : value,
          );
          setSelectionError("");
        } else setSelectionError(de.picker.unavailable);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSelectionError(de.picker.selectionFailed);
      });
    return () => controller.abort();
  }, [endpoint, initialValue, retry, staffRecipient]);

  return (
    <fieldset className="record-picker">
      <legend>
        {label}
        {required ? " *" : ""}
      </legend>
      <label className="sr-only" htmlFor={`${id}-search`}>
        {label} suchen
      </label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        maxLength={120}
        placeholder={de.picker.hints[kind]}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <label className="sr-only" htmlFor={`${id}-select`}>
        {label} auswählen
      </label>
      <select
        id={`${id}-select`}
        name={name}
        required={required}
        value={selected.id}
        aria-describedby={`${id}-status`}
        aria-busy={loading}
        onChange={(event) => {
          setSelected(
            items.find((item) => item.id === event.target.value) || {
              id: "",
              label: "",
            },
          );
          setSelectionError("");
        }}
      >
        <option value="">{de.picker.choose}</option>
        {selected.id && !selectedVisible && (
          <option value={selected.id}>{selected.label}</option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <div className="picker-footer">
        <span id={`${id}-status`} role="status" className="picker-status">
          {loading
            ? de.loading
            : current?.error
              ? de.picker.loadFailed
              : current?.data?.total
                ? `${current.data.total} ${de.picker.results} · ${de.picker.page} ${page}/${pages}`
                : de.picker.noResults}
        </span>
        <div
          className="picker-pages"
          aria-label={`${label}: ${de.picker.pages}`}
        >
          <button
            type="button"
            aria-label={`${label}: ${de.picker.previous}`}
            disabled={page === 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={`${label}: ${de.picker.next}`}
            disabled={loading || Boolean(current?.error) || page >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            ›
          </button>
        </div>
      </div>
      {(current?.error || (selectionError && selected.id === initialValue)) && (
        <div className="picker-error" role="alert">
          <span>{current?.error || selectionError}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {de.retry}
          </button>
        </div>
      )}
    </fieldset>
  );
}
