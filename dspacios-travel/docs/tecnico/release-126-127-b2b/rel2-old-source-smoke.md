# REL-2 — old-source compatibility smoke against the complete final migration chain (2026-11-21)

**Question (Codex REL-2).** Does the code that serves users **today** keep working once migrations 312–326 are applied, or is that claim only static reasoning?

**Answer, scoped.** A targeted smoke ran the **real old modules** (not stubs) through real server actions → PostgREST → PostgreSQL on a **disposable database that carries the complete final chain 001–326**. Everything listed under «Proved» below passed; the one intentional behavior change (315) is demonstrated and separated from regressions with a control on the old schema. Hosted Auth settings, the deployed commit and Production data volume are **not** proved (see «Not proved»). No product code, owner data, staging, commit, push, remote SQL or deployment was involved.

## 1. Which source is «old»

| Item | Value |
|---|---|
| Commit | `312608a5922d4424ac912153394f4aee99357cb2` — merge of PR #449; `origin/main` on 2026-11-21 and the base of this release branch |
| Tree | `7cb08520e786b982147b90c6652cc6e03a519e4e` |
| Export | `git archive` of that commit → `C:\tmp\old312` (a folder outside the repository; 3 190 tracked files, file list identical to the commit's, four sampled files byte-identical after line-ending normalization). The marker `.release-source-commit` inside it is asserted by the smoke itself (test S0). `node_modules` is a junction to the retained clean worktree `C:\tmp\base126` of the same commit. |
| Absent from the old tree (asserted) | `lib/portal/origenCotizacion.ts`, `lib/reservar/universoViajeros.ts`, `app/(auth)/recuperar`, `lib/tarifario/cierresHotel.ts`, and every migration ≥ 312 |
| **Is it what Vercel serves?** | **Not verified by the executor.** Local `HEAD` is not proof of the deployed commit. Owner check (30 s): Vercel → Deployments → Production → the commit SHA must be `312608a59…` (or a later commit that changed no application file). |

## 2. Which database

| Template (disposable, Docker `pgb2b`) | Content | How it was established |
|---|---|---|
| `plantilla_rel2_viejo` | schema **001–311** (what Production has now) | copy of the repository's 001–311 build; probes: 307–311 objects present, **no** 312+ object (no `moneda_pago`, no 315 triggers, no 313/316/318/319/322–325 table or function) |
| `plantilla_rel2_final` | schema **001–326** | `plantilla_int` (001–324 built from the migration files) + **325 and 326 applied with their own preflight → migration → postcheck** (all rows `OK`/`INFO`) |

Chain checks on the final template (read-only, `rel2_plantillas.sh`): **all 13 postchecks (312, 313, 314, 315, 316, 317, 318, 319, 322, 323, 324, 325, 326) return only `OK`/`INFO`**; the same postchecks 312/315/324 **fail on the old template** (negative control: the chain is really absent there). Comparing the objects of schema `public` old → final: 3 514 → 3 651; **0 objects disappear**, 137 new tables/columns/functions/triggers, and every new table/function/trigger name appears in the text of migrations 312–326 (0 unexplained).

Each smoke run clones the template into a fresh database (`test_pg_local.sh`), starts its own PostgREST, and drops everything afterwards.

## 3. What ran (old modules, final chain)

| Requested area | Suite (old tree) | Real old code exercised | Result |
|---|---|---|---|
| **Payment registration, confirmation, reversal** | `pagoUsdConversion2611.pg.ts` (existing) | `crearSolicitudReserva` → `convertirCotizacionCarrito` → `registrarAbono` (RPC `registrar_abono`, minimum decided in the same transaction) → `anularAbono` | **6/6** |
| **Payment REPLAY** | `abonoReplayCodigoViejo313.pg.ts` (**new**, this handoff) | `registrarAbono` with a repeated operation id, before/after confirmation | **5/5**: replay creates no second payment; the confirmation by minimum still happens in the same operation; `abonos.moneda_pago` stays `NULL` for payments written by old code and `trg_f313_abonos_moneda` is inert (312/313 present: asserted) |
| Confirmation minimum / agreement | `minimoAcuerdo307.pg.ts` (existing) | agreement read, plan generation, number-reuse identity | **3/3** |
| **Quotation creation** (all four origins: manual/dynamic, internal Reservar, hotel-on-request, public/B2B cart) | `personasCotizaciones1.pg.ts`, `personasCotizaciones1Carrito.pg.ts` (existing) | quotation actions, holder/passenger persistence, retry without duplicates, role/tenant isolation | **27/27** and **6/6** |
| **Quotation → contract conversion** | `pagoUsdConversion2611.pg.ts` (above: `convertirCotizacionCarrito`) and `netoNinoGratisReal2611.pg.ts` | cart quotation → contract with frozen conversion, NETO/PVP prices persisted, free-child line | 6/6 and **5/5** (with `semilla_revision_125.sql`) |
| **Portal / account reads** | `portalB2B65.pg.ts` (existing; own launcher `test_65_portal_b2b.sh`) | ally portal loaders and pages (lists, cartera, documents, pagination with real `max-rows`) | **21/24 on the final chain and the same 21/24 on the old schema**; the same three tests fail with the same names on both (a direct contract absent from the ally's lists — flagged earlier as a possible defect of the base). So they are **not attributable to 312–326**, but they are *not green* either |
| Ally voucher access | `voucherAcceso307.pg.ts` (existing) | voucher gate by role and payment | **10/10** |
| **Migration 315's intentional effect** | `cierreHotelCodigoViejo315.pg.ts` (**new**, this handoff) | old `crearBlackout` / `eliminarBlackout`, old `cargarFilasTarifarioPaginado` and old `cargarDatosTarifario` | **4/4** (details below); on the old schema the same file gives 1/4 (S1 only), so it discriminates |

### 315, distinguished from a regression
With the final chain, the old action `crearBlackout` **succeeds** (no error) and the trigger hides — does not delete — exactly the published rows whose window touches the closure (`tarifario_fila_oculta`, reason «cierre general del hotel»); a row outside the dates and the same row of another hotel stay visible; the old read path keeps working and no longer returns the hidden row. `eliminarBlackout` also succeeds, and the hidden row **stays hidden** until a regeneration republishes it (the 315 contract: a delete does not un-hide by itself). This is the effect the handoff announced («behavior change starts at the DB stage, even with the old code»); it is **not** a regression of old code, and it is the only behavior difference observed. No backfill exists, so rows already inside existing closures change only on the next closure write or regeneration.

## 4. Not proved (stated, not assumed away)

1. **Hosted Auth settings.** «Confirm email», the confirmation/recovery templates, the redirect allow-list, OTP length/expiry and SMTP limits live in the hosted Supabase Auth configuration. Additive SQL neither changes nor proves them harmless; the local GoTrue/PostgREST rigs do not reproduce hosted behavior. They remain **owner checks before the Preview** (handoff §6) and are **not part of the compatibility claim above**. The executor changed no hosted setting. Migration 324 adds functions that can delete an *unverified* account, but only when the new code calls them; the old code never does.
2. **The deployed commit** (§1): unverified by the executor.
3. **Production schema equality.** The «old» template is built from the repository's migrations 001–311, which the owner reports as applied; it is not a dump of Production.
4. **Production data volume and cost of the 315 triggers** (not measured), Storage buckets (318/319/325 are not touched by old code), PostgREST/Postgres versions of the hosted project, and any browser-level behavior.
5. **Breadth.** This is the smallest real-action smoke for the four requested areas, not a rerun of every old suite; seven stale old launchers and the three `portalB2B65` failures are pre-existing and were not «fixed» here.

## 5. Reproduce (local, disposable, nothing remote)

Scripts: `supabase/scripts/release_rel2/` (`rel2_plantillas.sh` → templates and chain checks; `rel2_exportar_viejo.sh` → the exact old tree; `rel2_suites.sh` → old suites against a template). The two new smokes are copied into the exported old tree and run from there:

```sh
MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pgb2b plantilla_rel2_final PG313 pruebas/abonoReplayCodigoViejo313.pg.ts
MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pgb2b plantilla_rel2_final PG315 pruebas/cierreHotelCodigoViejo315.pg.ts
```

Raw outputs: `rel2-evidence-logs.txt` in this folder.
