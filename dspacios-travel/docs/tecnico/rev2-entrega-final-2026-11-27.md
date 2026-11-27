# Consolidated owner-review — final verification hand-off (2026-11-27)

Status: **ready for Codex audit. NOT accepted by the owner, NOT audit-closed.** No staging, commit, push, remote SQL, live mail or deployment was done. The owner's review database, files, accounts and progress were not touched.

## 1. Exact final source under test
- Final build: `nlM_PWhr2xm4wxi_tCJHS` (`construir.cjs`, heavy-command mutex). No file under `app/`, `lib/`, `components/` is newer than this build's `BUILD_ID`.
- `tsc --noEmit`: no TypeScript errors (output only Node/npm notices: `C:/tmp/consolidada/rev2/tsc_final2.txt`).
- Earlier builds are archived under `C:/tmp/consolidada/next_<BUILD_ID>` (`p5wPiEq…`, `umd_uU0BWajzGtK4rPA7E`, `6OnUPtH3gfKENnLeQmnYV`). The build before this one did not contain the two form fixes below.

## 2. Product code changed in this last pass (two real defects found by the walkthrough)
Both are in `app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx` (manual contract form):
1. **Destination change left the old city.** Removing a hotel that no longer belongs to the chosen destination cleared name/category/meal plan/provider but kept the pre-filled city («Bogotá» next to a Cartagena hotel). The city is now cleared too. Test: `pruebas/contratoManualF6.rev2.react.ts` (assertion added to «cambiar el destino quita el hotel…»). Failure-path control: reverting the fix makes that test fail; restoring it passes.
2. **Room counters ignored the hotel's configuration.** The guide and `rev2-f95forms-guia` say «solo los tipos que ese hotel ofrece», but all four counters (Sencilla/Doble/Triple/Múltiple) were always shown. With a catalog hotel that has configured accommodations, only those are shown (a type already typed is never hidden); without a catalog hotel or configuration, all four. New test «B95-13/20: un hotel del catálogo con acomodaciones configuradas ofrece SOLO esos contadores…» with failure-path control (filter disabled → test fails).

## 3. Walkthrough on a fresh disposable clone
- Clone: `rev_consolidada_ensayo` recreated from `rev_consolidada_foto`; migrations 344→349 each with its single-query preflight and postcheck (all OK: 8, 19, 5, 5, 7, 7 checks) and the ten synthetic seeds (`semillas/rev2/*.sql`).
- Result: **117 steps, 1617/1617 checks OK** (`C:/tmp/consolidada/rev2/ensayo_final3.log`, `informe.json`). Lowest free memory recorded at a step boundary: 3,901 MB.
- Included and passing: S339-11 (reject a payment support), H103-03 (exclusion calendar), B95-12 (duplicate a packaged flight), B95-13 (manual contract: destination → hotels, city cleared on destination change, room counters per hotel), B95-16c (**anonymous visitor with a child** in the Tarifario comparative: no «máximo 0 niño(s)» error, exact totals 1,020,000 and 1,080,000, no net/supplier data in the shared quotation), NETA-06c (**USD service added after the contract exists**: born in USD with the contract's provisional cost TRM 3,900, corrected to 4,100, then confirmed: payable USD 100 = COP 410,000 at the frozen TRM 4,100, other contracts' payables unchanged).
- Earlier run (`ensayo_final.log`) had failures that were classified, not hidden. Step/assertion defects (fixed): B95-02 (text window and upper-case «TOTAL DEL CONTRATO»), B3-02/B3-02b (button accessible name is «Marcar como revisado: …», chip text is upper-cased by CSS), B3-06, B1-01 (collapsed `<details>` content still has client rects), B2-12/B2-12a (the public form stores type «CC» by default, so the holder card reads «CC 77100001»), H88-07 (the card is only painted after destination/dates; the hotel data is checked in the server-delivered page), B95-18b (cart conversion has its own screen: collection currency, second passenger, button «Generar contrato(s)»; the document row is «Paquete Turístico … 2 0 $ 520.000 $ 0 $ 1.040.000»), NETA-06c (administration has no advisers in the reservation form — pre-existing, see INT-04 — so «venta» creates the contract; adding the service to a package invalidates its tariff by design, so the setup follows the real order and simulates the republish), S339-11 (the «Rechazados» drawer is already open right after rejecting; the panel refreshes after the message), H103-03 (a hidden mobile-menu `role=dialog` exists in the DOM; checks now look at visible dialogs only). Product defects (fixed): the two in §2.
- **Deadline expectations are derived, not fixed.** B3-02 and B3-06 compute the expected number of alerts/validities from the seeded fixture dates and the business date (`public.fecha_negocio()`, window today…today+5). On the foto seeded 2026-11-25, «Villa de Leyva» (purchase end = seed day) expired by 2026-11-27, so the fixed «9» became 8 and «6» became 5; the steps no longer accept «≥ N». B3-02b re-aligns the dinámico-total fixture to «business date + 1» (clone only) so the revision flow has an alert to review. The guide text for those steps now says the number depends on the day.

## 4. Compiled screens and print layout of the customer document (1280 / 768 / true 390 px)
`supabase/scripts/revision_consolidada/visual_documentos.mjs` (clone only): creates five synthetic contracts that force the **fallback** conditions and a contrast, opens `/contrato/<n>` in Edge at 1280, 768 and 390 px, screenshots, measures horizontal overflow, applies the unconditional rules, and prints a PDF per case. Output: `C:/tmp/consolidada/rev2/visual_docs/` (PNGs, PDFs, `informe.json`). **79/79 checks OK.**

| Case | Fixture | Observed in the compiled document |
|---|---|---|
| F1 DTM-9911 | adjustment with children only (no adult row can receive it) | no adjustment row; people counts and the stored total COP 200,005; no tariff/value columns |
| F2 DTM-9912 | fractional cents between rows | no adjustment row; total 280,000 kept; no invented allocation |
| F3 DTM-9913 | service present, adjustment cannot be allocated | service described in «Servicios incluidos» with no price; no «Servicios adicionales» priced table; total 276,005 |
| F4 DTM-9914 | contrast: adjustment absorbable (2 adults) | adjustment absorbed (tariff $715,227.50, row total $1,430,455); no adjustment row; value columns kept |
| F5 DTM-9915 | 3 adults × USD 477.33 + 1 cent = USD 1,432 | prints USD $477.33 per adult and a row/total of USD $1,432: **3 × 477.33 = 1,431.99 ≠ 1,432.00 — owner decision still pending, not approved** |

- No page-level horizontal overflow at 1280, 768 or 390. I looked at the 390 px capture of F1, the 1280 px capture of F5, the 768 px capture of F4 and the print-media A4 layout of F3.
- **Finding (pre-existing design, not changed):** at 390 px the «Valores y Pagos» item table (min width 520 px, shown in a 318 px scroll container) needs an inner horizontal scroll, including the 3-column fallback table; the totals are readable in the cards above it. The passenger (560 px) and payment-condition (520 px) tables behave the same. Lowering the minimum width for the fallback table is a small possible follow-up; it was not done to avoid another rebuild after the walkthrough.
- **Limits:** the PDF viewer rendering tool was unavailable (no `pdftoppm`), so PDFs were checked by generation (4 A4 pages each) and by looking at the print-media render of the same page, not by opening the PDF files page by page. The legacy per-passenger summary fallback (unidentified passengers) and NETO total-that-does-not-reconcile cases are covered by rendered React tests (`documentoFallbacks95.rev2.react.ts`), not by a browser PDF, because they need stored summary/NETO data that the clone does not carry. Non-integer item quantities cannot be stored (integer column), so that fallback is only reachable in memory.

## 5. Other verification on the final source
- Tests touching the changed form, run with the official flags: unit 138/138 pass; React 20/20 pass (includes the new test). The earlier full unit and React batches (before these two last edits) classified every failing name against the clean baselines (28 identical unit names; React: baseline set only, one baseline failure now passes) — not re-run end to end after the last two edits.
- Resources (local only; **hosted behavior unmeasured**): the dashboard adds one RPC (`alertas_compra_listar`) per load for internal users and no polling; «Revisado» is one RPC per click; the new cost-TRM actions run only on user action. Rehearsal databases are ~33 MB; rehearsal free-memory floor 3.9 GB at step boundaries; builds ran under the heavy-command mutex (3 GB heap cap). Nothing here replaces the Vercel consumption validation (`VALIDACION_CONSUMO_VERCEL.md`) after deployment.
- Guide regenerated from the verified steps: `docs/tecnico/revision-consolidada-guia-ronda2-2026-11-27.md` (117 steps) and the owner's local `GUIA_REVISION.md` (the previous copy is kept as `GUIA_REVISION.previo-20261127.md`).

## 6. State of the environment
- Owner's database `rev_consolidada`: untouched (backup `respaldos/rev_consolidada_2026112704543.dump` + storage copy and `C:/tmp/consolidada/rev2/inv_owner_pre.json` taken beforehand).
- The owner's review stack is **stopped**; the rehearsal stack currently serves the clone on the same ports (3090) with the final build. I did not restore an older build, restart the owner stack, or apply migrations/seeds to the owner database. Restoring the owner stack serves the new build, and applying 344–349 + seeds to the owner database must follow the audit gate (`backup` → `aplicar_rev2.sh pgrevc rev_consolidada` → `inventario_integridad.mjs comparar …`).
- My own scratch databases (`rev2_prueba_*`, `cons_cadena_rev2`, `rev2_plantilla_*`) and the temporary worktree `wt_head` were removed. Earlier rounds' rehearsal copies were left in place as evidence.
- Seeds change six owner rows when applied to the owner database (notices 1–4 archived, hotel 12001 blanks filled, block 91203 +2 seats): disclose before applying.

## 7. Migration order for the owner's SQL editor (unchanged)
Each: preflight → apply → postcheck, one integral query each. 346 before deploying the code; 347 requires 333 and 346; 349 is additive. Never edit an existing migration.

## 8. Policy decisions still open (not decided here)
1. Rounding presentation (case F5 above): print the per-adult tariff at calculation precision (current) vs only row totals vs another rule.
2. «Revisado» per person (current) vs shared across the team.
3. Validity coverage: what counts as a purchase-deadline alert (promotions, hotel/service validities).
4. Date-set creation behavior (H103-04: copy nights into the validity vs create a validity named after the set).
5. Passenger-to-flight assignment (B1-05): not modeled; no assignment invented.
6. Per-agency e-mail templates (H103-13): not built.
7. Hotel-total («Bernalo») rows with a service now show no per-row amounts; the owner may prefer folding services into the hotel total.
8. Cost TRM: mixed USD accrual when there is no TRM to inherit; confirm without a TRM; correcting the TRM after confirmation (#43).
9. Administration cannot pick an adviser in the reservation form (pre-existing, INT-04).
10. Explained but not accepted: H88-02/03, B95-01. Deferred to the owner's production (never local passes): B2-05, H103-05…H103-10, the real Hostinger mailbox.
