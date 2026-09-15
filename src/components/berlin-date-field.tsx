"use client";
import { useId, useState } from "react";
import { berlinCandidates, berlinInput } from "@/lib/berlin-time";

export function BerlinDateField({
  name,
  label,
  required,
  original = "",
}: {
  name: string;
  label: string;
  required?: boolean;
  original?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(() =>
    original ? berlinInput(original) : "",
  );
  const [occurrence, setOccurrence] = useState("");
  const candidates = value ? berlinCandidates(value) : [];
  const unchanged = Boolean(original) && value === berlinInput(original);
  return (
    <fieldset className="record-picker">
      <legend>
        {label}
        {required ? " *" : ""}
      </legend>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="datetime-local"
        required={required}
        value={value}
        aria-describedby={`${id}-hint`}
        aria-invalid={Boolean(value && !candidates.length)}
        onChange={(event) => {
          setValue(event.target.value);
          setOccurrence("");
        }}
      />
      <span id={`${id}-hint`} className="picker-status">
        Europe/Berlin · deutsche Ortszeit
      </span>
      {value && !candidates.length && (
        <span role="alert" className="picker-error">
          Diese Uhrzeit existiert in Berlin nicht. Bitte Datum und
          Zeitumstellung prüfen.
        </span>
      )}
      {candidates.length > 1 && (
        <>
          <label htmlFor={`${id}-occurrence`}>
            Zeitumstellung: Welche Uhrzeit?
          </label>
          <select
            id={`${id}-occurrence`}
            name={`${name}Occurrence`}
            required={!unchanged}
            value={occurrence}
            onChange={(event) => setOccurrence(event.target.value)}
          >
            <option value="">
              {unchanged
                ? "Gespeicherte Uhrzeit beibehalten"
                : "Bitte auswählen …"}
            </option>
            {candidates.map((date, index) => (
              <option
                key={date.toISOString()}
                value={index === 0 ? "earlier" : "later"}
              >
                {index === 0 ? "Erste" : "Zweite"} Uhrzeit ·{" "}
                {new Intl.DateTimeFormat("de-DE", {
                  timeZone: "Europe/Berlin",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "shortOffset",
                }).format(date)}
              </option>
            ))}
          </select>
        </>
      )}
    </fieldset>
  );
}
