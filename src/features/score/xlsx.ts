import { zipSync, strToU8 } from "fflate";
import { AppError } from "../../server/policy";
export interface ExportScoreRow {
  driverName: string;
  transporterId: string | null;
  email: string;
  week: string;
  totalScore: number | null;
  rank: number | null;
  packages: number | null;
  bonus: number | null;
  status: string | null;
  focusArea: string | null;
  metrics: Record<string, unknown>;
}
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function escape(value: unknown) {
  const text = String(value ?? "");
  if (
    text.length > 32767 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  )
    throw new AppError(422, "Ein Exportwert enthält ungültigen Excel-Text.");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function column(n: number) {
  let out = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}
/** Text is always inlineStr, never a formula, link, relationship or executable content. */
function worksheet(rows: unknown[][]) {
  const end = `${column(rows[0].length - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${rows[0].length}" width="24" customWidth="1"/></cols><sheetData>${rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((v, j) => {
            const ref = `${column(j)}${i + 1}`;
            if (v === null || v === undefined) return `<c r="${ref}"/>`;
            if (typeof v === "number") {
              if (!Number.isFinite(v))
                throw new AppError(422, "Ungültige Exportzahl.");
              return `<c r="${ref}" s="2"><v>${v}</v></c>`;
            }
            return `<c r="${ref}" s="${i === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("")}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`;
}
export function scoreWorkbook(
  rows: ExportScoreRow[],
  filters: Record<string, string>,
) {
  if (rows.length > 5000)
    throw new AppError(
      422,
      "Maximal 5000 Exportzeilen. Bitte Filter eingrenzen.",
    );
  const metrics = [
    ...new Set(rows.flatMap((r) => Object.keys(r.metrics))),
  ].sort();
  if (metrics.length > 89)
    throw new AppError(
      422,
      "Maximal 100 Exportspalten. Bitte Filter eingrenzen.",
    );
  const table: unknown[][] = [
    [
      "Pos.",
      "Transporter ID",
      "Fahrer",
      "email",
      "Woche",
      "Status",
      "Total Score",
      "Pakete",
      "Bonus",
      "Fokus",
      ...metrics.map((m) => `Kennzahl: ${m}`),
    ],
  ];
  for (const r of rows)
    table.push([
      r.rank,
      r.transporterId,
      r.driverName,
      r.email,
      r.week,
      r.status,
      r.totalScore,
      r.packages,
      r.bonus,
      r.focusArea,
      ...metrics.map((m) => r.metrics[m] ?? null),
    ]);
  const info = [
    ["Fahriva Score-Export", "Wert"],
    ["Erstellt (UTC)", new Date().toISOString()],
    ["Zeilen", String(rows.length)],
    ...Object.entries(filters),
    [
      "Berechnung",
      "Übernommene Werte; keine Neuberechnung. Kennzahlen bleiben Quelltext.",
    ],
    [
      "Umfang",
      "Alle zugelassenen Treffer der Filter; nur aktive Wochenrevisionen.",
    ],
  ];
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, content: string) => {
    files[name] = strToU8(content);
  };
  put(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  put(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  put(
    "xl/workbook.xml",
    `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Scores" sheetId="1" r:id="r1"/><sheet name="Exportinfo" sheetId="2" r:id="r2"/></sheets></workbook>`,
  );
  put(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="r3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  put(
    "xl/styles.xml",
    `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183B56"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  put("xl/worksheets/sheet1.xml", worksheet(table));
  put("xl/worksheets/sheet2.xml", worksheet(info));
  if (Object.values(files).reduce((n, f) => n + f.length, 0) > 16 * 1024 * 1024)
    throw new AppError(422, "Export ist zu groß. Bitte Filter eingrenzen.");
  return zipSync(files, { level: 6 });
}
