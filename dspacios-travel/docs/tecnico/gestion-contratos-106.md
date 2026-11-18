# #106 — Unified contract management for superadmin (Mayorista + Minorista)

Status (2026-11-17): **implemented and executor-verified locally; NOT audited by Codex; NOT owner-reviewed; nothing staged, committed, pushed, deployed or run remotely.** Migration **309** exists only in this branch and has been applied only to disposable local databases.

- Worktree / branch: `dspacios-travel/.worktrees/106-gestion-contratos`, `claude/106-gestion-contratos`, from `origin/main` **51ea60612** (fetched at execution time; the local `main` checkout is 19 commits behind). The #53, #102, #1 and #105 worktrees were not touched; none of their unpublished code is merged here.
- Route: `/dashboard/gestion-contratos` (menu entry «Gestión de contratos», superadmin only).
- Prior evidence this builds on: `auditoria-confirmacion-voucher-gestion-2026-11-14.md`, block 3 of `auditoria-integral-5-bloques-2026-11-14.md`, `auditoria-verificacion-addendum-2026-11-14.md`. Their findings were re-checked against current code, not assumed (next section).

## 1. Audit findings re-verified against `origin/main` 51ea60612

| Finding | Verified how | Result |
|---|---|---|
| No combined-agency management screen | `git grep` for the route / any RPC in `app`, `lib`, `supabase/migrations` | Confirmed: none. Every existing list (`contratos`, `cartera`, `comisiones`, `contabilidad/facturacion`) filters by the active-agency cookie (`getTenant()`), and `contratos`/`cartera` have no server pagination. |
| Inconsistent balance calculations | Read `cartera/page.tsx`, the SQL `fn_dashboard_cartera_por_moneda` (235) and `lib/finanzas/cobro.ts` | Confirmed: one *formula* (collection currency + total, minus `abonos.valor_abono`) with several copies that differ in **which contracts count** (Cartera: every state; Dashboard RPC: only `confirmado`/`activo`) and in sign handling (Cartera applies `Math.max(…, 0)`, hiding overpayment). **This module reuses the authoritative rule** (`cobroDeVenta` ⇄ the 235 `CASE`) and proves parity contract by contract (see §6), and defines the state semantics explicitly (§3.3). |
| No reliable «voucher delivered» / «invoice sent» fields | `git grep` of `entregad|enviad` next to voucher/factura in migrations, `lib`, `app`; schema of `vouchers`, `facturacion`, `contrato_facturacion` | Confirmed: nothing records delivery or sending. `ventas.facturado` / `numero_documento` exist but nothing writes them. Hence migration 309 (§4). |
| Database permissions broader than this screen should expose | Ran it: a `gerencia` user whose own tenant is `mayorista` reads `ventas` of **both** agencies (47 + 15 rows) and `abonos` of both, through RLS | Confirmed (`puede_ver_tenant()` lets `gerencia` read both tenants). The new screen therefore does **not** rely on RLS or on the module map alone: three independent layers (§5). The existing permissions of every other role are unchanged (asserted in the test suite). |
| Missing indexes (audit §3.9) | `pg_indexes` of the 304 template | Confirmed absent: `abonos(numero_contrato)`, `aliados_b2b(numero_contrato)`, `facturacion(numero_contrato)`, `ventas(fecha_venta)`. **Measured, not added** (§7). |

## 2. What was built

- `supabase/migrations/20260601000309_gestion_contratos_superadmin.sql` (+ `preflight_309…`, `postcheck_309…`, `rollback_309…` in `supabase/scripts/`): table `contrato_seguimiento`, RPCs `fn_gestion_contratos` and `registrar_seguimiento_contrato`, private helper `seguimiento_referencia`.
- `lib/gestionContratos/`: `filtros.ts` (URL ⇄ validated filters), `tipos.ts` (response validation), `presentacion.ts` (text/tone/links per cell), `acceso.server.ts` (active superadmin), `cargar.server.ts` (single RPC call), `debounce.ts`, `canales.ts`.
- `app/(dashboard)/dashboard/gestion-contratos/`: `page.tsx`, `FiltrosGestion.tsx` (client), `TablaGestion.tsx`, `SeguimientoControl.tsx` (client), `actions.ts` (Server Action).
- Small edits to existing files: `lib/constants.ts` (module `gestion_contratos` = superadmin only + route prefix), `app/(dashboard)/layout.tsx` + `SidebarNav.tsx` (menu entry, icon), `contratos/[numero]/page.tsx` + `GestionTabs.tsx` (**`?tab=` deep link** and `#vouchers` anchor so each row link lands on the right place; an unknown or non-visible tab falls back to Cartera), `lib/contrato/reciclaje.ts` (label for the reuse blocker), `types/database.ts` (two RPC signatures).

## 3. Behaviour

### 3.1 Screen
One row per contract: agency chip (Mayorista/Minorista, always visible), state, number (Minorista shown without the `MIN-` prefix, as elsewhere), customer, destination, purchase and travel dates, total / paid / balance **in the contract's collection currency**, voucher cell, invoice cell, commission cell, and direct links (Contract, Pagos → Cartera tab, Vouchers → `#vouchers`, Facturación tab, Comisiones tab only when commission applies). One DOM serves both layouts: a grid with column headers on desktop, stacked labelled cards on phones. Secondary filters sit in «Más filtros» (closed unless one is active) so the list is on screen first. 25 rows per page, server pagination, exact total, per-agency/per-currency summary of the **whole filtered set** (never mixing COP and USD).

Filters (all in the URL, validated against allow-lists; invalid values are dropped with a visible notice): agency, contract number (substring; `%`/`_`/quotes are literal), customer, purchase date range (`fecha_venta`), travel date range (**departure** `fecha_salida`; contracts without a departure date are excluded when this filter is used), contract state, balance (with balance / paid / overpaid / no total), collection currency, vouchers (with/without), voucher delivery acknowledgment, invoice (issued/none), invoice-sent acknowledgment, commission class, sort order. Dates are inclusive on both ends.

### 3.2 Balance (no new formula)
`total` = `total_cobro` when `moneda_cobro` differs from the offer currency **and** `total_cobro > 0` **and** `trm_cobro > 0` (frozen conversion), else `precio_venta`; `paid` = `sum(abonos.valor_abono)` (already in the collection currency); `balance = total − paid`. This is exactly `lib/finanzas/cobro.ts › cobroDeVenta` and the 235 SQL `CASE`; `gestionContratos106.pg.ts` compares all 62 seeded contracts against `cobroDeVenta` + a direct sum of `abonos`.

### 3.3 States
- Contract state groups: `pendiente`; `confirmado` (= `confirmado` + `activo`); `cancelado` (= `cancelado`/`anulado`/`anulada`); `otro`.
- Balance class: `sin_total` (no total, or 0 → shown «Sin total», never a false zero), `con_saldo`, `pagado`, `sobrepago` (shown as overpaid; Cartera hides this with `Math.max`).
- «With balance» **excludes cancelled contracts and includes pending ones** (a deliberate, visible difference from the Dashboard RPC, which counts only confirmed/active). A cancelled contract with payments is labelled «Cancelado» with the paid amount; no balance is presented as collectible.
- A contract with `financiero_estado = 'pendiente'` shows «Registro financiero incompleto».

### 3.4 Voucher and invoice: generated ≠ delivered/sent
| Fact | Source (existing data) | Never inferred as |
|---|---|---|
| Vouchers prepared | rows in `vouchers` (count, max id) | delivered |
| Invoice **issued** (owner decision 2026-11-17) | `contrato_facturacion.dian_emitida` **only** — DIAN-validated. An accounting entry (`asiento_factura_id`), a draft or a legacy numbered `facturacion` row is shown as «Sin validar en la DIAN» (with what exists listed), never as issued | sent |
| Delivered / sent | **manual acknowledgment only** (§4), latest event per contract and kind | — |

Acknowledgment states (owner decision 2026-11-17 — no elaborate «stale» state): voucher `sin_voucher` / `pendiente` (prepared, delivery unregistered — also the state after a replacement voucher, shown as «Voucher nuevo · entrega sin registrar» with the earlier acknowledgment kept as history) / `entregado` (manual, current); invoice `sin_factura` / `sin_validar` (a record exists but is not DIAN-validated) / `pendiente` (DIAN-validated, sending unregistered) / `enviada` (manual). The delivery acknowledgment is **current only while no voucher with an id higher than the one recorded in the acknowledgment (`max_id`) exists**: generating a replacement voucher (the app deletes and re-inserts, so the new id is higher) clears the current mark and lets staff register the delivery again; edits that do not generate a voucher never clear it; every earlier acknowledgment stays in the append-only log (`contrato_seguimiento`). Historical contracts have no acknowledgment and therefore show «entrega sin registrar» — nothing is backfilled. Invoice-sending behaviour beyond the DIAN requirement is not newly decided here.

### 3.5 Commission class (per contract; uses the existing SQL helpers of migration 205)
Order of precedence: `retenida` (a row in `comision_b2b_revision`) → no rows: B2B contract (`canal = 'B2B'` or `tipo_asesor` agencia/freelance) with `comision_estado = 'descontada'` → **`descontada`**, with a sealed `comision_plan` for this `contrato_uid` → `prevista`, otherwise `sin_definir`; non-B2B → `no_aplica` (the internal advisor commission is settled monthly per advisor, not per contract) → rows: any `revision_neto` → any `pendiente` → any `parcial` → all `descontada` → `descontada`; else `pagada`. Per row: identical to `lib/finanzas/comisionB2B.ts › estadoComisionFila` (`comision_b2b_total`, `comision_b2b_descontada`, payments from `comision_b2b_pagos`, 1-peso tolerance). **A NETO commission already deducted from the price is «Descontada en el precio (NETO)», neutral/info tone, and is never counted or filtered as pending.** The test suite compares the class against the TS rules row by row.

## 4. Manual operational acknowledgments (migration 309)

`contrato_seguimiento` is an **append-only** log (`marcar` / `desmarcar`): contract number **and `contrato_uid`**, tenant, kind (`voucher_entregado` | `factura_enviada`), channel (WhatsApp, correo, portal, presencial, otro; required to mark), optional note (≤ 500), a snapshot of what existed (`referencia`), actor id/email/name, timestamp. It states that staff **report** the action; it is not proof of delivery and **triggers nothing**: no payment, no ledger entry, no invoice issuance, no voucher send. The UI repeats this wherever a panel is open.

- Only way to write: `registrar_seguimiento_contrato` (SECURITY DEFINER). It requires superadmin (`mi_rol()`, null for inactive users), takes the **uid** the screen read and rejects with `CONTRATO_CAMBIO` (F4601, the same error as migration 284's guard) if the number now belongs to another contract or no longer exists; serializes concurrent calls with an advisory lock; refuses to mark something that does not exist (no voucher / no invoice → F4702), a duplicate current acknowledgment (F4703) and retiring one that does not exist (F4704).
- The table itself: RLS select = superadmin only; no insert/update/delete privilege for the API (not even for superadmin); an `UPDATE` trigger rejects any modification even from a database owner; `trg_auditoria` records every event (actor from `auth.uid()`).
- Identity model (#75/284): registered in `contrato_guardas_config` as `estricto` (the installer re-ran: 45 guards), FK to `ventas(numero_contrato)` with `ON DELETE CASCADE` (the acknowledgments of a deleted contract go with it, and the list also joins on `contrato_uid`, so a reused number never inherits them); `fn_renumerar_contrato` follows the FK; `dtm_reuso_bloqueos` already blocks reusing a DTM number that has rows here (`RELACION_CONTRATO_SEGUIMIENTO`, label added in `reciclaje.ts`).

## 5. Authorization (three independent layers)
1. **proxy.ts** via `LECTURA_MODULO.gestion_contratos = ["superadmin"]` + `MODULO_POR_RUTA`: every other role is redirected (measured: gerencia, administración, operaciones, venta → `/dashboard`; aliado → `/portal/b2b`).
2. **Server code**: `esSuperadminActivo` (one profile query: role superadmin **and** `activo`) before any data request, in the loader and in the Server Action; nothing in the screen uses the service-role client, `getTenant`/`tenantContext` or the agency cookie (a unit test greps for it).
3. **Database**: both RPCs raise 42501 unless `mi_rol() = 'superadmin'`; verified for gerencia, administración, operaciones, venta, aliado, a **deactivated superadmin** and an anonymous caller, directly through PostgREST. `fn_gestion_contratos` is SECURITY DEFINER on purpose (§7) — the explicit check on its first line is the boundary; it is read-only and returns nothing a superadmin cannot already read. No private tokens are returned (`share_token` is never selected) and the HTML contains neither tokens nor the contract uid.

## 6. Tests personally executed (all local, disposable databases)

| Suite | Result |
|---|---|
| `pruebas/gestionContratos106.test.ts` (pure: filters incl. hostile input and calendar boundaries, debounce with fake timers, presentation rules, response validation, wiring: superadmin-only map, no service-role/agency cookie/timers, order of checks, migration hygiene) | **24 / 24** |
| `pruebas/gestionContratos106.pg.ts` through `supabase/scripts/test_106_gestion_contratos.sh` (real PostgreSQL + PostgREST, 309 applied to a copy of the 304 template + 305/306, synthetic seed; real loader, page and Server Action) | **55 / 55** (≈ 25 s) |
| Mutation checks (tests have teeth): drop the superadmin check; drop the uid check; NETO-descontada as pending; voucher generated = delivered; balance without collection conversion | each mutation made 1–6 tests fail; migration restored byte-identical |
| Migration scripts: preflight → 309 → postcheck → rollback → preflight on a scratch DB | all OK (the single `REVISAR` was «a superadmin exists», correct on an empty template); rollback leaves the pre-309 state |
| TypeScript (`tsc --noEmit`), ESLint on changed files | clean (one pre-existing React-compiler error in untouched `EliminarContrato.tsx`) |
| Real browser (headless Edge, local app + real GoTrue session): desktop 1366 px and phone 390 px, no horizontal scroll, no console errors; acknowledgment saved through the UI → DB row + audit row with the actor; `?tab=` / `#vouchers` links including opening a Minorista contract while the active agency is Mayorista; per-role smoke (`humo_roles_106.mjs`) | all as expected |
| Production build of the final source | **compiled, TypeScript clean, exit 0** (15.2 s + 57 s; route `ƒ /dashboard/gestion-contratos`), built after the last code edit |

The PostgREST suite covers: both agencies; COP, USD, USD-offer-collected-in-COP and COP-offer-collected-in-USD; paid, partial, unpaid, cancelled, overpaid and no-total contracts; voucher prepared-not-delivered / delivered / stale; invoice issued (accounting+DIAN, legacy number) not sent / sent; commission paid, partial, pending, NETO deducted, NETO with a non-deducted row, retained, planned, undefined, not applicable; contracts with no tracking history; reused contract number with a stale uid (rejected, nothing written, new contract does not inherit); concurrent acknowledgments (three simultaneous → exactly one); pagination (3 pages cover the 62 contracts exactly once, empty page 4, limit capped at 100), combined filters, inclusive date boundaries, empty results; hostile text (`%`, `_`, quotes, backslash, SQL fragments); acknowledgment saved + audited + **no change in 16 financial/voucher/invoice/commission tables** (row counts and content hash before/after).

## 7. Resource measurements (local; see the labels)

**Measured locally** — RPC `fn_gestion_contratos`, 5 runs per scenario in one session as an authenticated superadmin with real RLS configuration, synthetic volume (`supabase/scripts/local106/volumen_106.sql`: 2 agencies, ~2.3 payments/contract, 15 % vouchers, 8 % + 8 % invoices, 25 % B2B commissions, ~5 % acknowledgments), PostgreSQL 15 container on a development laptop (not Supabase hosted hardware):

| Contracts | payments | unfiltered page 1 (median / max) |
|---|---|---|
| 3,000 | 6,900 | 39 / 52 ms |
| 20,000 | 46,000 | 304 / 321 ms |
| 60,000 | 138,000 | 828 / 958 ms |

At 20,000 contracts: page 400 (offset 9,975) 321 ms; agency=minorista 96 ms; balance filter + sort by balance 283 ms; voucher-delivery filter 232 ms; commission filter 238 ms; invoice-sent filter 239 ms; purchase+travel date range 27 ms; number substring 18 ms; customer substring 34 ms; combined four filters 89 ms. Cost is linear in the number of contracts (one scan of `ventas`, hash aggregates for the rest), independent of the page offset.

**Design decision backed by measurement — SECURITY DEFINER.** The first version was SECURITY INVOKER (RLS as a second net). With RLS each row of `ventas`, `abonos`, `vouchers`, … evaluates `mi_rol()` (a query) and the policy predicates make the planner underestimate rows (133 instead of 20,000), choosing nested loops: **4.8 s unfiltered and a balance filter still running after 94 s** (stopped) at 20,000 contracts, versus 304 / 283 ms now. The explicit superadmin check at the top is the access boundary; the function is read-only.

**Indexes — not added.** `abonos(numero_contrato)`, `aliados_b2b(numero_contrato)` and `facturacion(numero_contrato)` were created on the 20,000-contract copy and the same scenarios re-measured: unfiltered 304 → 271 ms, balance 283 → 248 ms, one scenario 27 → 62 ms — within run-to-run noise or worse. No index is justified by these plans; revisit if production exceeds ~60,000 contracts or p95 exceeds ~1 s. Each index would also cost writes on `abonos`.

**Requests per action** (counted at the HTTP layer against PostgREST by the PostgreSQL suite, real loader/page/action): page load, any filter, any page = **2** (one `usuarios` profile read + one `fn_gestion_contratos` call; the proxy and layout make their own calls, as on every dashboard page, and are not counted); 0 per row; recording an acknowledgment = 2 (profile + RPC) plus one revalidation render. Idle after render: **0** requests over 2.5 s (test) and 4 s (browser). In a real browser: typing four characters in 500 ms produced 0 requests while typing and **1** RSC request after the 400 ms debounce; the same value again produced 0; clearing the field produced 2 RSC fetches of the same URL (Next router behaviour, bounded, no loop). No `setInterval`, no polling, no retries (a unit test greps for them); row links use `prefetch={false}`; Server Action buttons are disabled while pending.

**Vercel / external cost.** *Measured:* nothing hosted. *Local evidence:* one dynamic server render (one function invocation) per load/filter/page change; one Server Action invocation per acknowledgment; response payload is one jsonb of ≤ 25 rows (≈ 23 KB per page, §8). *Projected, not measured:* at the real contract count (hundreds to low thousands; exact production count not read) the database call should be well under the 39 ms measured for 3,000 contracts on this laptop; function CPU/duration on Vercel is **not measured** (no hosted run was made, per the rules) and must be compared by the owner in Preview Network/Observability for equivalent periods. *Introduced:* no cron, no new environment variable, no new dependency, no storage, no external API or AI call, no email sent. Related: #101 / #104.

## 8. Payload size
Measured on the 62-contract seed: the RPC response for a 25-row page is **23.1 KB of JSON (≈ 924 B per row)** — no voucher contents, no tokens, no child tables; the page HTML adds the markup of 25 rows. Not measured: gzip size, hosted transfer.

## 9. Limitations and open decisions
- **«Invoice issued» = DIAN-validated only** (owner decision 2026-11-17, applied in migration 309, `lib/gestionContratos/*` and the filter «Factura emitida (validada DIAN)»). Contracts whose invoice exists only as an accounting entry, draft or legacy numbered row show «Sin validar en la DIAN»; there is still no single invoice model (`ventas.facturado` is dead).
- Contracts collected in a currency different from the offer cannot be invoiced from the system (migration 235, F4451); they will show «Sin factura» / unregistered by design.
- «With balance» includes pending **and** confirmed/active contracts with debt and excludes cancelled (owner decision 2026-11-17); cancelled contracts stay reachable through the state filter. The Dashboard counts confirmed/active only — a known, intentional difference.
- Acknowledgments are contract-level (one for all vouchers, one for all invoices of the contract), not per document. A replacement voucher clears the current delivery mark (history kept); no other event does.
- Commission amounts are not shown (only the class): amounts live in the contract's Comisiones tab (link). The internal advisor's monthly commission is out of scope (`no_aplica` + explanation).
- The summary and the page both use the filtered set; text search is a substring match (sequential scan, fine at the measured scale; add `pg_trgm` only if the volume demands it).
- The local review banner «Tu sesión no tiene una agencia vinculada…» comes from the local environment (no `sesion_agencia` row), not from this module.
- Not verified: print/PDF (the screen has none), Safari/real phones, Vercel metrics, behaviour on hosted Supabase hardware, the production contract count.

## 10. Migration dependencies and owner SQL order
Depends on already-applied migrations: 107 (tenant), 131 (`comision_b2b_pagos`), 205 (commission functions), 208/235 (invoicing/collection currency), 268 (`comision_b2b_revision`), 284 (identity/guards), 286 (`comision_plan`), 087/108 (audit). **Numbering:** at execution time the highest number in any active worktree was 308 (#1); 307 = #53; **309 is therefore free** — re-run `ls supabase/migrations | sort | tail` in the integration branch before executing and renumber (file, scripts, docs, test launcher) if #53/#1/#102 land differently. Order: `preflight_309_gestion_contratos.sql` (one query, all OK) → migration 309 → `postcheck_309_gestion_contratos.sql` (one query, all OK, 0 acknowledgments) → deploy the code. The code needs the migration (the RPCs); the migration alone is inert (nothing calls it). Rollback: `rollback_309_gestion_contratos.sql` (refuses if acknowledgments exist).

## 11. Local review environment
`supabase/scripts/local106/local106.ps1 preparar | iniciar | dev | prod | start | restaurar | detener` (derived from `local53.ps1`; own containers `local106-*`, own network, ports 54356 gateway / 3056 dev / 3057 production, database `dspacios_local106` inside the existing `pg304`, snapshot `dspacios_local106_semilla` for `restaurar`). Users (password `Local106!`): `superadmin@`, `gerencia@`, `administracion@`, `operaciones@`, `venta@`, `aliado@local106.test`. Seed `semilla_local106.sql`: 17 curated Mayorista contracts `DTM-10601…10617` + 5 Minorista `MIN-00-0901…0905` + 40 filler contracts (3 pages). Tools: `captura_106.mjs` (login + cookie + desktop/phone screenshots), `humo_roles_106.mjs` (per-role route smoke), `volumen_106.sql` + `medir_106.sh` (volume and timings).
