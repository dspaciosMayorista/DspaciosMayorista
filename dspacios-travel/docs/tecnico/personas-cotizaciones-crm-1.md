# #1 — Every identifiable customer and passenger of a quotation is searchable in the CRM before any contract exists

Task #1 (formerly #42). Branch `claude/1-crm-cotizaciones-personas`, worktree `dspacios-travel/.worktrees/1-crm-cotizaciones`, based on `origin/main` 51ea60612 (fetched at execution time; the local `main` was 19 commits behind). **Status: implemented and executor-verified locally. NOT audited by Codex, NOT owner-reviewed, nothing staged, committed, pushed, deployed or run remotely.** Migration 308 is prepared but **not applied anywhere except disposable local databases**.

## 1. Requirement

Every identifiable customer (titular) and passenger supplied when a quotation is created or updated becomes consultable in the CRM, for manual/dynamic quotations, the Tarifario/cart, dynamic packages, hotel-on-request requests and internal Reservar. Conversion to a contract is never a prerequisite. Origin, channel, advisor, ally and tenant are provenance, not reasons to omit a person. Tenant visibility and permissions are unchanged.

"CRM" here means the persons registry introduced by #42 / migration 219 (`personas`, `persona_capturas`, `cotizacion_participantes`) and its list `/crm/personas-cotizacion` (`crm_personas_cotizacion_buscar`). The auxiliary `crm_contactos` row written by the public checkout is a separate campaign-recipient effect and was left as it was.

## 2. What already worked (verified, not re-implemented)

Real Server Actions → PostgREST → PostgreSQL, on `origin/main` code (`/c/tmp/base1`, a clean detached worktree):

| Source | Creation | Update / retry |
| --- | --- | --- |
| Manual / dynamic quotation (`crearCotizacionManual`) | titular registered | `actualizarTitularCotizacionManual`: one record per document, same envelope retry does not duplicate |
| Reservar (`crearCotizacion`) | titular + each identified passenger; blank rows skipped; same person as titular and passenger = one record, two seats | — |
| Dynamic package, internal staff and B2B ally (`crearCotizacionDin`) | titular registered | — |
| Tarifario cart (`crearSolicitudReserva`), visitor, internal staff, B2B ally | titular registered (visitor = provisional capture, no document type, decision D-6) | — |
| Isolation | other agency sees nothing; another advisor sees nothing; ally sees only its own; unauthenticated callers rejected; the fachadas are not callable with a user session | — |

## 3. Gaps reproduced on `origin/main` (7 of 18 + 1 of 5 scenarios fail on the baseline)

| Gap | Scenario | Baseline behaviour |
| --- | --- | --- |
| A. Public dynamic-package visitor | D1 | person exists only in `crm_contactos`; the persons registry rejected it (`no_autorizado`, only `carrito` could be anonymous) |
| B. Hotel-on-request (`pendiente_tarifa`) | S1, S2, S4, S5 | no seat until an operator loaded the net rate (`cotizacion_no_abierta`); if never valued, the customer was never in the CRM list. A B2B session request was not sealed to the ally |
| C. One invalid person blocks everyone | R3 | the fachada is atomic: one passenger with an 80-digit document rejected the whole call and the titular and the valid passengers were left out (only an on-screen notice, and "Reintentar" would fail forever) |
| D. Replay does not repair | S3, C4 | a repeated request (same `clave_envio`, or the same hotel request) returned its "already created" answer without re-running the registration, so a first failure was never repaired automatically |
| (no gap) | I1–I5, M1, R1, R2, D2, D3, C1–C3, C5 | already correct |

Contacts-collision note: the auxiliary `crm_contactos` insert silently ignores a unique-index collision (same email/phone/document). That used to be the *only* record for sources A and B, so a different person sharing a phone number was dropped. With A and B now in the persons registry (identity by document, contact data as observations) that omission no longer affects searchability. The auxiliary contact itself is unchanged.

## 4. Implemented paths

* **Migration `20260601000308_personas_cotizacion_fuentes.sql`** (additive; `create or replace` of two 219 functions only, generated from the exact 219 text with asserted substitutions):
  * `registrar_personas_cotizacion` accepts `pendiente_tarifa`; anonymity now also covers a dynamic-package quote with no creator/owner/ally (`tipo = 'manual'` and `paquete_din_id`) and a visitor's hotel request (`tipo = 'tarifario'` and `creado_por is null` and `paquete_armado_id`). The rule does not depend on the state, so the later registration after the net rate is loaded follows the same rules as the first.
  * `sellar_creador_cotizacion` accepts `pendiente_tarifa` so a B2B/staff session request is sealed to its author.
  * No tables, columns, data, grants (only service_role executes) or owners change; `actualizar_titular_cotizacion`, the CRM list and the document lookup are untouched.
* `lib/personas/cotizacion.ts`: `esCotizacionAnonima` mirrors the SQL rule; `FilaCotizacionPersonas` gains `creado_por`, `paquete_din_id`, `paquete_armado_id`; one shared column list `COLUMNAS_COTIZACION_PERSONAS`.
* `lib/personas/consulta.ts` (`altaPersonasCotizacion`): if the batch is rejected with a **per-person** code, only then it registers the participants one by one so a single bad record no longer blocks the rest; the failure is still reported (notice + log without personal data). **Positive list (audit F2):** only these codes, which depend on one person's data, allow the one-by-one pass: `original_demasiado_largo`, `nit_dv_sin_nit`, `nit_dv_invalido`, `observaciones_invalidas`, `campo_no_admitido`, `participante_vacio`, `tipo_no_admitido`. Anything else — authorization/state/tenant/batch-structure codes, timeouts, connectivity, unknown or unparsable messages — stops after the first call; a non-person failure that appears *during* the one-by-one pass stops it at that call.
* `lib/personas/altaGuardada.ts` (new): `leerFilaCotizacionPersonas` (typed read of the stored row) and `altaPersonasDeCotizacionGuardada` (idempotent registration/repair from the stored row; **audit F1:** with `sellar` it also recovers a missing creator seal, only when the stored row has no `creado_por_id`). Kept out of `consulta.ts`, which is a pure RPC client by contract.
* `din-actions.ts`: the registration is no longer exclusive of session users; the visitor is registered as an anonymous dynamic-package quote. The auxiliary campaign contact is kept.
* `solicitudHotelActions.ts`: registers (and seals, when there is a session) at creation; a repeated request repairs the registration and, for a user with a session, recovers the seal.
* `checkout/actions.ts` (`cotizacionDeClaveEnvio`): the same intent repeated (same verified `actor_envio`, same content hash) repairs the registration and the seal. A different actor or content gets `clave_en_uso` before anything runs.
* **Why recovering the seal is safe:** it reuses `sellar_creador_cotizacion` unchanged — the database grants it only to the user whose e-mail equals `creado_por`, on a row with no previous seal, within 15 minutes of creation, for `tarifario`/`carrito` quotations. Another ally, staff member or visitor repeating the request gets `sello_no_admitido`/`sello_ajeno` and adopts nothing; after 15 minutes nothing is recovered (`sello_vencido`).
* `reservar/actions.ts` (`asignarNetaSolicitud`): repeats the idempotent registration with the real row (uses the shared helper; `reservar/actions.ts` still has no #39 columns, as its guard requires).
* `cotizaciones/[id]/page.tsx`: the pending-people notice and "Reintentar" also cover `pendiente_tarifa`.
* Scripts: `preflight_308_…`, `postcheck_308_…`, `rollback_308_…` (restores the exact 219 text), `test_1_personas_cotizaciones.sh`.

Reused, not changed: identity/normalisation/deduplication (`p214_priv.upsert_persona`, document-based identity), "an identified row = document or name or surname", no persons from counts, provisional captures for anonymous sources, role/tenant visibility of the list.

## 5. Evidence (independently run in this session)

* Real-database tests (disposable DB cloned from `plantilla304` in `pg304` + migrations 303–306 and 308, PostgREST, real actions, JWT sessions):
  * `pruebas/personasCotizaciones1.pg.ts` — now 27 scenarios (S7–S9 added for audit F1), **27 pass**; the original 24 on the baseline code and schema: **7 fail** (R3, S1, S2, S3, S4, S5, D1).
  * `pruebas/personasCotizaciones1Carrito.pg.ts` — now 6 scenarios (C6 added for F1), **6 pass**; baseline: **1 fails** (C4).
  * Launcher: `sh supabase/scripts/test_1_personas_cotizaciones.sh <container> <template> [con308|sin308]`.
* Unit / wiring: `pruebas/personasCotizacionesFuentes1.test.ts` (anonymity rule, bounded fan-out, migration/rollback/action wiring). Updated three guards whose text encoded the old structure (`capturaPersonasPorOrigen40`, `paqueteDinamico82Alcance`) — the inventory guard had a blind spot: the hotel-request creator was not in the "must register people" list.
* Full unit suite (`test:unit`), re-run after the audit corrections: 9,818 tests, 9,788 pass, 30 fail; the failing test names (49 unique lines) are **identical** to the clean `origin/main` run (0 new, 0 fixed by accident). `test:react` was not run (the only React change is one label in the CRM list; it is covered by the navigated check below).
* Scoped TypeScript check of every changed file and its import graph: clean (apart from CSS-module declarations that only `next build` generates). ESLint on all changed files: 0 errors, the same 4 warnings as the baseline.
* Migration scripts on a disposable DB: preflight OK → apply → postcheck all OK → re-apply (idempotent) → rollback (postcheck then flags the three expected FALLAs) → re-apply.
* **Final local production build, after the audit corrections** (`next build`, Turbopack, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399` so the same build serves the navigated check, no `.env*`, watchdog floor 400 MB): compiled, TypeScript finished (20 s, warm cache), static pages generated, **exit 0**, minimum free memory 566 MB. Log: `C:/tmp/evidencia_1/build_produccion_final.log` (UTF-16; the first build, before the corrections, was exit 0 with TypeScript in 69 s and 116 routes, `build_produccion_local.log`). Earlier attempts of the first build were stopped by my own memory watchdog (249 MB / 186 MB free); nothing else was killed.
* **Executor visual checks, first pass** (real components with synthetic rows, built CSS, headless Edge): the CRM list label and the pending-tarifa ficha notice at 390 px. Superseded for the journeys by the navigated check in section 9.
* **Navigated check on the running compiled app (section 9):** `sh supabase/scripts/entorno_1_local.sh pg304 plantilla304 <out>` (disposable DB + migrations 303–306/308 + synthetic seed `humo_1_semilla.sql` + PostgREST + minimal auth proxy + `next start`) and `HUMO_SALIDA=<out> node supabase/scripts/humo_1_recorrido.mjs`: **34/34 checks OK**. Not covered: print/PDF; real GoTrue login (the session is a signed cookie accepted by the minimal proxy, as in the other local rigs).

## 6. Request counts and loop review (VALIDACION_CONSUMO_VERCEL.md)

HTTP requests to PostgREST per action (counted at the client, real actions, same data):

| Action | Baseline | Now | Why |
| --- | --- | --- | --- |
| `crearCotizacionManual` | 4 | 4 | unchanged |
| Reservar `crearCotizacion` (titular + 2 passengers) | 30 | 30 | unchanged (already one registration RPC) |
| `crearSolicitudReserva` (cart, visitor) | 8 | 8 | unchanged |
| `crearCotizacionDin` (visitor) | 8 | 9 | +1 registration RPC |
| `crearSolicitudHotel` (visitor, new) | 12 | 13 | +1 registration RPC (+1 seal RPC when there is a session) |
| `crearSolicitudHotel` repeated | ≈10 (derived: creation minus the insert and contact insert) | 12 | +1 row read +1 RPC, only on a repeated request |
| `asignarNetaSolicitud` | n | n + 1 | +1 row read (shared helper), operator action |
| `crearSolicitudHotel` repeated, B2B user, seal missing (F1) | n/a | 17 | the 12 of an anonymous repeat + auth/B2B context reads of a session + 1 seal RPC |
| same, seal already present | n/a | 16 | no seal call (the stored row already has `creado_por_id`) |
| `crearSolicitudReserva` replay by the same key, B2B, seal missing (F1) | n/a | 13 (12 once sealed) | one extra seal RPC only while the seal is missing |
| Failure path, batch rejected for **non-person** reasons (F2) | 1 + N (timeout was fanned out) | **1** | exact counts asserted in `personasCotizacionesFuentes1.test.ts` |
| Failure path, one invalid person (F2) | 1 + N | 1 + N (unchanged, bounded by the quotation's participants) | one call per participant, stops at the first non-person failure |

Loop / retry review: no React effects, polling, timers or client retries were added (the notice is an existing client component rendered in one more branch). The only new fan-out is the per-person fallback: runs once, only after a **per-person** rejection of a batch of two or more, at most one call per participant of that single quotation (the fachada admits 60), no retry afterwards and nothing recursive; any failure that is not one of the seven per-person codes does not fan out (unit-tested with exact call counters per failure class: 1 call; invalid-person path = 1 + participants; a system failure inside the one-by-one pass stops it). The only new call on a replay is the seal RPC, and only while the seal is missing. Repeated saves are idempotent (capture id `md5(ref:alta:level)`; checked by repeated, replayed and 5-way concurrent calls). Not measured: Network/Observability on a Preview.

## 7. Limitations (stated, not hidden)

1. **No backfill.** Existing quotations, public dynamic-package quotes and hotel requests without seats stay as they are. The preflight counts them (informative).
2. **Anonymous captures stay provisional (D-6).** The same visitor submitting twice creates two provisional records until staff promote them; the persons registry never merges them on its own. A signed-in ally/staff member with a document type resolves to a single record (tested).
3. **Concurrent identical hotel requests can still create more than one quotation** (a read-then-insert race that predates this work). Each quotation gets exactly one seat; the extra quotation is not removed.
4. A quotation that stops being `abierta`/`pendiente_tarifa` (discarded, converted, expired) before its registration succeeds can no longer be registered; the fachada rejects it.
5. A request repeated by a *different* actor (another ally, staff, a visitor) never adopts the quotation: it is not sealed to them and a B2B/visitor repeat registers nothing (tested S8). The seal is recovered only for the original author, within 15 minutes of creation (S9: after 20 minutes it is **not** recovered and the people stay pending with the notice — deliberately, so a stale unsealed quotation can never be claimed); a staff-visible quotation can still be retried from its ficha.
6. The per-person fallback reports the failure but cannot fix bad data: the invalid passenger stays pending (notice + log) until corrected at source.
7. Typed Supabase types do not know `cotizaciones.paquete_din_id` (migration 275); it is typed once in `altaGuardada.ts`.
8. Not run: print/PDF, a real GoTrue login (the navigated check and the real-action tests use signed sessions behind a minimal auth proxy), `test:react`, Preview, remote SQL. The local shared containers were not modified: only `pg304` was started (it was stopped) and is stopped again; the disposable databases `tpg_*` are dropped by the launcher.
9. `pendiente_tarifa` also appears as the raw state code anywhere else a quotation state is rendered without a label map; only the CRM list was checked.

## 8. Order of delivery (owner executes everything remote)

preflight 308 → migration 308 → postcheck 308 → deploy the code. With 308 and the old code nothing breaks (the new fachada branches are only called by the new code). Code before 308 is safe too: the new calls fail with a logged code and leave the pending-people notice (the quotation is never blocked). Before applying, confirm 308 is still free (`ls supabase/migrations | sort | tail` on the delivery branch; #53 holds 307).

## 9. Codex audit 2026-11-17 (F1–F4): corrections and evidence

Audit report: `docs/tecnico/codex-review-crm-1-2026-11-17.md` (primary checkout). Nothing was staged, committed, pushed, deployed or run remotely; migration 308 is unchanged (the corrections are code and scripts).

| Finding | Correction | Evidence (executed in this session) |
| --- | --- | --- |
| **F1** replay did not recover a failed B2B creator seal | `altaPersonasDeCotizacionGuardada(..., sellar)` re-requests `sellar_creador_cotizacion` when the stored row has no `creado_por_id`; the hotel-request replay passes `!!user`, the cart replay passes `actor !== "anon"` (the verified `actor_envio`). The database rule is untouched, so only the original author (e-mail = `creado_por`, < 15 min, no previous seal) gets it. | Real actions on PostgreSQL: **S7** (seal revoked on creation → grant restored → same user repeats → `creado_por_id` = that user, one titular seat, visible to that ally and staff only, third repeat does not duplicate and skips the seal call), **S8** (another ally, a visitor and staff repeat → no seal, no seats for ally/visitor; original author recovers), **S9** (backdated 20 min → not recovered), **C6** (cart: other actor gets `clave_en_uso`; original actor recovers). With the three call sites reverted: S7, S8 and C6 fail (S9 documents the bound and passes in both). |
| **F2** system errors fanned out per person | Positive list of seven per-person codes (see section 4); everything else, including a failure inside the one-by-one pass, stops. | 51 unit tests (`personasCotizacionesFuentes1.test.ts`): each per-person code → 1 + 3 calls and the valid people registered; 19 non-person codes (call-level, structural, `canceling`, `connection`, `fetch`, `deadlock`, `lock`, `invalid`, `unknown`) → exactly 1; real PostgreSQL timeout text with 1/2/8 passengers → 1 call (was 3 for 1 passenger); unparsable messages → 1; one participant → 1; a timeout/`no_autorizado`/unknown on the second call → total 3 calls; failed seal → exactly seal + registrar. With the fan-out condition forced on (mutation), 22 of these fail. |
| **F3** launcher masked failed tests with exit 0 | `test_pg_local.sh` keeps Node's status through the filter (status file; filter stays streaming; `|| true` for an empty filter under `set -e`); the trap that removes DB, role, network and container is unchanged and still returns the status. `test_1_personas_cotizaciones.sh` runs both suites always and exits 1 if either fails. | Launcher with a passing test → **exit 0**; with a deliberately failing test → **exit 1**, output still shown, no `tpg_*` database/role/container left (a pre-existing, unrelated `redtpg_…` network from 2026-11-13 was left alone). The full #1 wrapper: both suites pass → exit 0 (27/27, 6/6); with the F1/F2 call sites reverted → S7, S8, C6 fail and the **wrapper exits 1**. Shared-file change: only the last block of `supabase/scripts/test_pg_local.sh` (tracked) — coordinate if another branch edits it. |
| **F4** owner SQL stages had wrappers | `preflight_308_…sql` and `postcheck_308_…sql` are one `WITH … SELECT control, observado, esperado, veredicto` statement each (no `BEGIN`, `ROLLBACK`, or second statement); every check is kept (11 and 11). | Unit guards assert a single statement, `;` count 1, no transaction/write keywords. After the change both scripts were run as delivered (`psql -f`, one statement each) on a disposable DB: preflight before 308 → 9 OK + 2 INFO; 308 applied; postcheck → 10 OK + 1 INFO; preflight again with 308 applied → still 9 OK + 2 INFO (idempotent). Disposable DB dropped. |

### Navigated check of the running compiled app (audit gate)

Environment: `entorno_1_local.sh` — disposable DB from `plantilla304` + 303–306 + 308 + `humo_1_semilla.sql` (synthetic users `administracion`, `venta`, two `agencia` allies, a minorista admin; one porción-terrestre package with a hotel marked «bajo solicitud» and a tarified hotel), PostgREST, the minimal auth proxy and `next start` of the final build; Edge headless driven by CDP (`humo_1_recorrido.mjs`). **34/34 checks OK** in one clean run; captures in `C:/tmp/evidencia_1/humo/`:

1. Anonymous `/crm/personas-cotizacion` → redirects to `/login`.
2. A visitor, in the real public Tarifario UI («Vista Booking» → «Porción terrestre» → «Solicitar cotización» → form → «Enviar solicitud»): one `pendiente_tarifa` quotation, no author, one titular seat, no contract/sale, **exactly one browser POST (the Server Action)**, no console errors.
3. Staff in the CRM, desktop 1280 px and phone 390 px (real card stacking): one row «Visitante Humo · Titular · Sin tipo 7710001 · Provisional · C-0001 → Pendiente de tarifa · Mayorista»; no raw `pendiente_tarifa`; no horizontal overflow; no console errors.
4. Staff opens the ficha (no pending-people notice), loads the net rate in the real form → the quotation becomes `abierta`, still one titular seat, no contract; the ficha stays free of the notice.
5. An ally in the same UI: the quotation is sealed to that ally (`creado_por_id`), one titular seat, one POST; in the CRM that ally finds only their own person and **not** the visitor's; the second ally finds nothing; staff find it.
6. Minorista administrator: finds neither the visitor's nor the ally's person (tenant isolation).

Not exercised in the browser (covered by the real-action tests instead): the visitor dynamic-package and cart UIs, internal Reservar and manual forms, concurrent submissions, the F1 failure injection (needs revoking a database grant mid-flow).
