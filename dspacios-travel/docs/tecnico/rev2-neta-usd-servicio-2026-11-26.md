# NETA · USD service added after the contract exists (migration 349) — 2026-11-26

Worktree `dspacios-travel/.worktrees/revision-consolidada`. Applied **only on disposable clones** (`ttc_*`, `cons_cadena_*`, all dropped). `rev_consolidada`, its storage and the app on 3090 were not touched. No staging, commit, push, remote SQL, mail or deployment. Follows `rev2-neta-2026-11-26.md` (migration 348); this closes the point left open there (§4.2).

## 1. Defect (reproduced first)

Adding a USD service to a PENDING contract through the real editor (`ServiciosContratoEditor` → `actualizarServiciosContrato` → RPC `pendiente_aplicar_servicios` → `prevista_cxp_aplicar`):

| What | Observed before the fix |
|---|---|
| Currency | The new previsto got `moneda = ventas.moneda` (USD) — correct — but **no cost-TRM pair** (`trm_costo`, `valor_cop_costo`). |
| Workflow | 348 only edits previstas that already carry the pair, so the row was «TRM de costos pendiente» with **nowhere to set the TRM**. |
| Confirmation | The CxP was born in USD without an equivalent while the other USD obligations of the same contract had one (mixed accrual). |
| Editor display | The service prices in the editor were printed with `formatCOP` («$ 150») even in a USD contract — USD shown as pesos (NETA-05 rule). |
| Currency guard | The action never compared the service currency with the contract currency (the previsto always takes the contract currency, so a COP service added to a USD contract would have been stored as USD). |

Reproduction: `pruebas/trmCostoServicioUsd349.pg.ts` run **without** 349 applied: 8 of 10 tests fail (T9/T10 do not depend on the migration).

## 2. What changed

**Migration `20260601000349_trm_costo_servicio_usd_agregado.sql`** (additive; `begin…commit`; guarded by md5 of the 348 function bodies so it refuses to replace anything else or to run twice; does not touch `cuentas_por_pagar`, trigger `trg_cxp_costo_inmutable`/Z9610, or any existing row):
1. `prevista_cxp_aplicar` — on INSERT of a USD previsto without a pair it **inherits** the pair only when the contract's pending USD previstas that carry a pair share **one single TRM** (`valor_cop_costo = round(round(valor,2) × TRM, 2)`, what the 236 CHECK requires). No pair in the contract, or several different TRMs → nothing is invented; the row stays «TRM de costos pendiente». #63 contracts and COP rows are unchanged.
2. `prevista_trm_costo_actualizar` — with `p_trm_esperada = NULL` it **sets the initial TRM** of USD previstas without a pair whose key is `cxp:ed:…` (those born from the service editor). Every other pair-less previsto (other routes, historical) is still not editable (348 T10 preserved). With `p_trm_esperada` informed the behaviour is identical to 348 (compare-and-set). Same actor/tenant/pending-only/positive-finite-TRM validations.
3. `contrato_trm_costo_historial.trm_anterior / valor_cop_anterior` become nullable (an initial TRM has no previous value; none is invented).

Scripts: `supabase/scripts/preflight_349_trm_costo_servicio_usd.sql`, `postcheck_349_…`, `rollback_349_…` (each check is ONE integral read-only query returning control / observed / expected / verdict; rollback restores the exact 348 definitions and refuses if initial-TRM history rows exist). Verified on a clone: preflight 4 OK + 3 INFO → apply → postcheck 4 OK + 3 INFO → re-apply refuses → rollback → preflight OK. Combined chain `cadena_rev2.sh pgrevc rev_consolidada_base <clone>` now runs 344→349 (preflight 349: 7 controls, postcheck 349: 7 controls, all OK); `aplicar_rev2.sh` covers 349 too. **Order for the owner:** …348 → preflight 349 → 349 → postcheck 349 (compare INFO rows with the preflight: untouched CxP counts).

**Code**
- `app/(dashboard)/dashboard/contratos/actions.ts` (`actualizarServiciosContrato`): reads `ventas.moneda` and rejects, before computing or writing anything, a service whose currency differs from the contract's («… no se mezclan monedas. No se cambió nada.»).
- `ServiciosContratoEditor.tsx` + `page.tsx`: new `moneda` prop; prices and total are rendered with `formatMoneda` («USD $150.00»-style), no longer as pesos.
- `trm-costo-actions.ts`: `trmEsperada` may be `null` (initial TRM) and is passed as `p_trm_esperada = null` (never `Number(null)=0`).
- `TrmCostoEditor.tsx`: `trmActual: number | null`; empty input and «TRM de costos fijada en $… (provisional…)» message for the initial case.
- `ObligacionesPrevistasPanel.tsx`: a USD row without TRM whose key starts with `cxp:ed:` shows «Fijar TRM de costos» (only for roles that can edit; rows of other routes and COP rows show no editor).

## 3. Evidence (all on disposable clones)

| Check | Command | Result |
|---|---|---|
| New real-DB file (real actions → PostgREST → Postgres; only sale prices of services and the session are simulated; the COST is liquidated by the real `liquidarCostoTour` from seeded service vigencias) | `sh supabase/scripts/test_349_trm_costo_servicio_usd.sh <ttc_name> pgrevc rev2_plantilla_347` | **10/10 pass** |
| Mutation control: same file with the 349 migration not applied | modified copy of the runner (deleted) | **8 fail / 2 pass** (T9, T10 are action-side) |
| 348 file on a template that already has 348 + 349 | `sh supabase/scripts/test_348_trm_costo_provisional.sh ttc_t348r pgrevc <tpl 347+348+349>` | **12/12 pass** (no regression) |
| React panel (new «Fijar TRM» + role cases) | `…reactLoader.mjs --test pruebas/panelesCostoUsd348.rev2.react.ts` | **10/10 pass** (8 old + 2 new) |
| Editor with `moneda` prop, wiring | `pruebas/seleccionMasiva50.react.ts`, `serviciosPaqueteWiring`, `obligacionesAlConfirmar288`, `clasificacionServicios51`, `costoProvisional348` | 8/8 and 76/76 pass |
| Chain | `cadena_rev2.sh pgrevc rev_consolidada_base cons_cadena_t349` | 344→349 all controls OK |

What each test proves (hand-computed amounts, 2 pax: air USD 100×2 = 200, hotel 200 at TRM 3.900; tour USD 50×2 = 100; assistance USD 20×2 = 40):
- **T1** add tour via the real action → previsto `receptivo | USD | 100 | trm 3900 | cop 390000`; `costo_receptivo` = 100 (USD), `precio_venta` +150; hotel/air previstas hash identical; other contracts' hash identical; no CxP yet; all rows USD; Σ valor 500, Σ equivalent 1.950.000 (= 500 × 3.900).
- **T2** reload + correct TRM 3.900 → 4.100: three previstas change, USD values unchanged, equivalent = USD × 4.100 (tour 410.000), 3 history rows, `ventas` row hash and other contracts unchanged, a stale expected TRM is rejected.
- **T3** edit services again: the new assistance inherits 4.100 (164.000), the existing tour keeps its key/TRM, removing the tour deletes only its previsto, hotel/air untouched.
- **T4** confirm: three CxP born in USD with TRM 4.100 and equivalent = USD × 4.100 (the 236 CHECK does not reject), Σ USD 440 and Σ equivalent 1.804.000 (currencies never summed together), accrual entry 164.000 for the assistance; afterwards the action refuses and `update … set trm_costo` raises the Z9610 immutability error; CxP unchanged.
- **T5** contract without pairs (other route): the new service is USD «TRM pendiente» (nothing invented); the pair-mode correction is refused; the initial TRM is accepted only for that service (history row with `trm_anterior` NULL); historical rows stay without a pair (hash identical); a second initial call is refused; on confirmation only the new CxP has an equivalent (395.000 at 3.950), the historical ones stay as before.
- **T6** two different TRMs (3.900 / 4.000): the service does not pick one, is fixed explicitly (4.100); the 3.900/4.000 rows are untouched; confirmation works.
- **T7** rejections of the initial TRM: `0`, `-5`, `abc`, empty, `1e11`; role `venta`; administración of another agency; historical pair-less previsto; confirmed contract; row that already inherited a TRM — nothing changes (previstas JSON and history count identical).
- **T8** two simultaneous initial settings → exactly one wins, one history row.
- **T9** COP contract: the new service is COP without any pair, no TRM can be set, CxP stays COP.
- **T10** COP service in a USD contract and USD service in a COP contract are rejected before any write (previstas + `ventas` hash identical).

Note on setup: contracts created by the cart conversion carry no `paquete_armado_id`, so the editor does not apply to them in the real app; the test links the contract to its package with one `update` (as a Reservar contract is) and says so in a comment. A real Reservar USD contract was **not** built in this test (it would need the whole tarifario/price engine).

## 4. Rehearsal step
`supabase/scripts/revision_consolidada/pasos/60_88_neta.mjs`: new **NETA-06c** (after NETA-06b): creates another USD contract through the UI, then — **only on the rehearsal copy** — links it to its package and creates one optional USD service («Tour USD Rev349», neta 50) so the editor box appears; checks the USD labels, saving the service, the inherited provisional equivalent (390.000), the TRM correction to 4.100 (410.000), the CxP born after confirmation and that other contracts' CxP did not change. `node --check` OK; `generar_guia.mjs` loads 117 steps. **The step was NOT executed against a compiled app** (no build/rehearsal in this task); selectors and the real price engine for the seeded service are unverified and must be confirmed in the rehearsal.

## 5. Limits and owner decisions
- **Mixed accrual remains possible by design:** when the contract has no TRM to inherit (pair-less historical USD obligations) and the person fixes the TRM only for the added service, the other USD obligations still accrue at nominal USD on confirmation. Giving those a TRM would change historical accrual and was not done. Decision: allow it, require a TRM for all USD obligations before confirming, or give them a TRM on request.
- A service added with no TRM available can be confirmed without one (the pre-existing behaviour for USD obligations of other routes); no confirmation block was added.
- The service currency check uses `servicios_adicionales.moneda`; the editor box lists the package's services regardless of currency (the guard rejects at save, with a message).
- Post-confirmation TRM correction still needs a reversal + FX-difference design (#43), unchanged from 348.
- `contratoNetoB2B.test.ts` has 1 failing wiring test («ContratoDocumento calcula total/saldo NETO…») that pins the literal line `const mostrarDesglose = mostrarValoresItems || valoresDoc !== null`, which the customer-document change in another area rewrote; not caused by this area (needs updating by the owner of that change).
- `tsc`/build were not run (memory-constrained; no heavy commands beyond the targeted tests); changed TS types: `trmEsperada: number | null`, `trmActual: number | null`, `moneda?: string | null`.
- Resources (local only): no polling/timers/retries added; the guard adds one `servicios_adicionales` read per service save; the initial-TRM RPC is one `ventas FOR UPDATE` + one pass over the contract's previstas. Hosted Vercel/Supabase costs not measured.
