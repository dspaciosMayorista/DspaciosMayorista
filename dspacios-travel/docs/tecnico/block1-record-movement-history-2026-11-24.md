# Block 1 — record movement history (owner improvement, not the audit screen)

Date: 2026-11-24. Worktree `dspacios-travel/.worktrees/block1-vuelos`, branch `claude/block1-vuelos-documentos`. Nothing staged, committed, pushed, deployed; no remote SQL, no live mail, no owner review environment started.
**Not touched:** the closed LBH7YT support operation (record 142, six new available seats — no data access of any kind this round), the voucher/conversion findings, migrations 334–338 (still unapplied outside disposable databases), other worktrees, the previous production build (kept at `.next-r6-inf1eC8W`), and the separate audit-usability task (still pending, not started). CRM not started.

## 1. What changed (small, no migration, no new query)

| File | Change |
|---|---|
| `lib/vuelos/historial.ts` | `agruparHistorial` now (a) returns newest first (guaranteed in code, not only by the query; ties and unreadable dates keep the received order, unreadable last), (b) keeps one `detalle` entry per seat row inside each grouped operation. New `tituloEntrada()` names the operation **only from the saved `tipo`**. `describirEntrada` default branch (pre-194 rows without `tipo`) no longer says «Entró desde / Salió hacia X» unless origin AND destination are both saved and differ; otherwise «Movimiento anterior: no se guardó su tipo ni su destino». |
| `app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx` (new, server component, no client JS) | One card per operation: title, saved date **and time in America/Bogotá** (`fechaHoraBogota`, the project's existing helper; `dd/mm/yyyy hh:mm`, explicit «hora de Bogotá»), plain-language sentence from this record's point of view, then labelled facts: registered by, quantity, origin record, destination record, cupos origin/destination before → after, origin/destination seat numbers, contract, free-text reason (labelled «Motivo (texto libre)»), and a `<details>` «Detalle por silla (n)» with each individual row. Anything not saved says **«No guardado»**; what cannot apply (retirement has no destination) says **«No aplica»**. |
| `app/(dashboard)/dashboard/vuelos/[id]/page.tsx` | The inline list is replaced by the component. Same single `movimientos_silla` query (same columns, filters, ordering); authorization/tenant handling untouched. |
| `pruebas/vuelosOperaciones.test.ts` | History tests updated for newest-first, plus: retirement whose free-text reason mentions another record stays a retirement; pre-194 row with a destination is «Cambio entre records (registro anterior)»; pre-194 row without destination is «tipo no guardado» even if its reason says «trasladada al record Z»; ordering of ties/unreadable dates; per-seat detail survives grouping. |
| `pruebas/historialMovimientos.react.ts` (new, registered in `test:react:resto`) | Renders the real component: retirement vs genuine transfer, missing legacy facts, Bogotá day boundaries, empty state, mobile grid classes. |

**Rules honoured.** Stored timestamps are not modified and date-only travel dates are not converted (only `fecha_movimiento`, a `timestamptz`, is formatted). The free-text reason is never parsed or used to classify. No historical row, seat or cupo is written; the change is read-only presentation.

## 2. Verification

| Check | Result |
|---|---|
| Focused unit/wiring (20 files: vuelos operations/stats/control/colours/tabs, retention, infant/passenger wiring, currency, compatibles, publication wiring touching `vuelos/[id]`) | **463/463** (`evidence-block1-r8/regresion_unit.log`) |
| Focused React (new history render + `pasajeroAccionesMover`, `liberarRetencion`, `vuelosOperacionesActions`, `vuelosPasajeroContrato`, `dashboardCupos59`) | **67/67** (`regresion_react.log`) |
| `tsc --noEmit` | clean (no output) |
| Production build `next build` | **OK**. Final build after H8-1: BUILD_ID **`ELPK6LteTxZvxC8Kigs6m`** (`evidence-block1-r9/build.log`); the build of this report, `Joqwn4tJxTA3CCKMZrvyV` (`evidence-block1-r8/build.log`), is kept in `.next-r8-Joqwn4tJ` and the round-6 build `inf1eC8Wl3kHf73y7ywIz` in `.next-r6-inf1eC8W` (nothing deleted). |
| Synthetic cases | Retirement with reason «Se trasladó al record BBB222» → «Retiro de cupo», destination «No aplica», no «Traslado/Entraron/Salieron»; genuine transfer → origin AAA111 → destination BBB222, cupos 10→8 / 6→8, seats #9,#10 → #7,#8, per-seat detail; seen from the destination it reads «Entraron 2 cupo(s)…». Legacy row (no tipo, no actor, no destination, reason «pasó al record CCC333») → «Movimiento anterior (tipo no guardado)», every missing fact «No guardado», nothing inferred. |
| Timezone / day boundaries (UTC−5) | `2026-11-24T04:59Z` → **23/11/2026 23:59**; `05:00Z` → **24/11/2026 00:00**; `2026-12-31T23:30−05:00` → 31/12/2026 23:30; `2027-01-01T04:59:59Z` → 31/12/2026 23:59; ordering newest first verified. The formatter passes `timeZone: "America/Bogota"` explicitly, so it does not depend on the server/browser zone (not re-run under other `TZ` values: Node on this Windows host ignores `TZ`; the explicit option is what guarantees it). |
| Responsive rendering (**superseded by H8-1**, see `block1-h81-compiled-history-inspection-2026-11-24.md`) | The **real component** with the **compiled CSS of that build**, synthetic data, Edge headless: `evidence-block1-r8/visual/historial_desktop_1280.png` (4 columns), `historial_intermedio_820.png` (4 columns from `md`), `historial_movil_390.png` (2 columns, date wraps under the title, no horizontal overflow; images opened and inspected). Generator: `visual/render_historial.react.ts`. **Limit (and a wrong claim, corrected):** this was the component on a plain page, not the dashboard page. I wrote that the widths were «conservative (full width)»; the real page has a sidebar, so at 820 px the card is only ~380 px wide and the 4-column grid was cramped. H8-1 inspected the real compiled page with real sessions and a true 390 px device emulation, fixed the grid (`lg:grid-cols-4`, actor full width on narrow cards) and rebuilt: final build `ELPK6LteTxZvxC8Kigs6m`. Edge headless cannot go below ~500 px, so the 390 px case is a 390 px-wide container inside a 500 px window — the layout rule is a viewport media query (`md`, 768 px) and 500 < 768, so it is the mobile branch. |

## 3. Resource evidence (local measurements; hosted costs NOT measured)

- **Requests:** unchanged. One `movimientos_silla` select (same columns/filters/order) per page view, as before; no new query, no client-side fetch, **no client JavaScript added** (server component without hooks). The `<details>` is native HTML.
- **Payload (local measurement):** 4 grouped operations (5 rows) rendered as 9.2 KB of HTML ≈ 2.3 KB per operation, ≈ +35 bytes per extra seat in the collapsed detail (measured by `visual/tamano.react.ts`: 1 seat 2,045 B, 2 seats 2,080 B, 10 seats 2,357 B). I did **not** measure the old markup for the same data (so no before/after delta is claimed). The list is still not paginated (as before): a record with hundreds of operations would send hundreds of KB; no such record was measured.
- **Build:** warm build 18.5 s. A first attempt with a cold cache (my mistake: I moved `.next` with its cache) died in «Running TypeScript» at Node's default ~2 GB heap after 61 s; free memory fell to **544 MB** during that attempt (`build_intento1_heap_agotado.log`). The retry restored a copy of the old cache and used `--max-old-space-size=3072`: free memory never below **2267 MB** (`memoria_build.csv`, 5 s samples). Other processes on the host (a PostgREST container from earlier block-1 rounds and `aiomotor-db`) were left running; nothing was stopped.
- **Hosted (Vercel/Supabase) cost:** not measured. By construction the only server work is rendering one extra small component per page view; database and egress behaviour are unchanged.

## 4. Limits / owner-visible

- Cupos «antes → después» of a grouped operation are taken from its first row (all rows of one operation carry the same totals in the migration-194 writers); rows written by other paths could disagree and were not looked for.
- «Cantidad» counts seat rows of the operation, as before.
- Operations of type `mover_datos` legitimately show cupos unchanged (e.g. 8 → 8): data moved between seats, inventory did not.
- The `<details>` list is closed by default; the number of seats is in its title.
- The audit screen (`/dashboard/auditoria`) was not changed; its usability task remains pending.

## 5. Files

`lib/vuelos/historial.ts`; `app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx` (new); `app/(dashboard)/dashboard/vuelos/[id]/page.tsx`; `pruebas/vuelosOperaciones.test.ts`; `pruebas/historialMovimientos.react.ts` (new); `package.json` (one entry in `test:react:resto`, 514 chars); evidence in `docs/tecnico/evidence-block1-r8/`.
Re-run: `node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs pruebas/vuelosOperaciones.test.ts`; `node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/historialMovimientos.react.ts`.
