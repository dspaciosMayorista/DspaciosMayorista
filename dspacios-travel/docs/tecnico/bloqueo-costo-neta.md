# Bloqueo flight cost: `tarifa_neta` for cost/CxP, `tarifa_para_empaquetar` for commercial pricing

Date: 2026-11-24. Branch `fix/bloqueo-costo-neta-r2`, worktree `C:/tmp/wt_bloqueo_neta2`, baseline **`origin/main` `cd9bb1946` (#450)**.
Supersedes the first delivery (branch `fix/bloqueo-costo-neta` on `f4489c721`/#415, preserved untouched). Not staged, not committed, no remote SQL.

## Owner report

A bloqueo stores "Tarifa neta" (what the airline is paid per seat) and "Tarifa para empaquetar" (resale tariff used to build the customer price).
Packages appeared to use the packaging tariff as their internal flight cost. Confirmed.

## Root cause

The costing helpers for a bloqueo read only `bloqueos_vuelo.tarifa_para_empaquetar`:

| Place | Before | After |
| --- | --- | --- |
| `lib/reservar/empaquetadoOrigen.ts::datosVueloBloqueo` (`costo_neto`) | `tarifa_para_empaquetar` | `tarifa_neta`; `ok:false` if null/0 |
| `lib/reservar/costosObligacionesCarrito.ts::costoAereoBloqueo` | `tarifa_para_empaquetar × seats + fee_infante × infants` | `tarifa_neta × seats + fee…`; throws if net missing |

Hand-calculated: net COP 300,000 / packaging 349,000 / 2 pax with seat → expected 600,000 (before: 698,000). USD net 100 / packaging 120 / 2 pax / cost TRM 3,900 →
expected USD 200 = COP 780,000 (before USD 240). 2 adults + 1 infant, fee 80,500 → 680,500 (infant pays only its fee, no seat).

## Affected paths (fixed by the two shared helpers)

Single reservation and quotation-to-contract (`convertirCotizacion` → `datosVueloBloqueo`), quotation creation, cart conversion (`convertirCotizacionCarrito`, pre-numbering
review + creation), Bernalo-with-bloqueo (currently blocked for conversion). Downstream readers use the persisted `ventas.costo_aereo`/CxP and are corrected for NEW contracts.

## Deliberately unchanged

Public tariff/PVP and the tariff generator (`generarTarifario`, `aporteVuelo`, BNC base), margins, markups, TA, commissions, B2B recobro, `fee_infante`, `empaquetados` (already net).
`computoReservaBernalo`'s informational `costoVueloTotal` still reflects the packaging tariff for bloqueos (not persisted, no consumer).

## Baseline change that matters (#75/288)

On `cd9bb1946` a PENDING contract does not own payables: its CxP are stored as `contrato_obligaciones_previstas` and materialize into `cuentas_por_pagar` + accounting only when the
contract is confirmed (`confirmar_venta`/payment). The real-action tests therefore assert the previstas while pending, confirm through the real `confirmarVenta`, and assert the materialized CxP and accrual.

## N2 — required bloqueo rows can no longer disappear (cart conversion)

* Pre-review: every requested bloqueo id must come back from the batched read; an omitted id fails BEFORE numbering ("No se pudo verificar un vuelo negociado…") — no skipping.
* Creation: the per-item bloqueo read now checks `error` and a missing row; either reverts the contract in progress through `fallarYRevertirGrupo` (same cleanup semantics as the other creation failures)
  instead of skipping the flight leg, air cost and CxP. The `contrato_vuelos` insert already checked its error on this baseline; it is now covered by an injection scenario.
* Single-reservation path already fails closed (`datosVueloBloqueo` returns `ok:false` for unreadable/missing/net-less bloqueo).

Real-action failure injection (`pruebas/costoBloqueoNeta.pg.ts`, HTTP-layer faults between the real action and the real PostgREST/Postgres), each asserting that contracts, previstas, CxP, accounting entries/lines,
pending-financial rows, passengers, flight legs, items and taken seats are unchanged and the quotation fingerprint (state, payload, detail, number) is identical:
`previa_error` (read fails), `previa_omitida` (row omitted from a 200 response), `creacion_error` (read fails at creation), `creacion_sin_fila` (0 rows at creation), `vuelo_insert_error`; plus a control
showing the same quotation converts normally afterwards. Negative control with the net fix but WITHOUT the new guards: `previa_omitida` and `creacion_error` silently convert
(the later scenarios then fail because those contracts consumed the seats), proving the scenarios detect the defect.

## N3 — diagnostic is a candidate/estimate tool

`supabase/scripts/diagnostico_bloqueo_costo_neta.sql` (one read-only query, Bogotá business date for the open-bloqueo cutoff) now states its basis in every row and in its header:
current tariffs, current seat links, bounded infant fee; verdicts are `CANDIDATO_REVENTA`, `CONSISTENTE_CON_NETA`, `SIN_DIFERENCIA_POSIBLE`, `SIN_NETA_ACTUAL`, `REVISAR`,
`NO_EVALUABLE` (contracts with a bloqueo flight leg but no current seat link are listed, never presumed unaffected). The quantity is "diferencia ESTIMADA", not a confirmed overstatement.
Nothing is inferred or backfilled. Run locally (read-only session, `timezone=UTC` to show the Bogotá cutoff): original-code data → 4 candidates (COP 294,000 / USD 40 estimated), 1 consistent,
1 no-difference-possible, 2 SIN_NETA_ACTUAL, 2 REVISAR (other currency; edited cost), 1 NO_EVALUABLE, open bloqueos without net listed (past-dated excluded);
fixed-code data → 3 consistent (+1 SIN_NETA_ACTUAL because the fixture later removed that bloqueo's net — a demonstration of the current-tariff limitation).

## Test refresh on `cd9bb1946`

Carried the fix patch (applied cleanly) and refreshed fixtures that encode bloqueo costs: `cobroCarritoConversion`, `empaquetadoOrigenCosto`, `monedaObligacionesCarrito`, `tarifaInfante226Cableado`,
`conversionIncluidosEjecucion` (new on this baseline: bloqueo fixture now carries net 500,000 and a different resale 580,000). 80 affected unit files: 2,610/2,613 pass; the 3 failures
(`valorVisibleContratoItem…`, `DinamicoModal…`, `'Ver opciones' llama abrirHotel`) fail identically on a clean `cd9bb1946` checkout (compared by name), so they are not caused by this change.
Real actions: 12/12 pass (N1–N6 + 5 injections + control) on a disposable database with migrations 001–326.

## Historical impact

Existing contracts/payables are untouched. Contracts created before the fix from a bloqueo with net ≠ resale carry costs derived from the resale tariff; the diagnostic lists CANDIDATES only.
Correction (including contracts with payments, materialized CxP or invoices) is an owner/accounting decision.

## Resource impact (VALIDACION_CONSUMO_VERCEL.md)

No effects, polling, retries, timers or routes. Requests per action: unchanged for single reservation; the cart review reads the same batched query (net instead of resale) with an in-memory check;
creation reads the same per-item row and now checks its result. No new external service, AI or storage. Local measurements: typecheck and production build below. Hosted Vercel metrics: not measured.

## Remaining gaps

* Bloqueos without net stop selling until the net is loaded (diagnostic lists them).
* Diagnostic is an estimate on current data (edited tariffs, transferred seats and mixed sources can misclassify).
* `computoReservaBernalo` informational `costoVueloTotal` unchanged.
* No rendered UI/PDF inspection: no UI or document code changed; changed values are internal (cost/payables).
