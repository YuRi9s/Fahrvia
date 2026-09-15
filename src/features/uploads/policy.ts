import { AppError } from "../../server/policy";
/** Extension, claimed MIME and bytes must agree before any decoder sees the input. */
export function validateUpload(
  filename: string,
  mime: string,
  data: Uint8Array,
): "image" | "pdf" {
  const ext = filename.split(".").at(-1)?.toLowerCase();
  if (filename.length > 200 || /[\u0000-\u001f]/.test(filename))
    throw new AppError(422, "Ungültiger Dateiname.");
  const b = Buffer.from(data);
  if (
    ["jpg", "jpeg"].includes(ext ?? "") &&
    mime === "image/jpeg" &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255
  ) {
    if (b.length > 10 * 1024 * 1024)
      throw new AppError(413, "Bild maximal 10 MB.");
    return "image";
  }
  if (
    ext === "png" &&
    mime === "image/png" &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (b.length > 10 * 1024 * 1024)
      throw new AppError(413, "Bild maximal 10 MB.");
    return "image";
  }
  if (
    ext === "pdf" &&
    mime === "application/pdf" &&
    b.subarray(0, 5).toString() === "%PDF-"
  ) {
    if (b.length > 20 * 1024 * 1024)
      throw new AppError(413, "Dokument maximal 20 MB.");
    return "pdf";
  }
  throw new AppError(
    422,
    "Nur gültige JPG-, PNG- oder PDF-Dateien sind erlaubt.",
  );
}
