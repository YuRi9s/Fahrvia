import { it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readScoreFile, normalizeRows } from "../src/features/score/parser";
const drivers = [{ id: "d1", email: "a@example.test", transporterId: "T1" }];
it("recognizes screenshot headers and preserves supplied metric strings", () => {
  const r = normalizeRows(
    [
      [
        "Pos.",
        "Transporter ID",
        "Status",
        "Total Score",
        "Pakete",
        "Erfolgreich zugestellt (DCR)",
        "Fotos (POD)",
      ],
      ["1", "T1", "Great", "78,38", "250", "99,7%", "98%"],
    ],
    "2026-W31",
    {},
    drivers,
  );
  expect(r.errors).toEqual([]);
  expect(r.rows[0]).toMatchObject({
    rank: 1,
    totalScore: 78.38,
    packages: 250,
    metrics: { "Fotos (POD)": "98%" },
  });
});
it("allows explicitly ignored columns without duplicate-target errors", () => {
  const r = normalizeRows(
    [
      ["transporterId", "name", "extra"],
      ["T1", "A", "B"],
    ],
    "2026-W31",
    { name: "ignore", extra: "ignore" },
    drivers,
  );
  expect(r.errors).toEqual([]);
  expect(r.rows[0].metrics).toEqual({});
});
const sheet = (id: string) =>
  `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>transporterId</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>${id}</t></is></c></row></sheetData></worksheet>`;
export function workbook(second = sheet("T1")) {
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Cover" sheetId="1" r:id="r1"/><sheet name="Scores" sheetId="2" r:id="r2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet("WRONG")),
    "xl/worksheets/sheet2.xml": strToU8(second),
  });
}
it("selects the requested worksheet instead of silently using the first", () => {
  expect(
    readScoreFile(workbook(), "scores.xlsx", { sheet: "Scores" })[1][0],
  ).toBe("T1");
});
it("rejects missing sheets and checks active content on unselected sheets", () => {
  expect(() =>
    readScoreFile(workbook(), "scores.xlsx", { sheet: "Missing" }),
  ).toThrow();
  expect(() =>
    readScoreFile(
      workbook("<worksheet><f>1+1</f></worksheet>"),
      "scores.xlsx",
      { sheet: "Cover" },
    ),
  ).toThrow();
});
it("discovers other sheets even if the first sheet is not a usable score table", async () => {
  const { readScoreWorkbook } = await import("../src/features/score/parser");
  const { unzipSync } = await import("fflate");
  const files = unzipSync(workbook());
  files["xl/worksheets/sheet1.xml"] = strToU8(
    '<worksheet><sheetData><row><c r="CW1" t="inlineStr"><is><t>Cover</t></is></c></row></sheetData></worksheet>',
  );
  const bytes = zipSync(files);
  const found = readScoreWorkbook(bytes, "x.xlsx", { inspect: true });
  expect(found.sheets).toEqual(["Cover", "Scores"]);
  expect(found.inspectionWarning).toContain("100");
  expect(
    readScoreWorkbook(bytes, "x.xlsx", { sheet: "Scores" }).table[1][0],
  ).toBe("T1");
  expect(() =>
    readScoreWorkbook(bytes, "x.xlsx", { sheet: "Cover" }),
  ).toThrow();
});
