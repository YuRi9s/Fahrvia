/* XMLParser returns a dynamic tree; it is bounded and validated before field extraction. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse } from "csv-parse/sync";
import { AppError } from "../../server/policy";
import { checkWeek } from "../../server/validation";
const MAX_FILE = 5 * 1024 * 1024,
  MAX_EXPANDED = 16 * 1024 * 1024,
  MAX_ROWS = 5000,
  MAX_COLS = 100;
function bad(message: string): never {
  throw new AppError(422, message);
}
function safeCell(value: unknown) {
  const s = String(value ?? "").trim();
  if (
    s.length > 2000 ||
    /^[=+@]/.test(s) ||
    /^-[^\d]/.test(s) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)
  )
    bad("Formeln, Steuerzeichen oder zu lange Zellen sind nicht erlaubt.");
  return s;
}
function xml(text: string) {
  if (
    /<!DOCTYPE|<!ENTITY|<\s*(?:\w+:)?f(?:\s|\/?>)|TargetMode\s*=\s*["']External["']/i.test(
      text,
    )
  )
    bad("Aktive Inhalte oder externe Verweise sind nicht erlaubt.");
  let depth = 0;
  for (const tag of text.matchAll(/<([^>]+)>/g)) {
    if (tag[1].startsWith("?") || tag[1].startsWith("!")) continue;
    if (tag[1].startsWith("/")) depth--;
    else if (!tag[1].endsWith("/")) depth++;
    if (depth > 32 || depth < 0) bad("XML-Struktur ist zu komplex.");
  }
  if (XMLValidator.validate(text) !== true) bad("Ungültige XML-Datei.");
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    processEntities: false,
    removeNSPrefix: true,
  }).parse(text);
}
const array = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
function checkZip(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === data.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    bad("Ungültiges oder mehrteiliges ZIP-Archiv.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count > 200 || at >= end || view.getUint16(end + 8, true) !== count)
    bad("Zu viele ZIP-Einträge.");
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      bad("Ungültiges ZIP-Verzeichnis.");
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      local = view.getUint32(at + 42, true);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      local + 30 > at ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) & 1
    )
      bad("Verschlüsselte oder nicht unterstützte ZIP-Einträge.");
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  if (at !== end) bad("Ungültiges ZIP-Verzeichnis.");
}
function xlsx(data: Uint8Array): string[][] {
  checkZip(data);
  const entries = new Map<string, string>();
  let total = 0,
    count = 0;
  const unzip = new Unzip((file) => {
    if (
      ++count > 200 ||
      file.name.includes("..") ||
      file.name.startsWith("/") ||
      /vba|macro|externalLinks|embeddings|encrypted|encryption/i.test(file.name)
    )
      bad("Nicht unterstützter XLSX-Inhalt.");
    if (entries.has(file.name)) bad("Doppelte ZIP-Einträge.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length;
      length += chunk.length;
      if (total > MAX_EXPANDED) {
        file.terminate();
        bad("Entpackte Datei ist zu groß.");
      }
      chunks.push(chunk);
      if (final) {
        const all = new Uint8Array(length);
        let at = 0;
        for (const c of chunks) {
          all.set(c, at);
          at += c.length;
        }
        entries.set(file.name, strFromU8(all));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let i = 0; i < data.length; i += 1024)
      unzip.push(data.subarray(i, i + 1024), i + 1024 >= data.length);
  } catch (e) {
    if (e instanceof AppError) throw e;
    bad("Ungültige oder verschlüsselte XLSX-Datei.");
  }
  const parsed = new Map<string, any>();
  for (const [name, text] of entries) {
    if (name.endsWith(".xml") || name.endsWith(".rels"))
      parsed.set(name, xml(text));
  }
  const workbook = parsed.get("xl/workbook.xml");
  let sheetName = "xl/worksheets/sheet1.xml";
  if (workbook) {
    const sheet = array<any>(workbook.workbook?.sheets?.sheet)[0];
    const rel = array<any>(
      parsed.get("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship,
    ).find((r) => r["@_Id"] === sheet?.["@_id"]);
    if (!rel) bad("Erstes Tabellenblatt fehlt.");
    const target = String(rel["@_Target"]);
    if (target.includes("..")) bad("Ungültiger Tabellenpfad.");
    sheetName = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  }
  const worksheet = parsed.get(sheetName)?.worksheet;
  if (!worksheet) bad("Erstes Tabellenblatt fehlt.");
  const shared = array<any>(parsed.get("xl/sharedStrings.xml")?.sst?.si).map(
    (v) =>
      typeof v.t === "string"
        ? v.t
        : array<any>(v.r)
            .map((r) => r.t ?? "")
            .join(""),
  );
  const rows: string[][] = [];
  for (const row of array<any>(worksheet.sheetData?.row)) {
    if (rows.length >= MAX_ROWS + 1) bad("Maximal 5000 Datenzeilen erlaubt.");
    const values: string[] = [];
    for (const c of array<any>(row.c)) {
      const ref = String(c["@_r"] ?? "");
      const match = /^([A-Z]{1,3})\d+$/.exec(ref);
      if (!match) bad("Zelladresse fehlt.");
      let index = 0;
      for (const char of match[1]) index = index * 26 + char.charCodeAt(0) - 64;
      if (index > MAX_COLS) bad("Maximal 100 Spalten erlaubt.");
      let value = c.v ?? "";
      if (c["@_t"] === "s") {
        if (!/^\d+$/.test(String(value)) || shared[Number(value)] === undefined)
          bad("Ungültiger Textverweis.");
        value = shared[Number(value)];
      } else if (c["@_t"] === "inlineStr")
        value =
          c.is?.t ??
          array<any>(c.is?.r)
            .map((r) => r.t ?? "")
            .join("");
      else if (c["@_t"] === "e") bad("Excel-Fehlerzellen sind nicht erlaubt.");
      values[index - 1] = safeCell(value);
    }
    rows.push(Array.from({ length: values.length }, (_, i) => values[i] ?? ""));
  }
  return rows;
}
export function readScoreFile(data: Uint8Array, filename: string): string[][] {
  if (!data.length || data.length > MAX_FILE)
    bad("Datei muss zwischen 1 Byte und 5 MB groß sein.");
  let rows: string[][];
  if (/\.xlsx$/i.test(filename)) rows = xlsx(data);
  else if (/\.csv$/i.test(filename)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      const first = text.split(/\r?\n/, 1)[0];
      rows = parse(text, {
        bom: true,
        delimiter: first.includes(";") ? ";" : ",",
        skip_empty_lines: true,
        max_record_size: 200000,
        relax_column_count: false,
        to: MAX_ROWS + 2,
      }).map((r: unknown[]) => r.map(safeCell));
    } catch (e) {
      if (e instanceof AppError) throw e;
      bad("Ungültige UTF-8-CSV-Datei.");
    }
  } else bad("Nur CSV und XLSX werden unterstützt.");
  if (
    rows.length < 2 ||
    rows.length > MAX_ROWS + 1 ||
    rows.some((r) => r.length > MAX_COLS)
  )
    bad("Datei benötigt 1 bis 5000 Datenzeilen und höchstens 100 Spalten.");
  return rows;
}
export interface ScoreRow {
  driverId: string;
  week: string;
  totalScore: number | null;
  rank: number | null;
  packages: number | null;
  bonus: number | null;
  focusArea: string | null;
  status: string | null;
  metrics: Record<string, string>;
}
export interface DriverIdentity {
  id: string;
  email: string;
  transporterId: string | null;
}
export function normalizeRows(
  table: string[][],
  week: string,
  requested: Record<string, string>,
  drivers: DriverIdentity[],
) {
  checkWeek(week);
  const columns = table[0].map((s) => s.trim());
  if (
    new Set(columns).size !== columns.length ||
    columns.some(
      (c) => !c || ["__proto__", "prototype", "constructor"].includes(c),
    )
  )
    bad("Spaltennamen müssen eindeutig und nicht leer sein.");
  const canonical = [
    "email",
    "transporterId",
    "week",
    "totalScore",
    "rank",
    "packages",
    "bonus",
    "focusArea",
    "status",
  ];
  const mapping: Record<string, string> = {};
  for (const c of columns)
    mapping[c] = requested[c] ?? (canonical.includes(c) ? c : "metric:" + c);
  for (const key of Object.keys(requested))
    if (!columns.includes(key))
      bad("Zuordnung enthält eine unbekannte Quellspalte.");
  if (
    Object.values(mapping).some(
      (v) =>
        !canonical.includes(v) && !/^metric:[\p{L}\p{N} _.-]{1,100}$/u.test(v),
    ) ||
    new Set(Object.values(mapping)).size !== columns.length
  )
    bad("Ungültige oder doppelte Spaltenzuordnung.");
  const rows: ScoreRow[] = [],
    errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  const byEmail = new Map<string, DriverIdentity[]>(),
    byTransporter = new Map<string, DriverIdentity[]>();
  for (const driver of drivers) {
    const email = driver.email.toLowerCase();
    byEmail.set(email, [...(byEmail.get(email) || []), driver]);
    if (driver.transporterId)
      byTransporter.set(driver.transporterId, [
        ...(byTransporter.get(driver.transporterId) || []),
        driver,
      ]);
  }

  for (let i = 1; i < table.length; i++) {
    if (table[i].every((v) => !v.trim())) continue;
    try {
      const cells: Record<string, string> = {};
      columns.forEach((c, j) => (cells[mapping[c]] = safeCell(table[i][j])));
      const email = cells.email?.toLowerCase(),
        transporterId = cells.transporterId;
      const matches = [
        ...new Map(
          [
            ...(email ? byEmail.get(email) || [] : []),
            ...(transporterId ? byTransporter.get(transporterId) || [] : []),
          ].map((d) => [d.id, d]),
        ).values(),
      ];
      if (
        matches.length !== 1 ||
        (email && matches[0].email.toLowerCase() !== email) ||
        (transporterId && matches[0].transporterId !== transporterId)
      )
        bad("Fahrer nicht eindeutig über E-Mail oder Transporter-ID gefunden.");
      const driverId = matches[0].id;
      if (seen.has(driverId))
        bad("Fahrer ist in dieser Datei mehrfach enthalten.");
      seen.add(driverId);
      if (cells.week && checkWeek(cells.week) !== week)
        bad("Quellwoche stimmt nicht mit der ausgewählten Woche überein.");
      const number = (key: string, integer = false) => {
        if (!cells[key]) return null;
        if (!/^\d+(?:[.,]\d{1,4})?$/.test(cells[key]))
          bad("Ungültiger Zahlenwert: " + key);
        const n = Number(cells[key].replace(",", "."));
        if (
          n > 99999999 ||
          (integer && !Number.isInteger(n)) ||
          (key === "rank" && n < 1) ||
          (key === "bonus" &&
            Math.abs(n * 100 - Math.round(n * 100)) > 0.000001)
        )
          bad("Zahlenwert außerhalb des erlaubten Bereichs: " + key);
        return n;
      };
      rows.push({
        driverId,
        week,
        totalScore: number("totalScore"),
        rank: number("rank", true),
        packages: number("packages", true),
        bonus: number("bonus"),
        focusArea: cells.focusArea || null,
        status: cells.status || null,
        metrics: Object.fromEntries(
          Object.entries(cells)
            .filter(([k]) => k.startsWith("metric:"))
            .map(([k, v]) => [k.slice(7), v]),
        ),
      });
    } catch (e) {
      errors.push({
        row: i + 1,
        message: e instanceof Error ? e.message : "Ungültige Zeile.",
      });
    }
  }
  if (!rows.length && !errors.length)
    errors.push({ row: 0, message: "Keine Datenzeilen vorhanden." });
  return { rows, errors, columns, mapping };
}
