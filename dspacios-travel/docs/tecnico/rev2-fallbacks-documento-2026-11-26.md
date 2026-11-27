# Customer-document rules are unconditional (Codex follow-up, 2026-11-26)

Status: implemented and unit/rendered-tested; NOT accepted by the owner or audit-closed.

## What Codex found
1. `ContratoDocumento.tsx` still rendered the priced «Servicios adicionales» table when `valoresSinServicios` was `null`.
2. `absorberAjusteRedondeo.ts` returned the original «Ajuste de redondeo…» rows when the residual could not be allocated.
3. (Found while fixing 2) the per-passenger summary path (`filasResumen.ts` → `ResumenPreciosCliente.tsx`) still emitted an «Ajuste por redondeo» row for legacy stored summaries whose residual could not be absorbed.

## Rule now enforced (presentation only; persisted financial data untouched)
- A service line never shows its own price, in every branch (`serviciosSinPrecio = servicioItems.length > 0`).
- The adjustment row never reaches the customer, in every branch.
- When the amount cannot be absorbed exactly (no adult row to receive it, fractional-cent shares, invalid/duplicate item data, total that does not reconcile, legacy summary with unidentified passengers) the document does NOT invent an allocation and does NOT lose the amount: it prints people counts and the stored total only, with no per-row tariff/value columns (`sinDesglose` in `ContratoDocumento`, `sinImportes` in `ResumenPreciosCliente`). The total comes from the stored lines, unchanged.
- Children's tariffs are never touched; hotel/category/plan/accommodation text is unchanged.
- `absorberAjusteRedondeo` now returns `{ items, absorbido, sinReparto }`; adjustment lines (also `modo_precio = total`) are always removed from the customer rows. `filasResumen.unidadSinReparto()` is the equivalent check for summaries.

## Tests that exercise the fallbacks (not only successful absorption)
- `pruebas/alojamientosDocumento95.rev2.test.ts` (absorber: no adult row, fractional cents, total-mode line, no adjustment).
- `pruebas/documentoFallbacks95.rev2.react.ts` (rendered `ContratoDocumento`: NETO total that does not reconcile, non-integer quantity, duplicate ids, quotation variant; adjustment with children only, fractional cents; legacy summary with unidentified passengers).
- Updated, meaning preserved/inverted deliberately: `serviciosSinPrecio95.rev2.react.ts` (old assertion expected the legacy priced format), `ajusteRedondeoDocumento120.react.ts` (old assertion: «only case where the row stays visible»), `filasResumen94.test.ts` (old: «kept as a row»).

## Unresolved owner decision — rounding presentation (NOT approved)
3 adults, total USD 1,432.00: the document prints the per-adult tariff at calculation precision (USD 477.33) with the exact row total USD 1,432.00; 3 × 477.33 = USD 1,431.99, one cent short of the printed total. That discrepancy exists whenever the tariff is not a whole number of cents; #94/#52 behave similarly, but that is NOT treated as approval. Options for the owner: (a) keep printing the per-adult tariff at calculation precision; (b) print only the row total and the total (no per-adult tariff on rows that do not divide exactly); (c) round the tariff and show the cent elsewhere (rejected so far: it reintroduces an adjustment row). No new rule was invented here.
