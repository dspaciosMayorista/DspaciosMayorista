# Release handoff — integrated block #126 / #127 / B2B portal (2026-11-21)

Prepared by the executor for **Codex audit before any publication**. Nothing was staged, committed, pushed, merged, deployed or run remotely. No application code or migration was changed to prepare this handoff and nothing was rebuilt: the evidence below is the final-source evidence of the previous rounds (build `yst02koH-RpbWrYjRyQ1A`), **plus the two Codex findings of this round — REL-1 (fail-closed owner commands, §5) and REL-2 (old-source smoke against the complete chain, §3), each with its own targeted run only**. Two Markdown/log artifacts had a Windows user-name path redacted (see `release-126-127-b2b/excluded-paths.md`).

**Owner decisions recorded (2026-11-21).** The owner accepted locally the four corrections and existing-account recovery. **New sign-up with emailed code and recovery from a pending-registration continuation were NOT validated locally; the owner will verify them in Production. They are recorded here as PENDING — not passed.**

Companion files (all in `docs/tecnico/release-126-127-b2b/`): `commit-1-database.txt`, `commit-2-application-and-tests.txt`, `commit-3-documentation-and-tooling.txt` (exact staging lists, 70 + 283 + 106 = **459** files), `pr-body.md`, `excluded-paths.md`, and the REL-1/REL-2 artifacts `publish-release.ps1`, `test-publish-release.ps1`, `rel2-old-source-smoke.md`, `rel2-evidence-logs.txt` (the three REL-2 launch scripts live in `supabase/scripts/release_rel2/`, the two new old-source smokes in `pruebas/`). The previously accepted inventory was 449; the ten added files are exactly the REL-1/REL-2/REL-3 artifacts (8 in commit 3, 2 in commit 2); the three REL-2 launch scripts are joined by `test_rel2_exportar_viejo.sh` (REL-3: the exporter refuses an existing destination and never deletes — 14 checks, sentinel directory/file/junction and the retained export proven unchanged, a fresh destination still exports).

---

## 1. Branch and upstream

| Item | Observed (read-only, `git fetch origin main` run 2026-11-21) |
|---|---|
| Worktree / root | `.worktrees/integracion-126-127-b2b` (repository root of this worktree; the app is in `dspacios-travel/`) |
| Branch | `codex/integracion-126-127-b2b`, **no upstream configured** |
| `HEAD` | `312608a5922d4424ac912153394f4aee99357cb2` = PR #449 merge |
| `origin/main` | `312608a5922d4424ac912153394f4aee99357cb2` — **identical**; `rev-list --left-right --count HEAD...origin/main` = `0 0` |
| Staged | 0. Working tree: 148 modified tracked files, 18 085 untracked entries (17 774 excluded, see §2) |
| Local `main` of the main checkout | `f4489c721` — **stale** (behind `origin/main`). Never branch/merge from it; the PR base is `origin/main`. |

**Integration risks**
1. **Everything is uncommitted** on top of #449: one wrong `git add .` stages ~17 700 build files (the six `.next-*` folders are not git-ignored). Use the lists, never a blanket add.
2. **`main` can move before the PR.** Today there is no divergence. Re-run the divergence check immediately before pushing; if `main` advanced, stop and ask for a re-audit (migration numbers 312–326 are reserved by this block; no other branch or worktree holds a migration ≥ 312 except the source worktrees of this same block).
3. **CI:** of the nine workflows only `test-227-salida-vinculada-63` triggers on a PR to `main`, by path filters that this block matches (`lib/reservar/computo.ts`, `app/(dashboard)/dashboard/contratos/**`, `reservar/actions.ts`, `types/database.ts`, `package.json`, `pruebas/salidaVinculada63*`). It builds the schema only up to 226 + 227 (independent of 312–326) and needs Linux/Docker, so it was **not run here**; expect it on the PR. Its three touched `salidaVinculada63*.test.ts` files pass in the local unit suite. No workflow file changed.
4. **Preview and Production share one database.** The Preview built from this branch executes the new code against Production data → the migrations must exist **before the branch is pushed** (the Vercel Preview is built from the pushed branch/PR through the project's Git integration — not verifiable from here).
5. **Two `.pg.ts` suites encode pre-315 behavior** (`cierreGeneral127.pg.ts`, `cierreGeneralDinEmp127.pg.ts`: 9 tests pass only on a schema *without* 315; with 315 installed they fail by design). They are not part of the unit/React suites and no workflow runs them; a follow-up should rewrite them for the post-315 contract. Not acceptance evidence either way.
6. **Pre-existing failures that this PR does not fix** (identical names on the base): 29 unit and 26 React tests; seven stale real-action launchers (`hotelASolicitud270`, `cotizacionAsistidaB2B102`, `carritoCostoUsd236`, `programaHotel245`, `pvpInfanteFijo254`, `servicioManual64`, `gestionContratos106`) and `portalB2B65` 30/33 — whose three failing tests show a direct contract (`DTM-6501`) absent from the ally's lists, flagged earlier as a **possible real defect of the base**. They must not be read as green.
7. **Docs that mention old states** (earlier executor documents say «not audited»/«SQL unapplied») are dated history; this handoff and the audit prevail.
8. **Migration 326 was amended in place** before any real application (rule «do not edit existing migrations» concerns applied migrations; none of 312–326 is applied in Production; 325/326 exist only in the local review database and disposable copies; the review database received the amended 326).
9. **`package.json` `test:react`** is 8 106 characters (85 under the Windows command-line limit): adding more files there will break `npm run test:react` on Windows — new React tests belong in `test:react:resto`.

---

## 2. Release-file inventory and exclusions

Source of truth: `git status --porcelain=v1 -uall -z` (fresh), classified by rule and cross-checked against `docs/tecnico/integration-126-127-b2b-source-inventory.tsv` (the 350-file integration inventory with SHA-256).

| Group | Files |
|---|---:|
| Modified tracked files | 148 |
| Untracked, releasable | 311 |
| **Releasable total** | **459** (449 accepted + 10 REL-1/REL-2/REL-3 artifacts) |
| Excluded (never stage) | 17 774 (17 715 `.next-*`, 55 PNG, 1 fixture, 1 local composer, 2 browser-credential tools) |

Cross-check of the 294 code/test/migration files vs. the integration inventory: 222 identical to the integration snapshot; 25 changed afterwards (owner-feedback rounds, 325/326); 47 added after (O-1…O-4, #126 follow-ups 126-2/3/4, 325/326, the four corrections) — every one of the 19 modified-but-not-in-inventory files was attributed by diff markers (`O-1/O-2/O-3`, `R325`, #126) or by the documents that name it; **no unrelated change found**. Dependency/lock files: unchanged. New environment variable names: none. Vercel cron configuration: unchanged.

### Three commits (explicit lists, `--literal-pathspecs` because paths contain `(dashboard)` and `[id]`)
| # | Commit | Files | Content |
|---:|---|---:|---|
| 1 | Database | 70 | 13 migrations 312–319, 322–326; 13 preflight + 13 postcheck + 13 rollback; SQL/launcher tests (`test_25_*`, `test_314_*`, `test_317_*`, `test_318_*`, `test_319…326`, `test_62_recuperacion_gotrue.*`) |
| 2 | Application and tests | 283 | `app/`, `lib/`, `components/`, `types/`, `proxy.ts`, `package.json` (only `test:*` scripts), `pruebas/` (incl. `support/` and the two REL-2 old-source smokes `cierreHotelCodigoViejo315.pg.ts`, `abonoReplayCodigoViejo313.pg.ts`) |
| 3 | Documentation and local-verification tooling | 106 | `docs/tecnico` Markdown + inventory TSV + text evidence (logs, failing-name lists, build ids) + this release folder (incl. `publish-release.ps1` and its test) + `supabase/scripts/release_rel2/` (3 launch scripts + the REL-3 test); `supabase/scripts/{localreview,localreview127,localreview_integrado,real_62,pglite_cadena,pglite_319_parcial.mjs}` (precedent: 150+ rig files already tracked) |

A dry run (`git add --dry-run`) of each list matched its line count exactly (70/283/106, re-run after the REL-1/REL-2/REL-3 artifacts were added) and the index stayed empty; `publish-release.ps1 -Mode Check -Whitespace` also compares the dirty set with the three lists (459 = 459) and previews `git diff --check` on every file. Details and reasons: `excluded-paths.md`.

**Decision for the auditor:** the local-review rigs (commit 3) are tooling, not product; they follow the repository's precedent and make the evidence reproducible. The two browser-credential tools were excluded on purpose. If you prefer a leaner PR, drop the `supabase/scripts/real_62`, `pglite_cadena`, `localreview*` lines from list 3 — nothing in commits 1–2 depends on them.

---

## 3. Migration runbook (owner executes remote SQL, one stage at a time)

**Rule per stage (existing owner practice, see `remote-migrations-307-311-2026-11-18.md`):** (a) paste the **preflight** — one integral read-only query returning `control | observado | esperado | estado`; (b) only if every row is `OK` or `INFO` (no `REVISAR`/`FALLO`), paste the **migration file**; (c) paste the **postcheck** — one integral read-only query — and compare its INFO rows with the preflight's. Stop on any non-OK row or SQL error; never re-run an applied migration (its preflight will refuse: it asserts «not yet applied») and never edit applied SQL. Verified mechanically: all 26 preflight/postcheck files are a **single statement**, begin with `select/with`, contain no DML/DDL/transaction keyword, and return a status column. No agent runs remote SQL.

**Numbers.** 312–319 and 322–326; **320 and 321 were never used** (#25, #84 and #62 needed no migration). Production currently has 001–311 (307–311 applied 2026-11-18). 312/313 (#126) and 315 (#127) come from their own worktrees; 314, 316–319, 322–324 from `portal-b2b-allies`; 325/326 only from this worktree. No number is duplicated anywhere.

**Order = numeric.** It is the order validated on the chain (107/107 gated controls on a scratch database for 312–324, then 325 and 326 gated on the review database) and it satisfies every dependency (only three are real: 313→312, 325→323, 326→325; the rest need pre-existing objects checked by their own preflight).

| Stage | Migration (file `20260601000NNN_…`) | Requires (checked by its preflight) | Effect on the code **running today** (HEAD) | New code needs it | Rollback script |
|---:|---|---|---|---|---|
| 1 | **312** `abono_moneda_pago` | `abonos` | Additive nullable column `abonos.moneda_pago` + CHECK (NULL/COP/USD). Old code ignores it. No backfill: existing payments keep today's interpretation (pesos received). | Yes: documents read it | `rollback_312_…` (refuses if rows would be lost; lock timeout 5 s) |
| 2 | **313** `registrar_abono_moneda_atomico` | **312**, `registrar_abono(…10 args)` (248/288), `contrato_verificar_identidad` (284) | Adds `registrar_abono_moneda` + insert trigger `trg_f313_abonos_moneda`. **`registrar_abono` is untouched**; the trigger is inert unless the new function set its transaction-local currency (verified in the SQL), so old payment registration is unchanged. | **Yes — without it every payment registration fails with the new code** | `rollback_313_…` |
| 3 | **314** `comparativa_b2b_aliado_obligatorio` | the 211 function it replaces | `create or replace` of `crear_cotizacion_comparativa`: **only** the «B2B manual comparative without ally» branch changes from `null` to `COMPARATIVA_DATOS` (diffed against 211: 6 lines). HEAD already blocks that case before the RPC (`manual-actions.ts`), so no running flow changes; historical rows untouched. | No (database-boundary hardening) | `rollback_314_…` restores the 211 body |
| 4 | **315** `tarifario_oculta_por_cierre_general` | `hotel_blackouts` (064/145), `tarifario_fila_oculta`/`tarifario_resultado` (260), `tarifario_invalidar` (181) | Three statement triggers on `hotel_blackouts` + helper functions. **Behavior change starts at the DB stage, with the old code too:** saving/changing a general closure immediately hides published rows it closes. **No backfill** at apply time: rows already published inside existing closures change only on the next closure write or regeneration. Cost on Production data volume not measured. | No (pure DB rule; the new UI refreshes) | `rollback_315_…` |
| 5 | **316** `recuperaciones_consumidas` | — | New table, `service_role` only, RLS on, no policies. Old code ignores it. | Yes (password recovery) | `rollback_316_…` |
| 6 | **317** `neto_cotizacion_manual_independiente` | pieces of 216/222/286 (`p50_priv.sellar_hija`, `p39_priv.bloquear_para_editar`, `crear_cotizacion_manual`, `p97_priv.validar`, `cotizacion_neto`); **aborts if the function bodies it replaces differ from the audited 222/216 ones** | New `crear_cotizacion_manual_neto`; `sellar_hija` guard **widened** (old allowed set still allowed; diffed vs 222: 6 lines); `bloquear_para_editar` gains one new refusal (quotation with a NETO seal) — editable quotations are independent «simple» ones, which could not carry a NETO seal before 317 (preflight counts them), so nothing changes today. | Yes (NETO manual) | `rollback_317_…` (refuses if a NETO independent quotation exists) |
| 7 | **318** `cuenta_cobro_firma_aceptacion` | `aliados`, `fn_auditoria` (087) | Two new tables (+ immutability/audit triggers), private bucket `aliado-firmas`, two RPCs. Old code ignores. | Yes: **apply before the code** — with the new code and no 318 the cuenta de cobro shows a fail-closed notice | `rollback_318_…` (refuses if any signature/acceptance exists) |
| 8 | **319** `aliado_logo` | `aliados` (FK) | New table, private bucket `aliado-logos`, three functions. Old code ignores. | Yes (uploads; documents render without logo if missing) | `rollback_319_…` (refuses if logos/files exist) |
| 9 | **322** `clientes_aliado` | `aliados`, `fn_auditoria` | New table `aliado_clientes`, `service_role` only. Old code ignores. | Yes («Mis clientes») | `rollback_322_…` (refuses if any row) |
| 10 | **323** `solicitud_contrato_aviso` | `avisos` (281) | New table + RPC; `avisos_tipo_check` replaced by a **superset** (adds `solicitud_contrato`) and `avisos.cotizacion_id` added. Old code inserts only existing notice types. | Yes («Solicitar contrato») | `rollback_323_…` |
| 11 | **324** `registro_b2b_candados` | `usuarios`, `b2b_solicitudes`, `aliados`; **the role running the migration can `delete` from `auth.users`** (preflight control) | New table `registro_b2b_estado` + DB functions that coordinate sign-up by code (they delete an unverified account only inside the DB, only when `email_confirmed_at is null`). Nothing calls them from old code. | Yes (sign-up by code) | `rollback_324_…` (refuses if any registration is in progress) |
| 12 | **325** `evidencia_y_pasajeros_aliado_cotizacion` | `cotizaciones`, `usuarios`, **323**'s `solicitar_contrato_cotizacion` | Two new tables (CHECK: ≤ 30 passengers), private bucket `evidencias-cotizacion`, RPCs. Evidence is never a payment (no write to `abonos`/saldos). Old code ignores. | Yes (proof before confirmation, ally passengers) | `rollback_325_…` (refuses if rows exist) |
| 13 | **326** `pasajeros_aliado_tope_universo` | **325** | Replaces only `cotizacion_pasajeros_aliado_guardar` (same owner/SECURITY DEFINER/`search_path`/grants): cart-universe cap + 30-passenger technical limit with its own message. No tables, no data. | Yes (capacity rules) | `rollback_326_…` (restores the 325 function) |

**After stage 13, the old code still runs unchanged except for the two intentional DB-visible behaviors** (314 refusal for a case HEAD already blocks; 315 hiding on closure writes).

**Compatibility — now proved by a targeted smoke, not only by reading the SQL (REL-2; `release-126-127-b2b/rel2-old-source-smoke.md`, raw output `rel2-evidence-logs.txt`).** The **real old modules** of commit `312608a5922d4424ac912153394f4aee99357cb2` (PR #449 = `origin/main`; exported with `git archive`) ran their real server actions → PostgREST → PostgreSQL on a disposable database carrying the **complete final chain 001–326** (325 and 326 applied there with preflight → migration → postcheck; all 13 postchecks `OK`/`INFO`, and the same postchecks fail on the old schema as a control; 0 objects removed, 137 added). Passed: payment registration → confirmation → reversal (6/6), **replay of the same operation id** (5/5, new), minimum agreement and ally voucher gate (3/3, 10/10), quotation creation in all four origins (27/27, 6/6), quotation → contract conversion with persisted prices (5/5), and the ally-portal loaders (21/24 — **the same 21/24 and the same three failing names on the old schema**, so not caused by 312–326, but not green either). **315 is distinguished from a regression**: old `crearBlackout` succeeds and the trigger hides (does not delete) exactly the affected published rows; the row stays hidden after `eliminarBlackout` until a regeneration — the announced, intentional effect; a control on the old schema fails the same smoke as it should.

**What this does NOT prove** (do not read it into the claim): (1) the commit Vercel serves **today** — the executor cannot see Vercel; the owner confirms Production's deployed SHA is `312608a59…` (or a later commit with no application change); (2) **hosted Auth settings** — «Confirm email», the confirmation/recovery templates, the redirect allow-list, OTP length/expiry and SMTP limits are not touched by additive SQL, are not reproduced by the local rigs and stay owner checks (§6); nothing hosted was changed; (3) that the local 001–311 template equals Production (it is built from the repository migrations the owner reports as applied, not a dump); (4) the cost of the 315 triggers at Production volume, Storage buckets and browser behavior.

**After the last postcheck (still before pushing):** in Supabase → Storage confirm `aliado-firmas`, `aliado-logos`, `evidencias-cotizacion` exist and are **not public** (their postchecks already assert it); record the INFO counts.

**Auth/payment RPC summary (the sensitive ones):** payments — `registrar_abono` untouched, new `registrar_abono_moneda` (313) is what the new code calls; auth — password recovery uses table `recuperaciones_consumidas` (316), sign-up by code uses `registro_b2b_*` (324) and deletes only unverified accounts; both are `service_role`-only (anon/authenticated cannot execute or read).

---

## 4. PR title and body

**Title:** `Integrate #126/#127 follow-ups and the B2B portal block (migrations 312–326)`

**Body:** `docs/tecnico/release-126-127-b2b/pr-body.md` (paste as is; it states the migration prerequisite, what is included, what is deferred and the evidence with its limits).

---

## 5. Owner commands (reviewable text — do not run until Codex has audited and the migrations are done)

Order of events: **audit → database stages 1–13 → push → PR → ONE Preview → validate → ONE merge.** Run from PowerShell.

**REL-1 — the Git steps are now a fail-closed script, not a list of bare commands.** `docs/tecnico/release-126-127-b2b/publish-release.ps1` (Windows PowerShell 5.1) uses **one verified `git.exe`** (`--literal-pathspecs -c core.quotepath=off -C <root>` on every call), **checks the exit code of every Git call**, and throws — exit code 1, nothing further runs — on any unexpected result. Before anything is staged it requires: the repository root is this linked worktree (not the main checkout) · branch `codex/integracion-126-127-b2b` (not detached) · no merge/rebase/cherry-pick/revert/bisect in progress · **no upstream yet** · `HEAD` is the base `312608a5922d4424ac912153394f4aee99357cb2` for commit 1, or exactly *N−1* linear commits above it whose subjects **and path sets equal their manifests** for commit *N* · **index empty** and no unmerged entries · each manifest valid (exists, no blank/duplicate/absolute/`..` line, no `.next-*`, `node_modules`, `.env*`, `*.dump`, `*.png`, `*.tsbuildinfo` or excluded path, **exact expected size**, manifests pairwise disjoint) · the **working-tree dirty set equals the union of the remaining manifests exactly** (anything else dirty → stop; only plain modified/untracked entries are accepted; excluded files are counted and left alone) · no excluded path is tracked. Then it stages **only** the manifest (path list through a temporary NUL file), requires the **staged path set to equal the manifest exactly** (only `A`/`M`, none excluded), requires **`git diff --cached --check` clean**, commits, and re-verifies the commit's path set, the empty index and the remaining dirty set. If anything fails *after* staging, it restores the empty index (`git reset`) and does not commit. `Push` additionally needs `-ConfirmMigrationsApplied`, exactly three commits, nothing releasable left, `origin/main` **still equal to the base** (read from the remote with `ls-remote`), the branch **absent on the remote**, and then pushes `HEAD:refs/heads/codex/integracion-126-127-b2b`, verifying the upstream and the remote tip. There is no `--no-verify` and no force.

```powershell
# A) Verify and commit (read-only Check first; the loop stops at the first non-zero exit code)
$wt  = Join-Path $env:USERPROFILE 'Documents\DspaciosMayorista\dspacios-travel\.worktrees\integracion-126-127-b2b'
$rel = Join-Path $wt 'dspacios-travel\docs\tecnico\release-126-127-b2b\publish-release.ps1'
$steps = @(
  @('-Mode','Check','-Fetch','-Whitespace'),
  @('-Mode','Commit','-Number','1'),
  @('-Mode','Commit','-Number','2'),
  @('-Mode','Commit','-Number','3')
)
foreach ($s in $steps) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rel @s
  if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED at: $($s -join ' ') (exit $LASTEXITCODE). Nothing after it ran. Send the full output instead of retrying."; break }
}

# B) Push — ONLY after migrations 312-326 are applied AND postchecked in Production (Preview shares that database)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rel -Mode Push -ConfirmMigrationsApplied
if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED (exit $LASTEXITCODE). Nothing was pushed unless the output says PUSH DONE." }
# Then open the PR in the browser (gh is not installed here):
#   https://github.com/dspaciosMayorista/DspaciosMayorista/compare/main...codex/integracion-126-127-b2b?expand=1
# Title and body: see section 4 (paste pr-body.md).
```

Notes: the git `LF will be replaced by CRLF` warnings are the repository's normal line-ending conversion and do not affect the exit code; `-ExecutionPolicy Bypass` applies to that one process only; if a count or guard fails, stop and report instead of forcing. `Check` never stages, commits or pushes; `-Fetch` only refreshes `origin/main`; `-Whitespace` runs a read-only `git diff --check` preview of every manifest file (tracked files against `HEAD`; new files with `git diff --no-index`) so the gate is known to pass before any staging.

**How REL-1 was verified** (`test-publish-release.ps1`, scratch repositories under `%TEMP%` — a bare remote, a main repo and a *linked* worktree; the real repository is never staged, committed or pushed): rejection cases — wrong branch, detached HEAD, main checkout, existing upstream, `HEAD` not the base, pre-staged index (left untouched), unexpected untracked file, modified tracked file outside the manifests, deleted tracked file, missing manifest file, `.next-*`/PNG/`..` lines in a manifest, duplicate and blank lines, a path in two manifests, wrong list size, `Commit` without `-Number`, commit 2 before commit 1, `Push` without confirmation or without commits, trailing whitespace caught by `Check -Whitespace` and — **after staging** — by `diff --cached --check` (index restored, nothing committed), `Push` after the remote `main` moved, `Push` with an uncommitted releasable file; and **fake-git cases that force exit code 7 on one Git call at a time** (`status`, `rev-parse --show-toplevel`, `add`, `diff --cached --name-status`, `diff --cached --check`, `commit`), each asserting the run stops there with `HEAD` unchanged, an empty index and nothing on the remote. Each rejection asserts exit code 1, the expected reason, `HEAD` unchanged, empty index and nothing pushed. A scratch happy path (Check → 3 commits → Push, then re-run rejected) proves the real `add`/`commit`/`push` calls, including paths with `(dashboard)` and `[id]`. Against the **real** worktree only read-only or guaranteed-rejected invocations were run (`-RealRepoProbe`).

---

## 6. Remaining owner checks (hosted — none of these was run by the executor)

**Before the Preview (Supabase hosted, cannot be tested locally):**
1. Auth → «Confirm email» ON; «Confirm signup» template contains `{{ .Token }}`; OTP expiry (900 s recommended) and length (6 recommended; the code accepts 6–10); outbound SMTP working with acceptable rate limits (hosted defaults are low; the 60 s resend interval is also an Auth setting).
2. Recovery e-mail link: the code asks for `redirectTo = <current origin>/auth/callback?next=/restablecer`; Supabase honors it only if that origin is in the redirect allow-list, otherwise it falls back to the Site URL (Production). So **testing recovery on a Preview origin needs that origin allow-listed**; otherwise test after the merge on the Production origin (the owner's chosen path for the deferred checks). `secure_password_change` setting to be confirmed.
3. Storage buckets private (stage-13 follow-up above).

**Vercel Preview (one):** deployment Ready and tied to the head commit (a merge alone is not deployment confirmation); build succeeded; exercise the four corrected behaviors and existing-account recovery once; observe Network/Observability during actions and idle (resting 31 s should show one notification poll and no browser REST reads) — record CPU/duration/transfer only if actually observed; no unmeasured savings claim. The shared Production database is real: writes in Preview are real writes; create/clean test data only as the owner decides.

**After the merge → production verification (explicitly deferred by the owner; PENDING, not passed):**
- New B2B sign-up with the emailed code (valid code, wrong code, expired code, resend, five failures discard the unverified account, late verification race) — requires the Auth settings above.
- Recovery from a pending-registration continuation («Continúa tu registro» → recover password → set a new one without gaining access to the portal until approved).
- Then carry only the **actually outstanding** items into `VALIDACIONES_PRODUCCION.md` (it is not a pre-merge queue). Candidates besides the two above: hotel age configuration 254 DECAMERON MARYLAND / 239 OCEAN CORAL SPRING (existing item), real-data observation of #127 hiding and of payment currency documents, and the pre-existing items already listed there.

---

## 7. Evidence reused (nothing repeated for this handoff)

| Evidence | Where | Scope |
|---|---|---|
| Final local production build `yst02koH-RpbWrYjRyQ1A`, no app source newer than it; `tsc --noEmit` clean | `evidence-326/BUILD_ID-r326.txt`, `owner-review-corrections-b2b-evidence-2026-11-21.md` §7 | final source |
| Suites on the final source: unit 10 579 tests / 29 failures, React 2 148 / 26 failures — **same failing names as the retained baseline lists** (`evidence-326/*-r326.txt`; baseline equality for React and subset-of-31 for unit established in round 3); calendar 43/43, `o1o4` 45/45, `resto` 55/55 | same | final source |
| Journeys on disposable copies, real roles, compiled app: full 235/0 on the previous final build; P–S + Z (131 OK) and ZR (21 OK) re-run on the final build | `evidence-326/journey-*.log` | the sections affected by the last change were re-run |
| Integration evidence (chain 312–324, 107/107 gated controls; #126/#127/B2B journeys; resources) | `integration-126-127-b2b-evidence-2026-11-20.md`, `…-int1-int3-evidence…`, `portal-b2b-block-acceptance-2026-11-19.md`, `b2b-*.md` | block-level |
| SQL: tests 312–326 (326 A–G), rollbacks, mutation checks; 325 fixture now uses the Bogotá date | `supabase/scripts/test_*`, evidence docs | database |
| Idle/requests: no timers/effects/polling added; resting 31 s = 1 server action + 0 browser reads | evidence §4 | local only; **hosted unmeasured** |

**Not repeated, with the reason:** no rebuild (no application source changed since `yst02koH`); no suite re-run (no code changed); journey sections T, V, W, X, Y and U were not re-run after the last change (unaffected by capture-capacity logic; recorded in the R326-1 addendum). The migration chain was validated before 325/326 existed; 325/326 were gated separately on the review database.

---

## 8. Questions for Codex

Already answered by Codex in the previous audit and applied: (1) numeric order 312→326 accepted; (3) local-review rigs stay in commit 3; (4) PNG/fixture/credential-tool exclusions accepted; (5) the two pre-315 `.pg.ts` suites are tracked separately (follow-up, not release evidence). Open for this round:

1. **REL-1:** does `publish-release.ps1` (§5) satisfy «fail closed, reviewable, one verified Git, exit code checked after every call, worktree/branch/upstream/empty-index guards, exact staged path sets, excluded paths rejected, `diff --cached --check` before each commit, one final push»? Note the deliberate choices: it restores the empty index if a check fails after staging; `Push` re-reads the remote `main` and refuses if it moved; the whitespace preview found two real documentation defects (fixed: trailing spaces in a generated log, one extra blank line at the end of `owner-review-corrections-b2b-evidence-2026-11-21.md` — documentation only).
2. **REL-2:** do you accept the old-source smoke (§3, `rel2-old-source-smoke.md`) as the compatibility basis for Stage 1, with the three limits stated there left to the owner (Vercel's deployed SHA, hosted Auth settings, Production volume/cost of the 315 triggers)?
3. The `portalB2B65` result (21/24, same three failures on the old schema) still carries the earlier note that the base may have a real defect (a direct contract absent from the ally's lists). Do you want it investigated before the merge, or kept as a tracked follow-up?
