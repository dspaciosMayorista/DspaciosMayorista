# Consolidated review — final evidence after corrections RC-1…RC-4

Date: 2026-11-25. Supersedes, for the items below, `revision-consolidada-evidencia-2026-11-25.md` (kept unchanged as history). Corrections and their causes: `revision-consolidada-correcciones-rc-2026-11-25.md`. **Owner not invited; nothing marked delivered.** No staging, commit, push, remote SQL, live mail or deployment. Shared Docker/WSL, `aiomotor-db` and unrelated processes untouched. Every review service is **stopped** (app, simulator, gateway, template server, `consrev_*` and the review's own `pgrevc`; `docker ps` shows only `aiomotor-db`, no review port listens).

## 1. What changed since the audited preparation

| Item | Before (audited) | Now |
|---|---|---|
| Production build | `RBrPqnfYIRZCFzcK6Eh-8` (kept as a full copy in `C:/tmp/consolidada/next_RBrPqnfYIRZCFzcK6Eh-8`) | **`Igyj4k7h7GB9UNN5ywrLo`** (application inputs changed for RC-2: `lib/voucher/vuelo.ts`, `components/contrato/ContratoDocumento.tsx`, `lib/portal/vuelosContrato.ts`) |
| Guide | 93 steps | **96 steps** (+B2-04b, +B2-12a, +INT-04; B1-13, B2-04, B2-12, B95-14, INT-01 rewritten/relabelled), regenerated from the rehearsed modules; Spanish owner guide at `docs/tecnico/revision-consolidada-guia-2026-11-25.md` and `%LOCALAPPDATA%\dspacios-local-revision-consolidada\GUIA_REVISION.md` |
| Process stop | by port (unsafe) | by verified record (RC-1) |
| Steps simulated with SQL | B2-04 purchase, B2-12 conversion (known item 10 of the old evidence) | **none**: both are real UI/action journeys |
| Negative persistence checks | B95-14 slept 4 s | waits for the completed server rejection |

## 2. Complete corrected rehearsal (final build, fresh disposable clone, guide order)

- Clone: `rev_consolidada_ensayo` created from `rev_consolidada_foto` (`ensayo-crear`), started with `ensayo-iniciar` on build `Igyj4k7h7GB9UNN5ywrLo`. Output: `%LOCALAPPDATA%\dspacios-local-revision-consolidada\ensayo\rc_completo_final_2\informe.json` (copy `C:/tmp/consolidada/rc_informe_ensayo_final.json`; console log `rc_ensayo_final_log.txt`).
- **96 steps in order, 1295/1295 checks OK, 0 failures, exit 0.** Real Edge (Playwright), real login form per role, real GoTrue/PostgREST/Storage, real Mailpit. Cross-step state intact (one clone, no `--desde`, no `--solo`).
- **B1-13 passed through the real editor → server action → database → regenerated voucher** (18 checks): unchanged save leaves row id, service and every legacy column identical and the voucher valid («sin cambios»); outbound-only edit keeps `vuelo_regreso/fecha_regreso/hora_salida_reg/hora_llegada_reg` intact, marks the voucher «Desactualizado»; regeneration keeps the same link and service and shows **LG111 then LG200 (10 jun 2027, 18:00–19:30)**, no LG100, no banner; pressing again changes nothing.
- B2-04b (real purchase, 9 checks), B2-12a + B2-12 (real valuation and conversion, 5 + 7 checks), B95-14 (rejection awaited, 7 checks) and INT-04 (advisor/catalog measurement, 5 checks) all OK.
- Harness memory behaviour (the previous full run was stopped by the system at B1-03 under memory pressure): sessions limited to 2 live role contexts (LRU), browser restarted at each delivery boundary, public-step contexts closed after use (they used to leak one per step and width), Edge started with reduced-memory flags, free-memory gate before each step (`--mem-min 1100`) that **paused three times and recovered** (before B1-09 at 577 MB, H103-04 at 1009 MB, NETA-04 at 1085 MB), partial report after every step, clean stop + `--desde` resume if memory never recovers (not needed). No check, role, action or order was changed. The harness change is `ensayo.mjs` (+ `parche_ensayo*.mjs` records).

## 3. Focused checks after the correction

Re-run after the final rehearsal: `prueba_procesos_propios.mjs` 8/8 · `voucherVuelo18.test.ts` 11/11 · `portalVuelos85.test.ts` 27/27 · `hostinger103.test.ts` 42/42. Last run before the build (no application source changed after it): `contratoDocumentoRegresoHeredado.react.ts` 3/3 (+ the 11 `vueloManualDocumento64` tests) · `fechaNegocioReservasContratos.react.ts` 13/13. Full `test:unit` (not repeated since): 29 failures = the audited base; failing-name diff vs the previous composition run: only the two HIN-3 tests disappeared, nothing new (`rc_unit_fallos_anterior.txt` / `rc_unit_fallos_final.txt`). Mutation controls for RC-1/RC-2/RC-3 are listed in the corrections document.

## 4. Owner data and history

`rev_consolidada` (owner state) is unchanged and equals its snapshot `rev_consolidada_foto` (verified by counts 36 sales / 20 payments / 39 users / 1 quotation / 0 vouchers / 27 flight legs and an md5 over contract numbers+status); `estado.json` still has no `entregado`; credentials, Edge profile and storage untouched. Preserved: audited build copy; `rev_consolidada_ensayo_r1` (audited rehearsal), `_rc_focal` (diagnosis on the old build, incl. the pre-fix B1-13 reproduction), `_rc_parcial_oom` (final-build run stopped by the system at B1-03, 154 checks OK before it); their storage/mail/simulator-state folders; all `ensayo/*` report folders.

## 5. Remaining known items (unchanged by this correction)

1. Advisor selector / catalog-read gaps per role (INT-04) — pre-existing, open product decision; owner told in the guide, not asked to test in production.
2. Seeded support rows (DTM-8302…8306) have no file; the guide says not to open them.
3. At 768 px every contract sheet scrolls horizontally ~17 px (pre-existing markup; generic overflow check exempted there).
4. The saved legacy return is preserved and rendered everywhere, but is not shown inside the editor card (would need a view/migration).
5. Decisions the owner still has to make are listed at the end of the Spanish guide.

## 6. Reproduction

```
REV_ENSAYO=1 node supabase/scripts/revision_consolidada/revision.mjs ensayo-crear && … ensayo-iniciar
REV_ENSAYO=1 node supabase/scripts/revision_consolidada/ensayo.mjs --mem-min 1100 [--desde ID] [--salida carpeta]
REV_ENSAYO=1 node supabase/scripts/revision_consolidada/revision.mjs ensayo-detener
node supabase/scripts/revision_consolidada/prueba_procesos_propios.mjs
node supabase/scripts/revision_consolidada/generar_guia.mjs --build Igyj4k7h7GB9UNN5ywrLo --ensayo "<text>" [--salida archivo]
```
