# REV2 · B95-16 — Tarifario → comparative → selected option → contract/document (implementer `f95tarifario`)

Date: 2026-11-26 · Worktree `dspacios-travel/.worktrees/revision-consolidada` · Not staged, committed, pushed, applied remotely, mailed or deployed. The owner database (`rev_consolidada`), its storage, the app on 3090 and every process not started here were not touched; all database work ran on disposable clones of `rev2_plantilla_347` (= `rev_consolidada_base` + migrations 344–347) and was dropped. No migration was needed or taken.

Gap closed: F7 (`rev2-f95docs-2026-11-26.md` §3) only traced this path by source. This round **exercised** it with the real actions and found one real difference and one pre-existing blocking defect.

## 1. Journey exercised (real actions → PostgREST → PostgreSQL; only session, numbering RPC and two side effects stubbed)

`generarTarifario` → `crearComparativaCarrito` → `elegirOpcionComparativa` → `convertirCotizacionCarrito` → `registrarAbono` (full payment) → persisted rows re-read → customer document rendered from those rows.

Fixture (hand-calculated, markup 20 %, PVP = neto / 0.8, exact to the peso; 3 nights): Hotel Alfa «Estandar»/«Desayuno» (adult 375.000, child 150.000), Hotel Beta «Superior»/«Todo incluido» (adult 480.000, child **free**), optional assistance 40.000 per person linked to each hotel. Published prices were also read back from `tarifario_resultado` (doble 375.000 / 480.000, niño 150.000 / 0) — independent of the engine's cart path.

| Journey | Session | Result (all asserted against hand totals) |
|---|---|---|
| J1 option B, 2 adults + 1 child (3 pax) | staff creates, chooses, converts | total **1.080.000**; one hotel (Beta · Superior · Todo incluido · «1 hab Doble (2 pax), 1 Niño 1»); lines sum exactly; previstas hotel 768.000 + assistance 96.000; paid in full → balance 0 |
| J1b option A, same | staff | total **1.020.000**; child pays 150.000 (+40.000 assistance); hotel Alfa |
| J2 option B, 2 adults | **anonymous visitor** creates and chooses (staff converts) | total **1.040.000**; hotel Beta; titular document saved on the child |
| J4 normal cart (no comparative), same option B | staff | same total, same hotel/plan/detail; used as the parity oracle |
| J3 | staff | the comparative mother is never convertible |
| D0 · J2c | anonymous visitor + 1 child (checkout and comparative) | **passes after the fix** (see `rev2-publico-ninos-2026-11-26.md`) |

## 2. Is the Tarifario comparative the same path as the manual one? No — and it was not equivalent in the document

Source + executed evidence (extends F7 §3):

| Aspect | Manual comparative | Tarifario comparative |
|---|---|---|
| Creator / child | `crearComparativaManual` → manual child | `crearComparativaCarrito` → cart child (`tipo comparativa_carrito`) |
| Conversion | SQL `convertir_cotizacion_a_contrato` (333/347) | TS `convertirCotizacionCarrito` |
| Hotel row | written by 347 (real accommodation in `acomodacion`) | written by the cart code: **`acomodacion` = the room category** («Superior»), the room type is in `detalle_acomodacion` («1 hab Doble (2 pax), 1 Niño 1»). Pre-existing, identical in the normal cart (J4); NOT changed (it is the established production structure and `lib/solicitudProveedor/cargar.ts` reads both fields). |
| Frozen price summary (#94, `contrato_resumen_precios`) | none (grouped item) | **normal cart: yes · comparative option: NO (before this round)** |

### D2 (fixed) — the chosen comparative option lost the per-passenger summary
Reproduced before the fix (J1 option B): `contrato_resumen_precios` = 0 rows; the document fell back to item rows and, after F7's fold, printed **adult $540.000 / child $0** with «Cubre a · Según lo acordado» — the free-in-hotel child looked free although his assistance (40.000) was in the total and the adults carried it. The normal cart for the identical option printed **adult $520.000 / child $40.000, «Todos los pasajeros (3)»**.
Cause: `armarOpcionCarrito` builds each option with `capturar`, and `crearCotizacionCarrito` skips the summary whenever `capturar` is set (`!opts?.capturar`), so the child quotation (created by RPC from `plantilla_hija.detalle`) never carried `resumenPrecios`.
Fix (TS only, `app/tarifario/checkout/actions.ts`, 4 small edits): new option flag `conResumen`, passed by `armarOpcionCarrito`; the summary is built for comparative options too; a partial-coverage service the cart cannot split no longer rejects the option (it stays `resumenPendiente`, as in staff/B2B carts). Preview/normal paths are unchanged.
Evidence after the fix: J1 `contrato_resumen_precios` = 1 and **deep-equals** the normal-cart summary of J4; documents: B → adult $520.000 · child $40.000 · total $1.080.000; A → adult $415.000 · child $190.000 · total $1.020.000; no «Ajuste por redondeo», assistance described without its own price. Mutation: setting `conResumen: false` makes J1 fail on «contrato_resumen_precios congelado»; file restored (verified `conResumen: true` present).

### D1 (FIXED in the second pass) — an anonymous visitor could not quote a child
Cause, fix (service-role read of the capacity columns in `computarReserva`, no migration) and proof (D0, D0b–D0d, J2c; mutation control): see `rev2-publico-ninos-2026-11-26.md`. Rehearsal step B95-16c covers the compiled screens (not yet executed).

## 3. Files

New: `pruebas/f95tarifario.rev2.pg.ts`, `pruebas/documentoTarifario95.rev2.react.ts`, `docs/tecnico/evidencia-rev2-95tarifario-2026-11-26/*.json` (4 dumps of persisted rows, synthetic), `supabase/scripts/revision_consolidada/semillas/rev2/f95tarifario.sql`, `supabase/scripts/revision_consolidada/pasos/55_bloque95_tarifario.mjs` (B95-16a, B95-16b, B95-18b), this report.
Modified: `app/tarifario/checkout/actions.ts` (4 edits, §2 D2; the file also carries the unrelated #78 aviso edits of another block).

## 4. Verification (exact commands, results)

| Check | Command | Result |
|---|---|---|
| Real journey | `R2_ARCHIVOS=pruebas/f95tarifario.rev2.pg.ts sh supabase/scripts/test_rev2_95docs.sh r2a_<name> pgrevc rev2_plantilla_347` (add `PG95_EVIDENCIA=<dir>` to refresh the dumps) | 11 pass · 0 fail · 0 todo (D0 fixed; see rev2-publico-ninos) |
| Customer documents | `node C:/tmp/consolidada/rev2/heavy.mjs <app> "node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/documentoTarifario95.rev2.react.ts"` (also in `npm run test:react:rev2`) | 5/5 |
| Comparative/checkout unit tests | `node --test --experimental-strip-types … pruebas/*omparativa*.test.ts pruebas/cotizacionCarrito*.test.ts pruebas/resumen*.test.ts pruebas/checkout*.test.ts` | 335/335 |
| Comparative React tests | the 8 `*omparativa*.react.ts` files + `recorridoComparativa64` | 114/114 |
| Existing real suite with a comparative journey | `R2_ARCHIVOS=pruebas/alcance262.pg.ts sh supabase/scripts/test_rev2_95docs.sh …` | 83/86; the 3 failures (H2, H4, O4c — bloqueo-hours / past-departure scenarios) are **identical by exact name with the fix reverted** (baseline run), so they are not caused by this change; the comparative test C1 passes |
| tsc | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json --incremental false` | 1 error, in another implementer's file `pruebas/trmCostoProvisional348.pg.ts(394)`; none in these files |

Hand oracles: A = 2×375.000 + 150.000 + 3×40.000 = 1.020.000; B = 2×480.000 + 0 + 3×40.000 = 1.080.000; adults-only A = 830.000, B = 1.040.000; netos hotel B 2×128.000×3 = 768.000, assistance 3×32.000 = 96.000.

## 5. Resources (local; hosted not measured)
The fix adds, per comparative option built (≤ 3 at creation, 1 per option chosen), one `tarifario_resumen` SELECT (package names) plus pure in-memory computation inside the existing action; no polling, retries or new requests from the browser. No before/after request counting was run; the journey suite itself issues no unbounded loops.

## 6. Limits / not done
* Rehearsal steps B95-16a/16b/18b (`pasos/55_bloque95_tarifario.mjs`) are **written, `node --check` and generator-load verified, NOT executed** (they need the final build and the seed `semillas/rev2/f95tarifario.sql`, applied twice on a clone: idempotent, counts 2/2/2/1/2). The cart is injected through `localStorage` exactly as `lib/cart/CartContext.tsx` stores it; selectors of the checkout/option screens come from source and may need adjusting on the first rehearsal.
* Not exercised: an **ally (B2B) session** (`modo_compra`, commission/recobro and the B2B-asisted comparative are covered only by existing suites), USD, hotels on request/Bernalo (excluded from comparatives by design), flight-block packages (rejected for comparatives by design).
* Conversion needs the staff `asesorInterno` (known INT-04 selector finding); the real-UI step uses `venta`, as B2-12 does.
* `acomodacion = category` in cart-origin contracts remains (see §2); decide separately if the owner wants the real room type there.
