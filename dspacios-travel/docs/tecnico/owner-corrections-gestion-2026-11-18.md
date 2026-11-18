# #106 contract management — owner corrections (item 6), 2026-11-18

Status: implemented in `.worktrees/int-review`; **not browser-verified, not built, no DB run** (executor constraints for this pass). Codex re-audit and one consolidated owner recheck pending. Nothing staged or committed.

## Root cause of the overlap (layout)

`/dashboard/gestion-contratos` laid each contract out as a six-column grid with the **viewport** breakpoint `md:` (768 px) and `whitespace-nowrap` on the date lines. The dashboard shell is `md:flex-row` with a fixed **256 px** sidebar (`w-64`; 64 px collapsed) and the page adds `md:p-8` (2 × 32 px). Real content width = viewport − 320 px:

| Viewport | Content width | Old layout |
| --- | --- | --- |
| 768 | 448 px | 6 columns ≈ 56 px each → `Compra dd/mm/aaaa` / `Viaje … → …` (nowrap) overflowed into **Cobro** (the owner's screenshot) |
| 1024 | 704 px | 6 columns ≈ 100 px: still overlapping |
| 1280 | 960 px | 6 columns ≈ 140 px: tight but readable |
| 1440 | 1120 px | fine |

A viewport breakpoint cannot know the sidebar state (expanded/collapsed), so the fix is **container queries** (Tailwind v4 `@container`, no plugin): the layout reacts to the width the list actually has.

| Container width | Layout |
| --- | --- |
| < 36 rem (576 px) | stacked card, each block labelled (≈ viewport < 896 expanded sidebar; phones) |
| ≥ 36 rem | 2 columns, labelled blocks |
| ≥ 48 rem (768 px) | 3 columns (contract / dates / collection, then voucher / invoice / commission), labelled |
| ≥ 64 rem (1024 px) | six columns with the header row (viewport ≥ 1344 with the expanded sidebar; ≥ 1152 with the collapsed one) |

Dates are now one datum per line (`Compra`, `Viaje`, `Regreso`), no `nowrap`; money lines use `break-words`. Nothing is hidden. Files: `app/(dashboard)/dashboard/gestion-contratos/TablaGestion.tsx` (`REJILLA`, `Bloque`, `EncabezadoGestion`, wrapper `@container`).

## States (honest two-step reading)

Voucher and invoice each render as two labelled steps, so "generated" can never read as "delivered/sent":

| Document | Step 1 | Step 2 |
| --- | --- | --- |
| Voucher | **Generación**: `No generado` · `Generado (n)` (info) | **Entrega**: `Sin voucher` · `Entrega sin registrar` (warn) · `Entrega sin registrar (voucher nuevo)` (warn, previous acknowledgment kept as history in the text) · `Entrega registrada manualmente` (info) |
| Invoice | **Emisión (DIAN)**: `Sin factura` · `Pendiente de validación DIAN` (warn; lists accounting entry / numbered rows) · `Emitida (validada por la DIAN)` (ok) | **Envío**: `—`/«Se registra cuando la factura esté emitida» · `Envío sin registrar` · `Envío registrado manualmente` (info) · `Acuse de envío desactualizado` (orange) |

Manual acknowledgments: the badge says «manualmente» and the detail ends with «Acuse del personal: no prueba que el cliente lo/la recibiera ni lo/la aceptara.» Tone for a registered acknowledgment changed from green `ok` to blue `info` (a staff report is not a confirmed outcome); say so to the owner if they prefer green. The page banner explains the two steps. Filter label «Sin validar en la DIAN» → «Pendiente de validación DIAN».

Unchanged on purpose: the RPC `fn_gestion_contratos` (migration 309), acknowledgment actions, replacement-voucher invalidation/history (`acuseAnterior`), superadmin-only access, no service-role, no polling. Presentation only: `lib/gestionContratos/presentacion.ts` (`voucherVista` split into `voucherGeneracionVista` + `voucherEntregaVista`; `facturaEmisionVista`/`facturaEnvioVista` re-worded), `app/…/gestion-contratos/{TablaGestion,page,FiltrosGestion}.tsx`.

## Tests

- `pruebas/gestionContratos106.test.ts` (unit/wiring): 26/26; with `dashboardShellWiring.test.ts` 150/150. Covers the three voucher states, replacement voucher, DIAN pending/validated, honest manual wording (no «recibido/aceptado/confirmado»), container-query wiring (no viewport breakpoints, no `nowrap`, date lines).
- `pruebas/gestionContratos106.react.ts` (new, added to `test:react`): real SSR render of `TablaGestion` per state, 6/6. The Server Action module is replaced with `mock.module` inside the test (no loader change).
- `pruebas/gestionContratos106.pg.ts` and `supabase/scripts/localreview/humo_revision_106.mjs`: expected strings updated; the smoke script gained a width sweep (768, 900, 1024, 1180, 1280, 1344, 1440, 1920): no block overlap/overflow, no horizontal scroll, screenshots `106-lista-<width>.png`. **Not run** (needs the review stack).
- Pending for the lead: `tsc`, production build, `test:pg` for 106 on a disposable copy, the smoke script.

## Lead verification checklist

1. Superadmin → `/dashboard/gestion-contratos?numero=-106` (Mayorista). At viewport 768, 900, 1024, 1180, 1280, 1344, 1440, 390; expanded **and** collapsed sidebar: no overlap, no horizontal scroll.
2. Seeded contracts (humo script): DTM-10602 voucher `Generado (n)` + `Entrega sin registrar`; DTM-10601 `Entrega registrada manualmente` + invoice `Emitida (validada por la DIAN)` + `Envío registrado manualmente`; DTM-10609 DIAN-validated, `Envío sin registrar`; DTM-10602/10606 `Pendiente de validación DIAN`; DTM-10603 `No generado`; DTM-10604 replacement voucher `Entrega sin registrar (voucher nuevo)` with the earlier acknowledgment in the text.
3. Roles: gerencia, administracion, operaciones, venta, aliado must still be redirected (humo section 1). Minorista rows still appear only via the agency filter.
4. Registering/removing an acknowledgment still works (1 action per click, 0 requests at rest).
5. Print/PDF: this list is not a PDF route; no PDF page is affected by this item.

## Risks

- Breakpoints are my computation from the 256/64 px sidebar and 32 px padding; confirm visually (checklist 1). At 1280 with an expanded sidebar the list is now 3 columns rather than 6 by design.
- Info tone for registered acknowledgments is a judgment call (above).
- Browser-support: container queries need Chrome/Edge 105+, Safari 16+, Firefox 110+.
