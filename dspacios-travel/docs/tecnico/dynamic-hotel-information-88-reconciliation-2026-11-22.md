# #88 — hotel information in dynamic packages: reconciliation, acceptance matrix and delivery record

Date: 2026-11-22 · Executor: Claude (Sonnet 5.5) · Branch `claude/88-info-hotel-dinamico` · worktree `.worktrees/88-info-hotel-dinamico` · base **`origin/main` cd9bb1946** (#450 merge; fetched and compared before starting — the local `main` branch is stale at f4489c721 and dirty, so it was not used). #103's worktree, build, configuration and review data were not touched. Block definition: `dynamic-hotel-information-88-block-2026-11-22.md` (main checkout).

> Status: sections 1–3 were written **before any code was changed**; sections 4–7 record what was produced afterwards. Nothing is staged, committed or pushed; no remote SQL, live mail or deployment. **Executor evidence only — Codex audit and owner review have not happened.**

## 1. Reconciliation — what already works (code read first, then proven in the real flow; see §4)

"Dynamic package" here = the **100 % dynamic package** (#82/#434: tables `paquete_din*`, builder `/dashboard/paquetes/total`, public tab «Dinámicos» of the tarifario, checkout `/tarifario/checkout/dinamico`). The older catalog-driven «dinámico» offers in Vista Booking (`DinamicoModal`, `infoPorHotel`) already read the catalog hotel live and are **out of scope** (nothing missing there).

Data path of a linked hotel (verified by reading the code):

1. `paquete_din_hoteles.hotel_id` → `hoteles.id` (the catalog «ficha»); null = manual hotel.
2. **Builder** (`paquetes/total/HotelFilaDin.tsx`, `catalogos.ts`): shows the ficha's stars/description/location live and locks those fields when the ficha has them; **on save** the server copies them from `hoteles` into the package row (`cargarInfoHotelesFicha` in `lib/paqueteDinamico/fichas.ts`, migration 279) — never from the browser, never invented (`f?.estrellas ?? h.estrellas`).
3. **Public read** (`lib/paqueteDinamico/cargarPublico.ts` → `vistaPublica` in `publico.ts`): built `HotelPublico` **only from the package row's stored copy** (`h.descripcion`, `h.estrellas`, `h.ubicacion`, `h.foto_url`); from the ficha it read only rules/options (`cargarReglasHoteles`, `cargarOpcionesHotelFicha`: batched `in (ids)`).
4. **Card** (`app/tarifario/PorDinamicos.tsx`): `Categoria` (stars), room category/regime line («Habitación X · régimen», distinct from stars), `DescripcionHotelExpandible`, `UbicacionHotel` (map link), `CarruselFotoHotel fotos={[h.foto]}`, price «Desde por persona en doble» and the quote calculator.

Already working and preserved: validation of 1–5 stars; copy-on-save; locking of ficha-provided fields in the builder; manual hotels with manual stars/description/location/photo; the stars row hidden when no stars; clamp + expand for long descriptions; map link only with a location; stars never mixed with the room category; no net/markup/provider in the public view; prices, totals and the quote calculator.

## 2. Gaps — CONFIRMED in the real flow before coding (baseline, unmodified source, §4.1)

- **G1 Photos (confirmed).** The linked hotel's catalog gallery (`hotel_fotos`) was never used; the card showed `foto_url` (manual) or the generic placeholder (baseline: 88001#0 showed the placeholder although the catalog hotel had 3 photos).
- **G2 Snapshot vs catalog (confirmed).** The card showed only what was copied at the last save: an empty copy showed no stars/description/location although the catalog had them (88001#0, 88001#1, 88003#0, 88003#3); an old copy showed old stars (88003#1 showed 2★, catalog 4★).
- **G3 Classification (confirmed).** The card passed `clasificacion={null}`; a catalog hotel without stars but with «Posada» showed nothing (88002#0).
- Not gaps (checked): checkout summary and quotation documents of the normal flow do not show stars/location for any hotel type (no parity to restore); Booking dynamic offers read the catalog live.

## 3. Acceptance criteria (defined before coding) and results

Expected values were written by hand in `expected88.json` / the unit tests, independent of the code under test. Fixture ids: catalog hotels 30401–30408, packages 88001–88003.

| # | Requirement | Independently expected result | Evidence (final) | Status |
|---|---|---|---|---|
| A1 | Identity by `hotel_id`, never by name | Two rows named «Hotel Duplicado» (catalog 30401 vs 30402) each show their own data | Unit A1/A1b; real flow cards 88001#0 (4★, A-gallery) vs 88001#1 (5★, B photo, other text) | Pass |
| A2 | Catalog stars/description/location shown; stars ≠ room category | 4 star icons + description + map link; separate «Habitación Superior · PAM» | Unit A2; rendered cards; 1134 DOM checks | Pass |
| A3 | Missing fields degrade cleanly | No empty star row, no blank «Ubicación» heading, no map link, placeholder only when nothing exists | Unit A3/A3b; cards «Hotel Vacío», «Hotel Manual Pelado», «Hotel Sin Estrellas» (classification «Posada» instead of stars) | Pass |
| A4 | Catalog gallery, cover first, no duplicates; manual photo only without catalog photos; placeholder last | Counter «1 / n», first image = cover | Unit A4 + batching test (cover/dedupe); cards 88001#0 «1 / 3» A-2 PORTADA first, 88002#2 «1 / 2», 88003#3 «1 / 2» (catalog beats the manual photo) | Pass |
| A5 | Manual (unlinked) hotel unchanged | Exactly the stored values | Unit A5/A5b (+ mutation N4); cards «Hotel Manual Pleno»/«Pelado» identical to baseline | Pass |
| A6 | Stale/missing copies | Catalog value wins when present; stored value remains when the catalog field is empty; nothing invented | Unit A6 (5 cases); cards 88003#0, #1, #2 | Pass |
| A7 | Prices, totals, availability untouched | `opciones`/«Desde» identical; quote totals as computed by hand | Unit A7 (deep equal; Desde 500.000/700.000 computed by hand); 11 «Desde» values equal to `expected88.json` in 3 roles × 3 widths; Cotizador totals (5 cases) = 1.000.000 / 1.300.000 / 1.400.000 / 1.600.000 / 960.000 | Pass |
| A8 | Public/B2B payload only presentation fields | Key whitelist; no net/markup/provider/note | Unit A8 (exact key list, secrets absent); `select` limited to `id, estrellas, clasificacion, descripcion, ubicacion` (+ mutation N8) | Pass |
| A9 | Request consumption | Batched, independent of hotel/package count, none per card, no client fetch/polling, failure degrades | **15 → 18 requests per render** (hoteles 1→2, hotel_fotos 0→2), identical for 3 reps; unit batching test with 1/3/50 ids → 1 `hoteles` query and ≤2 `hotel_fotos` requests; degrade test below. See §6 for why it is +3 requests (+2 reads) | Pass (with note) |
| A10 | Multiple hotels, long text | Each card its own data; long text clamped | 3 packages / 11 cards; «Hotel Largo» ~1 600 characters clamped with «Ver más» | Pass |
| A11 | Roles/surfaces | Same presentation for visitor, agency, internal; no costs | `final-visitante`, `final-agencia` (agencia88@walk.test), `final-admin` (admin88@walk.test): 1134/1134 checks; builder code untouched | Pass |
| A12 | Responsive and visual | 1280/820/390 px, no overlap/overflow | No horizontal page scroll, no card overflow, no overlaps (DOM measured) and screenshots **read** at 1280 and 390 (collapsed + expanded) | Pass |
| A13 | Production build | `next build` exit 0 on the final source | Exit 0 · BUILD_ID `DN1DYVPAK4hoSIU_S14p9` · source fingerprint below | Pass |

Impact scope (declared before coding, unchanged): `lib/paqueteDinamico/{fichas,cargarPublico,publico}.ts`, `app/tarifario/PorDinamicos.tsx`, tests; **no schema change, no migration, no change to calculation, checkout or builder**.

## 4. Implementation and evidence

### 4.1 Baseline (unmodified source, same fixtures)
Visitor, 1280 px: 105/126 checks passed, **21 failed** (every failure is G1/G2/G3 above); 15 requests per render (3 reps).

### 4.2 Change (4 source files, +~70/−~15 lines)
- `lib/paqueteDinamico/fichas.ts` — new `cargarPresentacionHoteles(admin, hotelIds)`: exactly two reads per batch (`hoteles` presentation columns, `hotel_fotos` through the existing paginated `leerFotosHotel` + `galeriaPorHotel`); stars validated (integer 1–5 else null), texts trimmed; **throws on read failure** (never confused with «the ficha has no data»). `cargarInfoHotelesFicha` (save path, asserted by #82 tests) is unchanged.
- `lib/paqueteDinamico/publico.ts` — new pure `presentacionDelHotel` + types: for a **linked** row (`hotel_id != null`) the catalog value of **that id** wins when it has one, otherwise the stored copy remains, otherwise empty; photos = catalog gallery → stored `foto_url` → placeholder; unlinked rows = stored values exactly as before. `HotelPublico` gains `fotos[]` and `clasificacion`.
- `lib/paqueteDinamico/cargarPublico.ts` — one extra batched call inside the existing `Promise.all`, with its own `.catch` (logs, returns an empty map → cards fall back to stored copies; the list is never blocked).
- `app/tarifario/PorDinamicos.tsx` — `CarruselFotoHotel fotos={h.fotos}`; `Categoria clasificacion={h.clasificacion || null}` (shown only when there are no stars, the existing rule of every other hotel card).

### 4.3 Tests
- New `pruebas/paqueteDinamico88HotelCatalogo.test.ts`: **15/15**. Covers identity by id with duplicated names, precedence matrix, photo order/fallbacks, manual hotels, price deep-equal with hand-computed «Desde», payload whitelist/no secrets, batching with 1/3/50 ids and 2 distinct queries, star validation/trim/extra-column rejection, failure → throw, wiring of degrade + card.
- **Negative controls** (each mutation of the implementation made at least one test fail, then the file was restored): N1 catalog never wins · N2 stars ignored · N3 gallery ignored · N4 manual hotel consults the catalog (initially **not** caught → added A5b, now caught) · N5 stored value overrides catalog · N6 stars not validated · N7 one `hoteles` query per id · N8 private column added to the select.
- Existing: `paqueteDinamico82*.test.ts` + new file together **205/205** (one #82 wiring assertion on the exact text of the stars/location mapping was updated to the new `presentacionDelHotel` mapping — behaviour is covered by the new file); `netoEmpaquetados224.test.ts` 49/49; `hotelFilaDin82.react.ts` **13/13** (its public-card fixture gained the two new required fields; one jsdom test added: gallery counter, classification only without stars). `tsc --noEmit` clean. Full suites were **not** run (scope instruction).

### 4.4 Real flow (own disposable stack, production build)
Stack `h88_*` (own Postgres/GoTrue/PostgREST/gateway, loopback, synthetic data cloned from the production-equivalent schema template). `next build` → `next start` on 127.0.0.1:3088 with the stack's public config. For visitor, agency and internal accounts at 1280, 820 and 390 px: **1134/1134** DOM checks against hand-written expectations (stars, gallery order/count, description text, location section present/absent, classification, «Desde» price, no card overflow, no overlap, no horizontal page scroll). Visitor after the degrade test: 378/378.
- **Degrade test:** `hotel_fotos` renamed in the disposable DB → page still renders all 11 cards identical to the unmodified baseline, server logs `dinamicos: presentación de hoteles del catálogo … Could not find the table 'public.hotel_fotos'`; table restored (9 rows) and checks pass again.
- **Price control (Cotizador, agency login):** each of 5 cards, 1 double room, dates 10–13/03/2027: totals 1.000.000, 1.300.000, 1.400.000 (neta_markup: 560.000/0,8 × 2), 1.600.000, 960.000 — all equal to the hand-computed values. Fixture note: to make the calculator valid I added triple/múltiple/niño/infante prices to the tested package rows **in the disposable DB only** (the validator requires every accommodation to be priced); they do not affect the 1-double-room totals.
- Screenshots (read): collapsed and expanded, three roles, three widths, in the executor scratchpad `s88/final-*`. The Google Maps iframes render blank offline — the link and embed `src` are present but the map itself could not be viewed.

### 4.5 Production build
`next build` exit **0** (first attempt with a 2 GB heap died in the TypeScript phase with heap OOM; second attempt with 3 GB passed). BUILD_ID `DN1DYVPAK4hoSIU_S14p9`. Source fingerprint (`huella.mjs` over `app lib components styles public types proxy.ts next.config.ts package.json`, 1034 files): `c506d2aedde0f0539adec7b0b0d8732615bbf79eb43ee10dfcc8046f1d64d455` — identical when measured after the last test-only edits, i.e. the build matches the final source.

## 5. Measured local resources
Free RAM before the build 3.78 GB; minimum observed during the successful build 623 MB (guard floor 400 MB; the guard did not abort). Disposable containers capped (Postgres 640 MB). Executor processes stopped after use: `next start` (stopped), builds finished. The `h88_*` containers were removed at the end (see §7). #103's services, build (`IPfbW6qGGDVtuQda4XvBH`) and review folder were not started, stopped, rebuilt or read.

## 6. Remaining gaps, limits and notes for the Codex audit
1. **Request count is +3 HTTP requests, +2 queries.** `hoteles` +1 and `hotel_fotos` +2: the reused paginated helper `leerFotosHotel` always issues a terminating empty page. Constant (independent of hotels/packages); not changed to avoid forking the helper used by every other hotel card.
2. **Degradation is all-or-nothing.** If either batched read fails, the whole catalog overlay is dropped (cards show stored copies, as before #88), even though the other read may have succeeded. Chosen for simplicity/honesty; splitting it is a small follow-up if wanted.
3. **Catalog wins over a stored value.** For a linked hotel whose catalog field has a value, a different stored value is overridden (intended: the builder locks those fields when the ficha has them, so the stored value is only a past copy). The stored value is used only when the catalog field is empty.
4. **Not verified:** real production data (no remote access); the map rendering (offline); full test suites; the builder UI (not touched); B2B portal pages outside `/tarifario?vista=dinamicos` (they do not render this card).
5. **Checkout/quotation documents** do not show stars/location for any hotel type; deliberately not changed.
6. **Who verified what:** everything above is **executor** evidence. Codex audit: pending. Owner review: not requested per piece; **proposed pending-local-review queue entry** (not written into the queue file, which is outside this worktree): «#88 — in the Dinámicos tab, open one package whose hotel is linked to a catalog hotel with photos/stars/description/location and confirm it shows the real catalog data; price/“Desde” unchanged».
7. **Migrations:** none needed; numbering check not applicable.

## 7. Cleanup state
`next start` stopped and the disposable stack torn down (`stack88 down`: 0 `h88_*` containers, 0 `h88_*` networks remain). #103's build id still reads `IPfbW6qGGDVtuQda4XvBH`. Working tree: 4 source files, 2 test files modified, 1 new test, this document — nothing staged. No staging, commit, push, remote SQL, live mail or deployment.
