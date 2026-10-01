"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCamera,
  IconCheck,
  IconRefresh,
  IconTruck,
} from "@tabler/icons-react";
import type { InspectionList } from "@/features/inspections/service";
const views = {
  front: "Vorne",
  rear: "Hinten",
  left: "Linke Seite",
  right: "Rechte Seite",
  damage: "Schadendetail",
};
const checks = {
  tyres: "Reifen und Räder",
  lights: "Beleuchtung",
  mirrors: "Spiegel und Scheiben",
  warnings: "Warnanzeigen",
};
type View = keyof typeof views;
type Check = keyof typeof checks;
type Context = NonNullable<InspectionList["context"]>;
type Draft = {
  odometer: string;
  answers: Record<Check, string>;
  damage: string;
  notes: string;
  photos: Partial<Record<View, File>>;
  step: number;
  pending: FormData | null;
};
// One draft per tab, never localStorage or a shared server cache. A different shift replaces it.
let savedDraft: { key: string; value: Draft } | null = null;
function PhotoPreview({ file, label }: { file: File; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    const timer = setTimeout(() => setUrl(next), 0);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(next);
    };
  }, [file]);
  // Local previews intentionally bypass optimization and never upload before submission.
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={`Vorschau: ${label}`} /> : null;
}

function time(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}
export function VehicleInspections({
  driver = false,
  refreshKey = 0,
}: {
  driver?: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<InspectionList | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  const serial = useRef(0);
  const load = useCallback(async () => {
    const n = ++serial.current;
    try {
      const r = await fetch(`/api/v1/inspections?page=${page}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const v = await r.json().catch(() => null);
      if (!r.ok)
        throw new Error(v.error || "Prüfungen konnten nicht geladen werden.");
      if (n === serial.current) {
        setData(v);
        setError("");
      }
    } catch (e) {
      if (n === serial.current)
        setError(e instanceof Error ? e.message : "Verbindung fehlgeschlagen.");
    }
  }, [page]);
  const invalidate = useCallback(() => {
    serial.current++;
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(t);
      invalidate();
    };
  }, [load, refreshKey, invalidate]);
  const c = data?.context;
  return (
    <section className="panel inspection-panel" aria-label="Fahrzeugprüfung">
      <div className="inspection-heading">
        <div>
          <p className="eyebrow">FAHRZEUGZUSTAND</p>
          <h2>
            {driver ? "Vor der Fahrt prüfen" : "Eingereichte Fahrzeugprüfungen"}
          </h2>
        </div>
        <button
          onClick={() => void load()}
          aria-label="Fahrzeugprüfungen aktualisieren"
        >
          <IconRefresh size={18} />
        </button>
      </div>
      <p className="muted">
        Vier Ansichten, ein nachvollziehbarer Bericht. Empfangsbestätigung ist
        keine Freigabe zur Fahrt.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!data && <p role="status">Prüfungen werden geladen …</p>}
      {driver && c && (
        <>
          <ol className="inspection-progress" aria-label="Ablauf">
            <li className={c.shift ? "done" : ""}>1 · Arbeit beginnen</li>
            <li className={c.completedId ? "done" : ""}>2 · Fahrzeug prüfen</li>
            <li>3 · Vor Fahrt klären</li>
          </ol>
          {!c.shift ? (
            <p className="inspection-notice">
              Beginne zuerst deine Schicht unter{" "}
              <Link href="/work-times">Arbeitszeiten</Link>. Die Fahrzeugprüfung
              zählt zur Arbeitszeit.
            </p>
          ) : !c.assignment ? (
            <p className="inspection-notice">
              Dir ist kein aktives Fahrzeug zugewiesen. Bitte die Disposition
              kontaktieren. Deine Arbeitszeit läuft weiter.
            </p>
          ) : c.completedId ? (
            <div className="inspection-receipt" role="status">
              <IconCheck size={24} />
              <div>
                <strong>
                  Prüfung für {c.assignment.vehicle.plate} eingegangen
                </strong>
                <p>
                  Bei Schäden oder Zweifeln an der Sicherheit vor der Fahrt die
                  Disposition kontaktieren.
                </p>
                <small>Referenz: {c.completedId}</small>
              </div>
            </div>
          ) : (
            <InspectionForm
              key={`${c.shift.id}:${c.assignment.id}`}
              context={c}
              onSubmitted={() => void load()}
            />
          )}
        </>
      )}
      {data && (
        <div className="inspection-history">
          <h3>{driver ? "Meine Prüfberichte" : "Prüfberichte"}</h3>
          {!data.items.length && (
            <p className="muted">Noch keine Prüfberichte vorhanden.</p>
          )}
          {data.items.map((item) => (
            <details className="inspection-record" key={item.id}>
              <summary>
                <span>
                  <strong>{item.report.vehicle.plate}</strong>
                  <span>{time(item.createdAt)} · Berliner Zeit</span>
                </span>
                <span className="inspection-tag">
                  {item.report.damage ||
                  [
                    item.tyres,
                    item.lights,
                    item.mirrors,
                    item.warnings,
                  ].includes("ISSUE")
                    ? "Auffälligkeit gemeldet"
                    : "Keine Auffälligkeit gemeldet"}
                </span>
              </summary>
              <p>
                {item.report.reporterName} ·{" "}
                {item.odometerKm.toLocaleString("de-DE")} km
              </p>
              <dl className="inspection-check-summary">
                {Object.entries(checks).map(([k, label]) => (
                  <div key={k}>
                    <dt>{label}</dt>
                    <dd>
                      {item[k as Check] === "OK" ? "Unauffällig" : "Auffällig"}
                    </dd>
                  </div>
                ))}
              </dl>
              {item.report.notes && (
                <p className="inspection-notes">{item.report.notes}</p>
              )}
              <div className="inspection-file-links">
                {item.report.files.map((f) => (
                  <a
                    className="button"
                    key={f.objectId}
                    href={`/api/v1/files/${f.objectId}`}
                  >
                    <IconCamera size={16} />
                    {views[f.position as View] ?? "Foto"} herunterladen
                  </a>
                ))}
              </div>
              <small>Referenz: {item.id}</small>
            </details>
          ))}
          <div className="inspection-pagination">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Zurück
            </button>
            <span>Seite {data.page}</span>
            <button
              disabled={!data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
function InspectionForm({
  context,
  onSubmitted,
}: {
  context: Context;
  onSubmitted: () => void;
}) {
  const draftKey = `${context.actorId}:${context.shift!.id}:${context.assignment!.id}`;
  const draft = savedDraft?.key === draftKey ? savedDraft.value : null;
  const [step, setStep] = useState(draft?.step ?? 0),
    [odometer, setOdometer] = useState(draft?.odometer ?? ""),
    [answers, setAnswers] = useState<Record<Check, string>>(
      draft?.answers ?? {
        tyres: "",
        lights: "",
        mirrors: "",
        warnings: "",
      },
    ),
    [damage, setDamage] = useState(draft?.damage ?? ""),
    [notes, setNotes] = useState(draft?.notes ?? "");
  const [photos, setPhotos] = useState<Partial<Record<View, File>>>(
      draft?.photos ?? {},
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<FormData | null>(draft?.pending ?? null),
    [received, setReceived] = useState("");
  const inFlight = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (received) {
      if (savedDraft?.key === draftKey) savedDraft = null;
      return;
    }
    savedDraft = {
      key: draftKey,
      value: { step, odometer, answers, damage, notes, photos, pending },
    };
  }, [
    draftKey,
    step,
    odometer,
    answers,
    damage,
    notes,
    photos,
    pending,
    received,
  ]);
  const dirty =
    !!odometer ||
    !!notes ||
    Object.keys(photos).length > 0 ||
    Object.values(answers).some(Boolean) ||
    !!damage;
  useEffect(() => {
    if (!dirty || received) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, received]);
  const slots: View[] = [
    "front",
    "rear",
    "left",
    "right",
    ...(damage === "yes" ? ["damage" as const] : []),
  ];
  const issue = damage === "yes" || Object.values(answers).includes("ISSUE");
  const paused = context.shift?.clockState !== "RUNNING";
  function move(n: number) {
    setError("");
    setStep(n);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function validateDetails() {
    if (
      !/^\d{1,7}$/.test(odometer) ||
      !damage ||
      Object.values(answers).some((v) => !v)
    ) {
      setError("Bitte Kilometerstand und alle Prüffelder ausfüllen.");
      return false;
    }
    if (issue && notes.trim().length < 10) {
      setError("Bitte Auffälligkeit mit mindestens 10 Zeichen beschreiben.");
      return false;
    }
    return true;
  }
  function pick(slot: View, file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError(
        "Bitte ein JPG- oder PNG-Foto bis 10 MB auswählen. HEIC vorher umwandeln.",
      );
      return;
    }
    setPhotos((p) => ({ ...p, [slot]: file }));
    setError("");
  }
  async function send(form: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPending(form);
    setError("");
    try {
      const r = await fetch("/api/v1/inspections", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      const v = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status >= 400 && r.status < 500) setPending(null);
        throw new Error(v?.error || "Die Übermittlung wurde nicht bestätigt.");
      }
      if (
        typeof v?.id !== "string" ||
        v.id !== JSON.parse(String(form.get("metadata"))).requestId
      )
        throw new Error(
          "Die Übermittlung wurde nicht bestätigt. Bitte erneut anfordern.",
        );
      setReceived(v.id);
      if (savedDraft?.key === draftKey) savedDraft = null;
      setPending(null);
      onSubmitted();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Verbindung unterbrochen. Dieselbe Anfrage erneut senden.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submit() {
    if (!validateDetails()) return;
    if (slots.some((s) => !photos[s])) {
      setError("Bitte alle benötigten Ansichten fotografieren.");
      return;
    }
    if (slots.reduce((n, s) => n + photos[s]!.size, 0) > 24 * 1024 * 1024) {
      setError(
        "Alle Fotos zusammen dürfen höchstens 24 MB groß sein. Bitte kleinere Fotos auswählen.",
      );
      return;
    }
    const f = new FormData();
    f.set(
      "metadata",
      JSON.stringify({
        requestId: crypto.randomUUID(),
        entryId: context.shift!.id,
        assignmentId: context.assignment!.id,
        odometerKm: Number(odometer),
        ...answers,
        damage: damage === "yes",
        notes,
      }),
    );
    for (const slot of slots) f.set(slot, photos[slot]!);
    void send(f);
  }
  if (received)
    return (
      <div className="inspection-receipt" role="status">
        <IconCheck size={24} />
        <div>
          <strong>
            Prüfung für {context.assignment!.vehicle.plate} eingegangen
          </strong>
          <p>
            Bei Sicherheitsbedenken vor der Fahrt die Disposition kontaktieren.
          </p>
          <small>Referenz: {received}</small>
        </div>
      </div>
    );
  return (
    <div className="inspection-form" aria-busy={busy}>
      <div className="inspection-vehicle">
        <IconTruck size={28} />
        <div>
          <strong>{context.assignment!.vehicle.plate}</strong>
          <span>Aktuell zugewiesenes Fahrzeug · Prüfung vor Fahrtbeginn</span>
        </div>
      </div>
      {paused && (
        <p role="status" className="inspection-notice">
          Die Schicht ist pausiert. Arbeit fortsetzen, bevor du die Prüfung
          einreichst. Deine Auswahl bleibt hier erhalten.
        </p>
      )}
      <h3 ref={heading} tabIndex={-1}>
        Schritt {step + 1} von 3 ·{" "}
        {
          [
            "Zustand erfassen",
            "Ansichten fotografieren",
            "Prüfen und einreichen",
          ][step]
        }
      </h3>
      <p className="muted">
        Der aktuelle Entwurf bleibt bei Navigation innerhalb dieses Tabs
        erhalten. Neuladen oder Schließen kann ihn löschen. Erst die bestätigte
        Einreichung speichert den Bericht.
      </p>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || !!pending} className="inspection-fields">
        <legend className="sr-only">Fahrzeugprüfung</legend>
        {step === 0 && (
          <>
            <label>
              Kilometerstand (km)
              <input
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                maxLength={7}
              />
            </label>
            <div className="inspection-checks">
              {Object.entries(checks).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    value={answers[key as Check]}
                    onChange={(e) =>
                      setAnswers((p) => ({ ...p, [key]: e.target.value }))
                    }
                  >
                    <option value="">Bitte prüfen</option>
                    <option value="OK">Unauffällig</option>
                    <option value="ISSUE">Auffällig / nicht sicher</option>
                  </select>
                </label>
              ))}
            </div>
            <label>
              Sichtbarer Schaden?
              <select
                value={damage}
                onChange={(e) => setDamage(e.target.value)}
              >
                <option value="">Bitte auswählen</option>
                <option value="no">Nein</option>
                <option value="yes">Ja, Schaden dokumentieren</option>
              </select>
            </label>
            <label>
              {issue
                ? "Auffälligkeit / Schaden beschreiben (Pflicht)"
                : "Bemerkung (optional)"}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </label>
            {issue && (
              <p className="inspection-notice">
                Bei Sicherheitsbedenken nicht losfahren. Die Disposition
                kontaktieren und das weitere Vorgehen klären.
              </p>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (validateDetails()) move(1);
              }}
            >
              Weiter zu den Fotos
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <p>
              Das gesamte Fahrzeug aus jeder Richtung aufnehmen. Kennzeichen und
              Zustand gut erkennbar halten; Personen vermeiden. JPG/PNG, je 10
              MB, zusammen 24 MB.
            </p>
            <div className="inspection-photos">
              {slots.map((slot) => (
                <label
                  className={`inspection-photo ${photos[slot] ? "selected" : ""}`}
                  key={slot}
                >
                  <span>
                    <IconCamera size={19} />
                    <strong>{views[slot]}</strong>
                    <span>{photos[slot] ? "Ausgewählt" : "Pflichtfoto"}</span>
                  </span>
                  {photos[slot] && (
                    <PhotoPreview file={photos[slot]!} label={views[slot]} />
                  )}
                  <input
                    aria-label={`${views[slot]} fotografieren`}
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    onChange={(e) => pick(slot, e.target.files?.[0])}
                  />
                </label>
              ))}
            </div>
            <p className="muted">
              Bitte aktuelle Fotos verwenden. Die Kameraauswahl hängt vom Gerät
              ab; Aufnahmezeit und Echtheit werden nicht automatisch bestätigt.
            </p>
            <div className="inspection-actions">
              <button type="button" onClick={() => move(0)}>
                Zurück
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (slots.some((s) => !photos[s]))
                    setError("Bitte alle Pflichtfotos hinzufügen.");
                  else move(2);
                }}
              >
                Bericht prüfen
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <dl className="inspection-check-summary">
              <div>
                <dt>Kilometerstand</dt>
                <dd>{Number(odometer).toLocaleString("de-DE")} km</dd>
              </div>
              {Object.entries(checks).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {answers[key as Check] === "OK"
                      ? "Unauffällig"
                      : "Auffällig"}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Schaden</dt>
                <dd>{damage === "yes" ? "Ja" : "Nein"}</dd>
              </div>
              <div>
                <dt>Fotos</dt>
                <dd>{slots.length} Ansichten</dd>
              </div>
            </dl>
            {notes && <p className="inspection-notes">{notes}</p>}
            <p>
              Der Bericht wird mit Eingangszeit gespeichert und kann danach
              nicht bearbeitet werden. Bei einem Fehler bitte die Administration
              kontaktieren.
            </p>
            <div className="inspection-actions">
              <button type="button" onClick={() => move(1)}>
                Zurück zu Fotos
              </button>
              <button
                type="button"
                className="primary"
                disabled={paused}
                onClick={submit}
              >
                Prüfung verbindlich einreichen
              </button>
            </div>
          </>
        )}
      </fieldset>
      {busy && (
        <p role="status">Fotos werden geprüft und sicher gespeichert …</p>
      )}
      {pending && !busy && (
        <div className="inspection-notice">
          <p>
            Antwort noch unklar. Nicht neu beginnen: dieselben Daten erneut
            senden oder die Berichtsliste aktualisieren.
          </p>
          <button className="primary" onClick={() => void send(pending)}>
            Bestätigung erneut anfordern
          </button>
        </div>
      )}
    </div>
  );
}
