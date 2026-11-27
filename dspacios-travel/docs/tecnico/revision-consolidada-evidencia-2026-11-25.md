# Consolidated local review — preparation evidence (for Codex audit)

Date: 2026-11-25. Owner **not yet invited**; every review service is **stopped** at the end of this preparation. No staging, commit, push, remote SQL, live mail or deployment. Source worktrees, retained builds, the existing owner review databases (`pgb2b`/`rev_verif_int_revision`, `pg304`/`rev_revision`, #103's review folder) and their files were not touched.

## 1. Composition (exact audited changes)

Integration worktree: `dspacios-travel/.worktrees/revision-consolidada` (detached at `origin/main` cd9bb1946 = #450). Sources are the **uncommitted audited working trees** of the eight deliveries, applied in this fixed order. Inventory: `C:/tmp/consolidada/manifiestos/manifiesto_<fuente>.json` (path, status, sha256 for every changed/new file; build artifacts and `node_modules` excluded).

| Order | Source (worktree / branch) | Files (M / A) | Migrations |
|---|---|---|---|
| 1 | block 1 flights/vouchers (`block1-vuelos`) | 26 / 302 | 334–338 |
| 2 | block 2 CRM (`block2-crm`) | 16 / 49 | 340–342 |
| 3 | block 3 presence/alerts/state (`block3-activity-deadlines`) | 15 / 31 | 343 |
| 4 | B2B extra payment supports (`soportes-cupo-extra`) | 10 / 60 | 339 |
| 5 | bloqueo net cost (`C:/tmp/wt_bloqueo_neta2`) | 8 / 5 | — |
| 6 | six-task block (`95-bloque-copia-pagos`) | 54 / 118 | 331–333 |
| 7 | #88 dynamic hotel info (`88-info-hotel-dinamico`) | 6 / 2 | — |
| 8 | #103 hotel calendar/supplier mail (`hotel-cal-103`) | 15 / 109 | 327–330 |

Method (`compose.mjs`): a file touched by one source is copied byte-for-byte; a file touched by several is merged three-way (`git merge-file`) against cd9bb1946 with line endings normalized (the Windows checkout is CRLF, git blobs LF). Result: 790 files byte-identical to their source, 31 merged automatically without conflict, 5 `package.json` handled semantically, **4 true conflicts resolved by hand** (all in the notice/bell/CRM-shell overlap of block 2 and block 3):

- `app/(crm)/layout.tsx` — block 3's presence component + global bell **and** block 2's «Referidos» menu entry kept.
- `lib/avisos/presentacion.ts` — `TipoAviso` carries `cotizacion_publica` (block 2) **and** `compra_por_vencer` (block 3); `AvisoVista` carries both `atendida` and `texto`; `textoAviso` handles every type.
- `components/avisos/CampanaAvisos.tsx` — the item renders block 3's composed text and block 2's «Atendida · convertida a contrato» badge.
- `lib/avisos/actions.ts` (`sondearAvisos`) — block 2's single `avisos_recientes` RPC (computes «atendida») is kept; block 3's recipient filter (non-writers neither see nor count `compra_por_vencer`) is applied to the count and the list; the ventana/plazo columns of compra notices are read with one extra bounded query only when such notices are present (reclaim path and recent list). Added cost versus either block alone: at most +1 small query per poll for writers who have compra notices.
- `package.json` — scripts merged semantically (`test:react:resto` gains the files of blocks 1/2 and #103; new `test:react:b3` and `test:react:bloque95` chained into `test:react:all`).

Accounting check (`verificar_composicion.mjs`): every file of every inventory is present; every line a source adds is present in the integrated file; every line a source removes is absent. The only reported differences are the lines rewritten by the hand resolutions above. Two audited **test** assertions were adapted because block 2 added the harmless boolean `atendida` to every notice: `pruebas/soportesCupoAdicional339.pg.ts` and `pruebas/soportesPago281.pg.ts` (expected key list now includes `atendida`). No other audited file was edited.

## 2. Combined migration order on a disposable database

`cadena_migraciones.sh pgblk2 plantillablk2 cons_cadena_1` (log `cadena_migraciones.log`): copy of the template with the chain through 326, then **327 → 343 in numeric order**, each with its own preflight before and postcheck after; the runner fails on any non-OK verdict. All 17 migrations applied with every pre/postcheck OK. The shared object `avisos_tipo_check` ends with both `cotizacion_publica` (340) and `compra_por_vencer` (343) because 343 rebuilds the check from its current definition: order 340 → 343 is mandatory. No renumbering was needed (327–343 are disjoint across the sources).

## 3. Integration checks on the composed tree

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Real-database suites on the combined chain | block 3 **43/43**, #78 **12/12**, #339 **14/14**, #281 **36/36**, bloqueo net **12/12** (`pg_integracion_final.log`). The first run found the only real composition defect: two #339/#281 tests asserted the exact key list of a notice and block 2 added `atendida`; both assertions were updated (§1). |
| Unit suite vs clean baseline (cd9bb1946) | composition 31 failing = baseline 29 + 2 (`hostinger103.test.ts` HIN-3 B4/B5) that fail identically in the #103 source worktree. Compared by exact name. |
| React suites (batches of 10 files) vs baseline | composition 27 failing = baseline 26 + 1 (`fechaNegocioReservasContratos.react.ts` «editar servicios a las 19:30…») that fails identically in the #95 source worktree. |
| Final local production build | success, BUILD_ID `RBrPqnfYIRZCFzcK6Eh-8` (memory guard; review gateway inlined). No application source changed after it (only review tooling and tests). |
| Bell/CRM-shell overlap | exercised in the compiled app by B3-02…05, B2-10…12, S339-05, INT-01/03: notices of all three deliveries coexist with their own text, link and «Atendida» state; non-writers never see compra notices; the CRM shows bell, presence ping and «Referidos». |

## 4. Review environment (new, isolated)

Nothing of the existing owner review environments is reused or modified. New Postgres container `pgrevc` (volume `pgrevc_data`) with databases `rev_consolidada` (owner), `rev_consolidada_foto` (source of the explicit restore), `rev_consolidada_base` and the disposable `rev_consolidada_ensayo`; stack `consrev_*` (GoTrue, PostgREST, Storage, Mailpit) behind a gateway on 54410; app on **localhost:3090** (127.0.0.1 only); all state in `%LOCALAPPDATA%\dspacios-local-revision-consolidada`. No collision with `v1real_*`, `rev-*`, `lote-*`, `local*`, #103's folder or `aiomotor-db`.
- CLI `revision.mjs`: `preparar` (once; refuses when already prepared), `iniciar`, `detener` (deletes nothing), `estado`, `respaldar`, `restaurar --confirmar` (the only reset, explicit and separate), `navegador`, `navegador-preparar`, and the disposable-copy family `ensayo-crear|iniciar|detener|borrar` (`REV_ENSAYO=1`). Captured mail and simulated supplier-mail state persist on disk per environment.
- Synthetic data: the audited seeds 01–08 with documented substitutions only (advisor names → review accounts; #339 contracts → the review ally's catalogue record), plus seeds written for this review (#95, #88, bloqueo net, block 1 ambiguous-leg case). Fictitious accounts carried by the seeds are deactivated, so only the eleven real accounts are active.
- Accounts `<alias>@consolidada.test` (one synthetic password, in `credenciales.txt` outside the repository): superadmin, gerencia, administracion, operaciones, venta, venta2, controlvuelo, aliado, freelance, minorista, inactivo (deactivated).
- Dedicated browser: Edge profile `edge-perfil` with the eleven accounts saved (domain-restricted to `@consolidada.test`). `verificar_navegador_login.mjs` signs in through it: Edge fills the form, the dashboard opens, the session is closed — verified for superadmin and gerencia. The headed account dropdown cannot be captured headless.
- **Stop/start verified** (`ciclo_vida.mjs`, 16/16): data, Storage files, captured mail, accounts and credentials survive stop→start; the owner database and the photo are unchanged (counts compared); `restaurar` without `--confirmar` and `preparar` on a prepared review both refuse.

## 5. The walkthrough and its rehearsal

One guide (`GUIA_REVISION.md`, Spanish, generated from the same step modules that are rehearsed; copy in `docs/tecnico/revision-consolidada-guia-2026-11-25.md`): **93 steps** in nine sections with account, exact link, actions and expected result; an explicit **not implemented** list (referral payout recording/withholding/ledger/USD policy, live Hostinger mailbox and real mail, hosted cost, historical data correction); previously accepted checks not repeated; open owner policy decisions.
Rehearsal (`ensayo.mjs`) on a disposable copy of the owner's photo: real sign-in through the login form, one isolated browser session per role, compiled pages, real GoTrue/PostgREST/Storage, local mail capture and a simulated supplier mailbox; read-only steps at 1280, 768 and 390 px.
- Run 1: 1056/1123 (step defects, triaged by five authors against the live copy).
- Run 2 (clean DB, seeds rebuilt): 1260/1264; the only failures were B95-13 (a race in the step's redirect wait, fixed and verified 14/14 twice).
- Run 3 (fresh copy, all 93 steps in order): 1262/1265; the three misses were B3-01, whose check required the ally to be "recent" (presence lasts 10 min, so seeded activity has expired). Step text and check were corrected to what the product does (your own session is recent; others show last observation); re-run **18/18**. Net: every check passes; B3-01 was repeated on the same copy rather than inside a fourth full run.

## 6. Findings and observations (none changes what was audited)

1. Composition defect found/fixed in the integration only: `atendida` in every notice vs two exact-key tests (§1/§3).
2. Bell overlap resolution adds at most one small query per poll for writers holding compra notices; hosted cost unmeasured.
3. **768 px:** every contract sheet scrolls horizontally by ~17 px (no element exceeds the window; 1280/390 clean). Baseline markup, not attributed to a delivery; the generic overflow check is exempted at 768 only on INT-02, S339-02/09, H103-11/13.
4. **Advisor selectors are empty for every role except superadmin** (Reservar / Nuevo contrato / Nueva cotización): the `usuarios` RLS lets only superadmin read other users. Steps that create contracts use `superadmin` or `venta`. Worth an owner check against production.
5. A manual quotation cannot be converted without a prior payment (it freezes conditions and sets the minimum) — consistent with the audited documents; steps register the prepayment first. The review DB has no reference TRM (`trm_autoritativa` 1.0000), so USD prepayments use an explicit TRM.
6. Editing a legacy single-row flight itinerary in the editor leaves one modern leg; the legacy return is dropped until added with «+ Agregar tramo» (B1-13 asks the owner to note it). Seed defect found and fixed in review data only: loose legs were seeded with `direccion='suelto'`, which the app never writes.
7. Notice read state is per person (e.g. #103 reply notices: one per recipient).
8. Seeded #339 supports have no file in Storage (only supports uploaded during the walkthrough open).
9. The public registration success box uses an emoji (project rule: icons only). Out of scope.
10. Two steps simulate with SQL what the UI cannot trigger on demand: conversion of the visitor quotation (B2-12) and a purchase after a referral re-assignment (B2-04). Everything else drives the real UI.
11. Rehearsal write steps are single-use per copy; rerunning needs a fresh copy (`ensayo-borrar`/`ensayo-crear`). B95-14 asserts «no contract created» after a fixed 4 s wait (could pass trivially if a save were slow).
12. Environmental: the machine rebooted mid-session and the Docker engine hung until Docker Desktop was restarted by the owner; no data was lost (volumes and files intact; re-verified by the stop/start cycle).

## 7. Not verified here

Hosted behaviour (Vercel/Supabase request counts, costs, latency); a live Hostinger mailbox and real mail delivery; the headed Edge dropdown; owner acceptance of any delivery; publication or migration of anything. Production migration order for the owner is 327→343 with each delivery's preflight/postcheck (see the individual reports).

## 8. State at hand-off to audit

All review services are **stopped** (app, gateway, `consrev_*`, `pgrevc`); Docker Desktop, WSL and `aiomotor-db` untouched (Docker Desktop was restarted by the owner after the reboot). `rev_consolidada` holds the seeded initial state only; the rehearsals ran on `rev_consolidada_ensayo`, which is kept until the audit is done (drop with `REV_ENSAYO=1 revision.mjs ensayo-borrar`). The review is **not marked delivered** (`estado.json`). Source worktrees, retained builds, other review databases/folders and owner data are unchanged. No staging, commit, push, remote SQL, live mail or deployment.

## 9. Reproduction

```
node supabase/scripts/revision_consolidada/revision.mjs iniciar|detener|estado|navegador|respaldar
sh supabase/scripts/revision_consolidada/cadena_migraciones.sh <pg> <template> cons_cadena_<n>
REV_ENSAYO=1 node supabase/scripts/revision_consolidada/revision.mjs ensayo-crear && … ensayo-iniciar
node supabase/scripts/revision_consolidada/ensayo.mjs [--solo ID,ID] [--entrega x]
node supabase/scripts/revision_consolidada/ciclo_vida.mjs
node supabase/scripts/revision_consolidada/verificar_navegador_login.mjs
node supabase/scripts/revision_consolidada/generar_guia.mjs --build <id> --ensayo "<text>"
```
Composition tooling and evidence (outside the repo): `C:/tmp/consolidada/` (`compose.mjs`, `pkgmerge.mjs`, `resolve_avisos.mjs`, `verificar_composicion.mjs`, manifests, logs, reports `ens1`–`ens3`, `b301`).
