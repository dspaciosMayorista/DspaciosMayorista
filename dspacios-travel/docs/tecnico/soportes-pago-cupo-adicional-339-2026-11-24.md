# B2B payment supports: one extra support per contract (migration 339)

Date: 2026-11-24. Worktree `dspacios-travel/.worktrees/soportes-cupo-extra`, branch `claude/soportes-pago-cupo-adicional`, base `origin/main` `cd9bb1946`. Nothing staged, committed, pushed or deployed; no remote SQL, no live mail. Only my own disposable container `pgsoporte339` was used (databases, roles, PostgREST containers and networks created per run were dropped by the runners). Other worktrees, containers, processes and owner data were not touched. CRM not started.

## 1. Owner rule and what changed

Active supports of a contract: `<= registered payments` → **`<= registered payments + 1`** (0 payments: 1 support; 1 payment: 2; …). When the extra slot is taken, another upload is rejected until a payment is registered or an active support is withdrawn. Uploading evidence never creates/approves a payment, never changes the balance and never confirms a contract. The extra slot belongs to the **contract**: no support↔payment link exists or is assumed.

| Layer | Change |
|---|---|
| Database (authority) | **Migration `20260601000339_soportes_pago_cupo_adicional.sql`** replaces only `f281_soportes_insert()` (the BEFORE INSERT trigger function; same owner/permissions/trigger). Same error code `F4515` / `SOPORTE_LIMITE`; new text states the maximum (`abonos + 1`). Applies only on the exact 281 definition (md5 guard; re-applying is harmless; an altered function aborts the migration). `soporte_registrar/reemplazar/retirar`, `avisos`, `abonos`, `ventas`, quotation evidence (migration 325, cap 5) are untouched. |
| Server precheck | `lib/soportes/archivo.ts`: `SOPORTES_ADICIONALES = 1`, `maximoSoportes(abonos)`, `cabeUnoNuevo`, `estaExcedido` (excess = more than the maximum). `subirSoporte` precheck uses it unchanged; new `SOPORTE_LIMITE` message in `lib/soportes/operaciones.ts`. |
| Portal UI | `components/portal/SoportesPago.tsx`: «Soportes vigentes: N de M permitidos (X pagos registrados + 1 adicional)», hints for the open extra slot and for «all slots used», new excess wording. `app/portal/b2b/cartera/page.tsx` no longer hides contracts without payments (they now admit 1 support); all the ally's own contracts are listed (same queries, no filter by state — the database does not restrict by state either). |
| Internal UI | `SoportesPagoInterno.tsx`: «Vigentes N de M permitidos (X abonos + 1 adicional)»; amber warning only above the maximum; neutral note when supports exceed payments but are within the maximum («revisa los soportes y registra el abono que corresponda; no se sabe a cuál abono pertenece cada soporte»). |
| Scripts | `preflight_339_…sql`, `postcheck_339_…sql` (one integral read-only query each: control · observed · expected · status · verdict), `rollback_339_…sql` (restores the exact 281 body, refuses if the function is no longer the 339 version, never deletes/retires a support and reports how many contracts end up over the old limit). |

Migration number: 339 is the next free one after checking every branch/remote ref and every worktree under `.worktrees` and `C:/tmp` (327–338 are reserved by other branches: 327 conjuntos_fechas … 338 voucher_vuelo_por_servicio).

## 2. Acceptance matrix (independent expectations; real database, real actions)

| Requirement | Evidence | Result |
|---|---|---|
| First support with 0 payments | `soportesCupoAdicional339.pg.ts` (real `subirSoporte`): 1st OK, 2nd rejected **before any upload** (precheck), and with the precheck disabled the **database** rejects it and the new object is cleaned | pass |
| Extra slot when payment slots are full | 1 payment → 2 supports OK, 3rd rejected; 2 payments → 3 OK, 4th rejected (also with precheck disabled); direct SQL INSERT by a superuser hits the same limit (`máximo es abonos + 1 = 3`) | pass |
| Rejection above the limit | all of the above + compiled UI (forced file in the hidden input of a full card → visible limit message, database unchanged) | pass |
| Concurrent uploads for the last slot | 4 rounds × 3 simultaneous uploads with 1 payment + 1 support (1 slot left) and 4 rounds × 3 with 0 payments (1 slot): **exactly one winner every round**, never more than payments+1, no orphan objects from the losers | pass |
| Registering a payment opens the next slot | real `registrarAbono` as gerencia (contract stays confirmed): full 2/2 → payment registered by the team → 3rd support accepted → full again at 3/2+1 | pass |
| Uploads do not change finances | fingerprint of the contract row, payments, CxP, anticipated obligations, B2B commissions, ledger entry/line counts, seats and balance identical after upload, rejected upload, replace and withdraw; pending contract stays **pendiente**; no payment row created. Same check on the compiled app (venta/estado/abonos/asientos fingerprint equal after real UI uploads on 8301 and 8303) | pass |
| Existing notifications | gerencia, superadmin and the unambiguous advisor receive `soporte_pago_nuevo` for the extra-slot support; rejected uploads create none; `sondearAvisos(true)` claims it with the contract link and no client/file data; replace emits `soporte_pago_reemplazado`; other agency, other advisor, the actor and unrelated allies get none | pass |
| Unauthorized access | no session, another ally, commission-only participant, inactive account, ally of another agency, gerencia, superadmin and advisor cannot upload to a contract they do not own (0 payments = free slot, still denied; 0 objects reach Storage); an authenticated JWT cannot call `soporte_registrar` nor INSERT through the API | pass |
| Replacement, withdrawal, duplicates, ownership, tenant, reused/renumbered contracts | the full historical real-action suite `soportesPago281.pg.ts` (36 tests) on a 001–326 + 339 base | 36/36 after updating the 9 expectations that encoded the old limit |
| Detects the broken behaviour | same new suite on a base **without** 339: 13 of 14 fail (the 14th, API authorization, does not depend on the limit) | pass (control) |
| Migration lifecycle | preflight APLICABLE → 339 → postcheck CORRECTA → re-apply (idempotent) → rollback (restores md5 `b0ca477d…`) → postcheck REVISAR / preflight APLICABLE → second rollback refused → hand-altered function: migration and rollback both refuse | pass |

### Historical suite expectations that changed (limit only)
`soportesPago281.pg.ts`: DTM-8101 now fills to 4 (3 payments + 1) and the 5th is rejected; DTM-8102 fills its extra slot before the injected-failure cases; reemplazar/retirar/excedido counts +1 (excess = above payments+1); DTM-8104 fills its 4th before the definitive-rejection case; B (reused number) uploads 2 and the 3rd is rejected; the renumbering scenario has 3 supports (2 payments + 1) and counts +1. `soportes86.test.ts`: hand-written table (vigentes, pagos → cabe/excedido) and new message regex. `test_281_acciones.sh` skips 281/284/285 when the template already has them and applies 339 (`PG281A_SIN_339=1` keeps the old rule). `test_281_soportes.sh` (SQL suite of 281 in isolation, template 001–280) was left as the historical suite of the original rule and carries a header note; it was **not run** (no 001–280 template was built).

## 3. Rendered / compiled-page evidence

Production build of this worktree (`next start`, **BUILD_ID `vzjltR-QtYjToJEKEVRcz`**; no compiled source changed after it — checked with `find … -newer .next/BUILD_ID`), real sessions (ally, other ally, gerencia, superadmin, no session), disposable PostgREST database, Storage in memory, Edge over CDP with **real device emulation** (390 px mobile viewport, `mobile: true`), 1280 / 820 / 390 px. 82 checks, 0 failures (`lanzador_visual_final.log`, `mediciones_soportes339.json`, screenshots in `evidence-soportes-339/visual/`; I opened the 1280 and 390 portal captures and the 820/390 internal captures).

- Portal `/portal/b2b/cartera?vista=soportes`, ally with 6 contracts: 0 payments/0 supports (button enabled, hint), 0/1 (full), 1 payment/1 support (extra slot open, hint «este es el soporte adicional»), 1/2 (full), excess 4 of 3 (amber warning, replace/withdraw still offered), 3 of 3 (full). A long client name and a 90-character file name truncate with an ellipsis; no horizontal overflow, nothing outside the viewport, no clipped text at any width.
- **Real upload through the UI** (file chosen in the card's input → compiled Server Action → Storage → RPC): contract without payments goes to «1 de 1 permitidos» with «Soporte subido.» and a disabled button; contract with 1 payment accepts the extra support (2 of 2). A second file forced into the hidden input shows the limit message and changes nothing in the database.
- Internal contract page (superadmin and gerencia): panels for 1 of 1 (0 abonos), 2 of 2 (info note), 4 of 3 (amber excess only).
- Another ally sees only their own contract (0 payments: slot available); no session shows the login prompt and no contracts.
- Harness hygiene: the first attempts failed for harness reasons and were not accepted as evidence (the build had `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1`, a port Node `fetch` forbids; a `--require` shim in the **harness** rewrites only that URL inside the app server process, the compiled app is unchanged). The script now **aborts** when the page does not show the expected content instead of reporting vacuous «no overflow» results — an earlier run did exactly that.

## 4. Resource evidence (local measurements; hosted costs NOT measured)

- Database: the migration replaces one trigger function; no new table, index, query or trigger. The check still does the same two counts per insert (payments, active supports).
- Requests (compiled app, proxy counters): a load of Cartera → Soportes (6 contracts) = 34 requests to the proxy (23 of them `GET /usuarios`), HTML 86 KB; one complete UI upload (action + tab refresh) = 39 requests with exactly 1 Storage POST, 1 `soporte_registrar`, 1 `soporte_verificar_identidad` and the 3 precheck counts. The 339 changes no query code: the tab already loaded supports for all own contracts and only stopped hiding contracts without payments, so the extra cost is more cards in the HTML. I did **not** run the old build for a before/after comparison. The 23 `GET /usuarios` per page load are pre-existing behaviour I did not investigate (worth a separate look).
- No polling, timers or effects were added; no new client JavaScript beyond text and one derived value.
- Build: warm cache (a copy of the other worktree's Turbopack cache), 90 s, `--max-old-space-size=3072`; free RAM dropped to **284 MB** at its lowest (`memoria_build.csv`), i.e. close to the limit — a cold build would not have fit on this host right now. Real-action suites: ~32 s (new) and ~40 s (historical).
- Storage/Vercel/Supabase hosted impact: not measured.

## 5. Order of application (owner runs SQL)

`preflight_339` → migration 339 → `postcheck_339` → deploy the code. Code deployed **before** the migration is harmless (the precheck lets the extra support through and the old trigger rejects it with the limit message); migration before code is also harmless (old precheck simply stops the extra at the UI). `rollback_339` restores the 281 rule and deletes nothing.

## 6. Limits, decisions and pending owner review

- Decision I took: the portal lists **all** the ally's own contracts (including cancelled or fully paid ones with no payments), because the database restricts the limit by count only. If the owner prefers hiding cancelled contracts, that is a UI filter, not a database change.
- «Excess» is now above `payments + 1` (e.g. after annulling a payment). Replace and withdraw still work there.
- Evidence files that are NOT acceptance results: `lanzador_visual_1…4.log` are the discarded harness attempts described in section 3; `suite_281_base_sin_339.log` is the historical suite with the NEW code on a base WITHOUT 339 (9 failures from the new message text and the new precheck against the old trigger) — it is not a clean old-code baseline, which I did not build; `suite_281_con_339_intento1/2.log` are the runs before the expectations were updated.
- Not run: SQL suite `test_281_soportes.sh` (needs a 001–280 template); quotation-evidence flows beyond confirming the code is untouched; the 2 unit failures in the soporte-related run (`reciclajeContrato` 289 reasons, `loginWiring`) fail identically on the unmodified base `cd9bb1946` (compared by name).
- On the internal contract page at 820 px the «Total / Pagado / Saldo» tiles above the panel look clipped; they are outside this change and were not measured by my selector (pre-existing layout, not investigated).
- **Owner review (add to `pending-owner-local-review.md`, which lives uncommitted in the main checkout and which I did not edit):** with a synthetic ally, check at phone width: a contract without payments shows 1 slot and accepts 1 support; with 1 payment, 2; the third is refused with the new message; after the team registers a payment the slot reopens; staff receive the usual notification and the contract balance/status do not move after an upload.

## 7. Files

Migration `supabase/migrations/20260601000339_soportes_pago_cupo_adicional.sql`; `supabase/scripts/{preflight,postcheck,rollback}_339_soportes_cupo_adicional.sql`, `lanzar_visual_compilada.sh`, `visual_compilada_lib.mjs`, `visual_soportes339.mjs`, `semilla_visual_soportes339.sql`, `test_281_acciones.sh` (updated), `test_281_soportes.sh` (header note); `lib/soportes/archivo.ts`, `lib/soportes/operaciones.ts`; `components/portal/SoportesPago.tsx`; `app/portal/b2b/cartera/page.tsx`; `app/(dashboard)/dashboard/contratos/[numero]/SoportesPagoInterno.tsx`; `pruebas/soportesCupoAdicional339.pg.ts` (new), `pruebas/soportesPago281.pg.ts`, `pruebas/soportes86.test.ts`; `docs/tecnico/soportes-pago-aliado.md`; evidence in `docs/tecnico/evidence-soportes-339/`.

Re-run: `PG_REACT=1 sh supabase/scripts/test_pg_local.sh pgsoporte339 plantilla339 PG339 pruebas/soportesCupoAdicional339.pg.ts supabase/migrations/20260601000339_soportes_pago_cupo_adicional.sql` (template = `preparar_esquema_local.sh <container> 326 plantilla339`); historical suite: `sh supabase/scripts/test_281_acciones.sh t281a_x pgsoporte339 plantilla339`; compiled-page inspection: `sh supabase/scripts/lanzar_visual_compilada.sh pgsoporte339 plantilla339 docs/tecnico/evidence-soportes-339 supabase/scripts/visual_soportes339.mjs supabase/migrations/20260601000339_soportes_pago_cupo_adicional.sql supabase/scripts/semilla_visual_soportes339.sql` (needs the `.next` build with the fake Supabase env described above).
