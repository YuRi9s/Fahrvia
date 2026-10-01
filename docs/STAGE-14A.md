# Stage 14A — Score Excel import/export (v0.1.26)

This resumes the deferred score work using the supplied screenshot headers. PHR/concessions ingestion and validated provider-specific scoring definitions remain separate stages. No scores, bonuses, rankings or metric units are calculated or inferred.

## Upgrade and test

For an existing installation managed by the local database workflow:

```bash
npm run db:upgrade
npm run local:dev
```

Apply additive migration `20260925_score_selection` before this release. It adds nullable JSON selection metadata to ScoreImport; historical imports remain intact. For Stage 19 manually managed installations, use the established explicit migrator deployment procedure. Never reset the database. Fresh installations use `npm run local:bootstrap`.

1. As an administrator open Score → Score-Datei importieren.
2. Select a CSV/XLSX and reporting week. Choose the header row (1–100) if a title precedes the headings. Click Datei / Tabellenblatt prüfen.
3. Select another worksheet if needed and check it again. Known headers such as Transporter ID, Total Score, Pos. and Pakete are recognized. Other columns remain source-text metrics. Select a saved mapping from import history or adjust individual fields; unwanted columns can be ignored.
4. Create a preview. This saves the mapping, sheet and header row in an organization-scoped draft. Unknown/conflicting driver IDs, duplicate drivers and invalid numbers block commit. Names are never used to guess identity; transporter ID or email must identify a driver.
5. Check values and errors. Up to 100 normalized rows and all metrics are shown; all rows are validated and committed. Missing optional values remain empty. Changing inputs invalidates the preview.
6. If that week already has active scores, explicitly confirm replacing the **whole weekly revision**. Drivers absent from the new file will not appear in that week's active scores. Old revisions remain in history. A changed active revision requires a fresh preview.
7. Set week/search/status/sort on the score screen, then Excel exportieren. The workbook includes all authorized matches, not just the current page, and an Exportinfo sheet documenting filters. Drivers only export their own scores; dispatchers cannot access score exports.

## Guarantees and limits

- Original source bytes are retained privately. Mapping presets are existing draft/history mappings, not browser-local settings; history exposes the latest 100 imports.
- Duplicate active normalized imports are rejected. Drafts can be reused. Commits recheck live admin membership, driver tenancy and the expected weekly predecessor under the existing transaction/advisory lock.
- XLSX output has typed numeric values, text transporter IDs, a frozen header and filters. Text is written as literal strings, never formulas or links. It is a Fahriva layout, not a reconstruction of an unseen provider workbook.
- Input: 5 MB; actual ZIP expansion 16 MB; 200 entries; 100 columns; 5000 data rows; 2000 characters per cell. Global active-content checks include unselected worksheets. Worksheet validation warnings during inspection allow selecting another sheet; malformed ZIP/XML and active content still reject the workbook.
- Export: at most 5000 matching records, 100 columns and 16 MB uncompressed XML. Oversized requests fail clearly, never silently truncate. Export follows the same search/status/order scope as the screen.
- Data-only spreadsheets are supported. Formula cells, macros and external references are rejected. Excel formatting is not interpreted: percentage/date display styles and number formats do not define business units. A raw numeric 0.98 remains 0.98; no guessing that it means 98%. Use literal text such as `98%` for source-text metrics or a values-only provider export with known units.
- Real provider XLSX files were not supplied. Compatibility with their actual layouts, units and formulas is not certified. Test a real file through preview before confirming.

See STAGE-14A-VERIFICATION.md for executed checks and limitations.
