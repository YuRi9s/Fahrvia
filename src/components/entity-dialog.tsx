"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { de, fieldLabel, valueLabel } from "@/messages/de";
import { request, mutate, Row } from "./api";
import { BerlinDateField } from "./berlin-date-field";
import { berlinToISO } from "@/lib/berlin-time";
import { configs, Field } from "./module-config";
import { CategoryPicker } from "./category-picker";
import { RecordPicker, type RecordKind } from "./record-picker";
function inputValue(value: unknown, type?: string) {
  if (value == null) return "";
  if (type === "date") return String(value).slice(0, 10);
  return String(value);
}
export function EntityDialog({
  module,
  row,
  action = "edit",
  onClose,
  onSaved,
}: {
  module: string;
  row?: Row;
  action?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownership, setOwnership] = useState(String(row?.ownership || "OWNED"));
  const [location, setLocation] = useState(String(row?.location || "OFFICE"));
  const upload = action === "upload";
  const fields = useMemo<Field[]>(
    () =>
      action === "adjust"
        ? [
            { key: "quantity", type: "number", required: true },
            { key: "reason", required: true },
          ]
        : upload
          ? [
              { key: "title", required: module === "documents" },
              {
                key: "vehicleId",
                type: "vehicle",
                required: module === "photos",
              },
              { key: "driverId", type: "driver" },
              { key: "expiresAt", type: "date" },
              { key: "notes", type: "textarea" },
            ]
          : [
              ...(configs[module]?.fields || []),
              ...(module === "work-times" && row
                ? [{ key: "reason", required: true }]
                : []),
            ],
    [action, upload, module, row],
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (upload) {
        form.set("kind", module === "photos" ? "photo" : "document");
        if (row?.id) form.set("replacesId", String(row.id));
        form.set("damage", form.get("damage") ? "true" : "false");
        form.set("driverVisible", form.get("driverVisible") ? "true" : "false");
        await request("/api/v1/uploads", { method: "POST", body: form });
      } else {
        const data: Row = {};
        for (const field of fields) {
          const value = form.get(field.key);
          if (value !== null && value !== "")
            data[field.key] =
              field.type === "number"
                ? Number(value)
                : field.type === "datetime-local"
                  ? berlinToISO(
                      String(value),
                      String(form.get(`${field.key}Occurrence`) || ""),
                      String(row?.[field.key] || ""),
                    )
                  : value;
        }
        if (module === "vehicles") {
          data.brandCategoryId = String(form.get("brandCategoryId") || "");
          data.providerCategoryId = String(
            form.get("providerCategoryId") || "",
          );
        }
        if (module === "inventory" && row)
          data.expectedAlertVersion = row.alertVersion;
        await mutate(
          module,
          action === "adjust" ? "adjust" : row ? "update" : "create",
          row ? String(row.id) : undefined,
          data,
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog"
      aria-labelledby="entity-title"
      onCancel={onClose}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="entity-title">
            {upload
              ? de.upload
              : action === "adjust"
                ? de.adjust
                : row
                  ? de.edit
                  : de.create}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={de.close}
          >
            ×
          </button>
        </div>
        <div className="form-grid">
          {fields
            .filter(
              (f) =>
                !(f.key === "provider" && ownership === "OWNED") &&
                !(
                  module === "keys" &&
                  f.key === "driverId" &&
                  location !== "DRIVER"
                ),
            )
            .map((field) =>
              module === "vehicles" &&
              (field.key === "brand" || field.key === "provider") ? (
                <CategoryPicker
                  key={field.key}
                  name={field.key}
                  label={fieldLabel(field.key)}
                  required={field.required}
                  initialName={String(row?.[field.key] || "")}
                  initialId={String(row?.[`${field.key}CategoryId`] || "")}
                />
              ) : ["driver", "vehicle", "recipient"].includes(
                  field.type || "",
                ) ? (
                <RecordPicker
                  key={field.key}
                  name={field.key}
                  kind={field.type as RecordKind}
                  label={fieldLabel(field.key)}
                  required={field.required}
                  initialValue={String(row?.[field.key] || "")}
                />
              ) : field.type === "datetime-local" ? (
                <BerlinDateField
                  key={field.key}
                  name={field.key}
                  label={fieldLabel(field.key)}
                  required={field.required}
                  original={String(row?.[field.key] || "")}
                />
              ) : (
                <label
                  key={field.key}
                  className={field.type === "textarea" ? "span-two" : ""}
                >
                  {fieldLabel(field.key)}
                  {field.required ? " *" : ""}
                  {field.options ? (
                    <select
                      name={field.key}
                      defaultValue={String(
                        row?.[field.key] || field.options[0],
                      )}
                      onChange={(e) => {
                        if (field.key === "ownership")
                          setOwnership(e.target.value);
                        if (field.key === "location")
                          setLocation(e.target.value);
                      }}
                    >
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {valueLabel(option)}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      name={field.key}
                      required={field.required}
                      defaultValue={String(row?.[field.key] || "")}
                      rows={4}
                    />
                  ) : (
                    <input
                      name={field.key}
                      type={field.type || "text"}
                      required={field.required}
                      step={field.type === "number" ? "1" : undefined}
                      readOnly={
                        module === "vehicles" &&
                        field.key === "keyCount" &&
                        !!row
                      }
                      defaultValue={inputValue(row?.[field.key], field.type)}
                    />
                  )}
                </label>
              ),
            )}
          {upload && (
            <>
              <label className="span-two">
                {de.files}
                <input
                  name="files"
                  type="file"
                  required
                  multiple={module === "photos"}
                  accept={
                    module === "photos"
                      ? "image/jpeg,image/png,image/webp"
                      : ".pdf,.png,.jpg,.jpeg"
                  }
                />
              </label>
              {module === "documents" && (
                <label className="checkbox">
                  <input name="driverVisible" type="checkbox" />
                  Fahrzeugdokument für zugewiesene Fahrer freigeben
                </label>
              )}
              {module === "photos" && (
                <label className="checkbox">
                  <input name="damage" type="checkbox" />
                  {fieldLabel("damage")}
                </label>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" onClick={onClose}>
            {de.cancel}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? de.loading : de.save}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
