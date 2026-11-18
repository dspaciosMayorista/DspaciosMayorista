# Owner corrections 2026-11-18 — SEARCH workstream (items 3 and 4)

Scope: unit-priced accommodation in the Vista tabla (item 3) and the search-result presentation of the free-child promotion (item 4).
Source: `.worktrees/int-review` (integrated batch, base `51ea60612`, uncommitted). Status: **implemented, focused tests green; not browser-verified, not audited by Codex, not accepted by the owner.** No staging, commit, push, SQL or database write was performed.

## 1. Item 3 — unit accommodation in the table

### Root cause (the actual exclusion)

`app/tarifario/BuscadorBooking.tsx`, `buscar()`: the second request of a search (`buscarAlojamientosUnidadPorFechas`) was only issued when `modo === "booking"`.
In `modo="tabla"` it was replaced by `Promise.resolve({ ok:false, error:"unidad_no_soportada_en_tabla" })`, which produced the amber note «La Vista tabla no incluye los alojamientos por unidad…».
Even if unit results had been present, `TablaResultadosBusqueda` only iterated `estado.resultados` (person rows) and showed its empty state whenever that array was empty — so a destination with only unit hotels always looked empty.

### Change

| File | Change |
| --- | --- |
| `app/tarifario/BuscadorBooking.tsx` | The unit search is requested in table mode as well (same action, same arguments, same standard room split). The `unidad_no_soportada_en_tabla` branch and its message were removed. `sin_reparto_estandar` (e.g. 5 adults in 1 room) is still explained and never disguised as «no unit hotels». |
| `app/tarifario/TablaResultadosBusqueda.tsx` | New section «Alojamientos por unidad · estadía de N noches» (`data-testid="tabla-unidad"`). Columns: Hotel · Categoría · Alimentación · Habitaciones y viajeros · Total de la reserva. Honest label «Precio por habitación, no por persona». Filters (hotel/category/regimen) apply to it. At most two options per hotel, «Ver N opciones más» expands. The empty state is shown only when there are neither person nor unit results. Person sections (stay + additional night) render only when person rows exist. New pure exports `nochesEntreISO`, `textoOcupacionUnidad`. |
| `app/tarifario/TarifarioPublic.tsx` | Comment updated (no logic change). The existing amber blocks (`avisoUnidad`, `hoteles-en-revision`) already render in the table and already carry the unit hotels whose mandatory age configuration is missing. |

What is deliberately **not** done:

- No per-person (adult/child) tariff is ever derived for a unit hotel. The row shows the server-confirmed total (`OpcionUnidadConfirmada.precioVenta`, built field by field from `computarReservaBernalo`) and the rooms/travellers that passed capacity and age validation.
- No additional-night value for unit hotels (there is no engine path for it; inventing one would violate the rule). The section says so and tells the user to change the return date and search again.
- Capacity, minor classification and the mandatory hotel ages remain decided by the existing server engine (`evaluarDisponibilidadHotelUnidad` → `computarReservaBernalo`); the UI only renders its verdict.
- The table has no booking action for unit hotels (their cart/checkout flow lives in Vista Booking). The section header does not claim otherwise.

### Request/computation delta (to be recorded under `VALIDACION_CONSUMO_VERCEL.md`)

| | Before | After |
| --- | --- | --- |
| Server actions per click on «Buscar hoteles» in Vista tabla | 1 (`buscarHoteles`) | **2, in parallel** (`buscarHoteles` + `buscarAlojamientosUnidadPorFechas`) — identical to Vista Booking. Still **one pair per click**, never per card/row. |
| Extra server work of the second action | — | discovery by destination, one batch read of `hoteles`/`hotel_temporadas`/`hotel_tarifas_unidad` for the destination's unit hotels, then `computarReservaBernalo` per hotel × category × regimen with concurrency 4 (`CONCURRENCIA_HOTELES_UNIDAD`). Bounded by the destination's catalogue; zero when the destination has no unit hotels. |
| Browser effects / polling | none | none added. The existing nonce-guarded effect (date suggestion) is untouched. |
| Idle (no click) | 0 calls | 0 calls — asserted by `ocupacionBusqueda102Ui.react.ts` (waits 300 ms after the search and re-counts both mocks). |

Measured here: mock-level call counts only (1 + 1 per click, 0 at rest). **Not measured:** real latency or hosted Vercel/Supabase consumption of the added action; no saving or zero impact is claimed. The unit-search action has no cache or rate limit (documented in its file header); that existing risk now also applies to the table path.

### Why the owner's screenshots were empty (date mismatch, separate from the exclusion)

The screenshots search **10–13 June 2027**. The seeded fixtures are priced only in **2030**: CARTAGENA 102 / O3 / U1 tariffs (`semilla_local102.sql`, `semilla_revision_o3.sql`, `semilla_revision_u1.sql`) have `ALTA` seasons `2030-01-01 … 2030-06-30` (U1: through `2030-12-31`) and the packages' travel window is 2030. Nothing is priced in June 2027, so the engine correctly returns «no hoteles con tarifa» there. That is a **data/date mismatch, not the table limitation**; the table limitation (unit hotels never searched in table mode) would have remained even with the right dates.

### Owner walkthrough with matching dates (no database write needed; fixtures already loaded in the review environment)

Sign in as `administracion@revision.test` (or `superadmin@revision.test`) through `/login`, then `/tarifario` → **Vista tabla** → **Porción terrestre** (the integrated tariff has other modules; the default is not the terrestrial portion).

| # | Destination | Dates (dd/mm/aaaa) | Travellers | Expected |
| --- | --- | --- | --- | --- |
| 1 | CARTAGENA U1 | 10/06/2030 → 13/06/2030 | 1 room, 2 adults, no minors | Section «Alojamientos por unidad · estadía de 3 noches» with both unit hotels (`U1 · Hotel por unidad con edades` and `… SIN edades`), «1 hab Doble · 2 adultos». Total by hand from the fixture inputs (unit tariff `adulto` 100.000 per person per night, published unit price = authoritative, no package markup — DECISIONS line 104; `comisionPct` 20 is the agency commission inside that price): 2 adults × 3 nights × 100.000 = **600.000** (engine and compiled build agree; the earlier 750.000 derivation wrongly applied the 20 % package markup to a unit price). No amber warning. |

> **Correction by the verification (2026-11-18, compiled build, disposable copy):** the derived 750.000 in this row was WRONG. The engine returns **$600.000** for 2 adults / 1 room / 3 nights, which is right by hand: 2 adults × 3 nights × 100.000 (`adulto` per person and night in the U1 fixture; its `comisionPct` 20 is the agency commission, not a markup). **750.000 is the answer for row 2** (2 adults + a 5-year-old: 600.000 + 3 nights × 50.000 child = 750.000, 3 pax). See `owner-corrections-verif-search-promo-2026-11-18.md`.
| 2 | CARTAGENA U1 | same | 1 room, 2 adults + 1 minor aged 5 | `U1 · Hotel por unidad con edades` listed with «+ 1 menor (5 años)» and a larger total (by hand: 600.000 + 1 child aged 5, band 3–10 → 3 nights × 50.000 = 150.000 → **750.000**, 3 pax; infant band 0–2 would cost 0). `U1 · Hotel por unidad SIN edades` is **not** a row: it appears only in the amber block «1 hotel no se pudo cotizar con estas edades de menores» naming the missing fields (the mandatory-age rule, unchanged). |
| 3 | CARTAGENA O3 (person model) | same | 1 room, 2 adults | Unchanged person tables (stay + additional night): documented 750.000 total and 250.000 additional-night reference. Confirms nothing regressed. |
| 4 | CARTAGENA U1 | **10/06/2027 → 13/06/2027** | any | Empty state «No hay hoteles con tarifa…» — this reproduces the owner's screenshot and demonstrates that the emptiness comes from the date, not the view. |
| 5 | CARTAGENA U1 | same as 1 | **5 adults, 1 room** | Amber note: no standard room split exists, unit hotels were not evaluated (explained, never «no unit hotels»). |

Widths to inspect: desktop (≥1280), an intermediate width (~900–1000, where the table starts to scroll/stack), 390 px (cards with `data-label`). Compare with Vista Booking for the same search: the same unit hotels and totals must appear in both views.

Optional filters to try on step 1: type «Hotel por unidad con edades» in the hotel filter (only that hotel remains), then pick a category that does not exist (the «Ningún resultado coincide con los filtros» message).

### Tests

- `pruebas/tablaUnidad102.react.ts` (new, 5 tests, added to `test:react`): pure helpers; unit-only result shows no empty state and no per-person tariff and no additional-night section; filters apply to unit rows; the two-options-per-hotel cap and expansion; empty state / combined person + unit.
- `pruebas/ocupacionBusqueda102Ui.react.ts` (updated): table mode now makes exactly one unit call with the standard split (`doble`, 2 adults, no minors), publishes `avisoUnidad === null`, and makes no further calls after 300 ms.

## 2. Item 4 — promotion display in search results

### What was wrong

For a child with the «one free child per room» benefit the line already carried the amount to pay (`tarifa`) plus a text built by arithmetic: «Niño gratis por habitación · PRE BF · tarifa $269.000 − $101.000». It said «Niño gratis» even when the child still paid 168.000 (nights outside the promotion, retained services/flight), and showed a subtraction.

### Change

`app/tarifario/desgloseTarifas.tsx` (used by the Vista Booking card **and** the table, stay and additional night):

- `beneficioNino(line)` (pure): returns `null` unless `gratis.condonado > 0` — a benefit that forgives nothing (promotion not applicable to that stay/night) is not announced. Regular tariff = `tarifa + condonado`; `gratisTotal` = payable is zero; promotion names are filtered of blanks.
- `textoNinoGratis(line)`: «Niño gratis[ · PROMO]» only when the payable amount is 0; otherwise «Alojamiento gratis solo en las noches de la promoción[ · PROMO]; las demás noches y los servicios o cargos retenidos se pagan». No arithmetic.
- `NotaNinoGratis`: renders «Tarifa regular <s>$269.000</s> · …» under the line (`data-tarifa-regular` on the `<s>`), next to the line's own payable amount (`$168.000`).
- Totals, line amounts, grouping of genuinely different tariffs (never averaged) and the engine invariant `sum(lines) == total` (`ninoGratisDesglose.ts`) are untouched — only the wording/markup changed.

Examples (owner numbers): regular 269.000, payable 168.000 → «Tarifa regular ~~$269.000~~ · Alojamiento gratis solo en las noches de la promoción · PRE BF; las demás noches y los servicios o cargos retenidos se pagan» with `$168.000 c/u` on the line. Fully free child: `$0` and «Tarifa regular ~~$169.000~~ · Niño gratis · PRE BF».

### Tests

- `pruebas/ninoGratis125.desglose.react.ts`: 12 original tests updated to the new wording (real engine → real components, sums still equal the total) + 4 new owner-case tests (168.000 partial: struck 269.000, no «Niño gratis», no subtraction; fully free; zero-condoned benefit not announced; unnamed promotion leaves no dangling «·»).

## 3. Results run in this workstream

| Command (project loader, no `tsc`, no build, no containers) | Result |
| --- | --- |
| `test:react` loader on `ninoGratis125.desglose.react.ts` | 16/16 pass |
| same loader on `tablaUnidad102.react.ts` + `ocupacionBusqueda102Ui.react.ts` | 20/20 pass |
| unit loader on `busquedaPorcionTerrestreWiring`, `busquedaMonedaResultadoWiring`, `edadesMenores`, `filtrosBusquedaVistaBookingWiring`, `ninoGratis125.wiring`, `ninoGratis125.integracion102`, `etiquetaDescuentoHotel90`, `tarjetaCompletaBuscarAlojamiento` | 500/505; the 5 failures are all in `tarjetaCompletaBuscarAlojamiento` (+ one in a vitrina test), source-text assertions about the `BackgroundVideo`/`UbicacionHotel` shape in `BuscadorBooking.tsx`/`VistaBooking.tsx` (lines this workstream did not edit). Not compared against a clean baseline here — classify them by name against the baseline list before attributing them. |

Not run (by instruction): `tsc`, `next build`, database/real-action suites, browser journeys, PDF/print inspection.

## 4. For the consolidated verification (lead)

1. `tsc` + production build (new TSX types: `AlojamientoUnidadDisponible` import in the table, `textoNinoGratis` signature change — only two callers, both updated).
2. Real-action/disposable-copy check of the table scenario rows 1–2 above; record the real totals (replace the derived 750.000 / child total in this document) and request counts per click with the network log (expect exactly 2 server-action POSTs per click, 0 at rest).
3. Browser at desktop, ~900–1000 px and 390 px for the unit section and a free-child search (e.g. hotels 912501/912503 on their documented dates) — confirm the struck «Tarifa regular» wraps cleanly in the narrow Menores column and the 390 px cards.
4. Check that no other surface still reads the old text «Niño gratis por habitación · … · tarifa X − Y» in search (grep found none outside the document/contract descriptions, which belong to the DOCS workstream and are stored text: `contrato_items` descriptions starting with «Niño gratis por habitación»).
