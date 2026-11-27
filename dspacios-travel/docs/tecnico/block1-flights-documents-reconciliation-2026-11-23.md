> **Round 4 note (ADL-041):** the PNR is now shown on the paid air voucher, vouchers are per contract per service, and Gestión de contratos has an internal «voucher updated» signal; where this document says otherwise about those points, `block1-flights-documents-r4-adl041-2026-11-23.md` prevails. Conversion (C1) statements are unchanged.

# Block 1 — flights, documents and alternative destinations (#17/#18/#26/#29/#37/#40)

> **Round 2 (2026-11-23): Codex findings F1–F4 are answered in `block1-flights-documents-r2-corrections-2026-11-23.md`. Where the two documents disagree, round 2 prevails.**

Date: 2026-11-23. Baseline: `origin/main` `cd9bb1946` (includes #450). Worktree: `dspacios-travel/.worktrees/block1-vuelos` (branch `claude/block1-vuelos-documentos`). Author: implementer (Claude). For Codex audit.
Scope source: `docs/tecnico/ordered-three-blocks-2026-11-23.md`; historical rows in `tasks-history-before-cleanup-2026-11-18.md` (main checkout, untracked): #17 → row `#47`, #18 → `#48`, #26 → `#67`, #29 → `#70`, #37 → `#79`, #40 → `#82`.
No staging, commits, push, remote SQL, mail or deployment were performed. Owner review environments (#95/#61/#41/#42/#51/#33 build `4M-GiclW8LKnuqiUZXzV7`, #103, #88) were not touched.

## 1. Reconciliation matrix

| # | Delivered behavior (evidence) | Reproduced gap | Action in this block |
|---|---|---|---|
| 17 | `components/contrato/ContratoDocumento.tsx`: `mostrarHorario = esCotizacion`. Quotations show flight number + `HH:mm–HH:mm` and the notice once under the flight section (`AvisoItinerariosVuelos`); contracts show neither. All contract/quotation pages (`/contrato`, `/c`, `/cot`, `/cotizacion`, dashboard preview) render through this one component, so view/print/PDF share it. Existing test `pruebas/avisoItinerariosVuelos.react.ts`. | **None found.** Not covered before: the pre-135 combined ida+regreso row (`esLegacyDoble`) in a contract. | Added rendered proof for both row shapes × contract/quotation (`pruebas/voucherVueloRender18.react.ts`, group "#17"). No code change. |
| 18 | No air voucher exists (`vouchers.tipo` comment mentions `tiquete`; never implemented). Voucher types: `hotel`, `traslado`, `asistencia`, `servicios`. Regenerating service vouchers deleted every non-hotel voucher. | Missing type; delete filter would wipe a new `vuelo` type. Passenger↔segment link does not exist in the schema (`contrato_vuelos` has no passenger/seat key; `sillas` pair by row order only). | Implemented the decision-independent subset (see §3). Decisions open. |
| 26 | `armado_paquete_destinos_aereos` (220), pure rules `pais_comparable_67` / `destinos_aereos_efectivos_67` mirrored in `lib/paquetes/destinosAereos67.ts`. Country missing on the commercial destination → alternatives authorize nothing, save rejected (`comercial_sin_pais` / `destino_aereo_config`); missing on an alternative → reason `sin_pais`; flight source without destination → `fuente_sin_destino`. IATA is a label only; identity is by id; no name/proximity inference anywhere. Tests: `destinosAereos67*.test.ts`, `destinosAereosFlujos67.test.ts`, `test_220_destinos_aereos.sql`. | **No code gap in country/IATA identity or eligibility.** | Audit only; re-ran the existing suites (green). |
| 29 | Merge `fn_fusionar_destino` (latest 275) re-points FK columns and `paquete_din.destinos_extra`; the alternatives table has no FK. | A) after a merge the row (P, origin) pointed at a deleted id while flights of the origin were re-pointed to the target, so they silently stopped being eligible. B) deleting a destination that was only an alternative counted 0 uses, so the UI offered a plain DELETE that succeeded and left an orphan. C) merging into a package's commercial destination could leave an invalid alternative. | Migration **334** + modal count (§3). |
| 37 | `ventas_vuelo_sistema` predicate: `tipo_paquete='dinamico' OR empaquetado_ref_id IS NOT NULL`, no air check. Manual contracts default to `dinamico`; manual-quote conversion hardcodes `dinamico`. | Hotel/transfer-only dynamic contracts appeared in the packaged-flights list (and `/vuelos/historico`) with all-NULL airline/record/route. The legacy SQL test J4 enshrined that. | Migration **335** (§3). |
| 40 | Record is optional at conversion: empaquetado reserve copies `record: null`; conversion has no record gate. Post-hoc entry exists (`TramosEditor` → `guardar_tramos_contrato`), isolated to that contract's own `contrato_vuelos`. | (a) The post-hoc editor was reachable only from the Empaquetados list, not from the contract. (b) Non-#63 `convertirCotizacion` did not stamp `ventas.cotizacion_id`, so two simultaneous conversions of one quotation could create two contracts (only #63 was guarded by `aceptar_oferta_63`/`ventas_aceptacion_63_uk`). | Link from the contract; stamp `cotizacion_id` so the existing unique key serializes conversions (§3). |

## 2. Genuine owner decisions (not invented)

1. **#18 PNR visibility.** Hidden in the contract today. The new voucher carries no PNR and its generator never selects `record`; adding it needs the owner's rule (and whether only when `estado_emision = 'emitido'`). `contrato_vuelos_basica` already masks the record for `venta` on other advisors' contracts.
2. **#18 per contract vs per passenger.** Implemented per contract (one voucher). Per-passenger issue needs decision 3.
3. **#18 passenger↔segment association.** No saved link exists. **Round 2 (Codex F4):** the voucher no longer says "Los tramos aplican a la reserva completa" (that asserted coverage no saved data supports). It lists passengers and saved legs separately and states that no passenger-to-leg assignment is registered.
4. **#18 who may generate/see it** beyond the existing voucher rules (RLS of `vouchers`, ally access only with the contract 100 % paid, #53). `control_vuelo` has no access (unchanged).
5. **#37 definition of "has air".** Chosen conservatively (any saved evidence): ≥1 `contrato_vuelos` row, or non-empty `ventas.aerolinea`, or `costo_aereo > 0`, or ≥1 air payable. A Promoción-linked contract always stays. Owner to confirm; the preflight lists the contracts that leave.
6. **#37 existing land-only rows:** hidden by the view only; `tipo_paquete` is NOT rewritten.
7. **#40 shared Promoción record.** Editing the record of the shared Promoción (not the contract) invalidates linked salidas (#63 guard `con_record`) — unchanged; the contract-level editor never touches it. Whether the shared record stays editable once contracts exist is the owner's policy.
8. **#29 cross-country merge.** Not guessed: the existing 220 validator aborts the whole merge (`destino_aereo_config`). Whether to allow it is a product decision.

## 3. Changes

| Area | Files |
|---|---|
| #29 | `supabase/migrations/20260601000334_destinos_aereos_alternativos_integridad.sql` (merge block + `BEFORE DELETE` guard on `destinos`), `lib/producto/usoDestino.ts` (counts the alternatives table so the modal offers merge instead of delete), `pruebas/usoDestino.test.ts` |
| #37 | `supabase/migrations/20260601000335_vuelos_sistema_exige_componente_aereo.sql` (rewrites ONE predicate of the live view, aborts if not found exactly once, idempotent), `supabase/scripts/test_empaquetados.sql` (fixtures now carry an airline) |
| #40 | `app/(dashboard)/dashboard/reservar/actions.ts` (`cotizacionOrigen` → `ventas.cotizacion_id`; on `ventas_cotizacion_id_key` returns the existing contract), `app/(dashboard)/dashboard/contratos/[numero]/page.tsx` (link "Registrar o editar vuelo y record"), `lib/vuelos/empaquetadoContrato.ts` (**removed in round 2**: the link now uses the authoritative `ventas_vuelo_sistema` view, see `block1-flights-documents-r2-corrections-2026-11-23.md`) |
| #18 | `lib/voucher/vuelo.ts` (pure builder), `components/voucher/VoucherVueloDocumento.tsx`, `app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts` (`generarVoucherVuelo`; regeneration keeps `hotel` and `vuelo`), `VouchersPanel.tsx`, `app/voucher/[token]/page.tsx` |
| Evidence | `supabase/scripts/test_334_335_vuelos_destinos.sql`, `preflight_/postcheck_/rollback_334_335_vuelos_destinos.sql`, `pruebas/voucherVuelo18.test.ts`, `pruebas/voucherVueloRender18.react.ts` (registered in `test:react:resto`), `pruebas/empaquetadosConversion40.wiring.test.ts` |

No migration is needed for #18 (`vouchers.tipo` has no CHECK).

## 4. Known limits (honest)

- **Superseded in round 2 (Codex F1):** a concurrent/replayed conversion no longer spends a number (claim of migration 336); only a loser that LOST its claim mid-flight can burn one. See the round-2 document.
- `tarifario_resultado.destino_nombre` (text cache) is not refreshed by a merge (regenerable cache, unverified).
- Existing orphan alternative rows are NOT cleaned; preflight control 6 reports them for a manual decision.
- `supabase/scripts/test_empaquetados.sql` and `test_editor_vuelos_contrato.sql` were already failing on the baseline against the current schema (agency-session guard of 237 and the `DTM-` number format), so they cannot serve as regression evidence; their fixtures were only aligned for 335 (`test_empaquetados`), not made runnable. The new `test_334_335_vuelos_destinos.sql` is the runnable proof.
- Carrito/Bernalo contracts carrying a packaged flight were not traced (speculative in the investigation).

## 5. Resource evidence (local measurements; hosted costs NOT measured)

- **#37 view cost** (`EXPLAIN ANALYZE select count(*) from ventas_vuelo_sistema`, 20,000 synthetic dynamic contracts, one 1-vCPU Postgres container, same host load): baseline 2,331 ms vs 335 2,608 ms (+12 %); the dominant cost is the unchanged per-row `acceso_ventas_vuelo_sistema` call. The added `EXISTS` uses `idx_contrato_vuelos_num`; the air payable reuses the `cxp_aer` join the view already had. Result set 13,334 of 20,000 (land-only excluded) as expected. Production volume/latency is unmeasured.
- **App code:** no new polling, effects, retries, routes, cron or external services. `generarVoucherVuelo` runs three reads + one delete + one insert per click (same order as the hotel voucher). The contract page link adds zero queries (uses fields already loaded). The conversion guard adds one column to an existing INSERT and, only on the rare 23505, one indexed read.
- **Vercel/Supabase:** unmeasured; no change in function count, middleware or caching.

## 6. Acceptance matrix and results

| Case | Proof | Result |
|---|---|---|
| #17 contract hides flight number/times, both row shapes; quotation keeps them in HH:mm | `voucherVueloRender18.react.ts` (group #17) + `avisoItinerariosVuelos.react.ts` | pass |
| #18 voucher: saved data, «No registrado», no PNR, per contract, regeneration keeps it | `voucherVuelo18.test.ts` (9), `voucherVueloRender18.react.ts` (3) | pass |
| #26 country/IATA eligibility, missing country explicit | existing `destinosAereos67*.test.ts`, `destinosAereosFlujos67.test.ts` (in the 280-test run) | pass |
| #29 merge/delete with alternatives: re-point, dedupe, commercial collision, cross-country fails closed, direct delete blocked, replay no-op | `test_334_335_vuelos_destinos.sql` D1–D7; `usoDestino.test.ts` (77) incl. 334 body-diff vs 275 | pass; fails on the pre-334 schema (negative control) |
| #37 land-only out; legs/airline/air cost/air payable in; Promoción always in; blank airline not evidence; sources untouched | same SQL, L1–L11 | pass |
| #40 record entered later from one contract leaves the Promoción and the sibling contract unchanged; replay creates no rows; second conversion of one quotation rejected | same SQL, R1–R9; `empaquetadosConversion40.wiring.test.ts` | pass |
| Preflight / postcheck / rollback | one query each; run on disposable DBs; rollback restores the view (identical hash) and function (identical modulo CR) | pass |

Local environment: Postgres `supabase/postgres:15.8.1.085` container `pgblock1` (disposable; schema = migrations 001–326 + 334/335), not the owner review databases.

Regression comparison against a clean `origin/main` worktree, by test NAME (not counts):
- `test:unit`: 10,594 tests, 31 failing vs baseline 10,579 / 29 — after fixing two source-guard regexes in `cotizacionesTenant.wiring.test.ts` (signature of the private reserve function grew), **no failing name outside the baseline set**.
- `test:react`: 2,148 tests; 33 failing vs baseline 26 — 7 modal tests were caused by this block (fixture lacked the new table) and are fixed (`eliminarDestinoInteraccion.react.ts`, 42/42); remaining names ⊆ baseline. `test:react:o1o4` 45/45, `test:react:resto` 62/62 (includes the new render test), `test:calendar` 43/43.
- The baseline failures (about 27–49 names, mostly source-reading tests that read UI files) were NOT investigated or fixed here.

Final source/build: worktree HEAD `cd9bb1946` + the uncommitted files listed in §3 (nothing staged or committed); `npx next build` (Turbopack, fake Supabase env) compiled in 11.3 s, exit 0, **BUILD_ID `1m5VENB2JZTxDySkbhAPq`** in `.next/` of the worktree. Typecheck `tsc --noEmit` clean.

## 7. Not done (explicit)

- **No rendered inspection** of the voucher page, the contract link, or the delete modal at desktop/intermediate/mobile widths; the voucher was checked as server-rendered HTML text only. Needed before owner approval.
- No concurrent-connection test of `convertirCotizacion` itself (the unique-key block is proven in SQL R8/R9; the action's fallback read is covered by a wiring test, not executed against PostgREST).
- `test_editor_vuelos_contrato.sql` fixtures were not updated for 335 (the script already failed before this block).
- Owner-stage order: 334 and 335 are independent of pending 327–333; apply order across stages is the owner's call.

## 8. Later additions awaiting owner/Codex review

- **2026-11-24 — record movement history (owner improvement; not the audit screen):** Bogotá date+time per movement, operation named from the saved type only, actor/quantity/origin/destination/before-after cupos/seats/reason with «No guardado» for anything missing, newest first, compact on mobile. Read-only presentation, no migration, no new query, no client JS. Report: `block1-record-movement-history-2026-11-24.md`; evidence `evidence-block1-r8/` (build `Joqwn4tJxTA3CCKMZrvyV`). **H8-1 closed (2026-11-24):** the compiled dashboard page was inspected with real sessions (control_vuelo, superadmin; venta as negative control) at 1280 / 820 / a true 390 px device emulation, detail open and closed — 51 checks, 0 failures; it exposed a cramped 4-column grid at 820 px, fixed and rebuilt (final build `ELPK6LteTxZvxC8Kigs6m`); report `block1-h81-compiled-history-inspection-2026-11-24.md`, evidence `evidence-block1-r9/`. **Owner to check on the live page:** a real record with real retirements and transfers, at phone width (only synthetic data was rendered). The LBH7YT support operation stays closed and untouched; the audit-usability task and CRM remain pending.
