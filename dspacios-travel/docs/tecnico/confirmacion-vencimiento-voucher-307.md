# #53 · Configurable confirmation minimum, expiration and ally vouchers (migration 307)

Owner rules (2026-11-15) and their implementation. **Local only, unpublished.** Not touched: commission cycle #97 (OFF in production), the consecutive-number reuse switch, `confirmar_venta`, obligation materialization, payables, commissions, accounting. Applied migrations are never edited; the 307 is not applied remotely.

Revised after the Codex audit (`codex-review-307-2026-11-14.md`): findings F1–F5 are fixed in this version (section 6).

## 1. What changes

| # | Rule | Implementation |
|---|---|---|
| 1 | NETO and PVP resolve the confirmation conditions the same way. The minimum is configurable (30 %, another percentage or amount, 100 % when the hotel requires it). Superadmin changes conditions and limits. Audit trail intact. No mandatory justification workflow. | `p75_priv.regla_confirmacion` (from 288) **without the NETO branch**. Precedence: **agreement** (`contrato_minimo_acuerdo`, insert-only, audited) → **frozen condition** (a hotel that requires 100 % already arrives that way) → **`config_cobros` %** (30 % default; same policy for NETO and PVP). `fijar_minimo_confirmacion`: superadmin only, pending contracts only, optional note, does not confirm by itself, **verifies the contract identity** (see F1). TS mirror: `lib/contrato/reglaConfirmacion.ts`. UI: `MinimoConfirmacionPanel` on the contract page (all internal roles see the current minimum; only superadmin edits). |
| 2 | Automatic expiration **never** cancels a contract with any recorded payment (even below the minimum). Unpaid contracts behave as before. No historical batches. | `liberar_vencidas` (from 285, same signature) locks candidates by state and deadline, **then** (fresh snapshot, rows locked) discards those with an `abonos` row where `valor_abono > 0` or `monto_cop > 0`. It also returns `conservadas_con_pago`. It never confirms, cancels or rewrites anything else. |
| 3 | Vouchers are prepared internally; an ally opens them **only with the contract 100 % paid**, no early-release exception (not even superadmin); portal, direct link and metadata; a later balance increase blocks again without deleting. | `contratos_pagados_completos` (SQL, `service_role` only): authoritative collection total and currency, rounding tolerance 0.5 COP / 0.01 USD (same as `estado_minimo`), a cancelled contract never counts. Evaluated on **every** open. `lib/voucher/accesoVoucher.ts` (pure policy) + `accesoVoucher.server.ts` (real dependencies). `app/voucher/[token]` and its `generateMetadata` share one cached resolution; the portal filters server-side and, if payment cannot be verified, links nothing (fail closed). Internal generation no longer requires 100 % and has no superadmin special case. |

## 2. Who opens a voucher by token

| Who | Condition | Result |
|---|---|---|
| No session | — | `/login` (proxy); a "not found" screen if it ever reaches the page |
| Internal (`superadmin/gerencia/administracion/operaciones/venta`) | session RLS on `vouchers` lets them read the row (agency; `venta` only own contract) | preview at any time |
| Ally owner (`agencia/freelance/cliente_final`) | `accesoDocumentoContrato` recognizes the owner **and** the contract is 100 % paid | opens |
| Ally owner | balance above tolerance, cancelled contract, or payment read error | "not found" screen with no data |
| Another ally, deactivated user, unexpected role | — | "not found" screen with no data |

The root `app/loading.tsx` makes every dynamic page that calls `notFound()` answer HTTP 200 with the "not found" screen (a nonexistent `/c/<token>` behaves the same). The screen carries a generic title, `noindex` and no data; tests assert on content, not on the status code.

## 3. Deployment order (when the owner authorizes it)
`preflight_307_*.sql` → migration `20260601000307_minimo_confirmacion_vencimiento_voucher.sql` → `postcheck_307_*.sql` → deploy the code. The 307 is compatible with the old code (it only changes the NETO rule, expiration and adds functions/table); the new code requires the 307. Rollback: `rollback_307_minimo_vencimiento_voucher.sql` (see section 5) after reverting the code. **No batch runs over existing contracts**: a pending NETO contract that already meets its condition is confirmed by its next payment or by "Reintentar confirmación".

## 4. Tests
- SQL (117 checks on a disposable copy, includes F1/F2 and the rollback round trip): `bash supabase/scripts/test_307_minimo_vencimiento_voucher.sh <container> <base>` (base with 281–306). `MIG_307=<file>` runs it against a mutated migration (negative control). Rule regression: `test_288c_regla_confirmacion.sh` (NETO cases updated).
- Unit: `pruebas/accesoVoucher307.test.ts`, `pruebas/reglaConfirmacion288.test.ts`, `pruebas/minimoAcordado307.test.ts` (F3, F4, F5).
- Real sessions, RLS and real actions: `pruebas/voucherAcceso307.pg.ts`, `pruebas/minimoAcuerdo307.pg.ts` (F1 and F5 with the real Server Actions) and `pruebas/portalB2B65.pg.ts`, run with `PG_REACT=1 sh supabase/scripts/test_pg_local.sh <container> <template> PG206|PG65 <file> <migrations 303–307>`.
- Visual review: `supabase/scripts/local53/local53.ps1` (derived from `local4360.ps1`; same isolation; no Storage), smoke scripts `humo_local53.mjs` and `humo_local53_acciones.mjs`.

## 5. Rollback
Restores the four redefined functions to their applied text (`regla_confirmacion` 288, `liberar_vencidas` 285, `estado_confirmacion_pago` 288, `dtm_reuso_bloqueos` 304 — checked by md5) and drops the new functions. If `contrato_minimo_acuerdo` has rows it is **kept**, still classified and guarded (history is never lost) and those contracts are again blocked for reuse while they have agreements; if it is empty it is dropped together with its classification. The reuse switch (`dtm_reuso_config`) is never touched.

## 6. Codex audit findings and their fixes

| Finding | Fix | Regression evidence |
|---|---|---|
| **F1** stale or missing identity could change a reused contract's minimum | `fijar_minimo_confirmacion` locks the sale, then calls `contrato_verificar_identidad(number, true)` **before any other decision**: stale/foreign UUID → F4601, reused number with no declaration → F4602. The live UUID is never copied into the caller's declaration. The new table is also covered by the strict identity guard (F2). | SQL section 9 (stale UUID, missing identity on a reused number, correct UUID, ordinary contract, vanished contract, direct insert) and `minimoAcuerdo307.pg.ts` with the real `fijarMinimoConfirmacion` action. |
| **F2** the new table blocked reuse and was unclassified | Classified `estricto` in `contrato_guardas_config` and guard installed (`contrato_instalar_guardas()` no longer aborts). `dtm_reuso_bloqueos` = the 304 body with this table added to the preparation list (md5 `752e9eee…`); the reuse switch is untouched. The insert-only trigger now allows only the number move done by `fn_renumerar_contrato` (same life/uuid); cascade delete still works and the audit trail keeps INSERT and DELETE rows. | SQL section 10: classification, guard installed, installer idempotent, no unclassified table, eligible contract stays eligible with agreements, payments still block, `eliminar_contrato(…, true)` with an agreement, pool entry, audit history, renumbering, md5/permissions. Negative control: 17 failures against a migration without the fixes. |
| **F3** collection currency vs frozen component currency | `resolverCondicionesContrato` uses the collection currency (`ctx.monedaContrato`) for agreements; each component keeps its frozen currency. | `minimoAcordado307.test.ts`: percentage, amount, total and cross-currency cases (USD 300 @ 4,000 frozen, COP 4,000,000 collection → COP 1,200,000). |
| **F4** agreement vanished from documents without condition rows | New `minimoAcordado` field, rendered by `ContratoDocumento` outside the conditions section (internal, public and print/PDF are the same component). No hotels or restrictions are invented. | Unit tests (no rows + agreement; no rows + none; no total) and compiled-app check on a synthetic contract with no frozen conditions. |
| **F5** failed lookup treated as "no agreement" | `cargarAcuerdoMinimo` returns `ausente` / `acuerdo` / `error`. On `error`, `generarPlanCobro` stops **before** computing, deleting or inserting installments, and documents show "no disponible en este momento" instead of a substituted minimum. | `minimoAcordado307.test.ts` plus `minimoAcuerdo307.pg.ts`: with the lookup forced to fail the existing plan is untouched; verified absence → 30 % plan; 80 % agreement → 80 % plan. |

## 7. Known limits
- Changing the minimum does not confirm by itself (no rewriting of existing contracts): the contract page offers "Reintentar confirmación".
- A pending contract with payments and a past deadline stays **pending indefinitely** holding its seats; there is no alert or review list (no new state was invented).
- An agreement amount is fixed in the contract's **collection** currency; if that currency later changes, the database requires the full total (fail closed).
- If the agreement lookup fails the document shows the component rows (frozen facts) but no minimum line; the page recovers on the next successful read.
- Deploying the code before the migration makes agreement reads fail closed (documents show "no disponible", installment plans are refused) until the 307 is applied: keep the order in section 3.

## 8. Local review examples (real application flow, synthetic data only)

The earlier fixtures DTM-5304/5305 were inserted directly and had no items or hotel (the document printed USD 0). They were **removed** and replaced by examples created through the real server actions (`supabase/scripts/local53/ejemplos_local53.ts`: `generarTarifario` → `crearCotizacion` → `convertirCotizacion`, `crearContrato`, `fijarMinimoConfirmacion`). No child row was patched by hand. Replaced in the local review database only: the owner's earlier review clicks, DTM-5304/5305 and the importer demo contract MIN-00-0901. The restore photo (`dspacios_local53_semilla`) was refreshed so `local53.ps1 restaurar` returns to this state.

| Example | Link (internal) | Public link | Expected figures |
|---|---|---|---|
| 1. COP contract, hotel + travelers + package item | `/contrato/DTM-0001`, file `/dashboard/contratos/DTM-0001` | `/c/9a160766-034d-49f9-bc71-210c7347be9b` | Item "1 hab Doble (2 pax)", total COP 1.200.000, frozen hotel condition shown as the confirmation minimum |
| 2. USD offer collected in COP (**open quote, owner converts**) | `/dashboard/cotizaciones/2` | — | Offer USD 1,000; hotel condition USD 300 (30 %) |
| 3. Manual contract, no frozen supplier conditions | `/contrato/DTM-0003`, file `/dashboard/contratos/DTM-0003` | `/c/87858ffd-0e82-43bf-993b-2e47af27406c` | Item "Paquete Cartagena 4 días / 3 noches, 2 adultos", total COP 2.500.000, "Pago mínimo para confirmar: $500.000 COP (mínimo acordado)" (20 % agreement), no "Condiciones de pago" section |

Synthetic logins (password `Local53!`): `superadmin@local53.test`, `administracion@local53.test`, `operaciones@local53.test`, `venta@local53.test`, `aliado@local53.test`, `aliado2@local53.test`. App: `http://127.0.0.1:3054`.

### Owner step for example 2 (the TRM is entered by the owner, never seeded)
1. Log in as `superadmin@local53.test`, open `/dashboard/cotizaciones/2` (status "abierta", USD 1,000).
2. Fields are empty on purpose. Enter a **TRM provisional** (cost side, any value, e.g. 4000), choose **Moneda de cobro = COP (convertir al contratar)** and type the collection TRM **4000**: the preview must read COP 4.000.000. Change it to **4100**: COP 4.100.000. Confirm with "Confirmar → generar contrato".
3. The contract and both documents must show `Total a cobrar` = the frozen total (4.000.000 or 4.100.000) and the offer total `USD $1,000`. Before an agreement the minimum shows the frozen hotel condition (USD $300).
4. As superadmin set a 30 % agreement on the ficha: minimum **COP 1.200.000** (TRM 4000) or **COP 1.230.000** (TRM 4100). A payment of that amount confirms the contract; paid/balance follow the frozen total (4.100.000 → paid 1.230.000, balance 2.870.000).
5. To redo the step: `local53.ps1 restaurar` (quote 2 is open again).

Rehearsed with the real actions (`ensayo_conversion_local53.ts`, local only, then restored): TRM 4000 → `total_cobro` 4.000.000, agreement 1.200.000; TRM 4100 → `total_cobro` 4.100.000, agreement 1.230.000, payment 1.230.000 confirmed, balance 2.870.000; `moneda_cobro`/`trm_cobro`/`total_cobro` frozen in `ventas`.

### Findings about the flows
- **Price without items (defect, reproduced and fixed):** the real manual flow cannot create it (the margin check rejects a PVP of 0), but the supported Minorista historical importer stores `precio_venta`, payments and payables with **no** `contrato_items`; the document total is the sum of items, so it printed "Total $0 / Saldo $0". Fix (`lib/contrato/presentacionValores.ts`, `ContratoDocumento.tsx`): only when there are **zero** item rows and a registered price, the total is that price and the document states "Este contrato no tiene detalle de ítems (registro histórico)". No breakdown is invented; with any item row, or NETO, nothing changes. Tests: `contratoNetoB2B.test.ts`, `contratoSinItems53.react.ts`. Historical records were not modified.
- **#63 offer only on dynamic packages:** to get a USD 1,000 hotel offer a dynamic package with a zero-value departure was used; the hotel component is then USD 1,000 and its default 30 % frozen condition is USD 300.
- **Extra "TRM provisional" field:** the conversion form requires the cost-side TRM in addition to the collection currency and TRM.
- **Manual USD quotations do not offer a collection-currency step** (`permiteMonedaCobro` exists only for #63 offers).
- DTM-0002 is a numbering gap left by the removed fixtures; the synthetic data is unaffected.
