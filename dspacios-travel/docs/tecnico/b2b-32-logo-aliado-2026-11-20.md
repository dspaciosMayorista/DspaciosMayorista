# #32 — Ally logo on quotations (acceptance matrix and evidence)

Date: 2026-11-20 · Branch `claude/portal-b2b-allies-block` · Migration **319** (numbering checked across all worktrees: 312/313 = #126, 314/316/317 = this block, 315 = #127; 318 reserved by the coordinator for #98).
Owner decision (ADL-039): the ally logo is the primary brand of the ally's quotations; the legal issuer (`agencias`: razón social, NIT, RNT) stays clearly identified and unchanged; the asset is private and served only through authorized document access. Nothing was staged, committed, pushed, deployed, run against remote SQL or sent externally.

## 1. Design (what was built)

| Piece | Where |
|---|---|
| Table `aliado_logos` (history, ≤ 1 `vigente` per ally via partial unique index, content-addressed `path`, audit trigger), private bucket `aliado-logos` (no storage policies), RPCs `registrar_logo_aliado` / `retirar_logo_aliado` (SECURITY DEFINER, service_role only, row-locked per ally, re-verify the actor in the database through `p319_actor_puede`), index `comision_plan(cotizacion_id)` | `supabase/migrations/20260601000319_aliado_logo.sql` |
| Pure rules (PNG/JPG by magic bytes, ≤ 1 MB, path, ally-of-quotation precedence, private-asset headers) | `lib/aliados/logo.ts` |
| Server logic (upload/retire/read, `logoParaDocumento*`, HTTP responses) | `lib/aliados/logoServidor.ts` |
| Who may change/see (session → `usuarios.aliado_id`; same eligibility as #25 ficha edit; staff = superadmin/gerencia) | `lib/aliados/logoAcceso.ts` |
| Routes: `/cot/<token>/logo` (public, token resolves ONE quotation), `/cotizacion/<id>/logo` (session + tenant, same rule as the page), `/portal/b2b/perfil/logo` (own ficha), `/dashboard/aliados/logo/<id>` (staff) | `app/**/logo/route.ts` |
| Actions: `subirLogoPortal`, `retirarLogoPortal`, `subirLogoAliadoInterno`, `retirarLogoAliadoInterno` | `app/portal/b2b/perfil/logo-actions.ts`, `app/(dashboard)/dashboard/aliados/logo-actions.ts` |
| UI: `LogoAliado` (editor), `LogoAliadoInterno` (staff, lazy), `MarcaAliado` (`LogoAliado` tile + `EmisorLinea` strip in documents) | `components/portal/LogoAliado.tsx`, `components/aliados/LogoAliadoInterno.tsx`, `components/cotizacion/MarcaAliado.tsx` |
| Documents (optional prop `logoAliado`): manual quotation, tarifario quotation (`ContratoDocumento` only with `esCotizacion`), comparative sheet | `CotizacionManualDocumento.tsx`, `ContratoDocumento.tsx`, `ComparativaHoja.tsx`, `lib/cotizacion/comparativaDocumento.tsx`, pages `app/cot/[token]/page.tsx`, `app/cotizacion/[id]/page.tsx` |

Decisions taken inside the approved scope (flagged):
- **Which ally owns a quotation** comes only from what the quotation stored: `cotizaciones.aliado_id` → `payload.b2bAsistido.aliado_id` → `comision_plan.aliado_id` (by `cotizacion_id`). Never from the URL, a name, or the form. B2C/historical quotations (none of the three) render exactly as before.
- **No-logo fallback = the document as it is today** (the issuing agency's own logo in its issuer role, no strip). It is never labelled as the ally's. With a logo, the agency logo is removed from the brand slot and a strip states «presentada por {ally}, emitida por {razón social} · NIT · RNT»; the header RNT/site/email block is untouched.
- **Contracts never show it**: `ContratoDocumento` ignores `logoAliado` unless `esCotizacion`, and no contract route passes it (wiring test).
- The public page query was NOT changed (several audited source-text guards pin it); the ally is resolved with one separate read by token (`logoParaDocumentoPorToken`).
- Replacing keeps history (`vigente=false`, files never deleted). Same bytes again = no-op.
- Upload eligibility mirrors the #25 ficha edit: titular (no `agencia_id`), active, own ficha, not shared with another titular — agencies and freelancers both. Agents can SEE the agency logo but not change it. Staff: superadmin/gerencia, also guarded by `exigirEscrituraCatalogoGlobal`.

## 2. Acceptance matrix

| # | Requirement (owner-derived) | State / input | Independent expected result | Evidence | Status |
|---|---|---|---|---|---|
| L1 | Ally logo is the primary brand | quotation of ally A with logo, 3 document kinds | one `logo-aliado` tile, correct `alt`, authorized `src`, agency logo absent from the brand slot | `logoAliado32.react.ts` (3 kinds × 5 tests) | PASS |
| L2 | Legal issuer unchanged and visible | same | strip shows razón social, NIT, RNT + ally name; header RNT kept; everything else byte-identical with vs without logo | same file («todo lo demás es IDÉNTICO») | PASS |
| L3 | Honest no-logo fallback | ally with no logo / B2C | document identical to before: agency logo, no tile, no strip; `null` ≡ absent | same | PASS |
| L4 | Contract documents unchanged | `ContratoDocumento` without `esCotizacion` + `logoAliado` | markup byte-identical to without the prop; issuer = `agencias` | same; wiring test lists the only 3 files that pass `logoAliado` | PASS |
| L5 | Private asset, authorized access only | any render | no storage URL/public URL anywhere; `Cache-Control: private, no-store`, `nosniff`, sandbox CSP; no `getPublicUrl`/`createSignedUrl` | `logoAliado32.test.ts` | PASS |
| L6 | Public link authorizes by token only | tokens of A, B, carrito, plan, B2C, unknown | each serves ITS ally's bytes; B2C/unknown/no-logo → identical 404; ally id in URL ignored | route tests (real handlers, faked boundary) | PASS |
| L7 | Ally resolved from the quotation (3 sources) | column / carrito payload / comision_plan | precedence column → payload → plan; non-numeric/invalid → null | unit | PASS |
| L8 | A cannot change B's logo | A uploads with `aliadoId=B` in the form; shared ficha; agent; inactive; venta; administración; anonymous | only A's ficha changes; all others rejected with nothing uploaded/persisted | `logoAliado32.test.ts` + SQL cases A1–A12 (second key in the DB) | PASS |
| L9 | A cannot read B's logo | portal preview, staff preview, internal quotation route | portal = own ficha only; staff preview = superadmin/gerencia only; internal quotation = same tenant rule as the page; otherwise 404 | route tests | PASS |
| L10 | File validation | SVG with `.png` name and `image/png` type, GIF, WebP, PDF, empty, 1 MB / 1 MB+1 | decided by bytes; rejected before storage/RPC | unit + DB `check`s (C1–C3) | PASS |
| L11 | Replace / history / retire | A uploads 1, 2, 1 again, retire | ≤ 1 vigente; history kept; files kept; same bytes = no-op | unit + SQL B1–B6 | PASS |
| L12 | UI behaviour | preview, upload, >1 MB, server rejection, retire, no permission, staff lazy | see §3 | `logoAliadoUi32.react.ts` 8/8 | PASS |
| L13 | Print/PDF | documents print the same DOM | logo tile + strip are plain DOM (no fixed pixel layout beyond `max-w-[200px]`, `h-12`) | not rendered in a browser (see §6) | **NOT RENDERED** |

## 3. Evidence executed (this tree)

| Check | Result |
|---|---|
| `pruebas/logoAliado32.test.ts` (unit + real actions/routes with faked database/storage boundary) | **26/26** |
| `pruebas/logoAliado32.react.ts` (rendered structure, 3 documents + contract) | **17/17** |
| `pruebas/logoAliadoUi32.react.ts` (editor component interaction) | **8/8** |
| Neighbouring document suites run together with the above (`cotPublicoManual82`, `comparativaHoja75`, `contratoDocumentoNeto`, `documentosCliente94`, `cotizacionComparativa35Ui`) | 96/96 total in that run |
| Unit tests that read the touched sources (22 files, 551 tests) | 548 pass; **3 fail, all pre-existing**: `valorVisibleContratoItem` wiring (fails identically with the original `ContratoDocumento.tsx` — verified by swapping it in) and the `TarifarioPublic` price-base guard (file untouched) — baseline failures, not green. An earlier run had 7 failures: five pinned the public page's query text; fixed by NOT changing that query |
| Mutations (each restored afterwards) | app: no byte check → 2 fail; public cache → 2; ally from the form → 1; administración as staff → 2; token ignored → 2; plan source removed → 3. Documents: contract shows logo → 1; no issuer strip → 1; agency logo kept next to ally logo → 1. SQL: actor `agencia_id` ignored → 1 case fails; administración staff → 1; no unique index → postcheck REVISAR + 1 case; authenticated can execute → REVISAR + 1; public bucket → REVISAR + 1 |
| Migration 319 on **embedded Postgres (pglite) over a STUB schema** (`supabase/scripts/pglite_319_parcial.mjs`): preflight → 319 → 319 again (idempotent) → postcheck → `test_319` cases → rollback | preflight all OK; postcheck no REVISAR; **35/35 SQL cases**; rollback refused with data present; clean rollback with an empty table |
| Typecheck of the new/edited files + their import graph | clean (temporary tsconfig, removed) |

## 4. NOT RUN / limits (explicit)

- **Full-schema database run NOT executed**: the Docker engine was down (`docker info` hung) during this task. The migration, preflight, postcheck, rollback and `test_319_aliado_logo.sql` were run only on pglite with a stub of the tables they touch (`aliados`, `usuarios`, `auditoria`/`fn_auditoria`, `comision_plan`, `storage.buckets/objects`, three API roles). Re-run `test_319_aliado_logo.sql` (needs `psql`, fixtures `test_216_fixtures.sql`) and the three scripts on the full local schema before the owner SQL stage.
- **No real Supabase Storage** was exercised (upload/download are a faked boundary). Real bucket behaviour (private bucket, service-role access, the 1 MB limit enforced by the bucket) is unverified.
- **No browser rendering / screenshots / print-PDF / responsive (desktop, ~820, 390) inspection** of the three documents or the editor (no production build was allowed in this task; no rendered capture was made). Structure is proven in jsdom/`renderToStaticMarkup`; layout (logo tile height `h-12`, `max-w-[200px]`, the strip wrapping at 390 px, header wrapping with the tile on `sm:flex-row`) still needs the coordinator's real-build visual pass.
- Real-app end-to-end (login → upload → open `/cot/<token>` → print) not run.
- Hosted facts unknown: bucket creation through the SQL editor, Storage limits, Vercel invocation cost deltas.
- Not done by design: no logo on contract documents, receipts, estado de cuenta or cuenta de cobro (only quotations); no SVG; no cropping/resizing; no per-quotation logo override; no approval flow for logo changes (ADL-039: allies edit without approval).

## 5. Resource / consumption (local reasoning; hosted unmeasured)

- Public `/cot/<token>` render: **+1 read** (`cotizaciones` by token, ally columns) and, for a B2B quotation, **+1** `aliado_logos` (with embedded ally name); a quotation whose ally lives only in a plan adds **+1** `comision_plan` (indexed by the new `idx_comision_plan_cotizacion`; B2C quotations pay that one too, an index lookup that returns nothing). Internal `/cotizacion/<id>`: 0 extra on the quotation (columns added to the existing select) + the same logo/plan reads. Comparative pages: no extra quotation read (the mother row is already `select *`).
- Each logo image: **1 request** per page view → route (≤ 3 DB reads: quotation, plan if needed, logo) + **1 Storage download**; response is `private, no-store` (no shared cache; the browser refetches per view). Size ≤ 1 MB. If this becomes costly, a safe next step is a content-hash URL with `private, max-age` — deliberately not done to keep the asset non-public-cacheable.
- Upload: 1 session read + ficha context reads (existing) + 1 Storage upload + 1 RPC; the server action reads the file only after the size check. Retire: 1 RPC.
- Staff Aliados control is lazy: **0 requests** until «Logo de marca» is pressed (tested). «Mi perfil»: 1 image request on load. No polling, timers or retries added anywhere.
- Storage: ≤ 1 MB per distinct file, never deleted (history); expected volume = a handful of allies. Cost of Storage/egress hosted: not measured.

## 6. Mounts for the coordinator (shared files NOT edited here)

1. `app/portal/b2b/perfil/page.tsx` — imports and, below the `PerfilEditor` block:
   ```tsx
   import { LogoAliado } from "@/components/portal/LogoAliado";
   import { subirLogoPortal, retirarLogoPortal } from "./logo-actions";
   …
   {edicion.lecturaOk && ctx.aliadoId != null && (
     <div className="mb-4">
       <LogoAliado nombre={ficha?.nombre ?? ""} src="/portal/b2b/perfil/logo" puedeCambiar={edicion.permisos.puedeFicha} motivo={edicion.permisos.motivoFicha} subir={subirLogoPortal} retirar={retirarLogoPortal} />
     </div>
   )}
   ```
2. `app/(dashboard)/dashboard/aliados/AliadosClient.tsx` — inside the EXPANDED ficha, next to «Ver historial», **only when the viewer is superadmin or gerencia** (for other roles the preview route answers 404 and the editor would read «Sin logo» misleadingly): `<LogoAliadoInterno aliadoId={a.id} nombre={a.nombre} />` with `import { LogoAliadoInterno } from "@/components/aliados/LogoAliadoInterno";`.
3. `package.json` `test:react`: append `pruebas/logoAliado32.react.ts pruebas/logoAliadoUi32.react.ts`. (`logoAliado32.test.ts` is picked up by `test:unit`'s glob.)
4. `types/database.ts`: untouched; the new table and RPCs go through untyped service-role helpers.

## 7. Deployment order

preflight 319 → migration 319 → postcheck 319 (INFO row equal to the preflight) → then the code. With the code live and 319 missing: documents render as today (the logo lookup returns «no logo» when the table read errors), uploads fail with a generic message. Provider-side owner action: none beyond running the SQL (the bucket is created by the migration; confirm in Storage that `aliado-logos` is private).
