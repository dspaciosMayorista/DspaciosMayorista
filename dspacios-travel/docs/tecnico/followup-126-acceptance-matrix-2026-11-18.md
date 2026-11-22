# #126 — acceptance matrix, compatibility strategy and evidence (2026-11-18)

Scope: the four follow-ups deferred from PR #449 (126-A payment-specific TRM, 126-B unit child charges, 126-C infant-only base groups, 126-D promotion badges).
Base: `origin/main` 312608a59 (contains #449; migrations 307–311 untouched). Branch `claude/126-usd-trm-hijos-promos`, worktree `.worktrees/126-followups`.
**Status (round 5, after Codex round-4's remaining F5 concurrency finding; earlier in round 4: F4, F5 sequential guards and the owner-approved addition #126-E): corrected locally and executor-verified; returned for Codex re-audit. F1–F4 were closed by Codex and #126-E was independently verified; their changes are preserved. NOT Codex-approved, NOT owner-accepted, nothing staged/committed/pushed/deployed, no remote SQL, no historical recalculation, owner review data untouched.**
**Two additive migrations (312 and 313) are part of this work — see §7. #126-E needs no migration. #127 is a separate future audit and is NOT part of this block.**

Process note (honest): the owner's expected values were fixed first from the request text and the saved follow-up (`followup-usd-tariff-display-126.md`); this matrix was
consolidated in one file after the exploration phase and before the evidence runs. Every money expectation below is hand-computed, never taken from the code under test.

## R. Codex round 1 — findings and what was done

| Item | Reproduced / verified | Correction | Evidence |
| --- | --- | --- | --- |
| **F1 (P1)** submitted TRM ≠ previewed TRM (`"4.100"` previewed as 4100, submitted as `Number("4.100")` = 4.1) | Yes — same root cause in the new-payment hook, its "did the form change?" comparison, **and** the two edit-payment forms (`Number(trm) \|\| 0`) | One normalizer, `trmNormalizada`, used by preview, frozen submission, excess confirmation, retry and the reset comparison; edit forms send the normalized TRM (an invalid one sends 0 and is rejected). The plausibility floor is now **TRM ≥ 100**, so a typed `4.1` is rejected instead of silently meaning 4.1 pesos per dollar. The payment currency is part of the "form changed?" comparison. | `pruebas/pagoUsdEnvio126.react.ts` (10 interaction tests on the **real forms**, capturing the **actual call**: COP and native-USD entry with `"4.100"`, excess confirmation with the form changed behind the dialog, confirmation retry, reset when the same TRM is retyped vs changed, Cartera registration, both edit forms). With the old hook restored, **8 of the 9** tests of the first set fail (mutation executed); restored. Real browser: payment typed as `4.100` is previewed USD 300 and recorded as 4,100 (compiled-app run). |
| **F2 (P2)** two consecutive promotions covering the stay, no base nights, both labelled whole-stay | Yes | The liquidator now also returns `nochesPorGanadora` (nights won by each vigencia — additive output, no formula touched). Each promotion's reach is `nights it won ≥ nights of the stay`; with two successive promotions both are "algunas noches" and the label reads "Promociones A y B · cada una en algunas noches". Without the count (old caller) the function is conservative: two promotions are never "toda". | `promoMostrada126.test.ts` (real engine `evaluarHotelPorFechas`: PROMO UNO night 4 + PROMO DOS night 5, stay 4→6, **no base night**; also 3→7, single nights, a promotion winning every night, stay-level "N nights, 1 free"); the new tests fail (2) against the old rule (mutation executed); `salidaVinculada63Wiring` pinned fingerprint of `paquetes.ts` updated with its reason (additive output). |
| **Scope 1** historical COP-frozen vs new-contract behaviour | — | Explained separately in §0 (two modes, what each does, what is preserved, the one open business decision). The retained COP-frozen option for NEW contracts is **not** presented as satisfying 126-A. | §0; conversion screen text names both modes; `Q9`. |
| **Scope 2** by-dates tile and price popup badges | Missing before | The by-dates quote (`computarReserva`) now carries promotion provenance (live by-dates path and the re-liquidation of published tariffs). Badges: tile, "Ver opciones" popup, salida table (Vista tabla), advisor reservation form. Documents deliberately still carry none (not an owner requirement). | Rendered tests with the real components: `modalSeleccionTarjeta90.react.ts` (tile + popup: whole stay / some nights / none), `vistaTablaCotizada90.react.ts` (salida table); compiled app: reservation form 4→9 Dec shows the badge, 9→12 Dec none. **Compiled-app tile/popup could not be exercised** (see §6). |
| **Scope 3** native-USD receipts | **Defect confirmed**: a native-USD payment was stored identically to COP + TRM, so the receipt said "Pago recibido en pesos". | Migration 312 adds `abonos.moneda_pago` (COP/USD/NULL). Native-USD entry records `USD`; receipt, estado de cuenta, contract table and contract panel say "recibido en USD", show the accounting equivalent as such, and count **only pesos actually received** as "cobrado en pesos". Editing a USD-received payment in pesos is refused (date/form/reference remain editable). Historical rows stay NULL = read as pesos received, exactly as today. | `pagoUsdTrm126.pg.ts` Q10–Q13 (real actions + DB), compiled-app receipt/estado/panel + print render, unit `pagoUsd126`. |

### Round 5 — Codex round-4: F5 concurrency (confined to the rollback script and its tests)

| Item | Reproduced / verified | Correction | Evidence |
| --- | --- | --- | --- |
| **F5 (P2, concurrency)** `rollback_312` checked classifications before anything excluded writers, so a classified insert committing after the check lost its currency when the column was dropped | **Reproduced** with Codex's two-connection probe (pause after the guard, before the first ALTER): insert committed, rollback exit 0, column gone, 1 payment row left without its classification | The script now **starts with** `set local lock_timeout = '5s'; lock table public.abonos in access exclusive mode;` and holds that lock to the COMMIT, so no payment can commit between the guards and the DROP. An insert already in flight makes the script wait; once it commits classified, the guards see it and the script refuses. If the lock is not obtained in 5 s the statement fails and the single transaction leaves constraint, column and rows unchanged. The classified-payment guard and the 313 guard are unchanged (they now run after the lock). No application or configuration source changed. | Codex's reproducer re-run against the new script (wrapped only so a blocked-then-failed insert is reported instead of crashing it): the concurrent insert **waited 3,030 ms** for the rollback and was **rejected** once the column was gone; `remainingPaymentRows 0` — no committed payment lost its classification (before: 1 row, classification lost). Deterministic regressions `pagoUsdTrm126.pg.ts` **T1–T4** (below). |

### Round 4 — Codex round-3 findings and owner addition #126-E

| Item | Reproduced / verified | Correction | Evidence |
| --- | --- | --- | --- |
| **F4 (P2)** infant-only group pointed to the first promotion of the same category/regime, whatever its dates | Yes — reproduced with the shape Codex gave (infant-only BASE ENERO 2030-01-01→03 vs adult PROMO DICIEMBRE 2030-12-01→03 was linked) and several candidates were picked arbitrarily | `promoRelacionada` is now set only when the rows establish it: same category and regime, a **single** promotion group with **adult** rows (sencilla/doble/triple/múltiple), and that group covers **every** stay (departure id + dates + nights) of the infant-only group. Disjoint dates, another departure, several candidates, a candidate covering only part, a promotion group without adult rates, or rows with no stay identity → `null` and the neutral text («Las tarifas de adulto no se publican en este grupo.») with no link. Prices and rows are untouched (the function only reads). | `seleccionMasiva107.test.ts` (10 F4 cases; old rule → 8 fail), `armadoPestanas101.react.ts` (neutral rendering + accepted case), compiled app (accepted link on real rows; disjoint dates and two candidates on rows altered in the clone and restored). |
| **F5 (P2)** rollback of 312 dropped the column unconditionally | Yes (a classified native-USD payment would be re-read as pesos received) | New `rollback_312_abono_moneda_pago.sql`: one transaction that **refuses** (changes nothing) if any abono has a `moneda_pago`, or while 313 is applied (its trigger reads the column); otherwise drops only the empty constraint/column. It points the operator to a forward fix or a reviewed preservation procedure; it never rewrites payments. | `pagoUsdTrm126.pg.ts` S1–S2 (safe, historical NULL rows byte-identical; full chain 313 then 312), R-A (native USD + mixed: refusal, same schema+rows fingerprint before/after), R-B (single native payment), R-C (real payments made by the actions, 313 still applied), R-D; unconditional rollback restored → 4 fail. |
| **Seed delivery** `seed126d.sql` not found in delivered scripts | Confirmed: the seeds lived only in my temp folder | Delivered `supabase/scripts/localreview/seed126.sql`, `b`, `c`, `d` and `e` (clone-only guard, stated requirements); my helper scripts now read them from the repo, and the guard was shown to refuse on a non-clone database. | §9; refusal output captured (database `tmp_guarda_seed`, dropped). |
| **#126-E (owner addition)** «Viaje más reciente» = departures today or later in America/Bogota, nearest first; past excluded in that mode; history via explicit filters | Inspected first: Gestión de contratos (`/dashboard/gestion-contratos`) loads through ONE RPC (`fn_gestion_contratos`, migration 309, already applied) that returns total, summary and page together; the order option closest to the wording was «Viaje: más próximo» (`salida_asc`), which sorted every departure ascending, **including past ones**, with nulls last; the separate `Contratos` list has no such mode (no label «Viaje más reciente» exists in the code). | The loader turns that order into the existing `salida_desde` filter = **today in America/Bogota** (not the UTC date), unless the user chose an explicit trip date (then the explicit date wins). Because the floor travels inside the same RPC call, **total, resumen and every page are computed from the same set**. The option is relabelled «Viaje más reciente (desde hoy)»; the page states the rule, the Bogotá date and how to reach history; other orders have no floor and still list undated and past contracts. **No migration.** | Real RPC + real loader/page: yesterday/today/tomorrow, Bogotá 23:59:59 vs 00:00:00 (and the UTC trap), future ordering with stable tie-break, 30 future contracts across pages (25 + 8; total equals an independent SQL count; summary equals total), undated, explicit historical filters, other orders. Pure unit tests for the rule. Compiled app 1366/390 (see §3/§4). |

### Round 3 — Codex round-2 findings

| Item | Reproduced / verified | Correction | Evidence |
| --- | --- | --- | --- |
| **F3 (P1)** currency recorded by a second request after the financial transaction, overwritable on replay | Confirmed from control flow, then **reproduced by the tests**: with the guard removed, a replay with another currency changed the outcome (R2/R4), and a replay with a foreign contract identity was accepted (R6, found by my own test) | **Migration 313** (new; 312 only adds the column): `registrar_abono_moneda(…, p_moneda_pago)` is ONE transaction. The currency is stamped on the abono by a trigger **on the insert that already happens** — no second write. It wraps `registrar_abono` (288, untouched) so actor, agency, contract identity, idempotency, confirmation and ledger entry keep their existing authority. A replay returns the original result only when the currency matches exactly (NULL vs value is also a conflict) and a conflict **rolls back everything** (including the re-posting of the ledger entry). The wrapper also checks the contract identity explicitly (a replay writes nothing, so the table guard never fired). The currency is only admitted on contracts collected in USD and only COP/USD (checked in the database, not only in the action). Once written it cannot be changed by UPDATE, and historical NULL rows are not "completed" later. `registrarAbono` now makes one RPC call; the REST update is gone. | `pagoUsdTrm126.pg.ts` R1–R7 against the real actions and the real database (21/21); mutation → R2/R4/R6 fail; SQL preflight/postcheck/rollback validated on a throwaway database. |
| **V1** compiled-app tile / price popup / related table unverified; zero cards unexplained | Investigated: the clone **had published rows** (117 porción rows, packages ready) but **0 of 21 offers were recommended**, and the initial Vista Booking grid shows only recommended offers (`armado_hoteles.prioridad`, `lib/tarifario/recomendados.ts`). Fixture gap, not a product defect. | `seed126d.sql` (priority 1 on the four DEMO 125 offers) in the **disposable** clone; the browser script now **fails** instead of skipping when no tile exists. | Compiled app, three viewports: tile (whole / partial / none), "Ver opciones" popup (whole / partial / none), results table in Vista tabla and Vista Booking (whole / partial / none) — **151 OK, 0 failures, 0 skips** on build `K5iP5pHhIFHHjMmVxi_Xj`. |
| **Reports** must separate pesos received from the accounting equivalent of dollars | Found in two places: Flujo de caja (Caja basis summed `monto_cop` as pesos) and Conciliaciones (equivalent shown as an ordinary "Abono cartera") | Flujo de caja keeps the total but separates `cobrado` (pesos) from `cobradoDolaresEquivalente`, names both in the Caja definition and shows a quantified note; Conciliaciones labels the row "Abono cartera (dólares)" with "USD X recibidos (equivalente contable en pesos)". Rentabilidad / Facturación / Estados financieros recognise income at the equivalent and say "cobrado"/provisional — reviewed, not changed (see §6.5). | `reportesPesosRecibidos126.react.ts` (3/3) + compiled-app block `F ·` (note quantified as $1.230.000, label present). |

## 0. Compatibility strategy for 126-A — historical records vs new contracts (two modes, kept separate)

**Historical records (preserved, never recalculated).** Contracts already created as "USD offer collected in COP at one frozen TRM" (#90-F: e.g. the owner's DTM-0005, TRM 4,100, total COP 4,100,000) keep their frozen total, their payments stored in COP with TRM 1, and their interpretation. No payment TRM is invented, no row is rewritten, no report recomputes them, and
historical `abonos` keep `moneda_pago = NULL` (read as pesos received). The new code treats them exactly as before (verified by `Q9` and in the compiled app: DTM-0005 shows no new columns or panel).

**New contracts — what satisfies 126-A.** A USD offer whose collection currency is **USD** (the `USD` option of the conversion screen) keeps the USD principal authoritative and asks **each COP payment for its own TRM**; this is the mode that implements the owner's requirement (A1–A10 below).
The conversion screen's `COP` option for a USD offer is the **legacy frozen-TRM mode**: one TRM for all payments and a fixed COP total. It remains selectable and works as before, but it **does not satisfy per-payment TRM** — the screen says so ("todos los pagos usan esa misma tasa").
**Open business decision (not blocking, not resolved by me):** should new USD offers still be allowed to be collected in COP at a frozen TRM? The default kept here is *yes (unchanged)* because removing a deliberate #90-F option is not a technical choice.

Findings that shaped it (read from the code, not assumed):

Findings that shaped it (read from the code, not assumed):

1. The data model already stores a per-payment rate: `abonos.trm`, `abonos.monto_cop`, `abonos.valor_abono` (migration 095), and `registrar_abono` (288) credits
   `valor_abono = monto_cop / p_trm` **per payment**, for a contract whose **collection currency** is USD. Confirmation minimum, the 100 %-paid voucher gate
   (`contratos_pagados_completos`, 307) and the accounting entry (`postear_asiento_abono`, posts `monto_cop`) already read those per-payment values.
2. The owner's DTM-0005 shape (USD 1,000 offer **collected in COP**, one frozen collection TRM 4,100, total COP 4,100,000, #90-F) is a *different, deliberate* mode: the COP total
   is frozen at contracting and every payment is converted with that single TRM. That is exactly "the original contract TRM treated as the rate of every payment".
3. #90-F makes the collection currency an **explicit, mandatory choice** at conversion. Choosing USD for a USD offer already means "principal in USD, each COP payment with its own TRM".

Decision (technical, reversible, no migration):

- **One additive migration (312, `abonos.moneda_pago`) and no data rewrite.** The per-payment TRM mechanism already existed; 126-A hardens and exposes it. The only schema addition records the currency in which money actually arrived (needed so documents never call an accounting equivalent "pesos received"). RPC formulas and historical rows are untouched.
- **Historical contracts (including the owner's DTM-0005, collected in COP with frozen TRM 4,100) keep their interpretation.** Nothing is recalculated and no TRM is invented for old payments.
- New USD-offer contracts: the conversion screen now states, in the collection-currency selector, what each choice means: *USD* → principal in dollars, every COP payment asks its own TRM;
  *COP* → one frozen collection TRM for all payments (legacy mode, kept available because removing it is a business decision nobody made).
- Payment entry (contract Cartera tab and the Cartera module): per-payment TRM field **without a default**, plausibility guard (finite, ≥ 100, < 1e11; Colombian-formatted text such as `"4.100"` parses as 4100 everywhere it is used — preview, submission, confirmation, retry, reset and edit forms —, and `4.1` is rejected),
  live preview of the USD credited and the balance after the payment, and a native-USD entry mode (amount in USD credited exactly and recorded as **dollars received**; the TRM only produces the accounting equivalent the ledger needs).
- Internal COP reporting: realised COP (`Σ monto_cop`) is a fact; the COP equivalent of an unpaid USD balance is only an estimate and is labelled **provisional** until the USD balance is 0.
  Contracts collected in COP with a frozen total are never labelled provisional (their COP total is fixed by agreement).
- Client documents (estado de cuenta, recibo) keep USD paid / balance as the main figures and add, for USD-collected contracts only, the pesos actually received and the TRM of each payment — or, for a payment received in dollars, "recibido en USD" with the accounting equivalent labelled as such.
- Known, documented limits: `valor_abono` is `numeric(15,2)`, so a USD credit is rounded to the cent per payment; the 0.01 USD tolerance of the base closes a 1-cent drift. A reversal leaves
  `ventas.trm_contrato` stale only when **no** payment remains (existing behaviour, untouched). Contract-level income recognition in COP for facturación/rentabilidad still uses the weighted-average
  `trm_contrato` (now flagged provisional while the balance is open); a payment-by-payment recognition schedule would be a separate accounting design.

## 1. Acceptance matrix

Legend — E: executor evidence (mine). C: Codex independent evidence (**none yet**). Status: PASS only for what was actually run.

### 126-A — payment-specific TRM

| # | Requirement / variant | Input | Independently expected | Evidence (E) | Status |
|---|---|---|---|---|---|
| A1 | Two installments, two TRMs (owner example) | USD 1,000; COP 1,230,000 @4,100 then COP 2,940,000 @4,200 | USD 300 then 700; balance 0; COP collected 4,170,000; weighted TRM 4,170 | `pagoUsd126.test.ts`; `pagoUsdTrm126.pg.ts` Q1 (real actions, rows read back); compiled-app payment flow | PASS |
| A2 | Each installment asks its own explicit TRM, previews USD credited | form with value, TRM empty/valid | no default TRM; "Acredita USD 300 · saldo después USD 700" | `pagoUsdUi126.react.ts` (5 cases) | PASS |
| A3 | Native USD payment | USD 300 @4,100 | credits exactly 300; COP equivalent 1,230,000; ledger 1,230,000 | unit + react + `pg` Q5/Q6 | PASS |
| A4 | Invalid TRM | empty, 0, −4,100, 1, NaN, `"4.1"` text | rejected with message, **no abono written** | unit (14 inputs) + `pg` Q3 | PASS |
| A5 | Confirmation minimum depends on each payment's TRM | COP 1,200,000 @3,900 → 307.69; same @4,100 → 292.68 (30 % = 300) | confirmed vs pending | `pg` Q4 | PASS |
| A6 | Reversal | annul the 2nd payment | USD balance 700; COP collected 1,230,000; ledger entry removed; contract stays confirmed; TRM effective recomputed 4,100 | `pg` Q7 | PASS |
| A7 | Full-payment / ally voucher gate | 300 of 1,000, then 1,000, then reversal | false → true → false | `pg` Q8 | PASS |
| A8 | Accounting | per abono | entry debit = `monto_cop` (not USD, not contract TRM) | `pg` Q1/Q5/Q7 | PASS |
| A9 | Client documents show USD paid/balance + pesos & TRM per payment | estado de cuenta, recibo | paid 1,000 / balance 0; rows 1,230,000@4,100 and 2,940,000@4,200 | `pg` Q2 (data); compiled-app inspection | PASS |
| A10 | Internal COP reporting distinguishes real vs provisional | open balance | "provisional" flag/notice; definitive only at balance 0; COP-frozen contracts never provisional | unit (`pagoUsd126`), `cobroUsdReporte` wiring; compiled-app inspection | PASS |
| A11 | Historical / legacy mode intact | USD offer collected in COP @4,100 frozen | payment 1,230,000 stored as COP, TRM 1, confirmed; no TRM asked | `pg` Q9 | PASS |

### 126-B — explicit child charge, unit accommodation

| # | Variant | Independently expected | Evidence | Status |
|---|---|---|---|---|
| B1 | Child over the included slots (habitación, 3 nights, base 400,000, child 50,000/night, commission 10 %, markup 20 %) | sale effect = 1,215,000/0.8 − 1,080,000/0.8 = **168,750**, basis "por noche", included in the unchanged total | `cargosMenoresUnidad126.test.ts`, `ofertaHotel126.react.ts` | PASS |
| B2 | Child inside included capacity | "incluido en la unidad, sin cargo propio", no amount | same | PASS |
| B3 | Two children, one free slot | first (order received) included, second pays | same | PASS |
| B4 | 11–17 classified as adult | "paga como adulto", never a child amount | same | PASS |
| B5 | Per-person unit, infant insurance per stay vs child per night | infant 30,000 once; child 70,000 × 3 = 210,000 | same | PASS |
| B6 | Several rooms / no children / legacy option without the field | room number shown; empty list; no crash | react | PASS |
| B7 | No cost leak | only `habitacion, edad, clase, cobro, cargoVenta, noches` cross the boundary; existing key-pin test updated to add `menores` | unit | PASS |
| B8 | Additional night | unit hotels have no additional-night reference (accepted #449 behaviour, unchanged); extending the return date re-runs the whole search and the per-night child charge scales (3→4 nights: 150,000→200,000) | unit | PASS (limit documented) |

### 126-C — infant-only base groups

| # | Variant | Expected | Evidence | Status |
|---|---|---|---|---|
| C1 | Base group with only the infant row next to a promotion group (same category/regimen) | label "Solo tarifa de infante · adultos en «Promoción · X»"; dialog note; infant row and price (88,000) intact; promo group "Doble desde 900,000" | `armadoPestanas101.react.ts`, `seleccionMasiva107.test.ts` | PASS |
| C2 | Non-infant groups without a double | still "Sin tarifa doble"; child-only hotel unchanged; infant with promo of another regimen not linked; infant + niño group not "solo infante" | unit + react | PASS |

### 126-D — promotion badges

| # | Variant | Expected | Evidence | Status |
|---|---|---|---|---|
| D1 | Stay entirely inside the promotion (4→9 Dec, nights 4–8) | "Promoción PRE BF" | `promoMostrada126.test.ts` (real `evaluarHotelPorFechas`) | PASS |
| D2 | Stay partly inside (2→7 Dec) | "… · solo en algunas noches" (never whole stay) | same | PASS |
| D3 | Boundaries: night 8 yes, night 9 no, night 3 no, night 4 yes | exact | same | PASS |
| D4 | Stay outside; purchase window closed; no promotion configured | no badge | same | PASS |
| D5 | "N nights, 1 free" | "… · aplicada a la estadía"; absent below its minimum nights | same | PASS |
| D6 | Badge never speaks about children | no "niñ/gratis" | unit + react | PASS |
| D7 | Table and Booking card render it; card uses the **selected** combo; EBB/Long Stay + promotion coexist | rendered DOM | `ofertaHotel126.react.ts` | PASS |
| D8 | No per-card requests | label derived from provenance already computed in the single search/quote | code review + §5 | PASS |

## 2. Files changed (summary)

- 126-A: `lib/finanzas/pagoUsd.ts` (new), `cobroUsdReporte.ts` (new), `abonosReporte.ts` (new), `components/contrato/PagoUsdCampos.tsx` (new), `useRegistroAbono.ts`,
  `contratos/actions.ts` (TRM guard in `registrarAbono`/`actualizarAbono`), `AbonoForm.tsx`, `CarteraList.tsx`, `GestionTabs.tsx` (real vs provisional panel),
  `lib/cuenta/estado.ts`, `estado-cuenta/[numero]/page.tsx`, `recibo/[id]/page.tsx`, `ConvertirCarritoBtn.tsx` (explanatory note), `rentabilidad.ts`/`RentabilidadList.tsx`,
  `facturacion/page.tsx`/`FacturacionClient.tsx`, `estadoResultados.ts`/`estados-financieros/page.tsx`.
- 126-B: `lib/reservar/cargosMenoresUnidad.ts` (new), `computoReservaBernalo.ts`, `evaluarDisponibilidadUnidad.ts`, `app/tarifario/CargosMenoresUnidad.tsx` (new), `TablaResultadosBusqueda.tsx`, `VistaBooking.tsx`.
- 126-C: `lib/paquetes/tarifarioGrupos.ts`, `ArmadoClient.tsx`.
- 126-D: `lib/calc/promoMostrada.ts` (new), `liquidacionHotel.ts`, `composicionHotelBusqueda.ts`, `cotizar.ts`, `components/cotizacion/EtiquetaPromocionHotel.tsx` (new), `BuscadorBooking.tsx`, `TablaResultadosBusqueda.tsx`, `VistaBooking.tsx`.
- Tests: `pagoUsd126`, `cargosMenoresUnidad126`, `promoMostrada126` (unit); `ofertaHotel126`, `pagoUsdUi126` (React, added to `test:react`); `pagoUsdTrm126.pg.ts` (real actions); extended `seleccionMasiva107`, `armadoPestanas101`;
  two existing assertions updated with their reason (`etiquetaDescuentoHotel90` selected-combo source pattern, `evaluarDisponibilidadUnidad` key list now includes `menores`).
- **No migration. No schema change. No data backfill.**

## 1b. Round-2 and round-3 acceptance rows

| # | Requirement / variant | Input | Independently expected | Evidence (E) | Status |
|---|---|---|---|---|---|
| F1a | Typed TRM `4.100`, COP entry | COP 1,230,000, saldo USD 1,000 | preview USD 300 / saldo 700; **call carries valor 1,230,000, TRM 4100, moneda "COP"**; 1,230,000 ÷ 4,100 = 300 | `pagoUsdEnvio126.react.ts`; compiled app (typed `4.100`) | PASS |
| F1b | Typed TRM `4.100`, native-USD entry | USD 300 | preview "equivale a $1.230.000"; **call carries valor 1,230,000, TRM 4100, moneda "USD"** | same | PASS |
| F1c | Excess confirmation | pay a covered contract; form edited behind the dialog | confirmation re-sends the **frozen** envelope (TRM 4100, same operation, same currency); form not reset because it changed | same | PASS |
| F1d | Retry of a pending confirmation | confirmation fails after registration | same operation, valor and TRM 4100, currency | same | PASS |
| F1e | Reset comparison | retype "4100" for "4.100" (same) vs "4.200" (different) while the request is in flight; switch COP↔USD | same normalized TRM → reset; different TRM or currency → kept | same | PASS |
| F1f | Edit-payment forms | type `4.200` / `4.100` / `4.1` | `trmInput` 4200 / 4100 / 0 (rejected); amount unchanged | same (Cartera edit) | PASS |
| F1g | Floor | `4.1`, `99.99`, `1`, `0`, `-4100`, NaN, empty | rejected with message, **no abono written** (action + DB) | `pagoUsd126.test.ts`, `pagoUsdTrm126.pg.ts` Q3 | PASS |
| F2a | Two successive promotions, no base night | BASE 1–10 Dec; PROMO UNO night 4; PROMO DOS night 5; stay 4→6 | each "algunas noches"; label "Promociones PROMO UNO y PROMO DOS · cada una en algunas noches" | `promoMostrada126.test.ts` (real engine) | PASS |
| F2b | Neighbours | stay 3→7; 1-night stays; a promotion winning all nights; stay-level "N nights, 1 free"; no counts (old caller) | `Promociones … cada una…`; "Promoción PROMO UNO"; "Promoción PRE BF"; "aplicada a la estadía"; never "toda" for two promotions | same | PASS |
| S1 | Historical vs new documented separately | — | §0 | this document | PASS (doc) |
| S2 | Tile, popup, salida table, advisor form | promotion won / partial / none | badge only when won, reach honest, no child wording | React (real components) + compiled advisor form | PASS; compiled tile/popup **not exercised** (§6) |
| S3a | Native-USD receipt | USD 300 @4,100 | "Pago recibido en dólares: USD 300 recibidos · equivalente contable $1.230.000 a TRM $4.100 (no se recibieron pesos)"; never "recibido en pesos" | compiled app + print render; `pg` Q10 | PASS |
| S3b | Estado de cuenta / contract panel | same | "Recibido en USD", "Pagado (COP)" total $0, note; panel "Más USD 300 recibidos en dólares (equiv. contable …; no son pesos recibidos)" | compiled app; `pg` Q10/Q11 | PASS |
| S3c | Mixed | USD 300 received + COP 2,940,000 @4,200 | pesos received 2,940,000; USD received 300; contable total 4,170,000 | `pg` Q11; unit | PASS |
| S3d | Historical NULL / COP-frozen contract | old payments; DTM-0005 shape | read as pesos received; `moneda_pago "USD"` rejected on a COP-frozen contract; no new columns | `pg` Q9, Q13; compiled app | PASS |
| S3e | Editing a USD-received payment | change value or TRM in pesos | refused with message; date/form/reference editable; nothing else changes | `pg` Q12 | PASS |

| F3a | Interruption after the abono insert | native USD 300, failure injected before commit | no abono, no operation, no unclassified row; identical retry registers with USD | `pg` R1 | PASS |
| F3b | Accounting failure with the payment recorded | ledger entry fails | abono already classified USD; identical retry completes the entry once; retry with COP rejected and writes nothing (not even the re-post) | `pg` R2 | PASS |
| F3c | Confirmation failure with the payment recorded | confirmation fails | abono classified USD, contract still pending; identical retry confirms, no duplicates | `pg` R3 | PASS |
| F3d | Replay | identical / COP / no currency / historical NULL then USD | original result / rejected / rejected / NULL kept | `pg` R4 | PASS |
| F3e | Immutability | UPDATE of the currency, NULL→USD, other fields | blocked / blocked / allowed | `pg` R5 | PASS |
| F3f | Identity and authorization | anon, authenticated, role without accounting, wrong agency, foreign identity (new and replay), right identity | permission denied / rejected / rejected / F4601 / F4601 / registered USD | `pg` R6 | PASS |
| F3g | Validation in the database | currency EUR; USD currency on a COP-collected contract | F4470 / F4471, nothing written | `pg` R7 | PASS |
| V1a | Tile, popup, table with promotions | whole / partial / none stay | badge only when won, reach honest, none outside | compiled app (151 OK) | PASS |
| REP | Reports | native USD 300 + pesos | Caja note quantifies the equivalent; Conciliaciones row labelled dollars | React + compiled app | PASS |
| F4a | Disjoint dates | infant-only BASE ENERO (Jan) + adult PROMO DICIEMBRE (Dec) | no link; neutral text; prices/rows intact | unit, React, compiled app | PASS |
| F4b | Different departure | same dates, bloqueo/salida ids differ | no link | unit | PASS |
| F4c | Several candidates / partial / split | two promotions with adults on the same stay; one covering half; two covering one each | no link (never "the first") | unit, compiled app (two candidates) | PASS |
| F4d | Promotion group without adult rates | niño/infante only | not a candidate; a real adult promotion is still linked | unit | PASS |
| F4e | Accepted case | same stay, one adult promotion (also with salida/bloqueo ids; other nights → no) | «adultos en «Promoción · X»» | unit, React, compiled app (912501, 912512) | PASS |
| F5a | Safe rollback | no classifications, 313 rolled back | proceeds; historical NULL abonos byte-identical | `pg` S1, S2 | PASS |
| F5b | Refusal | native USD + mixed classified payments | refuses; schema + rows fingerprint unchanged | `pg` R-A, R-B | PASS |
| F5d | Concurrent classified insert after the guards (Codex's scenario) | script paused after the guards; second connection inserts native-USD | insert waits for the lock (seen in `pg_stat_activity`), then fails with an explicit column error; no classified payment committed without its currency | `pg` T1 | PASS |
| F5e | Classified insert IN FLIGHT when the rollback starts | uncommitted native-USD insert held 3 s | rollback waits, sees the committed row, refuses; schema and row intact | `pg` T2 | PASS |
| F5f | Lock not obtained | uncommitted writer held 8 s | script fails after ~5 s (`lock timeout`); constraint, column and the writer's row untouched | `pg` T3 | PASS |
| F5g | Existing guards still active | safe rollback; 313 applied; classified payment | proceeds / refuses / refuses | `pg` T4 | PASS |
| F5c | Refusal with 313 applied | real payments by the actions / empty DB with 313 | refuses; nothing changed; documents still distinguish dollars | `pg` R-C, R-D | PASS |
| E1 | Yesterday / today / tomorrow | departures today-1, today, today+1, today+2 | yesterday out; today in; nearest first | real RPC + loader | PASS |
| E2 | Bogotá midnight | 23:59:59 vs 00:00:00 Bogotá, and 02:00Z (UTC says tomorrow) | still today / next day / still today | unit + real RPC | PASS |
| E3 | Counts, totals, pagination | 33 in-scope future contracts | total = independent SQL count on every page; summary sums to total; pages 25 + 8 + empty | real RPC + loader | PASS |
| E4 | Undated | no `fecha_salida` | out in this mode; visible (nulls last) in other orders | real RPC + loader | PASS |
| E5 | Historical access | explicit «Viaje desde»/«Viaje hasta»; other orders | explicit date wins and the note says so; past contracts reachable | real RPC, compiled app | PASS |
| E6 | Presentation | desktop 1366 / mobile 390 | rule note, Bogotá date, no horizontal overflow, 0 requests at rest | compiled app | PASS |

## 2b. Files changed in rounds 2 and 3

`components/contrato/useRegistroAbono.ts`, `lib/finanzas/pagoUsd.ts` (`trmNormalizada`, floor 100, received-vs-equivalent summary), `GestionTabs.tsx`, `CarteraList.tsx`, `AbonoForm.tsx`, `cartera/actions.ts`, `contratos/actions.ts` (optional trailing `monedaPago`, edit guard),
`lib/calc/paquetes.ts` (+`nochesPorGanadora`), `lib/calc/promoMostrada.ts`, `lib/reservar/liquidacionHotel.ts`, `lib/reservar/computo.ts`, `lib/reservar/cotizar.ts`, `lib/tarifario/entradaTarjeta.ts`, `app/tarifario/cotizarTarjetaActions.ts`, `TarjetaHotelFechas.tsx`, `VistaBooking.tsx`, `TarifarioPublic.tsx`, `ReservaForm.tsx`,
`lib/cuenta/estado.ts`, `estado-cuenta/[numero]/page.tsx`, `recibo/[id]/page.tsx`, `contratos/[numero]/page.tsx`, `types/database.ts`.
**Round 3:** `supabase/migrations/20260601000313_registrar_abono_moneda_atomico.sql` (+ `supabase/scripts/{preflight,postcheck,rollback}_313_registrar_abono_moneda.sql`), `contratos/actions.ts` (`registrarAbono` → `registrar_abono_moneda`, REST update removed), `flujo-caja/page.tsx` + `FlujoCajaClient.tsx`, `contabilidad/conciliaciones/page.tsx`, `pruebas/reportesPesosRecibidos126.react.ts`, `pruebas/pagoUsdTrm126.pg.ts` (R1–R7), three tests updated for the RPC name, `supabase/scripts/localreview/humo_126.mjs` + `sonda_126c.mjs`.
**New:** `supabase/migrations/20260601000312_abono_moneda_pago.sql`, `supabase/scripts/{preflight,postcheck,rollback}_312_abono_moneda_pago.sql`, `pruebas/pagoUsdEnvio126.react.ts`, `supabase/scripts/localreview/sonda_126*.mjs` (DOM probes, diagnostics only).
**Tests extended:** `pagoUsd126`, `promoMostrada126`, `pagoUsdTrm126.pg.ts` (Q10–Q13), `pagoUsdUi126.react`, `modalSeleccionTarjeta90.react`, `vistaTablaCotizada90.react`; one pinned fingerprint updated with its reason (`salidaVinculada63Wiring`, additive output of `paquetes.ts`).

## 3. Executed evidence (executor; nothing here is Codex-independent) — round 4

Final production build **`PU7ZUGVSAhJHonyK8SlZZ`** (977 files). Source changes after that build: none to application code (only this document, the memory note and coordination files). Earlier builds are superseded.
Baseline for name comparison: origin/main 312608a59 (detached worktree `C:/tmp/base126`; name lists kept).

| Check | Result |
| --- | --- |
| `tsc --noEmit` (whole project incl. tests) | clean, run after the last production edit |
| Unit (`test:unit`, `--test-concurrency=2`) | **10,210 tests, 30 failures**; failing names **identical** to the baseline's 30 (empty set difference both ways). |
| React (`test:react`) | **2,046 tests, 26 failures**; failing names **identical** to the baseline's 26 (both directions). |
| F4 | `seleccionMasiva107.test.ts` 19/19 (10 new F4 cases); old rule restored → **8 new tests fail**, restored. `armadoPestanas101.react.ts` 26/26 (new neutral rendering test; the accepted-case fixture now carries a stay). Compiled app: accepted link, disjoint dates, two candidates, restore. |
| F5 | `pagoUsdTrm126.pg.ts` **31/31** (Q0–Q13, R1–R7, S1–S2, R-A…R-D, **T1–T4 concurrency**). Old unconditional rollback → **R-A…R-D fail**; the previous (lock-less) script → **T1, T2, T3 fail** (28/31); both restored. Codex's reproducer: data loss before, none after (see round 5 above). No application/config source changed in round 5, so the build `PU7ZUGVSAhJHonyK8SlZZ` and the application suites of round 4 stand (not re-run, as instructed). |
| #126-E | `gestionContratos106.test.ts` 32/32 (5 new); `gestionContratos106.pg.ts` (real RPC + real loader/page, launcher `test_106_gestion_contratos.sh`) **61/62** — the 7 new #126-E tests pass; floor disabled → 4 fail; the ONE failing test (`superadmin ve ambas agencias…`, text «Acuse de envío desactualizado») **fails identically on the unmodified baseline sources** (verified by restoring the HEAD versions of the four touched files and re-running it): a pre-existing fixture/clock dependency, not caused by this work and not fixed here. |
| Compiled-app browser run (`humo_126.mjs`, Edge, real login, 1366 / 1024 / 390, disposable clone with 312 + 313 + the delivered seeds; **never `rev_revision`**) | **183 OK, 0 failures, 0 skips**; captures in `C:/tmp/ev126/capturas4` (not versioned). |
| Earlier-round real-action suites | the F3 suite (R1–R7) is inside the 27/27 above; the payment/promotion/tile/report checks are inside the 183. |

## 4. Rendered inspection — round 4

Read (not only asserted): Gestión de contratos in «Viaje más reciente» at 1366 and 390 px (three contracts, nearest first, the note, the Bogotá date, no overflow), and the earlier popup/tile/Flujo de caja captures. Defects found in round 4 and fixed before the final run: one **fixture** defect (the two-candidate F4 case inserted rows violating the provenance constraint; fixed in the clone fixture, restore verified) and two **script** defects (hotel-header regex; unscoped selectors). No product defect surfaced by rendering. Not inspected: Conciliaciones with a row selected; quotation/contract PDFs (untouched).

## 5. Resource / consumption evidence — round 4

| Item | Measurement / reasoning |
| --- | --- |
| Gestión de contratos | unchanged cost: **1 role query + 1 RPC per load** (existing test `CONSUMO` still passes); the Bogotá floor is one extra filter key inside the SAME RPC call; no extra request, no polling (browser: 0 requests at rest). |
| F4 | pure in-memory grouping over rows already loaded; no query. |
| F5 / seeds / scripts | no application cost (operator scripts and clone fixtures). |
| Payments / searches / reports | unchanged from round 3. |
| Not measured | any hosted Vercel/Supabase metric. |

## 6. Remaining gaps and honest limits — round 4

1. **No Codex approval and no owner acceptance.** Executor evidence only.
2. **#126-E interpretation to confirm.** The page has no control literally named «Viaje más reciente»; the nearest existing control was the order «Viaje: más próximo» (`salida_asc`), which sorted all departures ascending, past ones first. I **relabelled that option «Viaje más reciente (desde hoy)»** and gave it the owner's rule. The «Contratos» list (non-superadmin page, ordered by contract number) has no such mode and was not changed. If the owner meant a different control, say so.
3. **#126-E design choices (documented, testable):** (a) the floor is applied in the server loader as the existing `salida_desde` filter, so **no migration** and the applied 309 stays untouched; (b) any explicit trip date («Viaje desde» or «Viaje hasta») wins and the floor is not applied (that is how history is reached in this mode; other orders have no floor); (c) undated contracts are excluded in this mode and visible in every other order (nulls last); (d) a shared URL with `orden=salida_asc` shows a different set tomorrow because «hoy» is computed per load, by design; (e) the day is the America/Bogota business day (`fechaNegocio`), not the UTC date.
4. **Pre-existing failing test** in `gestionContratos106.pg.ts` (see §3): not caused by #126; reported, not fixed.
5. **126-D reach / 126-B limits / 126-A report wording / immutable currency:** unchanged from round 3 (§6 of that round): label says "algunas noches" without naming nights; unit-hotel child lines only in search views; Rentabilidad/Facturación/Estados say «cobrado»/provisional (accounting equivalent) and do not claim pesos received; a wrong currency classification is corrected by annul-and-re-register or a reviewed migration.
6. **Deployment dependency:** the code calls `registrar_abono_moneda` (313) and reads `abonos.moneda_pago` (312). **Code before 313 = every payment registration fails; code before 312 = estado de cuenta/recibo fail.** Order in §7. `seed126*.sql` are clone-only and not part of any deployment.
7. **F5 operational note:** the lock makes the rollback briefly block `abonos` traffic (≤ 5 s of queuing) and a payment attempted during the window fails or waits; that is the intended trade-off for a maintenance script, and the regression proves no silent loss.
8. **Environment notes:** `pg304` is stopped at the end of the session; `rev_revision`, `rev_revision_semilla`, `rev_verif_corr` untouched; the `rev-*` containers were removed; leftover `tpg_5f624352e92a` from an earlier session still exists. The build watchdog twice refused/stopped work because **other programs** held memory (I did not touch them); builds and runs were repeated, and only the final complete runs are counted.

## 7. Migration / deployment order (two additive migrations: 312, 313; #126-E needs none)

1. Owner runs `preflight_312_abono_moneda_pago.sql` (ONE read-only query) → applies `20260601000312_abono_moneda_pago.sql` → `postcheck_312_abono_moneda_pago.sql` (ONE query).
2. Owner runs `preflight_313_registrar_abono_moneda.sql` (control 1 requires 312) → applies `20260601000313_registrar_abono_moneda_atomico.sql` → `postcheck_313_registrar_abono_moneda.sql`.
3. Deploy the code (one final Preview; owner checks the payment form Network/idle, the reports and Gestión de contratos), then merge.
**Rollback (F5):** `rollback_313_registrar_abono_moneda.sql` first, then `rollback_312_abono_moneda_pago.sql`, only after the new code is withdrawn. **`rollback_312` now REFUSES (one transaction, nothing changed)** when any abono already has a `moneda_pago` (native-USD or mixed payments) or while 313 is still applied; it proceeds only when no classification would be lost, and never rewrites payments. **It first takes an ACCESS EXCLUSIVE lock on `abonos` (lock_timeout 5 s) and keeps it to the COMMIT**, so no payment can commit between the check and the DROP; run it in a maintenance window (new reads/writes of `abonos` queue behind it for at most those 5 s; a payment attempted during the window is rejected or waits, never committed without its classification). Withdraw the code and leave the column (forward fix) or run a separately reviewed preservation/recovery procedure. Migrations 307–311 untouched; applied migrations are not edited; no historical data is modified or recalculated. All SQL files were executed **only on local throwaway databases**, never remotely.

## 8. Codex audit targets — round 4

1. F4: `lib/paquetes/tarifarioGrupos.ts` (`llaveEstadia`, candidate selection): is "same stay (departure id + dates + nights) with adult rows in exactly one promotion that covers every infant-only stay" the right bar? Any row shape where identity is wrongly established (e.g. several hotels/packages mixed in one call — the function is per hotel)? `ArmadoClient.tsx` text unchanged (it only reads `promoRelacionada`).
2. F5: `rollback_312_abono_moneda_pago.sql`: single transaction, guard order, dynamic SQL when the column is absent, behaviour under the Supabase SQL editor; tests S1/S2/R-A…R-D.
3. #126-E: `aplicarPisoViajeReciente`, loader (`ahora` injection, `fechaNegocio`), page wording, the label change; whether "explicit date wins" and "undated excluded" are the intended semantics; the choice to avoid a migration.
4. Seeds: `supabase/scripts/localreview/seed126*.sql` (clone-only guard, requirements stated in each header).
5. F5 concurrency: `rollback_312_abono_moneda_pago.sql` (lock first, `ACCESS EXCLUSIVE` vs a weaker mode — chosen to avoid a lock upgrade before the ALTER and a deadlock window; bounded wait; guards after the lock) and `pagoUsdTrm126.pg.ts` T1–T4 (marks are psql `\echo` outputs and `pg_stat_activity`, not sleeps-and-hope; T3 takes ~9 s by design).
6. Earlier targets still open: 313 wrapper/trigger; reports wording; compatibility (historical NULL, COP-frozen, DTM-0005); the open business decision on the legacy COP option.

## 9. Addendum — reproducing the browser pass and the clone fixtures

**Delivered fixtures (clone-only; each refuses to run unless the database name starts with `rev_verif`, and checks its requirements):** `supabase/scripts/localreview/seed126.sql`, `seed126b.sql`, `seed126c.sql` (pending USD contracts DTM-12601/2/3 cloned from DTM-10608), `seed126d.sql` (recommended offers for DEMO 125 so Vista Booking shows tiles), `seed126e.sql` (#126-E: contracts DTM-12611…12616 dated yesterday / today / tomorrow / day after / undated / 400 days ago, from the Bogotá date at run time).
Order: create the clone from `rev_verif_corr` → apply migrations 312 and 313 → `seed126.sql` … `seed126e.sql` → `REV_DB_VERIF=<clone> localreview.ps1 iniciar` → `prod` → `node supabase/scripts/localreview/humo_126.mjs <captures>`. The script also alters and restores `tarifario_resultado` rows of package 912501 inside the clone for the F4 cases (it refuses outside `rev_verif*`). `sonda_126*.mjs` are DOM probes. The seeds depend on rows that exist in `rev_verif_corr` (DTM-10608 and the DEMO 125 fixture of #125); they are **not** self-contained, which each header states.
