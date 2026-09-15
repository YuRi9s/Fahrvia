import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readScoreFile, normalizeRows } from "../src/features/score/parser";
const drivers = [
  { id: "d1", email: "driver@example.com", transporterId: "T1" },
];
describe("score data boundary", () => {
  it("normalizes decimal comma without inventing missing values", () => {
    const r = normalizeRows(
      [
        ["email", "totalScore"],
        [" DRIVER@example.com ", "97,25"],
      ],
      "2026-W37",
      {},
      drivers,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      driverId: "d1",
      totalScore: 97.25,
      rank: null,
    });
  });
  it("rejects duplicate driver identities and conflicting weeks", () => {
    const r = normalizeRows(
      [
        ["email", "week"],
        ["driver@example.com", "2026-W38"],
        ["driver@example.com", "2026-W37"],
      ],
      "2026-W37",
      {},
      drivers,
    );
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("does not guess names or permit conflicting identifiers", () => {
    expect(
      normalizeRows([["name"], ["Driver"]], "2026-W37", {}, drivers).errors
        .length,
    ).toBeGreaterThan(0);
    expect(
      normalizeRows(
        [
          ["email", "transporterId"],
          ["driver@example.com", "OTHER"],
        ],
        "2026-W37",
        {},
        drivers,
      ).errors.length,
    ).toBeGreaterThan(0);
  });
  it("rejects formulas in CSV", () =>
    expect(() =>
      readScoreFile(strToU8("email,score\na@b.de,=1+1"), "x.csv"),
    ).toThrow());
  it("rejects hostile XML and formula cells", () => {
    for (const xml of [
      '<!DOCTYPE x [<!ENTITY a "boom">]><worksheet/>',
      "<worksheet><sheetData><row><c><f>1+1</f><v>2</v></c></row></sheetData></worksheet>",
    ])
      expect(() =>
        readScoreFile(
          zipSync({ "xl/worksheets/sheet1.xml": strToU8(xml) }),
          "x.xlsx",
        ),
      ).toThrow();
  });
  it("rejects expansion bombs", () =>
    expect(() =>
      readScoreFile(
        zipSync({
          "xl/worksheets/sheet1.xml": new Uint8Array(17 * 1024 * 1024),
        }),
        "x.xlsx",
      ),
    ).toThrow());
});
it("reads a data-only XLSX first sheet and preserves source metrics", () => {
  const data = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>email</t></is></c><c r="B1" t="inlineStr"><is><t>quality</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>driver@example.com</t></is></c><c r="B2"><v>98</v></c></row></sheetData></worksheet>',
    ),
  });
  const result = normalizeRows(
    readScoreFile(data, "score.xlsx"),
    "2026-W37",
    {},
    drivers,
  );
  expect(result.rows[0].metrics).toEqual({ quality: "98" });
});
it("rejects unknown mappings and fake ISO weeks", () => {
  expect(() =>
    normalizeRows(
      [["email"], ["driver@example.com"]],
      "2026-W37",
      { email: "driverId" },
      drivers,
    ),
  ).toThrow();
  expect(() =>
    normalizeRows([["email"], ["driver@example.com"]], "2025-W53", {}, drivers),
  ).toThrow();
});
it("rejects encrypted ZIP flags and truncated archives", () => {
  const data = zipSync({ "xl/worksheets/sheet1.xml": strToU8("<worksheet/>") });
  const encrypted = data.slice();
  encrypted[6] |= 1;
  expect(() => readScoreFile(encrypted, "x.xlsx")).toThrow();
  expect(() => readScoreFile(data.slice(0, -4), "x.xlsx")).toThrow();
});
