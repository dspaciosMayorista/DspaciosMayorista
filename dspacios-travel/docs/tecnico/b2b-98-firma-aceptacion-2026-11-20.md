# #98 — Ally signature image + electronic acceptance of a frozen cuenta-de-cobro version

Date: 2026-11-20. Branch `claude/portal-b2b-allies-block` (worktree `.worktrees/portal-b2b-allies`). Owner decision: ADL-039 (DECISIONS.md). Nothing staged/committed/pushed; no remote SQL; no external message. #97 stays OFF, voucher gate and commission amounts untouched.

## 1. Owner decision implemented

- Signature IMAGE + explicit ELECTRONIC ACCEPTANCE of a FROZEN version. Never described as a cryptographic/certified digital signature (UI states the opposite; a wiring test forbids the wording).
- Accepted versions are immutable (DB triggers). A change in commission, withholding, concept, ally identity or bank data → new hash → new version → new acceptance. The old version stays viewable (`?v=N`).
- Freelancers sign; agencies keep invoicing (existing page block); internal staff never accept on behalf of the ally.

## 2. Design (and deviations from the brief, with reason)

- **Migration 318** `20260601000318_cuenta_cobro_firma_aceptacion.sql` + `preflight_/postcheck_/rollback_318_firma_aceptacion.sql` (one integral read-only query each). Tables `aliado_firmas`, `cuenta_cobro_aceptaciones`; private bucket `aliado-firmas` (512 KB, png/jpeg, no storage policies); RPC `registrar_firma_aliado`, `aceptar_cuenta_cobro` (SECURITY DEFINER, service_role only, advisory lock per key); RLS on, no policies; explicit `trg_auditoria`; immutability triggers.
- **Key column `clave`** (`ab:<aliados_b2b.id>` or `cu:<ventas.contrato_uid>`) instead of `numero_contrato`/`aliado_b2b_id`: (a) no `numero_contrato` column → the #75 identity-guard installer does not need a classification, (b) not tied to a reusable number, (c) NO FK to ventas/aliados_b2b so `eliminar_contrato` is never blocked and the evidence survives (same choice as `soportes_pago`).
- The snapshot includes ally identity AND bank data and the issuer; the hash excludes only the elaboration date (frozen at acceptance time; otherwise every day would be a new version). Consequence (stricter than the brief's "commission or withholding"): a change to the ally's name/bank also creates a new version, because those values print on the document.
- Aliases: going back to a previously accepted content re-recognises that version (UNIQUE(clave, hash)); no v3 is created.
- Eligibility to accept/upload = `permisosPerfil` rule of #25: active titular freelance, ficha linked and NOT shared with another active account. A freelance sharing a ficha is told to contact their advisor (conservative; revisit if the owner wants shared-ficha signing).
- Image served only as a data URI read server-side from the private bucket after the page authorized the document; row ownership (`aliado_id`) and SHA-256 are re-checked on every read. No public or signed URL exists (wiring-tested).
- Shared resolver: `comisionResolver.ts` now also returns `contratoUid` and `aliadoInfo.id` (read-only additions; amounts untouched).

## 3. Files

New: `lib/cuentaCobro/{snapshot,servidor}.ts`, `components/portal/{CuentaCobroDocumento,AceptarCuenta,FirmaAliado,FirmaAliadoSeccion}.tsx`, `app/portal/comision/[numero]/acciones.ts`, `app/portal/b2b/perfil/firma-actions.ts`, migration 318 + 3 scripts, `supabase/scripts/test_318_firma_aceptacion.sql`, `supabase/scripts/test_318_concurrencia.sh`, tests below.
Edited: `app/portal/comision/[numero]/page.tsx` (renders from snapshot), `lib/finanzas/comisionResolver.ts` (+2 fields), `pruebas/support/reactLoader.mjs` (two `next/navigation` stub entries for the new client components).

## 4. Acceptance matrix

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | Freelance with signature accepts version → frozen snapshot, hash, signature hash, actor | `cuentaCobro98.test.ts` "aceptar" (model of the RPC) | PASS (model); real RPC: `test_318_firma_aceptacion.sql` NOT RUN |
| 2 | Signature image rendered ABOVE the ally name, version/date, "not a certified digital signature", frozen amounts (427.200 etc. hand-calculated) | `cuentaCobro98.react.ts` (renderToStaticMarkup) | PASS |
| 3 | Commission/retention/ally-data change → new version; v1 untouched; reverting re-recognises v1 | unit tests (hash cases + v2 flow) | PASS (model) |
| 4 | Stale accept (hash seen ≠ server hash) rejected, nothing written; malformed hashes rejected | unit | PASS |
| 5 | Replay idempotent; 2–3 concurrent accepts → one row | unit (model); real concurrent sessions `test_318_concurrencia.sh` | model PASS; real NOT RUN |
| 6 | Isolation: ally B, internal staff, agency, non-owner, non-freelance, shared ficha, other ficha, anonymous cannot accept; ally A signature never read for ally B | unit (11 denial cases + `firmaDataUri` ownership/sha) + wiring (resolver before any acceptance read; key never from the URL/form) | PASS |
| 7 | Upload: only PNG/JPG by magic bytes, ≤512 KB (exactly 512 KB ok), SVG/GIF/PDF/text/empty/mislabelled rejected; ficha comes from session; no orphan objects on failure/duplicate | unit + React | PASS |
| 8 | DB immutability, unique (clave,version)/(clave,hash), single vigente, grants (anon/authenticated denied, service_role ok), private bucket, audit rows | `test_318_firma_aceptacion.sql`, `postcheck_318` | NOT RUN (Docker engine down) |
| 9 | Document unsigned state ("Versión sin aceptar"), accepted-but-image-missing wording, history links, banner when a later change exists | React + page code | markup PASS; full-page render NOT RUN |
| 10 | Responsive/print/PDF at 3 widths on the production build | — | NOT RUN (coordinator builds once; RAM) |

## 5. Executed evidence (this tree, 2026-11-20)

- `node --test … cuentaCobro98.test.ts cuentaCobro98.wiring.test.ts`: **31/31** (25 behaviour tests + 6 wiring).
- `cuentaCobro98.react.ts` (jsdom, real components): **8/8**.
- Neighbours with dummy local Supabase env (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 … SUPABASE_SERVICE_ROLE_KEY=x`): `documentosContrato.wiring`, `accesoDocumentoContrato`, `identidadPropagacion.wiring`, `fichaAliado`, `comisionB2BReglas` **258/258**; `comisionPortalB2B`, `portalB2BComisionDosAliados`, `revisionComision65`, `portalPerfilEditor25`, `documentosLegacyNombre`, `participacionEconomica65` + new React **61/61**. Without the env vars the portal React tests fail with "supabaseUrl is required" (environment, unrelated to this change).
- Mutations (each restored; suite green again 23→31/31): hash check removed → 1 failure; internal-staff guard removed → 2; ficha-mismatch guard removed → 2; elaboration date included in hash → 2; ownership check of the image removed → 1; image SHA check removed → 1; magic-byte check removed → 1 (this one SURVIVED the first test version; a no-declared-type SVG/GIF/PDF case was added and now kills it).
- Scoped `tsc --noEmit` (new files, page, actions, tests; `--max-old-space-size=1400`): clean. Whole-project `tsc`/`next build` NOT run (RAM ~2.3 GB free).

## 6. NOT RUN — must not be cited as evidence

All database evidence: migration 318 apply, preflight/postcheck/rollback, `test_318_firma_aceptacion.sql`, `test_318_concurrencia.sh` (Docker engine unreachable: `docker info` hangs; no native Postgres). The SQL was only read carefully; it has never been parsed by Postgres. Also not run: full-page real render with real Auth/PostgREST/Storage, desktop/intermediate/mobile captures, print/PDF check, production build, hosted Storage behaviour.

## 7. Resource / consumption (static count; hosted unknown)

Per action, no polling, no timers, no retries:
- View of the cuenta de cobro: existing resolver reads + 1 `cuenta_cobro_aceptaciones` select (≤200 rows, one per real change). Signed version: +1 `aliado_firmas` select +1 Storage download (≤512 KB; data URI inlined, ~+0.7 MB HTML worst case). Unsigned, freelance owner: +1 `getUser` +3 reads (`cargarContextoEdicion`) +1 firma select.
- Accept: resolver + agencia + 3 context reads + 1 RPC. Upload: `getUser` + 3 context reads + 1 Storage upload + 1 RPC (+1 remove on duplicate/failure). Profile section: 3 + 1 reads (+1 download if a signature exists).
- Storage: ≤512 KB per signature, versions never deleted (tiny). No external service/AI cost. Vercel: +1 small server action route file; no cron/image.

## 8. Mount needed (shared perfil page — not edited by this worker)

In `app/portal/b2b/perfil/page.tsx`: `import { FirmaAliadoSeccion } from "@/components/portal/FirmaAliadoSeccion";` and, right after the `PerfilEditor` block (before the `grid` of groups): `<FirmaAliadoSeccion userId={ctx.userId} />` (renders nothing for agencies/shared fichas).
Tests to add to `package.json` `test:react`: `pruebas/cuentaCobro98.react.ts`. (`*.test.ts` are picked up by `test:unit` automatically.)

## 9. Deployment order / risks

Owner SQL: preflight 318 → 318 → postcheck 318, then publish code. With the code live and 318 missing: viewing the cuenta de cobro shows "No pudimos comprobar si ya fue aceptada" (fail-closed, never an "unsigned" document that might be false); that includes the freelance's existing print flow — so apply 318 BEFORE the code. Rollback refuses when any signature/acceptance exists (evidence).
Risks/limits: (1) strict hash = any printed-data change forces re-acceptance; (2) shared-ficha freelancers cannot sign; (3) vía-1 documents (no aliados_b2b row) are keyed by `contrato_uid`; (4) the signature is an image anyone with the ally's session could upload — acceptance proves "this session accepted", not identity certification (stated in the UI); (5) an `auditoria` row duplicates the snapshot (incl. bank number) — readable only by superadmin/gerencia as for other audited tables.
