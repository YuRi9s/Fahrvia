import {
  readScoreFile,
  normalizeRows,
} from "./lib/src/features/score/parser.js";
process.once("message", (message) => {
  try {
    const { bytes, filename, week, mapping, drivers } = message;
    const result = normalizeRows(
      readScoreFile(new Uint8Array(Buffer.from(bytes, "base64")), filename),
      week,
      mapping,
      drivers,
    );
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
