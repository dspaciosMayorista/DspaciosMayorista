# #125 integrated into the consolidated review batch — executor handoff for Codex re-audit

**CURRENT RELEASE STATUS — 2026-11-18:** technical re-audit passed; owner reviewed the consolidated flow and deferred further refinements to #126. Production migrations 307–311 were applied and postchecked by the owner. Application publication and final hosted Preview remain pending. See [the final release handoff](release-integrated-batch-2026-11-18.md). Older pending/unapplied/not-audited labels below are retained as dated history, superseded by that handoff.

Prepared 2026-11-17 (America/Bogota). Language: English by the owner's policy; Spanish product text, identifiers and historical documents are unchanged.
**Status: integrated and executor-verified locally. NOT Codex-audited as an integrated source, NOT owner-accepted, NOT staged, committed, pushed, deployed or run remotely.** Previous audits of the individual blocks (including #125 R1/R2 and the batch's U1 closure) are not an approval of this integration.

**ROUND 2 (2026-11-18, after Codex C1/C2) — returned for re-audit; NOT audited, NOT owner-accepted, nothing staged/committed/pushed/deployed/remote.** Codex's two findings were valid and the acceptance criteria were corrected FIRST (matrix §0): a free child lives INSIDE the adult package row (DTM-0003 and DTM-0004 = one row each; C-0005 = two rows: adults + free child $1.464.000, and Niño 2 $293.000) and several partially benefited children never fall back to a negative row. Fix: package-row merge only when the adult row is unambiguous, sealed per-child tariffs where they exist, an honest group value (no invented split, no average) where only a total was stored; real persisted cart-path NETO data exposed one more defect in the fold (hotel-prefixed signed line) which was fixed and regression-tested (mutation-checked). Round-2 final build `FreOT3YH2M3PLd17-pfnV` (969 files, fingerprint matches the code): document script **230/230** (1/1/2 rows, quantities, no negative row, no promotion text, NETO DTM-0004 one row $300.000), DTM-0003 PDF read page by page (one row), C-0005 quotation and NETO screenshots read, calculator 60/60 and deep link `#cruce-bases` 32/32 re-run (CalculadoraEditor was touched by a mutation test); `tsc` clean; unit 10,158 / 30 and React 2,010 / 26 failures with names **identical** to the clean baseline. Real-action gaps closed with my own re-runs: payment → confirmation → reversal G1 6/6, real NETO free-child cart path G4 5/5 (needs `semilla_revision_125.sql` as extra seed argument), unit-table rejection/USD G2 5/5, matrix boundaries G6 40/40. Open and explicit: Reservar-path NETO with a free child exists only as stored-items rendering; several PARTIAL children on historical Reservar contracts show a group value without per-child tariff; only DTM-0003 and the pending-USD PDFs were read page by page; Dubai hotels 912511/912512 still exist only in the disposable copy `rev_verif_corr` (to be loaded into the owner's DB with backup after the re-audit); hosted metrics not measured. Voucher history (migration 309) untouched per Codex's RPC probe. The review services are back on `rev_revision`: counts and the stored items of DTM-0003/0004/0005 are identical to the pre-work backup (hash-compared), DTM-0005 still confirmed USD 1.000 with its COP 1.230.000 payment. Details: `owner-corrections-acceptance-matrix-2026-11-18.md`, `owner-corrections-fix-docs-round2-2026-11-18.md`, `owner-corrections-gaps-round2-2026-11-18.md` (int-review worktree).

**Round 3 (2026-11-18) — owner correction batch:** The corrections are implemented in `.worktrees/int-review` and returned for the **Codex re-audit; Codex has NOT audited it and the owner has NOT accepted it; nothing staged, committed, pushed, deployed or run remotely**. Final production build `aw6VTv30k99_9jBP-jGY2` (969 files, fingerprint checked against the current code); first-build evidence `puuFCUhRG9T2WWRKfpn20` kept separate. Evidence on the final build: #106 layout 55/55 + smoke 43/43 (nine widths, menu open/collapsed, role guards 6/6), unit-destination table check 42/42, direct `#cruce-bases` 32/32, Temporadas/Tarifas at 390 px 60/60, document script 210/210 + the pending-USD PDF (4 pages) read; `tsc` clean; unit 10,140 / 30 and React 1,968 / 26 failures with names **identical** to the clean baseline. Four defects found after the first build (table destination list, `#cruce-bases` link, 390 px Temporadas overflow, #106 note overflow) are fixed with regressions where practicable. Decisions: the Dubai discount rule is settled by DECISIONS.md ADL-019 (PR #316, 2026-09-18; older notes were stale and are corrected, behavior unchanged); the pending USD client document now states the minimum in USD (USD 300 at the frozen TRM) while the COP instruction stays in the internal view. Hand calculations (600.000 unit stay, infant PAM 88.000 / FULL 200.000) and the full matrix with explicit gaps G1–G11: `docs/tecnico/owner-corrections-acceptance-matrix-2026-11-18.md` (in the int-review worktree). The review services are back on the owner's `rev_revision` (data identical to the pre-work backup; DTM-0005 still confirmed with its COP 1.230.000 payment); the Dubai example hotels 912511/912512 exist only in the disposable copy `rev_verif_corr` and still have to be loaded additively (with backup) into the owner's database after the re-audit. Hosted consumption was not measured.

**Round 2 (2026-11-17) — Codex finding I1 corrected** (displayed passenger breakdown vs total, §10.1) and the question about the review database answered with a whole-database comparison (§10.2). The build, test counts and browser totals below were refreshed for this round (build `Le0Hvfutw3yjtD1KwYIrQ`).
The former separate #125 Preview route is superseded by this plan: one PR, one consolidated review, one final Preview.

## 1. Source and baseline

| Item | Value |
| --- | --- |
| Integration worktree / branch | `dspacios-travel/.worktrees/int-review` · `claude/int-review-batch` (HEAD = base `51ea60612`; nothing committed) |
| #125 source (preserved, untouched) | `.worktrees/promo-multibase` · `claude/promo-multibase` (same base `51ea60612`) |
| Clean baseline for comparisons | `.worktrees/base-main` (detached `51ea60612`) |
| Blocks | #1, #53, #102, #105, #106, #124 (+ O1–O4, U1) **and #125 (incl. R1/R2)**. #103 and #104 are not touched. |
| Pre-integration safety copies | `C:/tmp/int125_backup/` (tracked diff + untracked tar of BOTH worktrees) and, for the review database, `%LOCALAPPDATA%\dspacios-local-revision\respaldos\rev_revision_antes_ampliar125_20261117_205649.dump` |
| Production build | **`Le0Hvfutw3yjtD1KwYIrQ`** (round 2; the first integrated build was `K65j0hUR7Sy_7Ge_tTKX3`, superseded), content fingerprint `99985b50…73383` over **968** source files; `huella_build_review.mjs comprobar` says the build corresponds to the current source (checked again after the last test/script edits: none of them is part of the fingerprint). |

## 2. Migration order (all unapplied everywhere; no applied migration was edited)

`307` (#53) → `308` (#1) → `309` (#106) → `310` (#125) → `311` (O3). 310 depends only on 300/301 (applied); 311 only drops four column defaults. 303–306 are already applied in Production; the disposable databases apply them first because `plantilla304` does not carry them.
Owner SQL: each stage is ONE read-only `SELECT` (control · observed · expected · verdict): `preflight_N_*.sql` / `postcheck_N_*.sql` in `supabase/scripts/`.

## 3. Integration decisions (audit these first)

1. **Nine files were edited by both #125 and the batch** — three-way merges (base = the clean checkout of `51ea60612`, line endings normalized to CRLF first): `CalculadoraEditor.tsx` (#124 + #125), `hoteles/actions.ts`, `reservar/actions.ts`, `checkout/actions.ts`, `ContratoDocumento.tsx`, `computo.ts`, `liquidacionHotel.ts` and `types/database.ts` merged without textual conflicts; **`cotizar.ts` had three conflicts and one semantic one** (next point). The other 23 tracked files of #125 (including `package.json`) were not touched by the batch and were copied. A clean text merge is not proof of behavior: the shared files were re-verified by `tsc`, the full suites and the journeys below.
2. **#102 moved the combo loop of `buscarHoteles` into the shared engine `lib/reservar/composicionHotelBusqueda.ts`; #125 had edited the old inline loop.** The «one free child per room» benefit of the search was ported into `evaluarComposicionHotel` with the same rules: the children that pay a child tariff in THAT hotel (`cl.ninos`, so hotel age rules decide eligibility), room-by-room assignment, price recomposed through `ventaNinoCondonada`, the same three explicit rejections (resolution blocker, missing price breakdown, under-two child on a Niño tariff — none is silently dropped). `ComboEvaluado`/`ComboBusqueda` carry `beneficioNinoGratis`; `buscarHoteles` still exposes the cheapest combo's benefit. A new `soloFactibilidad` flag lets the date-suggestion feasibility check (`compatibleConComposicion`) ignore pricing, because it only asks whether the composition fits. The table view and the extra-night reference use the same engine, so the benefit is recomputed for the longer stay and the extra-night amount stays a reference.
3. **`package.json` test list.** The integrated tree's `test:react` list had lost four block tests (`calculadoraConflicto124`, `contratoSinItems53`, `imagenCatalogo`, `ocupacionBusqueda102Ui`); they are now in the list together with the two #125 React files. Eleven pre-existing baseline gaps (files not in the list) were left alone.
4. **Two tests were adapted, not weakened.** `ninoGratis125.correcciones.test.ts` reads the engine source instead of `cotizar.ts` for the search rejections (and still asserts `cotizar.ts` exposes the benefit); `calculadoraConflicto124.react.ts` stubs `../actions` also for `CruceBasesMixta` (the #125 component now lives inside the real `CalculadoraEditor` the #124 test renders) and adds `guardarReglasPromocion` to the stub.
5. **#125 journey and fixture.** `recorrido_125.sh` now loads the combined chain 303 → 311 (was 303–306 + 310); exit-code propagation is unchanged. Because migration 311 removes the hotel age defaults (O3), every hotel of `fixture_recorrido_125.sql` declares its ages explicitly (0–2 infant, 2–10 child = the old defaults). No assertion was changed.
6. **Review environment (`supabase/scripts/localreview/`).** `localreview.ps1`: migration list now includes 310, seed `semilla_revision_125.sql`, real-action examples `ejemplos_revision_125.ts`, a new additive action **`ampliar125`** (backup → migration 310 only if missing → seed → tariffs/examples; idempotent; never restores or deletes review data) and an executor-only switch `REV_DB_VERIF` that points the services at a disposable copy. `humo_revision_125.mjs` is the new browser journey; `humo_revision_{1,105,124}` read `REV_DB_VERIF`.
7. **What `ampliar125` added to the owner's review database** (details and the whole-database comparison in §10.2): migration 310; hotels 912501–912504 and their seasons/tariffs/calculators/packages; 15 `tarifario_resultado` rows (packages 912501, 912503, 912504); contracts `DTM-0003` and `DTM-0004`; quotations C-0003, C-0004 (converted) and C-0005 (open). C-0002 (the USD 1.000 offer for the owner's TRM) is still open and unconverted. The snapshot `rev_revision_semilla` was NOT modified: after `restaurar`, run `ampliar125` again. `ampliar125` is idempotent only up to the seed: the seed deletes and recreates its own ids, so it is skipped when the four hotels already exist (re-running it over existing examples would fail on foreign keys and roll back).

## 4. Approved behavior — where each rule is proven

| Rule | Evidence |
| --- | --- |
| Winning base resolved per night; genuine ties and missing rates fail closed; percentage on adults, Niño 1, Niño 2; infant base tariff kept in follow mode | `promoMultibase125.motor` 49, `.baseline` 10 (unit); SQL 310 suite 37/37; journey S1–S8 |
| One eligible free child per room with ≥ 2 adults, accommodation of that hotel only; declared child/room/tariff association; hotel-age fallback without promotion override | `ninoGratis125.wiring` 23, `.correcciones` 20, `.integracion102` 7 (new: the ported search path); journey F2 cases |
| R1: successive promotions for the SAME child aggregated by child and recomposed ONCE; provenance kept; R2: checkout sums every entry of a passenger | `ninoGratis125.sucesivas` 12; journey S9a–S9e; browser: DTM-0004 line «PROMO UNO, PROMO DOS» −101.000, total 360.000 |
| Flights, assistance, services and other nights are never waived | journey S9d (three nights, ticket kept) |
| Strict passenger-summary reconciliation; valid cart summaries frozen into contracts; Reservar single-hotel path unchanged (no generated `resumenPrecios`, pre-existing) | journey S1–S9 (B2C, commission 10 %, NETO, USD/TRM) |
| Explicit hotel ages for every hotel that accepts minors, including unit-priced hotels; tariff overrides cannot bypass; Adults Only intact | `edadesHotelUnidadU1.pg` 12/12, `edadesNocheReferencia.pg` 18/18 on the combined schema; browser O3/O4 76/76, U1 20/20; journey fixture now declares ages |
| Public Receptivo photos expose only the published image data; images reduced before the final size check | browser #105·O1·O2 28/28 |
| Additional-night price is a reference; extending recalculates the whole stay | browser #102 22/22; `ocupacionBusqueda102.pg` 19/19 |
| #53 confirmation/expiry/ally vouchers; #1 CRM isolation; #106 permissions; #124 conflict handling | `voucherAcceso307.pg` 10/10 (real payment module), `minimoAcuerdo307.pg` 3/3, `personasCotizaciones1.pg` 27/27 + `…Carrito.pg` 6/6, `gestionContratos106.pg` 55/55, `calculadoraConflicto124.react` 17/17; browser 60/60, 20/20, 35/35, 35/35 |

## 5. Tests actually executed on the final integrated source

| Run | Result |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| Full unit suite | **10,096 tests · 30 failures · 0 skipped**; failing names **identical** to the clean baseline (50 name lines each; none new, none fixed) |
| Full React suite (`npm run test:react`) | **1,957 tests · 26 failures · 0 skipped** (1,945 before round 2 + 12 new rendered tests); failing names **identical** to the clean baseline (27 lines each) |
| #125 real-action journey (real Server Actions → PostgREST → Postgres, schema 303 → 311) | **328 PASS · 0 failures · 2,244 PostgREST requests**, launcher exit 0 (the earlier isolated run had 2,250; the difference is request accounting under the extra migrations, no assertion differs) |
| Combined sequence `test_integrado_cadena_307_311.sh` (preflight → apply → postcheck per stage, in numeric order; each owner script is ONE SELECT) | 307 17/17 + 17/17 · 308 11/11 + 11/11 · 309 12/12 + 11/11 · 310 12/12 + 14/14 · 311 7/7 + 4/4; none of the stages altered pre-existing rows |
| `test_307_minimo_vencimiento_voucher.sh` (SQL, with data) | 117 PASS · 0 failures |
| `test_310_promocion_sigue_base.sh` on a database that already carries 303–309 | **37/37**, second apply aborts as designed, rollback restores `LISTA PARA 310` |
| Real-database suites on the combined schema (`test_integrado_suites_pg.sh`: fresh DB per suite from a combined template) | #53 voucher 10/10 · #53 minimum agreement 3/3 · #1 27/27 + 6/6 · #102 occupation/search/extra night 19/19 · O3/U1 12/12 · O4 18/18 · #106 55/55 (its own launcher on a 303–311 schema) |
| **Not green, and not caused by this integration:** `cotizacionAsistidaB2B102.pg.ts` (#102 *assisted B2B quotation*, a different task) | 7 sub-tests fail on the combined schema **and 10 fail on the clean baseline** with the same template and migrations 303–306 (B1, B4, B5, B7, C3, C9 + D1, D2, K1, K2); the integrated failures are a subset of the baseline's. Likely a template/schema prerequisite of that suite; not investigated further. |
| #124 database reproduction (`repro_124_conflicto_calculadora.sh`) | **not re-run**: it needs the `local4360` photo and hard-coded users. #124 is covered by `calculadoraConflicto124.react` 17/17 (real editor with the #125 component inside), its unit file (in the full unit run) and the compiled-app journey 35/35 |

## 6. Compiled app, real login, desktop 1366 px and mobile 390 px

Round 2 total on build `Le0Hvfutw3yjtD1KwYIrQ`: **446 checks, 0 failures** (60 + 22 + 20 + 28 + 35 + 35 + 76 + 20 + 150). Run against the production build above, through `/login`, on a **disposable copy** of the review database (`rev_verif` + a copy of the storage folder, same ports/keys/container names; `REV_DB_VERIF`), so the writing journeys (CRM requests, image uploads, acknowledgments, calculator saves) never touched the owner's data. The copy and its storage folder were deleted; the services were recreated against `rev_revision` and verified (`rev-rest` → `pg304:5432/rev_revision`).

| Journey | Checks |
| --- | --- |
| #53 (COP, manual, USD quotation, no-item historical document, **four real PDFs**, ally vouchers) | 60/60 |
| #102 (table view, Booking, extra night) | 22/22 |
| #1 (visitor request → CRM people, isolation) | 20/20 |
| #105 + O1 + O2 (uploads end to end, public Receptivo photos) | 28/28 |
| #106 (roles, filters, acknowledgment write + retire) | 35/35 |
| #124 (rename, concurrent save, permission) | 35/35 |
| O3 + O4 | 76/76 |
| U1 (unit hotels) | 20/20 |
| **#125 (this integration)** | **150/150** (76 desktop, including the two contract PDFs; 74 mobile; round 2 added the card/table checks of I1): calculator plan and «Calcular por noche…», single-base hotel unchanged, «Reglas por grupo» with the free child, Booking search total = saved quotation = contract (`$1.464.000`), idle behavior, **card and table breakdown with the free child, extra-night reference**, contract documents, PDF, quotations, public links |

Where the #125 line is visible (checked, not assumed). The internal contract page `/dashboard/contratos/<n>` is an operations/finance control view (summary, hotel cost payable, conditions, passengers, payments, vouchers): its item rows are queried only for superadmin and only feed the content editor, never rendered as text — for `administracion` and for `superadmin` the rendered text and the editable fields contain **0** occurrences of the free-child line. The signed line is shown by the contract document (`/contrato/<n>`, also with `?token=`), by the quotation page (`/dashboard/cotizaciones/<id>`, including its price composition) and by the client link `/cot/<token>` **without a session**. The journey therefore asserts the description, promotion names and amount on those documents, and asserts on the internal page the **hotel cost payable** (`Total previsto`: adults only, `$1.170.000` / `$360.000`) as an additional check. Note: `/cotizacion/<token>` is the route of manual quotations, not of Reservar quotations.

## 7. Resource validation (`docs/agents/VALIDACION_CONSUMO_VERCEL.md`)

**Measured locally** (compiled app, desktop and mobile identical): «Calcular por noche…» = 1 server action and 0 RSC refreshes; «Guardar reglas» = 1 action, 0 RSC; «Guardar calculadora» (existing) = 1 action + 1 RSC refresh; Booking search = 2 server calls (person + unit), as before; **idle 10 s on the open calculator = 0 requests; idle 10 s on the search results = 0 requests**. No `setInterval`, `setTimeout`, `useEffect`, `fetch` or `router.refresh` appears in the lines #125 added to application code (checked on its tracked diff and in the new modules). The ported search benefit is pure computation over data the search already loaded: no extra database read per quote or per search. Build `Le0Hvfutw3yjtD1KwYIrQ`: peak process tree 2,465 MB, minimum free memory 1,191 MB, TypeScript 20.4 s (the first integrated build peaked at 3,154 MB / 475 MB). I1 adds no timer, effect, fetch or refresh: the payable lines are computed once in the engine and rendered; Vista tabla = 1 server call per search, Booking = 2, as before.
**Not measured:** hosted Vercel/Supabase requests, CPU, duration, transfer, deployment size, TTFB, LCP. No improvement in any of them is claimed.

## 8. Limitations (not defects) and open points

- Reservar's single-hotel path never generates `detalle.resumenPrecios` (pre-existing; its totals and items reconcile through `contrato_items`); not expanded here.
- NETO contract price versus the sum of PVP items (journey: 405.000 vs 450.000) follows the existing NETO behavior; Codex previously judged it not a defect by itself.
- A free child under 2 on a Niño tariff is rejected with an explanation (declared supported scope).
- Which room a child sleeps in follows the declared-order convention (the quote forms have no per-room child entry).
- The hosted cause of the slow save reported for the calculator is not reproduced locally.
- `CalculadoraEditor.tsx` still performs one `router.refresh()` after «Guardar calculadora» (existing behavior).
- The empty-database sequence check proves schema/permission behavior; data preservation is proven by the SQL suites that carry data (307: 117 checks; 310: 37 cases) and by the review-database fingerprint.
- The #124 database reproduction and the baseline-failing #102 assisted-B2B suite are listed in §5.

## 9. Commands

From `dspacios-travel/.worktrees/int-review/dspacios-travel` (PowerShell, `supabase/scripts/localreview`):
`.\localreview.ps1 iniciar` → `.\localreview.ps1 start` (app `http://127.0.0.1:3070`) · stop: close the app window / `.\localreview.ps1 detener` (add `-IncluirPostgres` only if nothing else needs `pg304`). `.\localreview.ps1 ampliar125` is already applied; run it again only after `restaurar` (which returns to the initial snapshot and loses #125 and your progress).
Re-run for the audit (from `dspacios-travel/`, `pg304` up): `MSYS_NO_PATHCONV=1 sh supabase/scripts/recorrido_125.sh` · `sh supabase/scripts/test_integrado_cadena_307_311.sh` · `sh supabase/scripts/test_integrado_suites_pg.sh` · `bash supabase/scripts/test_310_promocion_sigue_base.sh` (set `TEMPLATE_DB` to a database that already has 303–309) · browser: `node supabase/scripts/localreview/humo_revision_125.mjs <dir>` (and the other `humo_revision_*.mjs`) with the app running; add `REV_DB_VERIF=<copy>` to protect review data.

## 10. Round 2 — Codex finding I1 and review-data preservation

### 10.1 I1 — card/table breakdown contradicted the total (corrected)

**Finding (Codex, P2).** The shared search engine subtracted the free-child benefit from `total` but built the passenger breakdown from the original tariffs, so a card/table showed adults 250.000 + child 169.000 against a total of 250.000, with no explanation; additional-night lines did the same.
**Correction.** New pure module `lib/reservar/ninoGratisDesglose.ts`: `aplicarNinoGratisADesglose` moves each benefited child out of its class line into its own line whose amount is what is PAID (tariff − waived) and whose `gratis` field carries the promotions and the waived amount; `desgloseNocheAdicional` computes the per-passenger additional-night reference from the same payable lines; `sumaDesglose` is the invariant. `composicionHotelBusqueda.ts` applies it and **rejects the combo with a reason** if the lines do not add up to the total (|Σ − total| > 0.015) — it can no longer offer a contradictory breakdown. `LineaDesglose.gratis` is the new optional field. UI: `desgloseTarifas.tsx` (Booking card) and `TablaResultadosBusqueda.tsx` (table, stay and additional night) show the payable amount and one compact line: «Niño gratis por habitación · PRE BF · tarifa $169.000 − $169.000».
**Preserved.** Totals are unchanged; R1/R2 (one line per real child, promotions listed in chronological order, one recomposition); room eligibility (a free child among several children keeps the others' real tariffs, shown on separate lines; identical benefited children are grouped, different ones are never averaged); retained flight/services (the payable amount of a partially waived child still contains them); extra night: payable differences per passenger sum exactly to `total(N+1) − total(N)`; a night outside the promotion shows the child paying it with no explanation; if the structure changes when the stay is extended the table shows the total only (no invented breakdown).
**Tests.** `pruebas/ninoGratis125.desglose.react.ts` (12 tests, in `test:react`) renders the real components from the real engine in jsdom and asserts passenger amounts, the explanation and that the displayed lines sum to the displayed total: Codex's reproduction (adults 250.000, child $0), one free child among two children of different classes, two rooms with two children of the same class and only one eligible (169.000 and $0, never averaged), R1 successive promotions (one line, «PROMO UNO, PROMO DOS», no 1.000 remainder), retained flight and transfer (child pays 400.000+), no-benefit case unchanged, the table's stay and both additional-night cases, and the structure-change fallback. **Mutation check:** with the fix disabled 11 of the 12 fail. Compiled app (desktop 1366 px and 390 px): card 2 × $732.000 = $1.464.000 with the child at $0 and the explanation; table stay 2 × $732.000 + $0 = $1.464.000; additional night (9 dic, outside the 4–8 dic promotion) 2 × $187.000 + $94.000 = $468.000; Vista tabla = 1 server call per search; 24 new assertions, all passing.

### 10.2 The review database: whole-database comparison (corrects the earlier «unchanged» claim)

**Why financial hashes were not enough, and what was compared instead.** The pre-`ampliar125` backup (`rev_revision_antes_ampliar125_20261117_205649.dump`) was restored into a scratch database and compared with the live review database table by table, row by row (hash of the columns present in both), across **242 tables** of `public`, `auth` and `storage` (`supabase/scripts/localreview/comparar_bases_revision.mjs`, read-only; its header explains how to recreate the «before» database from the backup). Result: **0 previously existing rows deleted or changed, except 2 rows of `auth.users`** (`last_sign_in_at`/`updated_at` of the two users that logged in during my browser runs); **500 rows added**, all attributable to #125's data and to the logins/audit trail of the runs: `auth.sessions`/`refresh_tokens`/`sesion_agencia*` (10 logins each), the four hotels and their seasons/tariffs/accommodations/categories/regimens/calculators/rules/season history, packages 912501/912503/912504 and their publication machinery (`tarifario_resultado` 15, `tarifario_cambio_fuente`, `tarifario_fila_oculta` — all with those package ids), DTM-0003/0004 and their items/hotels/passengers/conditions/obligations, quotations C-0003…C-0005 with their composition and participants, the CRM people of those quotations, the audit rows of all of the above, and one destination, one category and one supplier.
**`tarifario_resultado` 103 → 91 → 118.** Before: 103 rows = packages 5301 (5), 5302 (5), 9803 (7), 10201 (32), 10301 (42), 916101 (6), 916102 (6). Now: 118 = the same 103 rows (all present and identical) + 15 new (912501: 5, 912503: 5, 912504: 5). The «91» I recorded came from my own verification query (`hotel_id NOT BETWEEN 912501 AND 912504`), which drops rows whose `hotel_id` is NULL (SQL three-valued logic): **12 rows of packages 916101 and 916102** (Programa service-module rows, 6 each) have a NULL hotel. 103 − 12 = 91; nothing was lost.
**A real inconsistency the check exposed, now fixed.** My first two runs of the #125 browser journey ran on `rev_revision` itself (before I moved to a disposable copy). They restored the «PRE BF» season and the calculator with direct SQL, but the actions they had clicked had regenerated the published tariff of **package 912501** (my own seed package) with the promotion applied (double $338.000 «PRE BF»), so the published rows no longer matched the restored seed (a fresh generation gives $375.000 «BASE A»). I regenerated only package 912501 with the real action (`localreview.ps1 publicar -Paquetes 912501`), confirmed against a regeneration in a disposable copy, and re-ran the comparison. Also corrected earlier: the calculator version counter of hotel 912502 (advanced to 12 by those runs) was reset by recreating its calculator row with identical parameters. **`humo_revision_125.mjs` now refuses to run without `REV_DB_VERIF`** (disposable copy) so this cannot repeat.
**Not repeated:** `ampliar125` was NOT run again (its seed would fail on the foreign keys of the existing examples; now guarded). The backup `rev_revision_antes_ampliar125_20261117_205649.dump` is retained; the review database was not reset.


## 11. File inventory for Codex's integrated re-audit

Generated from `git status` of the integrated worktree. Excluded by construction: logs, evidence screenshots/PDFs (`C:/tmp/ev_int/`), credentials, `.env*`, `node_modules`, `.next`, local keys, and the #125 rig `supabase/scripts/local125/` (superseded by `localreview/`). Evidence/log locations: `C:/tmp/ev_int/final/{cap*,logs}`.

Total entries in `git status` of int-review: **327** (modified 125, new 202). Before integrating #125: 271.

### #125 — 49 files

- `app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/CruceBasesMixta.tsx` (new)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/PlanPromoPorNoche.tsx` (new)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionReglas.tsx` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/actions.ts` (modified)
- `app/(dashboard)/dashboard/reservar/actions.ts` (modified)
- `app/tarifario/checkout/actions.ts` (modified)
- `components/contrato/ContratoDocumento.tsx` (modified)
- `components/cotizacion/ComposicionPrecio.tsx` (modified)
- `docs/tecnico/promo-multibase-125.md` (new)
- `lib/calc/calculadoras.ts` (modified)
- `lib/calc/paquetes.ts` (modified)
- `lib/calc/promoCalculadora.ts` (modified)
- `lib/calc/promocionesGrupo.ts` (modified)
- `lib/cotizacion/comparativa.ts` (modified)
- `lib/cotizacion/composicionPrecio.ts` (modified)
- `lib/cotizacion/desgloseInterno.ts` (modified)
- `lib/cotizacion/resumenCarrito.ts` (modified)
- `lib/cotizacion/resumenNeto.ts` (modified)
- `lib/cotizacion/tarifaPaquete.ts` (modified)
- `lib/hoteles/contextoGeneracionTarifas.ts` (modified)
- `lib/hoteles/ninoGratis.ts` (new)
- `lib/hoteles/promocionesVigencia.ts` (modified)
- `lib/reservar/aceptacion63.ts` (modified)
- `lib/reservar/computo.ts` (modified)
- `lib/reservar/costosObligacionesCarrito.ts` (modified)
- `lib/reservar/desglosePersonaCotizacion.ts` (modified)
- `lib/reservar/ninoGratisLinea.ts` (new)
- `lib/reservar/ninoGratisPrecio.ts` (new)
- `pruebas/calculadoraGrupos297.react.ts` (modified)
- `pruebas/ninoGratis125.documentos.react.ts` (new)
- `pruebas/ninoGratis125.sucesivas.test.ts` (new)
- `pruebas/ninoGratis125.wiring.test.ts` (new)
- `pruebas/promocionesGrupo43.acciones.test.ts` (modified)
- `pruebas/promocionesGrupo43.react.ts` (modified)
- `pruebas/promoMultibase125.acciones.test.ts` (new)
- `pruebas/promoMultibase125.baseline.test.ts` (new)
- `pruebas/promoMultibase125.motor.test.ts` (new)
- `pruebas/promoMultibase125.react.ts` (new)
- `pruebas/salidaVinculada63Wiring.test.ts` (modified)
- `supabase/migrations/20260601000310_promocion_sigue_base_nino_gratis.sql` (new)
- `supabase/scripts/postcheck_310_promocion_sigue_base.sql` (new)
- `supabase/scripts/preflight_310_promocion_sigue_base.sql` (new)
- `supabase/scripts/recorrido_125.mjs` (new)
- `supabase/scripts/rollback_310_promocion_sigue_base.sql` (new)
- `supabase/scripts/test_310_promocion_sigue_base.sh` (new)
- `supabase/scripts/test_310_promocion_sigue_base.sql` (new)
- `types/database.ts` (modified)

### Integration (new or adjusted in this round) — 25 files

- `app/tarifario/desgloseTarifas.tsx` (new)
- `app/tarifario/TablaResultadosBusqueda.tsx` (new)
- `docs/tecnico/integracion-125-lote-revision.md` (new)
- `lib/reservar/asignacionHabitacionesBusqueda.ts` (new)
- `lib/reservar/composicionHotelBusqueda.ts` (new)
- `lib/reservar/cotizar.ts` (modified)
- `lib/reservar/liquidacionHotel.ts` (modified)
- `lib/reservar/ninoGratisDesglose.ts` (new)
- `package.json` (modified)
- `pruebas/calculadoraConflicto124.react.ts` (new)
- `pruebas/ninoGratis125.correcciones.test.ts` (new)
- `pruebas/ninoGratis125.desglose.react.ts` (new)
- `pruebas/ninoGratis125.integracion102.test.ts` (new)
- `supabase/scripts/fixture_recorrido_125.sql` (new)
- `supabase/scripts/localreview/comparar_bases_revision.mjs` (new)
- `supabase/scripts/localreview/ejemplos_revision_125.ts` (new)
- `supabase/scripts/localreview/humo_revision_1.mjs` (new)
- `supabase/scripts/localreview/humo_revision_105.mjs` (new)
- `supabase/scripts/localreview/humo_revision_124.mjs` (new)
- `supabase/scripts/localreview/humo_revision_125.mjs` (new)
- `supabase/scripts/localreview/localreview.ps1` (new)
- `supabase/scripts/localreview/semilla_revision_125.sql` (new)
- `supabase/scripts/recorrido_125.sh` (new)
- `supabase/scripts/test_integrado_cadena_307_311.sh` (new)
- `supabase/scripts/test_integrado_suites_pg.sh` (new)

### Previous batch (#1, #53, #102, #105, #106, #124, O1–O4, U1) — 253 files

- `app/(crm)/crm/personas-cotizacion/PersonasCotizacionClient.tsx` (modified)
- `app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts` (modified)
- `app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx` (modified)
- `app/(dashboard)/dashboard/contratos/[numero]/MinimoConfirmacionPanel.tsx` (new)
- `app/(dashboard)/dashboard/contratos/[numero]/page.tsx` (modified)
- `app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts` (modified)
- `app/(dashboard)/dashboard/contratos/[numero]/VouchersPanel.tsx` (modified)
- `app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx` (modified)
- `app/(dashboard)/dashboard/cotizaciones/din-actions.ts` (modified)
- `app/(dashboard)/dashboard/gestion-contratos/actions.ts` (new)
- `app/(dashboard)/dashboard/gestion-contratos/FiltrosGestion.tsx` (new)
- `app/(dashboard)/dashboard/gestion-contratos/page.tsx` (new)
- `app/(dashboard)/dashboard/gestion-contratos/SeguimientoControl.tsx` (new)
- `app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx` (new)
- `app/(dashboard)/dashboard/paquetes/actions.ts` (modified)
- `app/(dashboard)/dashboard/paquetes/total/PaqueteTotalForm.tsx` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/HotelConfigEditor.tsx` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/[id]/tarifasUnidadActions.ts` (modified)
- `app/(dashboard)/dashboard/producto/hoteles/NuevoHotelForm.tsx` (modified)
- `app/(dashboard)/dashboard/producto/programas/[id]/ProgramaImagenes.tsx` (modified)
- `app/(dashboard)/dashboard/producto/servicios/ServicioFotoCell.tsx` (modified)
- `app/(dashboard)/dashboard/reservar/nuevo/page.tsx` (modified)
- `app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx` (modified)
- `app/(dashboard)/layout.tsx` (modified)
- `app/(dashboard)/SidebarNav.tsx` (modified)
- `app/c/[token]/page.tsx` (modified)
- `app/contrato/[numero]/page.tsx` (modified)
- `app/portal/b2b/documentos/page.tsx` (modified)
- `app/tarifario/BuscadorBooking.tsx` (modified)
- `app/tarifario/BuscadorReceptivos.tsx` (modified)
- `app/tarifario/busquedaUnidadActions.ts` (modified)
- `app/tarifario/cotizacionBernaloActions.ts` (modified)
- `app/tarifario/ExploraReceptivos.tsx` (modified)
- `app/tarifario/solicitudHotelActions.ts` (modified)
- `app/tarifario/TarifarioPublic.tsx` (modified)
- `app/tarifario/tarjetaHotelCompartida.tsx` (modified)
- `app/tarifario/VistaBooking.tsx` (modified)
- `app/voucher/[token]/page.tsx` (modified)
- `CLAUDE.md` (modified)
- `components/ImagenCatalogo.tsx` (new)
- `docs/tecnico/calculadora-version-desactualizada-124.md` (new)
- `docs/tecnico/confirmacion-vencimiento-voucher-307.md` (new)
- `docs/tecnico/gestion-contratos-106.md` (new)
- `docs/tecnico/imagenes-programas-receptivos-2026-11-17.md` (new)
- `docs/tecnico/observaciones-o1-o4-2026-11-17.md` (new)
- `docs/tecnico/personas-cotizaciones-crm-1.md` (new)
- `docs/tecnico/README.md` (modified)
- `docs/tecnico/tabla-booking-ocupacion-102.md` (new)
- `lib/calc/reglaEdadTarifa.ts` (modified)
- `lib/calc/tarifaAlojamientoEditor.ts` (modified)
- `lib/cart/CartContext.tsx` (modified)
- `lib/constants.ts` (modified)
- `lib/contrato/acuerdoMinimo.ts` (new)
- `lib/contrato/condicionesContrato.ts` (modified)
- `lib/contrato/presentacionValores.ts` (modified)
- `lib/contrato/reciclaje.ts` (modified)
- `lib/contrato/reglaConfirmacion.ts` (modified)
- `lib/gestionContratos/acceso.server.ts` (new)
- `lib/gestionContratos/canales.ts` (new)
- `lib/gestionContratos/cargar.server.ts` (new)
- `lib/gestionContratos/debounce.ts` (new)
- `lib/gestionContratos/filtros.ts` (new)
- `lib/gestionContratos/presentacion.ts` (new)
- `lib/gestionContratos/tipos.ts` (new)
- `lib/hoteles/calculadoraConflicto.ts` (new)
- `lib/imagenes/reducirImagen.ts` (new)
- `lib/paqueteDinamico/menores.ts` (modified)
- `lib/personas/altaGuardada.ts` (new)
- `lib/personas/consulta.ts` (modified)
- `lib/personas/cotizacion.ts` (modified)
- `lib/portal/b2bPortal.ts` (modified)
- `lib/portal/b2bPortalServidor.ts` (modified)
- `lib/reservar/computoReservaBernalo.ts` (modified)
- `lib/reservar/edadesMenores.ts` (modified)
- `lib/reservar/solicitudHotelServidor.ts` (modified)
- `lib/tarifario/datos.ts` (modified)
- `lib/tarifario/evaluarDisponibilidadUnidad.ts` (modified)
- `lib/tarifario/fotosServicio.ts` (new)
- `lib/tarifario/resumen.ts` (modified)
- `lib/voucher/accesoVoucher.server.ts` (new)
- `lib/voucher/accesoVoucher.ts` (new)
- `lib/voucher/pagoCompleto.ts` (new)
- `pruebas/accesoVoucher307.test.ts` (new)
- `pruebas/bernaloIntegracionGuardWiring.test.ts` (modified)
- `pruebas/buscadorBookingDestinoInteraccion.react.ts` (modified)
- `pruebas/buscadorBookingPendienteInteraccion.react.ts` (modified)
- `pruebas/busquedaPorcionTerrestreWiring.test.ts` (modified)
- `pruebas/calculadoraConflicto124.test.ts` (new)
- `pruebas/calculadoraGrupos297.test.ts` (modified)
- `pruebas/capturaPersonasPorOrigen40.test.ts` (modified)
- `pruebas/composicionRecorrido.test.ts` (modified)
- `pruebas/computoReservaBernaloWiring.test.ts` (modified)
- `pruebas/contratoNetoB2B.test.ts` (modified)
- `pruebas/contratoSinItems53.react.ts` (new)
- `pruebas/cotizarFechasWiring.test.ts` (modified)
- `pruebas/cuposLiquidacionReal94.test.ts` (modified)
- `pruebas/dashboardShellWiring.test.ts` (modified)
- `pruebas/destinosAereosFlujos67.test.ts` (modified)
- `pruebas/disponibilidadServicios256.test.ts` (modified)
- `pruebas/edadesHotelUnidadU1.pg.ts` (new)
- `pruebas/edadesMenores.test.ts` (modified)
- `pruebas/edadesNocheReferencia.pg.ts` (new)
- `pruebas/empaquetadosUsd230.test.ts` (modified)
- `pruebas/etiquetaDescuentoHotel90.test.ts` (modified)
- `pruebas/evaluarDisponibilidadUnidad.test.ts` (modified)
- `pruebas/filtrosBusquedaVistaBookingWiring.test.ts` (modified)
- `pruebas/fotosServicio.test.ts` (new)
- `pruebas/gestionContratos106.pg.ts` (new)
- `pruebas/gestionContratos106.test.ts` (new)
- `pruebas/gralRetirado255.test.ts` (modified)
- `pruebas/imagenCatalogo.react.ts` (new)
- `pruebas/imagenesCatalogo.wiring.test.ts` (new)
- `pruebas/lecturasCompartidas439.test.ts` (modified)
- `pruebas/medicion102.pg.ts` (new)
- `pruebas/minimoAcordado307.test.ts` (new)
- `pruebas/minimoAcuerdo307.pg.ts` (new)
- `pruebas/ocupacionBusqueda102.pg.ts` (new)
- `pruebas/ocupacionBusqueda102.test.ts` (new)
- `pruebas/ocupacionBusqueda102Ui.react.ts` (new)
- `pruebas/paqueteDinamico82Alcance.test.ts` (modified)
- `pruebas/personasCotizaciones1.pg.ts` (new)
- `pruebas/personasCotizaciones1Carrito.pg.ts` (new)
- `pruebas/personasCotizacionesFuentes1.test.ts` (new)
- `pruebas/portalB2B65.pg.ts` (modified)
- `pruebas/precioFinalAutoritativo.test.ts` (modified)
- `pruebas/prepararSubidaImagen.test.ts` (new)
- `pruebas/reactLoaderPagoCompleto307.test.ts` (new)
- `pruebas/recorridoModalCheckout90.test.ts` (modified)
- `pruebas/reducirImagen.test.ts` (new)
- `pruebas/reglaConfirmacion288.test.ts` (modified)
- `pruebas/reglaEdadErrorSupabaseWiring.test.ts` (modified)
- `pruebas/reglaEdadTarifa.test.ts` (modified)
- `pruebas/salidaDinamicaFlujos62.test.ts` (modified)
- `pruebas/salidaVinculada63Generar.test.ts` (modified)
- `pruebas/salidaVinculada63UsdGenerar.test.ts` (modified)
- `pruebas/serviciosPaqueteWiring.test.ts` (modified)
- `pruebas/support/reactLoader.mjs` (modified)
- `pruebas/support/stubs/pagoCompletoStub.mjs` (new)
- `pruebas/tarifaAlojamientoEditor.test.ts` (modified)
- `pruebas/tarifaInfante226.test.ts` (modified)
- `pruebas/tarifaInfante226Cableado.test.ts` (modified)
- `pruebas/tarjetaBusquedaPromo90.test.ts` (modified)
- `pruebas/tarjetaCompletaBuscarAlojamiento.test.ts` (modified)
- `pruebas/vistaPreviaCobro53.test.ts` (new)
- `pruebas/voucherAcceso307.pg.ts` (new)
- `supabase/migrations/20260601000307_minimo_confirmacion_vencimiento_voucher.sql` (new)
- `supabase/migrations/20260601000308_personas_cotizacion_fuentes.sql` (new)
- `supabase/migrations/20260601000309_gestion_contratos_superadmin.sql` (new)
- `supabase/migrations/20260601000311_hoteles_edades_sin_default.sql` (new)
- `supabase/scripts/entorno_1_local.sh` (new)
- `supabase/scripts/humo_1_recorrido.mjs` (new)
- `supabase/scripts/humo_1_semilla.sql` (new)
- `supabase/scripts/local-img/faltas_off.sql` (new)
- `supabase/scripts/local-img/faltas_on.sql` (new)
- `supabase/scripts/local-img/generar_fixtures.mjs` (new)
- `supabase/scripts/local-img/generar_tarifario_img.ts` (new)
- `supabase/scripts/local-img/local-img.ps1` (new)
- `supabase/scripts/local-img/medir_cdp.mjs` (new)
- `supabase/scripts/local-img/medir_reductor.mjs` (new)
- `supabase/scripts/local-img/proxy_rest.mjs` (new)
- `supabase/scripts/local-img/resultados/after_fallas_fondo.json` (new)
- `supabase/scripts/local-img/resultados/after_fallas.json` (new)
- `supabase/scripts/local-img/resultados/after_reductor.json` (new)
- `supabase/scripts/local-img/resultados/after_reposo.json` (new)
- `supabase/scripts/local-img/resultados/after.json` (new)
- `supabase/scripts/local-img/resultados/baseline_fallas_fondo.json` (new)
- `supabase/scripts/local-img/resultados/baseline_fallas.json` (new)
- `supabase/scripts/local-img/resultados/baseline.json` (new)
- `supabase/scripts/local-img/resultados/reductor.json` (new)
- `supabase/scripts/local-img/resumir_resultados.cjs` (new)
- `supabase/scripts/local-img/semilla_img.sql` (new)
- `supabase/scripts/local-img/servidor_imagenes.mjs` (new)
- `supabase/scripts/local-img/servir_con_log.mjs` (new)
- `supabase/scripts/local-img/urls_originales.sql` (new)
- `supabase/scripts/local-img/urls_reductor.sql` (new)
- `supabase/scripts/local102/claves_local102.mjs` (new)
- `supabase/scripts/local102/dueno_auth_local102.sql` (new)
- `supabase/scripts/local102/generar_tarifario_102.ts` (new)
- `supabase/scripts/local102/guardia_red_local102.cjs` (new)
- `supabase/scripts/local102/huella_build_local102.mjs` (new)
- `supabase/scripts/local102/humo_local102.mjs` (new)
- `supabase/scripts/local102/kong.yml` (new)
- `supabase/scripts/local102/local102.ps1` (new)
- `supabase/scripts/local102/semilla_local102_usuarios.sql` (new)
- `supabase/scripts/local102/semilla_local102.sql` (new)
- `supabase/scripts/local106/captura_106.mjs` (new)
- `supabase/scripts/local106/humo_roles_106.mjs` (new)
- `supabase/scripts/local106/kong.yml` (new)
- `supabase/scripts/local106/local106.ps1` (new)
- `supabase/scripts/local106/medir_106.sh` (new)
- `supabase/scripts/local106/semilla_local106_usuarios.sql` (new)
- `supabase/scripts/local106/semilla_local106.sql` (new)
- `supabase/scripts/local106/volumen_106.sql` (new)
- `supabase/scripts/local124/claves_r124.mjs` (new)
- `supabase/scripts/local124/dueno_auth_r124.sql` (new)
- `supabase/scripts/local124/guardia_red_r124.cjs` (new)
- `supabase/scripts/local124/kong-r124.yml` (new)
- `supabase/scripts/local124/local124.ps1` (new)
- `supabase/scripts/local124/verificar_124_navegador.mjs` (new)
- `supabase/scripts/local53/ejemplos_local53.ts` (new)
- `supabase/scripts/local53/ensayo_conversion_local53.ts` (new)
- `supabase/scripts/local53/humo_local53_acciones.mjs` (new)
- `supabase/scripts/local53/humo_local53.mjs` (new)
- `supabase/scripts/local53/kong.yml` (new)
- `supabase/scripts/local53/local53.ps1` (new)
- `supabase/scripts/local53/semilla_local53_acuerdos.sql` (new)
- `supabase/scripts/local53/semilla_local53_catalogo.sql` (new)
- `supabase/scripts/local53/semilla_local53_usuarios.sql` (new)
- `supabase/scripts/local53/semilla_local53.sql` (new)
- `supabase/scripts/localreview/cargar_imagenes_revision.mjs` (new)
- `supabase/scripts/localreview/claves_review.mjs` (new)
- `supabase/scripts/localreview/dueno_auth_review.sql` (new)
- `supabase/scripts/localreview/ejemplos_revision.ts` (new)
- `supabase/scripts/localreview/guardia_red_review.cjs` (new)
- `supabase/scripts/localreview/huella_build_review.mjs` (new)
- `supabase/scripts/localreview/humo_revision_102.mjs` (new)
- `supabase/scripts/localreview/humo_revision_106.mjs` (new)
- `supabase/scripts/localreview/humo_revision_53.mjs` (new)
- `supabase/scripts/localreview/humo_revision_o3o4.mjs` (new)
- `supabase/scripts/localreview/humo_revision_u1.mjs` (new)
- `supabase/scripts/localreview/kong-review.yml` (new)
- `supabase/scripts/localreview/publicar_paquetes_revision.ts` (new)
- `supabase/scripts/localreview/revision_comun.mjs` (new)
- `supabase/scripts/localreview/semilla_revision_1.sql` (new)
- `supabase/scripts/localreview/semilla_revision_105.sql` (new)
- `supabase/scripts/localreview/semilla_revision_124.sql` (new)
- `supabase/scripts/localreview/semilla_revision_53_catalogo.sql` (new)
- `supabase/scripts/localreview/semilla_revision_53.sql` (new)
- `supabase/scripts/localreview/semilla_revision_ajustes.sql` (new)
- `supabase/scripts/localreview/semilla_revision_o3_despues.sql` (new)
- `supabase/scripts/localreview/semilla_revision_o3.sql` (new)
- `supabase/scripts/localreview/semilla_revision_u1.sql` (new)
- `supabase/scripts/localreview/semilla_revision_vinculos.sql` (new)
- `supabase/scripts/postcheck_307_minimo_vencimiento_voucher.sql` (new)
- `supabase/scripts/postcheck_308_personas_cotizacion_fuentes.sql` (new)
- `supabase/scripts/postcheck_309_gestion_contratos.sql` (new)
- `supabase/scripts/postcheck_311_hoteles_edades.sql` (new)
- `supabase/scripts/preflight_307_minimo_vencimiento_voucher.sql` (new)
- `supabase/scripts/preflight_308_personas_cotizacion_fuentes.sql` (new)
- `supabase/scripts/preflight_309_gestion_contratos.sql` (new)
- `supabase/scripts/preflight_311_hoteles_edades.sql` (new)
- `supabase/scripts/repro_124_conflicto_calculadora.mjs` (new)
- `supabase/scripts/repro_124_conflicto_calculadora.sh` (new)
- `supabase/scripts/rollback_307_minimo_vencimiento_voucher.sql` (new)
- `supabase/scripts/rollback_308_personas_cotizacion_fuentes.sql` (new)
- `supabase/scripts/rollback_309_gestion_contratos.sql` (new)
- `supabase/scripts/rollback_311_hoteles_edades.sql` (new)
- `supabase/scripts/test_1_personas_cotizaciones.sh` (new)
- `supabase/scripts/test_102_ocupacion.sh` (new)
- `supabase/scripts/test_106_gestion_contratos.sh` (new)
- `supabase/scripts/test_288c_regla_confirmacion.sh` (modified)
- `supabase/scripts/test_307_minimo_vencimiento_voucher.sh` (new)
- `supabase/scripts/test_pg_local.sh` (modified)

