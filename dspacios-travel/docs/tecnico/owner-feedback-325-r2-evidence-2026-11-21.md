# R325-1 / R325-2 corrections and the five follow-up gaps — evidence for Codex re-audit (2026-11-21)

Source review: `codex-review-325-owner-feedback-2026-11-21.md` (main checkout). Builds: final local production build **`mJuzIBj6CMWgFKNUNO2Mx`** (earlier builds of this work are kept untracked in `.next-zjq-anterior`, `.next-r2-anterior`, `.next-dvq-anterior`, `.next-previo`; keep them out of staging). Nothing was staged, committed, pushed, deployed or run against a remote service. **Migration 325 was NOT applied to the owner's review database**; it exists only on the disposable copy `rev_verif_int_o3b`. The owner's review database `rev_verif_int_revision` (container `pgb2b`), its pristine copy, its `storage` folder and the review-browser profile with the 15 saved logins were not touched: the table-by-table fingerprint (249 tables of `public`/`auth`/`storage`, count + md5 of every row) is **identical before and after** (`c66a9e530f0ac2cc`). Executor evidence only: not a Codex audit, not owner acceptance, no publication recommendation. E62.3 and #126-E keep their owner gates.

Migration 325 was edited in place (two new rejection codes) because it has never run anywhere but the disposable copy; preflight, apply and postcheck were re-run on a fresh copy each time (`reiniciar_copia_o3.sh`).

## 1. R325-1 — saved ally passengers reach every conversion path that offers capture

**Where passengers can be captured and consumed (decided from the code, enforced in the database):**

| Quotation type | Conversion screen | Ally capture | Handoff |
|---|---|---|---|
| `carrito` (checkout) | `ConvertirCarritoBtn` | offered | rows 2…n precharged (was already built) |
| `tarifario`, **no** passengers in `payload.pasajeros` | `CotizacionAcciones` (capture panel) | offered | **new:** rows 2…n precharged from the ally list |
| `tarifario` that already carries passengers | direct conversion with `payload.pasajeros` | **refused before saving**: «ya trae sus pasajeros (los capturó D'spacios); no se reemplazan» (F4723) | existing passengers are never replaced |
| `manual` (dynamic) | converts with the titular only | **refused before saving**: «se convierte con el titular… no admite pasajeros adicionales» (F4722) | nothing promised |

Implementation: `cotizacion_pasajeros_aliado_guardar` rejects F4722/F4723 (clearing the list is always allowed); the pure rule `capturaPasajerosAliado` (same decision) feeds the portal through `cargarPreparacionPortal` (type + existing-passenger count read per quotation), so the panel shows the restriction instead of the editor; `page.tsx` now loads the saved list for `tarifario` as well as `carrito` and passes it to `CotizacionAcciones` only when the quotation has no passengers; `CotizacionAcciones` precharges names, document type/number, birth date and nationality and now also checks the document rule before sending (same rule as the atomic passenger function). A second defect found on the way: `cargarPreparacionPortal` created the service client outside its `try`, so an environment without it would have crashed the whole quotations page instead of showing the «no pudimos cargar» notice (a pre-existing React test caught it); fixed.

**Proof (real browser, real roles, final build, disposable copy — section W of the journey):**
* The ally portal for a dynamic quotation and for one that already carries passengers shows the restriction and offers no editor; nothing was saved for either (checked in the database).
* A non-cart quotation owned by the ally, **without** passengers (fixture: a clone of the seeded convertible C-0005 owned by `freelance@`; 2 adults + a minor of 8 + a minor of 5): the ally saved an adult (CC), a minor of 8 (TI) and a minor of 5 (RC) with birth dates; `administracion@` opened the ordinary conversion screen: 4 rows, rows 2-4 precharged without retyping (names, types, numbers, dates); the contract was generated and `contrato_pasajeros` holds `Ana Uno:CC:1010101010:1985-03-04`, `Tomas Dos:TI:2020202020:2018-01-01`, `Lucia Tres:RC:3030303030:2021-01-01` exactly as the ally wrote them; no abonos created.
* **Rejected variant:** on a second clone the ally wrote 3 adults for a quote of 2 adults + 2 minors; conversion is refused by the **existing** passengers↔rooms rule («Por fecha de nacimiento hay 4 adulto(s), pero las habitaciones son para 2»), no contract is created, and the saved list is untouched. The system adjusted nothing.
* SQL test (`test_325_…sql`, section 5b): dynamic → F4722, already-captured → F4723, empty list allowed, tarifario without passengers saves.
* Fixture limits (labelled in the script): the clones and the ally-owned dynamic quotation exist only in the disposable copy; the quotations a real ally gets on the non-cart path come from staff-assisted flows, so the non-cart evidence is a realistic fixture, not an organically created record.

## 2. R325-2 — split React suites are part of the canonical execution

* `package.json`: new `test:react:resto` (6 previously unregistered files that had no CI workflow), `test:react:all` (= `test:calendar` + `test:react` + `test:react:o1o4` + `test:react:resto`) and `test` (= `test:unit` + `test:react:all`). The Windows command-length limit justifies several scripts; it no longer removes a test from the canonical run.
* `pruebas/suitesPruebas.test.ts`: the every-file requirement is **kept and extended**, not weakened: every `*.react.ts` must be listed in `test:react`, `test:calendar` or any `test:react:*`, **or** be executed by its delivery's CI workflow (read from `../.github/workflows/*.yml`, counted only when the workflow command lists it next to `reactLoader.mjs`, and the file must exist); every listed file must exist; `test` must run `test:unit` and `test:react:all`, and `test:react:all` must run **every** React suite script; every suite uses the React loader. The five files that run in a workflow (`clientesContratos68UI`, `destinosAereosEditor67`, `salidaVinculada63Contabilidad/Editor/Reserva`) were deliberately **not** copied into `package.json`: `salidaVinculada63Wiring.test.ts` forbids it («van por comando directo»), and my first attempt tripped that guard (it appeared as the single new failing name in an intermediate run and was fixed before the final one).
* **Mutation proof (executed):** adding an orphan `pruebas/zzHuerfanaMutacion.react.ts` makes the guard fail naming that file; removing `npm run test:react:resto` from `test:react:all` makes the canonical-entry assertion fail. Both were restored; the guard is 8/8 green.
* Components that render the ally table now import the new Server Actions: the repository convention (loader stub for Server Action modules) was followed — `pruebas/support/stubs/preparacionActionsStub.mjs` + one loader rule; `panelPreparacionContrato325.react.ts` replaces the stub with recording doubles (**13 tests**: the original 11 plus the two restriction cases). The earlier ad-hoc mock in `botonSolicitarContrato78.react.ts` was removed (no net change to that file). Two page-level React tests (`cotizacionesValorContrato84`, `portalCotizaciones65`) failed at file level after the first delivery and now pass.

## 3. The 29 → 30 failing-test reconciliation, by exact names (retained in `docs/tecnico/evidence-325-r2/`)

Method: a **base tree** was built by copying the worktree to `C:\tmp\base325` and reverting **only** the first 325 delivery (new files removed, edits to `tiposDocumento.ts`, checkout, `ConvertirCarritoBtn`, both quotation/contract pages, `TablaCotizaciones`, the portal page, `operaciones.ts`, `package.json` and the one test reverted; every earlier uncommitted change kept). Same commands, same machine, same session on both trees; raw outputs are in `%LOCALAPPDATA%\dspacios-local-revision-int\` (`unit_full_base_pre325.txt`, `unit_full_final_325_1.txt`, `unit_full_final_r2b.txt`, `react_*`), the extracted name lists are the `unit-failing-*.txt` / `react-failing-*.txt` files here.

| Run | `test:unit` | failing names |
|---|---|---|
| base tree (before the 325 delivery) | 10 533 tests, 31 fail | `unit-failing-base-pre325.txt` (31) |
| delivery 1 (the tree Codex audited) | 10 547 tests, 30 fail | `unit-failing-delivery1.txt` (30) |
| **final source** | 10 554 tests, **29 fail** | `unit-failing-final.txt` (29) |

* Delivery 1 vs base: the **same 30 names**; the base has one more, `paqueteDinamico82HotelInfo.test.ts :: migración 279…`, which runs `git status` and fails only because the base copy is not a git worktree (a copy artifact, not product behavior). So the 30 reported last time were already failing before the 325 delivery; **the delivery added no failing name**. The earlier «29» cannot be reproduced (no name list was retained then); the retained evidence shows 30 comparable failures before and after.
* Final vs delivery 1: `suitesPruebas.test.ts :: cada pruebas/*.react.ts está en test:react o test:calendar` is **gone** (R325-2; it had been red for pre-existing unregistered files) and no name was added. **Final = 29 names, every one of them also failing on the base tree; zero new names.** Their causes are other batches (wiring guards for CI workflows, program-rejection counts, CRM RPC keys, login page, hotel modal ordering, etc.); none touches a file changed here.
* `test:react` (217 files, same env on both trees): base 26 fail, final 26 fail, **identical name lists** (`react-failing-*.txt`); `test:calendar` 43/43, `test:react:o1o4` 32/32, `test:react:resto` 45/45.

## 4. Ally-entered minor and infant through conversion and the existing guardian rules (journey section X)

Real checkout: Camila (freelance) quoted DEMO 125, 04/12/2026→09/12/2026, 2 adults + minors of 8 and 1 (4 travelers, real totals). In the portal she saved three additional passengers: an adult (CE), a minor born 2018-06-15 (TI) and an infant born 2025-03-10 (RC). `administracion@` (the real notice recipient) opened the conversion:
* the 4 rows arrive precharged; the screen **classifies by birth date** («Niño · 8a», «Infante · 1a») and **demands «Adulto responsable *» for the infant**, left unselected — neither the ally nor the system picks a guardian;
* converting without a guardian is refused by the existing rule and creates nothing;
* after the staff member chose the adult guardian, the contract `DTM-0007` persisted: adult `CE 7654321 / 1987-02-02`, minor `TI 1020304050 / 2018-06-15` (not infant, no guardian), infant `RC 1111222233 / 2025-03-10`, **`es_infante = true`, `responsable_id` = the chosen adult's row id**; no abonos.
* No document-policy invention: the ally capture applies only the already approved rule (digits except Pasaporte); the existing «un menor no puede tener CC» check stays at conversion.
* Limit: the infant case was exercised on the cart path (the only path with a guardian selector). The ordinary (non-cart) conversion screen has no guardian selector at all — a pre-existing limitation: an infant on that path would be refused by the same trigger regardless of who typed it. Not changed.

## 5. Complete-action races through the real Server Action and real Storage (journey section V)

Four real logged-in sessions of the same ally clicked «Adjuntar comprobante» simultaneously on one quotation (the action performs the session read, the verify RPC, the duplicate check, the Storage upload and the register RPC):
* **Identical content, 3 rounds × 4 simultaneous requests:** every round ended with exactly **+1 row and +1 Storage object**, a single row for that SHA, and file⇄object coherence (every row has its object with the registered size, no extra object). In all **9** losing requests the database rejected the duplicate **after** the Storage upload (`SOPORTE_COT_REPETIDA`) and the action's compensation **deleted the losing objects** — so the compensation path itself was exercised (0 were resolved by the idempotent pre-check).
* **Last available slot:** 4 vigentes, then 4 simultaneous requests with 4 **different** files: exactly one won (5 vigentes), **3 were refused by the limit** (`SOPORTE_COT_LIMITE`) and their uploaded objects were compensated: objects 4→5, rows 4→5, the winning SHA is one of the four sent and equals the stored one; the three losers saw the limit notice on screen.
* Payments: abonos, pagos previos, contratos and soportes de contrato are byte-for-byte equal in count before/after both races.
* Limit of the proof: concurrency is four sessions on one machine; it demonstrates the serialization (row lock on the quotation + unique index) and the compensation, not behavior under production latency.

## 6. Preserved behavior and final-source journey

Proof-first evidence, the advisor selector (real recipient role, other-agency and role denials), the owner's document rules and the O-2 modal sections (P, Q, R, S, T) are **unchanged and re-run**. The complete journey `guion_o3_completo.mjs` — sections P Q R S T V W X U — ran **in one pass on the final build `mJuzIBj6CMWgFKNUNO2Mx`: 150 OK / 0 FALLO** (`journey-final-150ok.log`). Earlier passes during this round are reported as they happened: a pass that failed for an environmental reason (my first attempt to block external hosts aborted the Google-Fonts stylesheet, which React treats as a resource error and which broke hydration; it now answers an empty stylesheet), a pass with two failures in section W caused by my fixture (the cloned quotation's rooms did not match four adults), and a pass with one failure caused by a typo in my own regular expression. Each was fixed in the script/fixture, not in the product, and followed by a fresh-copy full run; only the last, clean, full pass is the evidence above. The journey now blocks every non-local host so timings cannot depend on the internet.

Other final-source checks: `tsc --noEmit` clean; production build `mJuzIBj6CMWgFKNUNO2Mx`; SQL test `test_325_…sql` passes; `preparacionContrato325.test.ts` 18/18; `suitesPruebas` guard 8/8.

## 7. Resource / consumption (VALIDACION_CONSUMO_VERCEL.md), proportionate

Local measurements only; hosted Vercel/Supabase usage remains unmeasured and no cost is claimed.
* **Changed mechanisms:** no timers, effects or polling were added; the only runtime additions are click-driven. `cargarPreparacionPortal` gained one more read per ≤100-quotation batch (`cotizaciones` id/type/previous passengers) next to the two it already did — 3 reads per portal quotations page load (was 2), bounded by the batch size. The quotation page adds one read for `tarifario` quotations (saved passengers).
* **Idle (31 s, final build, same tab):** portal without panel 1 action / 0 REST; portal with the panel open 1 / 0; staff dashboard 1 / 0; staff quotation with evidence 1 / 0 — the single action is the existing bell poll (30 s, one per tab, cleaned on unmount); the new screens add none. Per-step counts: checkout 7 actions, ally panel (save passengers + 7 evidence operations) 9 actions, staff open + evidence + convert 4 actions, 0 browser REST reads.
* **Races:** each attach ≤ 5 round trips (session/profile, verify RPC, duplicate count, Storage upload, register RPC) plus one Storage delete when compensating; 12 attach requests in section V caused 3 + 9 = 12 compensating deletes and 0 retries (the action never retries).
* **Storage:** unchanged limits (≤ 5 active files × 4 MB per quotation); retired and compensated objects: retired files are kept by design, losing racers' objects are deleted immediately, so races do not leave orphans.
* **Builds:** three local production builds this round (the last is the evidence); unit suite ≈ 10–14 min and React suites ≈ 8 min per full run, run sequentially.
* **Unknown:** function duration/memory on Vercel, Supabase request logs, storage growth over time.

## 8. Not done / residual risk

* The 29 remaining unit failures and 26 React failures are baseline (identical names on the base tree); they were not fixed here.
* The base tree is a file copy, not a git worktree (one git-dependent test differs by construction, see §3).
* Evidence retention policy, visibility of evidence to `venta`, linking evidence into `contrato_soportes_pago`, and the 5-file/4 MB limits remain explicit owner decisions (unchanged from the previous report). The contract page's «Editar asesor» still reads its advisor list through RLS (not touched).
* To show this to the owner after Codex approval: apply 325 to `rev_verif_int_revision` (`bash supabase/scripts/localreview_integrado/aplicar_migraciones.sh pgb2b rev_verif_int_revision 325`) — **not done**; until then the compiled app against the owner's database shows the panel but its actions fail. The disposable copy `rev_verif_int_o3b` and `storage_o3b` are kept for Codex (`drop database rev_verif_int_o3b with (force)` removes it); the stack, the app and `pgb2b` are stopped; `C:\tmp\base325` is a throwaway copy that can be deleted.
