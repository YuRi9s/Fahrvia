import { it, expect } from "vitest";
import { validateUpload } from "../src/features/uploads/policy";
it("rejects executable content with image extension", () =>
  expect(() =>
    validateUpload("photo.jpg", "image/jpeg", Buffer.from("<?php evil")),
  ).toThrow());
it("rejects oversized uploads before decoding", () =>
  expect(() =>
    validateUpload("photo.png", "image/png", new Uint8Array(11 * 1024 * 1024)),
  ).toThrow());
it("rejects SVG scripts", () =>
  expect(() =>
    validateUpload("photo.svg", "image/svg+xml", Buffer.from("<svg/>")),
  ).toThrow());
it("rejects mismatched PDF MIME", () =>
  expect(() =>
    validateUpload("doc.pdf", "text/html", Buffer.from("%PDF-1.7 test")),
  ).toThrow());
