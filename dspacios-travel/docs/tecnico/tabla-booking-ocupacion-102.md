# #102 — Table view and Booking search: occupancy, extra night, minor price breakdown

Branch `claude/102-tabla-booking-ocupacion` (worktree `.worktrees/tabla-booking-ocupacion`), based on `main` f4489c721.
Task number: next free ID in the first column of TASKS.md (the legacy «Antes» #102 is unrelated). No migration, no schema change.

## 1. What changed (by requirement)

| # | Requirement | Where |
|---|---|---|
| 1 | Table layout | `TablaHorizontal` in `app/tarifario/TarifarioPublic.tsx` (fixed column widths, right-aligned tabular prices, hotel/category/meal-plan hierarchy, `ResponsiveTableShell` stacking with `data-label` on phones instead of clipped columns) |
| 2 | Package nights vs ONE extra night (Porción terrestre only) | `PorPaquete` (browse mode: «Paquete de N noches» + explanatory «Una noche adicional» panel) and `TablaResultadosBusqueda.tsx` (search mode: two separate sections) |
| 3 | External search in the table view | `PorcionTerrestreTabla` embeds `BuscadorBooking modo="tabla"` — same inputs, same Server Action (`buscarHoteles`), ONE call for the whole destination |
| 4 | Logical room allocation | `lib/reservar/asignacionHabitacionesBusqueda.ts` (+ `composicionHotelBusqueda.ts`); the buscador now asks for the NUMBER of rooms, not a type per room |
| 5 | Compact adult/minor breakdown | `desgloseTarifas.tsx` (card) and the table columns; both paint `ComboBusqueda.desglose`, built by the engine from the same numbers that form `total` |
| 6 | Hotel-specific age classification | `clasificarMenoresDeHotel` + per-combo age rule (`resolverReglaEdadEstadiaSegura`, unchanged) |

## 2. Rules (documented preferences — owner to confirm)

**Global normalization** (`validarOcupacionGlobal`, runs in the client AND before any catalog read on the server): integer rooms 1–8, adults ≥ 1, `rooms ≤ adults + minors`. It never decides room types or ages.
**Standard allocation** (`repartoEstandar`) is shown before searching only as orientation (1→Doble, 3→Triple, 4→Múltiple with the 1/2/3/4 defaults). It never blocks the search: each hotel can sell other accommodations or classify a minor as an adult.

**Per hotel/combo** (`evaluarComposicionHotel`, pure):
1. Age rule of the combo (temporada override → the hotel's MANDATORY general configuration; **no default since O3, 2026-11-17**). Infant `e ≤ infanteMax`, child `e ≤ ninoMax`, otherwise **adult rate for that hotel**. The passenger keeps the real age (`edadesComoAdulto` on the result and the cart item; never rewritten as a legal adult).
2. Adults at adult rate = declared adults + those minors. Room types offered = the accommodations the combo actually sells (priced), with the hotel's own `pax_tarifa`.
3. Allocation preference among valid ones: the most **even** split (4 adults/2 rooms → 2 Dobles, not Triple + Sencilla), then lexicographic by size. Minors are placed with the existing `distribuirPorHabitaciones` (minimums first, then capture order, Niño 1/Niño 2 cap per room). The first candidate whose minors fit wins; otherwise the real reason of the preferred candidate is returned.
4. If the rule is ambiguous/incomplete (override missing, duplicated, partial, or two seasons with different rules in one stay) the combo is NOT offered and the hotel is reported as «en revisión» (`enRevision`, shown as an amber notice). No free-child rate is invented. Per-room-type rules: a room type is evaluated under the rule of ITS season; two rules never decide one minor.
5. Legacy mode (`habitaciones: [{acom}]`, used by cart revalidation `revalidarHotelPersona`) is unchanged: an age above the child band is still rejected there. The cart now stores only true minors in `edadesMenores`, so a cart item with an adult-rate minor revalidates and checks out as «3 adults in a Triple».

**Extra night** (`calcularNocheAdicional`): `total(N+1 nights from the same arrival) − total(N nights)` computed with the same engine and the same already-loaded hotel data (no extra I/O). It is exactly the night of the checkout date, governed by ITS season/promotion/group. It is reported as «not available» (with the reason) when that night has no tariff, exceeds the stay limit (`validarRangoFechasConsulta`), or the composition changes with the longer stay (other room split or age rule). Rounding: totals keep the engine's rounding, so the difference is what the customer actually pays for the longer stay; it is not an average and not a «universal» price. Browse mode (no dates) states what must be selected.

## 3. Callers of the shared engine (traced)

- `buscarHoteles` (Server Action `reservar/actions.ts` → `lib/reservar/cotizar.ts`): only caller of `evaluarComposicionHotel` besides the date-suggestion path.
- `sugerenciasBusquedaGeneral` / `compatibleConComposicion` (`liquidacionHotel.ts`): reuse the same engine when the request has `numHabitaciones`.
- `revalidarHotelPersona` (cart edit): legacy explicit-rooms mode, unchanged semantics; now reads rooms/ages from the chosen combo.
- `cotizarPorFechas` (card internal calculator) and `computarReserva` (reservation): NOT modified; the pg test proves they return the same total as the search for the same composition.
- Unit/Bernalo half of the search: unchanged vía heredada, evaluated with the standard allocation (no user-chosen types any more); skipped with an explicit notice when no standard allocation exists. **Not supported / not changed:** unit hotels in the table view (explicit notice «La Vista tabla no incluye los alojamientos por unidad»), minors-as-adults for unit hotels (their reparto still rejects an age above the child band).
- Preserved: validity dates and expired-base exclusion, promotion/day-group precedence, stay limits (`MAX_NOCHES_CONSULTA`), currency/rounding, adults-only rejection, group-included services.

## 4. Evidence executed (executor, local synthetic data)

- `pruebas/ocupacionBusqueda102.test.ts` (unit, 20): normalization, allocation (2/3/4 adults, unsupported occupancy, multi-room conservation, determinism), age boundaries (2/3, 12/13, 15, 17), two hotels with different classification, several minors with different tariffs, desglose = total, missing/duplicated/ambiguous policy → review state, per-room-type rules.
- `pruebas/ocupacionBusqueda102.pg.ts` (19, real Postgres + PostgREST, real `generarTarifario`/`buscarHoteles`/`cotizarPorFechas`/`computarReserva`): run with `sh supabase/scripts/test_102_ocupacion.sh` (container `pg304`, template `plantilla304`; disposable DB, no migrations needed).
- `pruebas/ocupacionBusqueda102Ui.react.ts` (15, jsdom): buscador sends `numHabitaciones`, early rejection, tabla mode (extra night requested, no unit search), one click = one call, stale response not published, idle = 0 calls, table sections/labels/data-label, card = table totals, cart keeps `edadesComoAdulto` apart.
- Existing wiring tests that asserted the old structure of `cotizar.ts` were repointed to the extracted module (intent kept): `cotizarFechasWiring`, `edadesMenores`, `serviciosPaqueteWiring`, `tarifaInfante226Cableado`, `reglaEdadErrorSupabaseWiring`, `busquedaPorcionTerrestreWiring`, `filtrosBusquedaVistaBookingWiring`, `tarjetaCompletaBuscarAlojamiento`.
- Full `test:unit`: no new failures vs `main` (the 20 failures present in `main` on Windows remain: CRLF/date-sensitive source-reading tests). Full `test:react`: only the 13 `dinamicoEnPaquetes.react.ts` failures, identical on `main`.
- `tsc --noEmit` clean; `next build` (production) succeeded on the final source.

## 5. Request / resource validation (docs/agents/VALIDACION_CONSUMO_VERCEL.md)

Scope reviewed: `BuscadorBooking`, `TablaResultadosBusqueda`, `PorcionTerrestreTabla`, `buscarHoteles` and its helpers. No `useEffect` fetch, polling, retries or timers were added; the table search is user-triggered only.

| Metric (5 hotels in one destination, same search, local) | Before (`main`) | After |
|---|---|---|
| PostgREST requests per search | **42** | **34** (+0 for the extra night: it reuses loaded data) |
| hotel capacity/age-policy requests | 10 (`hotel_acomodaciones` 5 + `hoteles` 5, one pair per evaluated hotel) | **2** (one batch per ≤100 hotels) |
| requests per hotel evaluated | 8 | 6 (+2 once per search) |
| server time of the search | 113–140 ms | 91–121 ms |
| requests at rest after the search | 0 | 0 |
| server calls from the browser per click | 2 (persona + unit) | 2 in Booking (persona + unit, unit skipped when no standard allocation) · **1 in table mode** |
| impossible request (rooms > travelers, bad integers, both room modes) | queried the catalog | **0 requests** |

Bounds: ≤ 8 rooms, ≤ 10 minors, ≤ 24 pax, ≤ 60 nights; allocation enumeration ≤ 165 candidates per combo (4 types × 8 rooms) of pure arithmetic; the extra night doubles only the in-memory price evaluation of the pairs that matched, only when the table asks (`nocheAdicional`). The per-pair data load (6 requests) is pre-existing and was not changed (documented residual N+1 per priced hotel; out of scope, bounded by the destination).
Stale/cancel: unchanged generation counter (`generacionBusquedaRef`); tested for the new modes. Several tabs: no shared polling exists.
Not done: no production load test; Vercel CPU/invocation figures must be compared by the owner in Preview per the rule (Network and Observability, during the walkthrough and at rest).

## 6. Limitations and owner decisions

- Allocation preference (even split) and «the hotel’s own child band decides who pays adult rate» are implemented as defaults; the owner should confirm them in the walkthrough.
- **Superseded by O3 (2026-11-17):** the 2/10 fallback was removed. A hotel that accepts minors must have «Infante hasta» and «Niño hasta» configured; without them, a search WITH minors returns an actionable reason for that hotel (listed under «no se pudieron cotizar», never omitted) and reservations/quotations with minors are rejected with the same reason; an adults-only search is unaffected. A tariff-specific override never replaces the hotel configuration. Adults Only hotels are exempt and reject minors. See `observaciones-o1-o4-2026-11-17.md`.
- **Superseded by O4 (2026-11-17):** the extra-night amount is labelled «Valor referencial», explained, and a button extends the return date by one night and reruns the COMPLETE search (same travelers and filters); the server always recalculates the whole requested stay and never adds the reference to an old total.
- Printing/export: the table view has no print/PDF export of results (only the existing «Brief de flyer», which reads the browse matrix and was not changed); nothing to verify there.
- The table search needs the destination (inherited rule: the catalog is never scanned for all destinations).
- Local walkthrough stack: `supabase/scripts/local102/local102.ps1` (derived from `local53.ps1`; see `pending-owner-local-review.md`).
