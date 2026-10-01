import {
  readScoreWorkbook,
  suggestMapping,
  normalizeRows,
} from "./lib/src/features/score/parser.js";
process.once("message", (message) => {
  try {
    const { bytes, filename, week, mapping, drivers, selection = {} } = message;
    const { table, ...metadata } = readScoreWorkbook(
      new Uint8Array(Buffer.from(bytes, "base64")),
      filename,
      selection,
    );
    const normalized = selection.inspect
      ? {
          rows: [],
          errors: [],
          columns: table[0] ?? [],
          mapping: suggestMapping(table[0] ?? []),
        }
      : normalizeRows(table, week, mapping, drivers);
    const result = { ...normalized, ...metadata, sample: table.slice(1, 6) };
    if (!selection.inspect)
      result.errors = result.errors.map((e) => ({
        ...e,
        row: e.row ? e.row + metadata.headerRow - 1 : 0,
      }));
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    process.send(
      {
        ok: false,
        message: error.status
          ? error.message
          : "Die Datei konnte nicht verarbeitet werden.",
      },
      () => process.exit(0),
    );
  }
});
