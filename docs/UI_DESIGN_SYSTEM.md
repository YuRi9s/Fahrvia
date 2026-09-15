> Design baseline. Read `RELEASE_STATUS.md`, `API.md` and `OPERATIONS.md` for the current implementation and remaining gaps. Some decisions below describe the intended v1 target.

# Proposed design direction

Status: design proposal. No screens, original logo, brand clearance or visual QA have been completed.

## Character

Restrained German operational software: neutral surfaces, ink text, one dark teal accent, clear borders, readable typography and deliberate information density. Reserve orange/red for attention states. Use text and icons with color. The dashboard should foreground things requiring action and link directly to filtered operational lists.

Proposed light tokens: canvas #F5F6F7, surface #FFFFFF, text #17252B, secondary text #52616B, accent #12685E. Proposed dark tokens: canvas #11191D, surface #1A252B, text #EEF3F5, secondary text #ADBCC4, accent #7DD3C5. These are candidates; verify every actual foreground/background pair before claiming contrast compliance.

Use self-hosted Inter if the asset/license review passes. Body 14–16 px, table text 14 px, labels at least 12 px, tabular numerals for dates and metrics. Space on a 4 px scale. Radius 8 px for controls and 12 px for cards/dialogs. Use shadows for floating layers, not every row.

## Desktop administration

Persistent left navigation groups the eleven requested modules into operations and administration without hiding their labels. The top bar shows page context, search where relevant, notifications and the profile menu. Account menu includes avatar, name, email, role, Personalisieren and Abmelden.

Vehicle rows retain brand/model/year → plate → VIN hierarchy. Ownership and provider are distinct. Progressive vehicle forms show rental provider only when relevant and put advanced fields in Weitere Angaben. Provide the required Fotos, Zuweisungen, Inaktive and Schlüsselmappe tabs.

Score uses a deliberately wide table, sticky identifying columns, visible period/source context and horizontal scrolling. Display import preview errors beside their row/column context before allowing commit. Avoid a success toast when data has only been uploaded, not committed.

## Mobile drivers

Primary destinations: Start, Fahrzeuge, Profil. Profile provides Score, Fahrzeugverlauf, Dokumente and Einstellungen. Score opens grouped own-data metrics with period navigation and PHR/Concessions detail buttons where data exists. Show empty source data honestly. Vehicle history remains separate from score.

Never compress the administrative score table to phone width. Use metric groups and disclosures. Preserve a usable 320 px layout and test 360, 390, 430 px and landscape sizes. Vehicle details use readable labels and a single primary next action.

## Interaction contract

- URL-backed list search/filter/period state with bounded pagination and clear-filter control.
- Inline form errors, associated labels, preserved values after recoverable errors and focus on the first invalid field.
- Accessible dialogs with labelled titles, focus containment/restoration and clear cancel actions.
- Short CSS opacity/transform transitions around 120–220 ms, with nonessential motion disabled for reduced-motion users.
- German date display dd.MM.yyyy; timestamp time beneath date and seconds visually secondary. Store the source instant, not formatted strings.
- Theme persists as a harmless preference; both themes require their own tokens and tests.
- Loading, empty, permission-denied, error and retry states are part of each module's definition of done.

## Research basis and limits

[Fleetio's inspection product information](https://www.fleetio.com/features/vehicle-inspections) connects inspection workflows with defect follow-up. Our design inference is to link damage reports directly to the vehicle and attention queue. This is a product-workflow observation, not evidence that a specific table or layout has been usability-tested here.

Target [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Run automated checks and manual keyboard testing on the built application, including error states and both themes. Automated tools alone cannot establish accessibility conformance.

Brand research, final tokens, original SVG/icon work and visual benchmark comparisons remain before implementation of the finished visual system. Use “Fleet platform” as a documentation label only.

## Terminology

| German UI                                  | Internal term                     | Meaning                                                 |
| ------------------------------------------ | --------------------------------- | ------------------------------------------------------- |
| Fahrer                                     | driver                            | Driver profile linked to authenticated membership       |
| Fahrzeugbesitz                             | ownershipType                     | Eigentum, Gemietet or Geleast                           |
| Zuweisung                                  | vehicleAssignment                 | Auditable operational handover                          |
| Schlüsselmappe                             | keyCustody                        | Individual physical key location/holder                 |
| Fahrzeugverlauf                            | vehicleHistory                    | Vehicle assignments grouped by ISO week                 |
| Kalenderwoche / KW                         | isoWeek + isoWeekYear             | Complete unambiguous reporting period                   |
| Concessions                                | concessionEntry                   | Source-provided delivery complaint/problem details      |
| PHR                                        | phrEntry                          | Source label retained; expansion not assumed            |
| Soll-Zustellort / Tatsächlicher Zustellort | intendedLocation / actualLocation | Natural German presentation of the requested PHR fields |
