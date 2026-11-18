# FIX-DOCS round 2 — Codex C1 / C2 (2026-11-18)

Executor evidence only (light node/jsdom tests; **no tsc, build, app or database**). Not audited, not owner-accepted. Criteria: §0 of `owner-corrections-acceptance-matrix-2026-11-18.md` (written first, before code).

## What changed

| File | Change |
|---|---|
| `lib/contrato/plegarNinoGratis.ts` | (C1) a free child (payable tariff 0) is merged into the ONE adult package row of its hotel/category/regimen; (C2) several children with a partial benefit and only a stored total become ONE group row (Σ tariffs − benefit) with no per-child tariff. Marks (`ninoGratisFusionado`, `tarifaNinoNoAtribuible`) are presentation-only, never stored. Inconsistent data (benefit > what the named children would pay, or their row missing) keeps the signed line labelled only «Niño gratis». |
| `components/contrato/ContratoDocumento.tsx` | Tarifa-Niño cell: «Niño gratis» for the merged row, «—» for a group row; the single-package-row quotation path (`unificarPaquete`) is not used when a group row exists (it would average). |
| `lib/cotizacion/filasResumen.ts` | Sealed (frozen-summary) path: with ONE adult tariff, zero-tariff minors join the adult row; children with another real tariff keep their own row. With several adult tariffs nothing is merged (the summary does not name the room). |
| `package.json` | **Defect fixed:** the `test:react` list had two files glued without a space (`…documentosClienteCorreccion2611.react.tspruebas/calculadoraConflicto124.react.ts`), so neither ran in the full suite (round-1 «React 1,968» excluded both). Space restored; the suite now counts 2,003 (see results). |
| `pruebas/correccionDocumentos2611.test.ts`, `pruebas/documentosClienteCorreccion2611.react.ts` | Round-1 expectations that encoded the wrong structure replaced (DTM-0003/4: 2 rows → 1; C-0005: 3 rows → 2; resumen: 3 → 2; row-count matrix `filas` 2/2/3 → 1/1/2) and new cases added (below). Valid requirements kept: totals, no negative row, no promotion/calculation in contracts, quotation keeps its explanation. |

## What each case renders now (asserted on the rendered HTML)

| Case | Value rows | Content |
|---|---|---|
| DTM-0003 | 1 | `1 hab Doble (2 pax)` · 2 · 1 · 732.000 · **Niño gratis** · 1.464.000 |
| DTM-0004 | 1 | 2 · 1 · 180.000 · **Niño gratis** · 360.000 |
| C-0005 (contract and quotation, items path) | 2 | 2 · 1 · 732.000 · Niño gratis · 1.464.000 ; 0 · 1 · — · 293.000 · 293.000 (Σ 1.757.000) |
| C-0005 sealed summary (PVP and NETO) | 2 | same; NETO exigible 1.657.000 → 1.380.000 + 277.000 |
| 2 rooms, same adult tariff | 1 | 4 · 2 · 100.000 · Niño gratis · 400.000 |
| 2 rooms, different adult tariffs | 3 | Doble 200.000, Triple 270.000 (children 0) + one «Niño gratis» row 0 — **not guessed into a room** |
| Partial single child (347.000 − 253.000) | 2 | adults 1.388.000 ; child 94.000 (not «Niño gratis», not merged) |
| C2: two children, partial −50.000 over 2 × 100.000 | 2 | adults 800.000 ; group 0 · 2 · **—** · 150.000 (no negative row, no per-child tariff, no average) |
| C2: two sealed children 50.000 / 100.000 | 3 | each exact tariff in its own row |
| NETO, items path (exigible 1.657.000) | 2 | by-hand proration 1.380.676,15 + 276.323,85 = 1.657.000 |
| USD (2 × USD 500 + free child) | 1 | 2 · 1 · USD 500 · Niño gratis · USD 1.000, no COP |
| Quotation vs contract | same rows | quotation keeps «Niño gratis de «…»»; contract never names the promotion |

## C2: sealed vs unresolved

- **Sealed:** the frozen `resumen_precios` seals the payable tariff per passenger position (`condonado[k]` from the checkout), so that path is exact for any number of children/rooms; two children with different tariffs keep separate rows.
- **Not sealed (historical items path):** the signed line stores only the total benefit and text naming each child (`hab. N`, age, class). A split is not derivable, so the beneficiaries are shown as one group value without a per-child tariff. Not evaluated as safe: adding per-child amounts to the signed text for new contracts (many consumers parse that text/prefix); the existing sealed summary already covers new cart-created quotations/contracts.
- **Unresolved, honest:** (a) several adult tariffs without a sealed room link — the free child keeps its own «Niño gratis» row; (b) inconsistent historical data keeps the signed line labelled «Niño gratis» (its stored negative amount still prints in that single edge case; not reachable from consistent data).

## Tests run (light, project loaders)

- `correccionDocumentos2611.test.ts` + `filasResumen94.test.ts`: 36/36.
- `documentosClienteCorreccion2611.react.ts`: 20/20. Mutation actually executed (merge and resumen change disabled): 6 of 17 then-existing tests failed; restored → all pass.
- Full unit suite: 10,145 tests / 30 failures; names identical to the clean baseline. Full React suite: 2,003 / 27; the 26 baseline names unchanged plus 2 names (`Vista tabla — alojamientos por unidad` / «hotel por unidad en USD …») from the other fork's test in progress (prints a debug line) — not part of this change.
- eslint on the touched files: clean.

## Lead must re-verify on the compiled build

`tsc` (generic spreads in `plegarNinoGratis.ts` and the `MarcasNinoGratis` fields read in `ContratoDocumento.tsx` are not type-checked), rebuild, then: `/contrato/DTM-0003` and `/contrato/DTM-0004` (one row), **C-0005 = `/dashboard/cotizaciones/5` and its public `/cot/<token>`** (two rows; `/cotizacion/5` was a wrong guess), NETO variants, PVP/NETO PDFs (read every page), 390 px (the row is wider: «Niño gratis» in the tariff cell), and `humo_correcciones_2611_docs.mjs` whose expected row counts must be moved to the corrected structure (1/1/2).

## Risks

The merge relies on the description suffix «· categoría / régimen» and the hotel prefix matching exactly; a differently written adult row simply isn't a candidate (the free child then keeps its own row — safe). The group row shows «—» in the child tariff cell by design.

## Addendum — REAL persisted NETO free-child contract (coordinator request)

Fixture: `pruebas/support/fixtures/netoNinoGratisPersistido2611.json` (copied unedited from VERIF-GAPS `g4_persisted.json`: real actions `crearCotizacion` → B2B-assisted NETO quotation → `convertirCotizacion`; the owner's C-0005 shape: PVP 1.757.000, commission 175.700, exigible 1.581.300; `venta`: modo `neta`, `comision_estado` `descontada`, `precio_venta` 1.581.300; items «1 hab Doble (2 pax)» 2 × 732.000, «Niño 1» 366.000, «Niño 2» 293.000 and the signed line `-366.000`; sealed `resumen_precios` modalidad `neto`). Regression: `pruebas/netoNinoGratisPersistido2611.react.ts` (4 tests, renders the real `ContratoDocumento`).

### Defect exposed and fixed

The stored signed line carries the hotel in front («Hotel PRE BF 125 ACTIVO · Niño gratis por habitación …») while the child rows do NOT («Niño 1 · Estandar / PAM»). My round-2 fold looked for `${prefix}Niño 1 · …`, found no row and left the signed line: **before the fix the items path printed a negative row «Niño gratis | -$ 366.000» (PVP) and the NETO items path lost every per-row amount** (`valoresNetosDocumento` refuses negative lines → total only). The sealed-summary path was already correct. Fix (`lib/contrato/plegarNinoGratis.ts`, `buscarFila`): look first with the prefix; if no row carries it, use the ONE row of that class without prefix; with several candidates nothing is guessed (line kept). Mutation executed: with the fallback disabled 2 of the 4 new tests fail; restored 4/4.

### Exactly what the document renders now for this real data

| Presentation | Rows | Content | Σ |
|---|---|---|---|
| NETO, sealed summary (how the contract page serves it: `resumenContrato` + `netoTotalExigible` 1.581.300) | 2 | `Paquete Turístico Paquete PRE BF 125 ACTIVO` · 2 · 1 · NETO 658.800 · **Niño gratis** · **1.317.600** ; · 0 · 1 · 0 · 263.700 · **263.700** | **1.581.300** |
| NETO, items only (no sealed summary) | 2 | `1 hab Doble (2 pax) · Estandar / PAM` 2 · 1 · 658.800 · Niño gratis · 1.317.600 ; `Niño 2 · Estandar / PAM` 0 · 1 · 0 · 263.700 · 263.700 | 1.581.300 |
| PVP (quotation or contract) | 2 | 2 · 1 · 732.000 · Niño gratis · 1.464.000 ; `Niño 2` 0 · 1 · 293.000 · 293.000 | 1.757.000 |

By hand: the plan applies a uniform 10 % (`pct` 0,1, tax 0), so 1.464.000 × 0,9 = 1.317.600 and 293.000 × 0,9 = 263.700. The sealed plan allows exact attribution (it stores each passenger's NETO tariff). The items-only NETO path uses the pre-existing proportional distribution of the exigible total over the PVP weights (`valoresNetosDocumento`); it equals the sealed result here **only because the commission is uniform** — with a non-commissionable tax it would be an approximation, so the sealed summary remains the authority and that caveat stays documented. Asserted in every NETO render: no «1.757.000», no «175.700», no negative amount, no «PRE BF ·»/«PROMO»/«por habitación»/«(hab.» text; «PRE BF» only appears inside the real package name «Paquete PRE BF 125 ACTIVO». Total shown 1.581.300.

Tests run: `netoNinoGratisPersistido2611.react.ts` 4/4; `correccionDocumentos2611.test.ts` 20/20 (two new cases: unprefixed single class row is found; several unprefixed rows are not guessed); 101/101 across the 9 neighbouring document React files; eslint clean. The file is registered in `test:react`.
