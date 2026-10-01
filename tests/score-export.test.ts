import { it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { scoreWorkbook } from "../src/features/score/xlsx";
import { readScoreFile, normalizeRows } from "../src/features/score/parser";
const row = {
  driverName: "A & B",
  transporterId: "00123",
  email: "a@example.test",
  week: "2026-W31",
  totalScore: 78.38,
  rank: 1,
  packages: 200,
  bonus: null,
  status: "Great",
  focusArea: null,
  metrics: { "Fotos (POD)": "99%" },
};
it("exports actual XLSX with numeric scores, text IDs, filter metadata and preserved metrics", () => {
  const bytes = scoreWorkbook([row], {
    week: "2026-W31",
    q: "A & B",
    status: "Great",
  });
  const zip = unzipSync(bytes);
  expect(Object.keys(zip)).toContain("[Content_Types].xml");
  const xml = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  expect(xml).toContain("<v>78.38</v>");
  const data = readScoreFile(bytes, "scores.xlsx");
  expect(data[1]).toContain("00123");
  expect(data[1]).toContain("A & B");
  expect(data[1]).toContain("99%");
  expect(strFromU8(zip["xl/worksheets/sheet2.xml"])).toContain("2026-W31");
});
it("writes formula-looking names as literal strings without formula or hyperlink nodes", () => {
  const zip = unzipSync(
    scoreWorkbook(
      [{ ...row, driverName: '=HYPERLINK("https://example.test")' }],
      { week: row.week },
    ),
  );
  const tree = new XMLParser({ ignoreAttributes: false }).parse(
    strFromU8(zip["xl/worksheets/sheet1.xml"]),
  );
  expect(JSON.stringify(tree)).not.toContain('"f":');
  expect(JSON.stringify(tree)).not.toContain('"hyperlink":');
  expect(JSON.stringify(tree)).toContain("inlineStr");
});
it("rejects oversized export instead of silently truncating records", () => {
  expect(() =>
    scoreWorkbook(Array(5001).fill(row), { week: row.week }),
  ).toThrow("5000");
});

it("round trips canonical fields including bonus without changing metric names", () => {
  const data = scoreWorkbook([{ ...row, bonus: 12.5 }], { week: row.week });
  const normalized = normalizeRows(
    readScoreFile(data, "x.xlsx"),
    row.week,
    {},
    [{ id: "d", email: row.email, transporterId: row.transporterId }],
  );
  expect(normalized.errors).toEqual([]);
  expect(normalized.rows[0]).toMatchObject({
    bonus: 12.5,
    metrics: { "Fotos (POD)": "99%" },
  });
});
