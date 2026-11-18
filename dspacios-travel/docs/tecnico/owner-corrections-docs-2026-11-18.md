# Owner corrections 2026-11-18 — workstream DOCS (items 1, 2, 5)

Status: implemented in `.worktrees/int-review`; NOT staged, committed or deployed; no database was touched. Codex has not audited this; the owner has not accepted it.

## Item 1 — DTM-5301 `valor_componente = 1`: fixture data, not a production behaviour

- `supabase/scripts/local53/semilla_local53.sql` (`pg_temp.cond`) hard-codes `valor_componente = 1` for every synthetic condition, independently of `monto_exigido` (300000 for DTM-5301). Nothing in the app computes that `1`.
- Real creation writes the component's price: `lib/cotizacion/snapshotCondiciones.ts` (`valor_componente: round2(Number(c.valor))`) → `lib/contrato/congelarCondicionesContrato.ts` → RPC `congelar_condiciones_contrato`. The display (`lib/contrato/condicionesContrato.ts`) reads `valor`, but the minimum shown to the client is `monto_exigido`, so the `1` is invisible in documents and does not change confirmation.
- No historical row was changed. Verification still needed (read-only, lead): `select numero_contrato, tipo_componente, valor_componente, monto_exigido from contrato_condiciones where numero_contrato in ('DTM-0003','DTM-0004','DTM-0005')` on the review copy — real-action contracts must show the component price, not `1`.

## Item 2 — USD client documents

- `components/contrato/ContratoDocumento.tsx` (used by `/contrato/[numero]`, `/c/[token]`, `/cot/[token]`, `/cotizacion/[id]`, print/PDF, PVP and NETO): the COP «Total a cobrar» card is gone. «Total pagado» and «Saldo pendiente» are shown in the OFFER currency.
- New pure helper `pagadoEnMonedaOferta` (`lib/finanzas/cobro.ts`): collection-currency payments are converted with the FROZEN collection TRM (COP ÷ TRM for a USD offer; USD × TRM for a COP offer). Paying the full frozen total counts as the full offer, so the thousand-peso rounding of the converted total never leaves a phantom balance.
- Example (test): USD 1000, TRM 4100, COP 1.230.000 paid ⇒ USD 300 paid, USD 700 balance. NETO: balance is against the exigible total (900 ⇒ 600).
- Not changed: payments ledger, `abonos`, frozen TRM, internal COP accounting, the internal contract page card (`/dashboard/contratos/[numero]`, kept in the collection currency on purpose).
- Minimum-to-confirm: once the contract is confirmed (`confirmado`/`confirmada`/`activo`) the document hides the «Pago mínimo» column, the summary line, the agreed-minimum line and the «no disponible» notice. The frozen conditions table (component, condition, deadline, restrictions) stays; confirmation rules untouched. Pending contracts print everything as before.

## Item 5 — free-child folding (presentation only)

- New `lib/contrato/plegarNinoGratis.ts` (`plegarNinoGratisItems`): the stored signed line («Niño gratis por habitación …», adultos 1 × negative tariff) is folded into the payable tariff of the child it belongs to, keeping Σ rows = stored total. Child tariff 0 ⇒ row «Niño gratis · cat / régimen»; partial benefit (child still pays part of the stay) ⇒ the child row at its real payable tariff and NOT called free (e.g. 347.000 − 253.000 ⇒ 94.000). Genuinely different payable tariffs stay as separate rows (C-0005: one child at 293.000 + one «Niño gratis»).
- Attribution is by the class tags in the stored description («(Niño 1)» / «(Niño 2)») and the hotel prefix of the multi-hotel cart; it is refused (line kept, shown only as «Niño gratis», no promotion name or arithmetic) when it would be a guess: several free children of the same class with a partial benefit; Niño 1 + Niño 2 free together unless both end at zero.
- The contract no longer prints the promotion name or its explanation («Niño gratis de «X»: habitación …») in «Condiciones de la tarifa»; the quotation keeps that explanation.
- Frozen summaries (`ResumenPreciosCliente` / `filasDeUnidad`): they already carried the reduced child tariff; a row whose children are non-infant and cost 0 now reads «Niño gratis» (new optional `ninoGratis` flag, no importe changed).
- In a quotation with a manual service (single «Paquete turístico» row, which averages the child tariff) the unified row is not used when folding leaves distinct child tariffs, so a free child and a paying child are never averaged.
- NETO: because the negative line is folded before `valoresNetosDocumento` (which rejected negative lines), NETO documents with a free child now also show per-row amounts.

## Tests

- New: `pruebas/correccionDocumentos2611.test.ts` (11, pure helpers) and `pruebas/documentosClienteCorreccion2611.react.ts` (8, real components; wired into `npm run test:react`).
- Updated to the new rule: `ninoGratis125.documentos.react.ts`, `contratoSinItems53.react.ts` (F4/F5 now use a pending contract and assert the confirmed one hides the notice), `cobro235.test.ts` (wiring assertion).
- Run: 210/210 React tests across 16 document files and 163/163 unit tests across 10 files, all passing. No `tsc`, no build.

## Not covered / limits

- Internal-only views keep the signed line on purpose (`desgloseInterno`, `ComposicionPrecio`, the dashboard quotation page). The aggregated hotel comparison (`lib/cotizacion/comparativa.ts`) already treats the signed line as a hotel reduction; its document was not re-inspected here.
- Browser/PDF inspection of the affected pages is still to be done by the lead on the built source (see the final message for pages).

## Acceptance matrix (TEST_ACCEPTANCE.md) — executor evidence only; Codex has not independently checked it

Expected values below are hand-calculated, not produced by the code under test.

| Requirement | Input | Hand-calculated expected | Actual evidence | Status | Untested variants |
|---|---|---|---|---|---|
| USD client doc, COP collection | offer USD 1000, TRM 4100, COP 1.230.000 paid | paid USD 300 (1.230.000/4100), balance USD 700, no «Total a cobrar», no COP amount | React doc test + unit test | PASS | printed PDF page not viewed; `/c/[token]`, `/cot/[token]` not rendered individually (same component, not separately asserted) |
| Partial / boundary payments | COP 615.000; 1.000.000; 4.099.999; 4.100.000 | USD 150; 243,90; 999,99 (never «0 balance» with money missing); USD 1000 | unit tests (boundary guard added after reasoning, not after a failing run) | PASS | USD collection of a COP offer only unit-tested |
| NETO USD | exigible 900, paid COP 1.230.000 | paid 300, balance 600 | React doc test | PASS | NETO with free child + USD not combined |
| Pending → confirmed | USD component minimum 300 | pending prints «Pago mínimo requerido» + column; confirmed hides both, keeps component/condition rows | React test (same contract, state toggled) | PASS | pending→confirmed through the real RPC not exercised |
| Payment reversed | paid 1.230.000 → 0 | paid USD 0, balance USD 1000, confirmed still hides minimum | React test | PASS | real abono annulment action not run |
| Minimum already satisfied, still pending | paid USD 300 vs minimum 300, estado pendiente | still pending ⇒ minimum still printed (rule hides only when confirmed) | React test pins this | PASS (pins current rule) | business confirmation of that wording by the owner |
| DTM-0003 | 2 adults × 732.000, child 293.000 fully waived | 2 rows (adult, «Niño gratis»), total 1.464.000, rows sum 1.464.000 | row-count test × 4 routes | PASS | real contract in the review DB not rendered |
| DTM-0004 | 2 × 180.000, Niño 2 150.000 waived | 2 rows, total 360.000 | same | PASS | same |
| C-0005 | 2 × 732.000 + 2 children × 293.000 − 293.000 | 3 rows (adult / child 293.000 / «Niño gratis»), total 1.757.000 | same + manual-service quotation (no averaged single row, total 2.057.000) | PASS | same |
| Partial benefit not «gratis» | child 347.000 − 253.000 | child row 94.000 labelled normally, total 1.482.000 | React test (existing fixture updated) | PASS | — |
| No promotion name / arithmetic in contracts | explanation «Niño gratis de «PRE BF»…» | absent in contract, present in quotation | React tests | PASS | — |
| Frozen summary (`resumenPrecios`) | adult 732.000 ×2, child 293.000, child 0 | 3 rows, one «Niño gratis» | React test | PASS | real conversion output not read |
| NETO folding | free child + NETO exigible 1.300.000 | row folded, label shown, total unchanged | React test | PASS | NETO per-row amounts for the free child only checked by label |
| Mutation check | fold disabled temporarily | tests must fail | executed: 6 tests failed, file restored (15/15 pass again) | DONE | — |

Routes covered by rendering the real component with the props each route passes: contract (confirmed/pending/with frozen conditions), quotation (`esCotizacion`), NETO, frozen summary, manual-service quotation. NOT covered (missing coverage, not claimed): the saved-quotation → conversion → contract chain through real actions and the database; public routes `/c/[token]`, `/cot/[token]`, `/contrato/[numero]`, `/cotizacion/[id]` as HTTP pages with a real session; print/PDF page inspection; desktop/intermediate/mobile visual inspection; two free children of one class with a partial benefit and Niño 1 + Niño 2 partially free together (kept as the signed line labelled «Niño gratis», by design); DTM-5301 real-action `valor_componente` readback (fixture finding is static analysis only).

Labels: item 1 is FIXTURE-ONLY behaviour (static analysis); items 2 and 5 are PRODUCT behaviour changes (presentation).
