# Integration #126 + #127 + B2B block — integrated evidence for Codex audit (2026-11-20)

Worktree `integracion-126-127-b2b` (base 312608a59, nothing staged or committed). Baseline = clean worktree at 312608a59 (`C:/tmp/base126`).
Status: **evidence complete for audit; NOT handed to the owner.** Sections 1–7: database/action evidence; section 8: integrated production build, real-browser journeys, responsive, documents, request counts and resources; the review environment and the single walkthrough are prepared (see `integration-126-127-b2b-owner-walkthrough-2026-11-20.md`). No staging, commit, push, remote SQL or deployment.

## 1. Defect found and fixed by the integration (not visible in either block alone)

`#78` (B2B) added `cotizacion_id` to the public avisos payload (`AvisoVista`, `lib/avisos/actions.ts`); `#86/#281` audits that the payload is exactly `creado_en, href, id, leido, numero_contrato, tipo`.
Result on the integrated tree: `soportesPago281` 31/36 (35/36 on the unmodified-schema run) → test «destinatarios inequívocos; el contenido no revela datos…» failed.
Fix: `cotizacion_id` is still read server-side to compute `href` but no longer returned to the browser (`lib/avisos/actions.ts`, `lib/avisos/presentacion.ts`).
After: `soportesPago281` **36/36** on the integrated schema (baseline 36/36); `avisosSolicitudContrato78`, `campanaAvisos86`, `avisosTarifario` React tests 16/16; `tsc --noEmit` clean.

## 2. Migration chain

Ordered chain 312, 313, 314, 315, 316, 317, 318, 319, 322, 323, 324 with preflight/postcheck gates: 107/107 controls on a scratch DB; applied with gates to a copy of the owner data (`rev_verif_int`), whose ACL/policy/trigger signature matched the origin before applying. 315 absent and 315 installed variants kept separately (§4).

## 3. Reconciled inventory of the 31 real-action files (`pruebas/*.pg.ts`)

Method: failing test **names** compared with the baseline; runner `test_pg_local.sh` unless a dedicated launcher is named.

### 3a. Green on the integrated tree (22)

| File | Result | Note |
|---|---|---|
| alcance262, cierreGeneralSolicitud127, cierreGeneralUnidad127, edadesHotelUnidadU1, edadesNocheReferencia, financieroContrato210, medicion102, minimoAcuerdo307, ocupacionBusqueda102, pagoUsdConversion2611, personasCotizaciones1, personasCotizaciones1Carrito, programaHoteles252, resumenContrato94, unidadTablaRechazosUsd2611, voucherAcceso307 | all pass (86, 8, 8, 12, 18, 12, 1, 3, 19, 6, 27, 6, 11, 10, 5, 10) | 16 files |
| pagoUsdTrm126 | 31/31 | needs `PG126_PLANTILLA` = a template with the chain (default `plantilla304` absent); first 22/31 was environment |
| cierreGeneral127, cierreGeneralDinEmp127 | 36/36, 9/9 | **only on the 315-absent template** (`plantilla_int_315off`); see §4 |
| soportesPago281 | 36/36 | own harness `test_281_acciones.sh` without replaying 281/284/285 (already in the template); baseline 36/36 |
| perfilAtomico283 | 8/8 | own launcher; baseline 8/8 |
| netoNinoGratisReal2611 | 5/5 | with its documented seed `semilla_revision_125.sql`; without it 4 fixture failures (identical on baseline) |

### 3b. Failing, names identical to the baseline (9) — not caused by the integration

| File | Integrated vs baseline | Note |
|---|---|---|
| carritoCostoUsd236 | 17 vs 17 | same names |
| cotizacionAsistidaB2B102 | 13 vs 13 | same names |
| hotelASolicitud270 | 29 vs 29 | same names (fixture/template) |
| programaHotel245 | 12 vs 12 | same names; own launcher 27 pass/12 fail on both |
| pvpInfanteFijo254 | 5 vs 5 | same names |
| servicioManual64 | same names | |
| gestionContratos106 | own launcher on a template with 309 rolled back: 61/62 vs 54/55 | the single failure («superadmin ve ambas agencias…») is identical on both |
| portalB2B65 | **CURRENT: 30/3** after the two test-helper repairs (§7c) — the 3 failures (A, Cartera, Inicio) also fail on the baseline file. *History (superseded):* an earlier pass showed 29/4 with the React loader, identical on the B2B-alone worktree; the extra failures were async server components + a stale assertion, repaired in §7c. | the three base failures are a possible real base defect (direct contract `DTM-6501` absent from the ally's lists), not an accepted fixture quirk |
| contratoManualNeto206 | load failure on both; **not run through its own launcher** (needs a published-port container) | coverage gap |

Dedicated launchers `test_270_e2e`, `test_238_asistida_b2b`, `test_236_app_carrito`, `test_254_app_infante`, `test_64_servicio_manual` abort within seconds on integrated **and** baseline templates (they re-apply migrations or assert older fingerprints). They give no evidence either way; the in-runner results above are what we have.

Total: 22 + 9 = 31. Earlier «17 green + 11 baseline-failing = 28» omitted soportesPago281 (no compatible prefix), perfilAtomico283 and pagoUsdTrm126; corrected here.

## 4. #127 — migration 315 absent vs installed

* 315 **absent** (`plantilla_int_315off`): 36/36, 9/9, 8/8, 8/8 (61/61). These files assert the pre-315 behavior of «save closure without regeneration» and are the fixture phase.
* 315 **installed** (`plantilla_int`): 29/36 and 7/9 in the two files; the 9 failures (R2, S2, S3, S4, T5, G1-1, G1-2, DIN1, EMP1) are the tests that presuppose 315 absent (stale row still published). They are **not acceptance evidence**. Passing with 315 installed: M0 idempotence and non-callable by app roles, M2 trigger = application rule on 7 closure shapes, M3/M3b immediate hiding and fail-closed, M4 no unaffected hotel touched, DB1, P4, S6.

## 5. Unit / React

Failing-name comparison vs baseline: no new failures (unit baseline 10,158/30; React baseline 2,010/13).

## 6. Open — HISTORY (superseded: everything listed here was completed in §8 and in the INT1–INT3 evidence)

Integrated production build; stack on the owner-data copy; B2B, recovery, NETO, #126, #127 browser journeys; cross-block journey; responsive 1280/820/390; documents; request counts and idle measurements; seeded review DB and the single walkthrough.

## 7. Follow-up (owner instruction 2026-11-20): launchers, 206, portal reconciliation

### 7a. `contratoManualNeto206` through its dedicated launcher (`test_206_app_rpc.sh`)
The stock launcher replays 206/208 and reaches Postgres through a published port. A scratch copy (deleted afterwards) skips the replay (already in the templates), reaches `pgb2b` by container IP and sets a synthetic RNT on the scratch `agencias` row (the plain templates (001–324, no owner data) have an empty Mayorista RNT, so documents refuse to render by design — #49; the owner-data copy already carries the synthetic RNT).
* Integrated: **85/87**. The two failures (`NETO-ED1`, `NETO-ED4`) assert «confirmation minimum = NETO total»; migration 307 (#53, already in the base) made NETO use the same rule as PVP (default 30 %, `606.000` of `2.020.000`). The test file was last changed in #445, **before** 307, and the integration does not touch it (empty diff against 312608a59). Stale assertion, not caused by the integration; not provable by a baseline run (see below).
* Baseline: 2/87 — the first test (`F1`) fails on its own form-text assertion and everything after it cascades («No tienes una sesión válida»). The baseline run is therefore not informative either way.
* Review-environment consequence: none for the owner-data copy (RNT `RNT-REVISION-SINTETICO` already there); with real production data an empty Mayorista RNT blocks Mayorista documents by design.

### 7b. Dedicated launchers that aborted «within seconds»
Cause: every launcher replays migrations (236, 238/239/240/241, 244–247, 249–251, 254, 255–271, 309) on a template at an older level; the integrated and baseline templates already contain them (e.g. «309: ya existe», «256 ABORTADA: huella de la 254», «236: ya existen objetos», «cannot drop columns from view» in 239). Repair: scratch copies (`_tmp_*`, generated by a patcher, deleted after the run) that skip the replays (`PG64_APLICAR_249/250/251=0` for 64; the 255–271 block removed from the 270 environment). Results are now **real runs, identical to the in-runner results**:

| File | Integrated | Baseline | Same failing names |
|---|---|---|---|
| hotelASolicitud270 | 0/29 | 0/29 | yes |
| cotizacionAsistidaB2B102 | 96/116 | 96/116 | yes |
| carritoCostoUsd236 | 1/18 | 1/18 | yes |
| programaHotel245 | 27/39 | 27/39 | yes |
| pvpInfanteFijo254 | 15/20 | 15/20 | yes |
| servicioManual64 | 81/97 | 81/97 | yes |
| gestionContratos106 | 61/62 | 54/55 | yes (1 each) |

Root causes sampled: fixtures that freeze a cart/quotation price of `1` or a «Estandar» category now rejected by later guards («el precio cambió desde que se generó la cotización (antes 1, ahora 600000)», «tipo de habitación no configurado»). These suites are **stale against the current base**; they cannot give evidence for the integration deltas either way. Coverage of the integration deltas comes from the files that run green: `pagoUsdTrm126` (31), `edadesHotelUnidadU1`/`cierreGeneralUnidad127` (unit hotel + closure), `cierreGeneralSolicitud127` (G2 request path), `soportesPago281` (36), `portalB2B65` (below). Repairing the stale fixtures is out of scope; listed for Codex.

### 7c. `portalB2B65` — reconciled with the documented 30 pass / 3 fail
Same file, same launcher (`test_65_portal_b2b.sh`, PostgREST max-rows 1.000):
* Documented earlier: 30/3 (A, Cartera, Inicio — also failing on the baseline file, same names).
* *History (superseded by the 30/3 result below):* observed 29/4 (the fourth: «datos de la ficha editados por personal interno (teléfono)…») and, under the generic runner, a fifth («ningún cargador ni página… costos») plus «el tope es real» (that one is the runner not setting PostgREST max-rows).
* Cause of the extra failures: the profile page gained **async server components** (`FirmaAliadoSeccion` #98, `HistorialPerfil` #25, created 2026-11-20 12:07–12:09, after the documented 30/3 run). The test helper rendered with `renderToStaticMarkup`, which cannot resolve them → «A component suspended while responding to synchronous input». The teléfono test also asserted that, after resetting the phone, the number no longer appears anywhere on «Mi perfil»; the new history intentionally shows «Teléfono: 3100650001 → —».
* Repair (test-only, in `pruebas/portalB2B65.pg.ts`; flagged for Codex because the file is B2B-audited): render with `renderToReadableStream` + `allReady`; the final assertion now excludes the history section and asserts the history records «3100650001 → —».
* Result on the integrated schema: **30/3** — exactly the three documented failures (A, Cartera, Inicio: the direct contract `DTM-6501` is absent from the ally's lists; identical on the baseline file). That behavior predates the integration; it should be looked at as a possible real defect of the base, not accepted as a fixture quirk.

### 7d. Avisos payload correction
Preserved (§1). Regressions covering it: `soportesPago281` 36/36 (payload key set), `avisosSolicitudContrato78`, `campanaAvisos86`, `avisosTarifario` (16).

## 8. Integrated build, real-browser journeys, resources (final tree)

### 8a. Production build
`next build` on the final integrated tree: **exit 0** (compiled, TypeScript finished in 32.8 s, 17/17 static pages). History: attempt 1 and 2 died in the type check with `JavaScript heap out of memory` at ≈2 GB heap — **not** the memory guard: Next runs the type check in a child process that does not inherit `--max-old-space-size`; fixed by passing the limit through `NODE_OPTIONS` (attempt 3 → exit 0). Free memory at launch ≈4.9 GB; the guard did not kill it. The helper is now in the repo: `supabase/scripts/localreview_integrado/app_integrada.mjs` (`HEAP_MB`, default 4096).

### 8b. Real app (Edge, Playwright, GoTrue/PostgREST/Storage/Mailpit through the gateway) on the compiled build
| Journey | Database | Result |
|---|---|---|
| Consolidated B2B driver (`escenarios_b2b.mjs`: firma #98, logo #32, historial #25, solicitud #78, clientes #76/#77, registro por código #62 incl. R19/R20, agentes/tabs T7 at 1280/820/390) | clone of `plantilla_int` | **173 controls, 0 FALLO**; layout: 66 captures, 0 overflow |
| Password recovery (`escenarios.mjs`, incl. lost responses / cut connections) | same | **123 controls, 0 FALLO**; 48 captures, 0 overflow |
| NETO (`escenarios_48.mjs`) | same | **38 controls, 0 FALLO**; 24 captures, 0 overflow |
| #127 hotel closure (`humo_127.mjs`, 1366/820/390) | `rev_int_127` (clone of `plantilla_int` + `semilla_127`) | **96 OK, 0 FALLO** (save+regenerate = 1 server-action POST; closed stay hidden; boundary stays still offered; stale checkout link shows the closure message) |
| #126 (`humo_126.mjs`, 1366/1024/390: USD payments with their own TRM, documents, reports, unit-hotel menores, solo-infante group, promo badge, latest-trip list) | `rev_verif_int_126` (owner-data copy + 312–324 + `seed126a–e`) | **183 OK, 0 fallo, 0 omitido**; «registrar un pago» = 1 POST, 0 REST; idle = no requests |
| **Cross-block** (scratchpad `cruce_final.mjs`): `DTM-12601` (USD, two payments at 4.100 / 4.200) linked to ally `aliado@` and seen in the B2B portal, desktop and mobile | same copy | **22 OK, 0 FALLO**: «Pagos» shows `USD $700`, `USD $300`, balance `USD $0`; receipts `/recibo/58` and `/recibo/59` open in USD; no COP equivalent (1.230.000 / 2.940.000 / 4.170.000) mixed in; no horizontal overflow; 20 s idle = 0 new requests |

Tooling adjusted (repo, flagged for Codex): `pila.sh` (`PILA_DB`, `PILA_SIN_MIGRACIONES`, `PILA_STORAGE_DIR`, `PILA_OTP_EXP`; existing-DB check now uses `-t -A`), `revision_comun.mjs` (`REV_CFG_DIR`), `humo_126.mjs` (`REV_PG`). Ports in the integrated config moved to 54381–54384 (54371 is held by the antivirus service).

### 8c. Final unit / React suites (after the avisos correction and the two portal-test repairs)
Unit **10,501 tests / 30 fail**, React **2,144 / 13 fail**; failing test names **identical to the clean baseline** (0 only-in-integrated in both). The baseline counts were 10,158/30 and 2,010/13 (the integrated tree adds the tests of the three sources).

### 8d. Resources and consumption (under `VALIDACION_CONSUMO_VERCEL.md` policy: no polling, no request per card, nothing after the action)
* `next start`: 255 MB resident. Stack containers: Postgres 460 MB, PostgREST 103 MB, Storage 73 MB, GoTrue 19 MB, Mailpit 10 MB → ≈0.9 GB in total; the whole review needs ≈1.5 GB.
* Idle: no browser-originated requests in any scenario (B2B portal 20 s idle, #126 idle checks, #127). A hotel search = 2 server calls; saving a closure = 1; registering a payment = 1.
* Not measured (no instrumented Vercel/production environment locally): invocation counts under real traffic and edge/cache behavior.

### 8e. Review environment
`rev_verif_int_revision` (container `pgb2b`): owner-review data copy + migrations 312–324 + `seed126a–e` + `semilla_127` + users `admin127@`/`venta127@` + `DTM-12601` linked to `aliado@`. Read-only sanity (7 pages by 5 roles) 200/0 failures, repeated after a stop/start cycle of the launcher `revision_integrada.ps1` (detener 8 s, iniciar 23 s). `pg304` is restarted at the end of this work; `aiomotor-db` untouched.

### 8f. What is NOT claimed
* The nine stale suites (§3b/§7b) and the three `portalB2B65` failures are base defects, not evidence for or against the integration.
* Walkthrough steps were written from the smoke scripts and doc; labels such as «Registrarme» were not re-verified by hand in the UI.
* No test of real payment/mail providers, Vercel deployment, or production data; migrations 312–324 are still unapplied in production.
