# H8-1 — inspection of the compiled flight-record page (movement history)

Date: 2026-11-24. Worktree `dspacios-travel/.worktrees/block1-vuelos`, branch `claude/block1-vuelos-documentos`. Nothing staged, committed, pushed or deployed; no remote SQL, no live mail. Synthetic data only, in a disposable database copied from a local template (container `pgsoporte339`, template 001–326, plus migrations 334–338 and the seed); the database, role, PostgREST container and network of each run were dropped by the launcher. Not touched: LBH7YT / record 142, any owner data, the other worktrees and containers. CRM stays queued.

## 1. Result in one paragraph

The gap is closed with real evidence, and the inspection found one real layout problem that my earlier synthetic check had hidden: on the actual page at 820 px the dashboard sidebar leaves the history card only ~380 px wide, so the 4-column grid (`md:`) squeezed the long actor name and the labels into very narrow columns (readable, no overlap or overflow, but cramped). I changed the grid to 2 columns up to `lg` (1024 px) with «Registrado por» spanning the full width on narrow cards, **rebuilt** (compiled inputs changed) and repeated the whole inspection: **51 checks, 0 failures**, new **BUILD_ID `ELPK6LteTxZvxC8Kigs6m`** (the previous build `Joqwn4tJxTA3CCKMZrvyV` is kept in `.next-r8-Joqwn4tJ`). My earlier report said the intermediate width was «conservative (full width)»; that statement was wrong and is corrected there.

## 2. How it was inspected

- **Compiled app:** `next start` of the production build of this worktree; real sessions (the app resolves each user through the real `usuarios` row and RLS): **control_vuelo** (the flights role), **superadmin**, and **venta** as a negative control. Disposable PostgREST database; a minimal GoTrue stub only answers «who is this token» for those users.
- **Browser:** Edge over CDP with **real device emulation** (`mobile: true`, mobile user agent, 390 px viewport, device scale factor 2) — not a narrow container — plus 820 and 1280 px.
- **Routes:** `/dashboard/vuelos/9501` (record AAA111, sends the transfer, has the retirements and the legacy history) and `/dashboard/vuelos/9502` (BBB222, receives the transfer), tab «Cambios» → «Movimientos históricos», per-seat detail closed and open.
- **Fixture** (`semilla_visual_historial_h81.sql`, rows listed in `visual/fixture-movimientos.txt`): retirement whose reason says «Se pasa al record BBB222…» with a 140-character unbroken token and a 100-character actor name; grouped transfer AAA111 → BBB222 of 3 seats; passenger moved with cupo (manual contract CM-0451); two legacy rows (one with no actor/destination/cupos whose reason names CCC333, one with origin and destination but no actor/cupos); three day-boundary retirements (04:59Z, 05:00Z, New Year 04:59Z).

## 3. What was verified on the rendered page

| Case | Observed (compiled page) |
|---|---|
| Retirement whose reason mentions another record | Titled «Retiro de cupo»; «Record destino: No aplica»; cupos 10 → 9, seat #4; no «Traslado / Entraron / Salieron» wording; the reason appears only as «Motivo (texto libre): “Se pasa al record BBB222…”»; the 100-character actor is shown in full; the unbroken 140-character token wraps inside the card at every width |
| Grouped transfer from the sending record (AAA111) | «Traslado de cupos libres», «Salieron 3 cupo(s) libre(s) hacia BBB222», 3 sillas, origin AAA111 → destination BBB222, cupos 12 → 9, seats #10, #11, #12 |
| Same transfer from the receiving record (BBB222) | «Entraron 3 cupo(s) libre(s) desde AAA111», cupos destino 6 → 9, seats #7, #8, #9; the passenger moved with cupo reads as «Salió… hacia AAA111» there and as «Entró… desde BBB222» on AAA111 |
| Incomplete legacy history | «Movimiento anterior (tipo no guardado)»; actor, destination and cupos say «No guardado»; nothing inferred from the reason naming CCC333; the second legacy row is «Cambio entre records (registro anterior)» only because origin and destination are saved |
| Expanded per-seat details | «Silla #10 → #7», «#11 → #8», «#12 → #9» and «Silla #3 → #13 · contrato CM-0451» listed after opening every «Detalle por silla» |
| Bogotá date/time | each card shows `dd/mm/yyyy hh:mm (hora de Bogotá)`: 23/11/2026 23:30, 23/11/2026 00:00, 22/11/2026 23:59 (04:59Z), 02/11/2026 15:15, 05/10/2026 10:00, 03/01/2026 07:00, 02/01/2026 07:00, 31/12/2025 23:59 (New Year 04:59Z) — newest first, in that order |
| Overflow / overlap | at 1280, 820 and 390 px (390 = real mobile viewport), detail closed and open, for control_vuelo on both records and superadmin on AAA111 (1280 and 390): no horizontal overflow (document scroll width = viewport), nothing outside the viewport, no sibling elements intersecting inside any card, nothing outside its card, no clipped text; 0 JavaScript exceptions |
| Roles | control_vuelo and superadmin see the history; the **venta** advisor is taken out of the module (the page shows the dashboard shell with only commercial modules, no history) |
| Requests | switching Pasajeros ↔ Cambios makes **0** requests; a page load makes 1 `movimientos_silla` request (the history added no query) |

Screenshots (all full page, in `evidence-block1-r9/visual/`): `historial-AAA111-control-{compacto,detalle}-{1280,820,390}.png`, `historial-BBB222-control-{compacto,detalle}-{1280,820,390}.png`, `historial-AAA111-super-{compacto,detalle}-{1280,390}.png`. I opened the 390 and 820 captures of AAA111 (before and after the fix) and the 1280 capture of BBB222. Card texts of AAA111: `visual/tarjetas-AAA111.txt`; measurements: `visual/mediciones_h81.json`; run logs: `lanzador_h81_final.log` (`lanzador_h81_1…4.log` are earlier attempts: a missing `operaciones_vuelo` row in the seed, the card-count/label-case assertions of my own script — none of them was a page defect).

## 4. The change made (small)

`app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx`: details grid `grid-cols-2 … md:grid-cols-4` → `grid-cols-2 … lg:grid-cols-4`; «Registrado por» gets `col-span-2 lg:col-span-1` (new optional `clase` prop on the internal `Dato` helper). `pruebas/historialMovimientos.react.ts` updated to the new breakpoint. No logic, query, data or permission change.

## 5. Verification and resources

- `tsc --noEmit` clean; focused unit/wiring **182/182** (vuelos operations/stats/control/colours/tabs, retention, close-writes wiring, alliance/own history) and React **67/67** (new render test + passenger move, retention release, operations actions, passenger/contract, cupos dashboard), run after the layout fix. No file under `app/ lib/ components/ types/` is newer than the final build.
- Build: warm cache (copy of the previous build's cache), **36 s**, `--max-old-space-size=3072`; free RAM fell to **246 MB** at the lowest (`memoria_build.csv`) — close to the host limit, no other process was stopped.
- Requests per page load of `/dashboard/vuelos/[id]` in this harness: 376 requests / 16 loads ≈ 23.5, of which 9 are `GET /usuarios` per load; that count is pre-existing behaviour I did not change or investigate (worth a separate look). Hosted (Vercel/Supabase) costs: not measured.

## 6. Limits

- The fixture is synthetic and small (8 operations on the largest record); a record with hundreds of operations was not rendered (the list is not paginated, as before).
- Edge was driven with its own device emulation; real phones/other browsers were not used.
- The harness shim: the compiled app is unchanged; the harness only supplies the Supabase environment at start-up (this build did not bake it in).
- Pre-existing, not changed: the page header line «(no son cupos)» is very light grey and hard to read.

## 7. Re-run

`sh supabase/scripts/lanzar_visual_compilada.sh pgsoporte339 plantilla339 docs/tecnico/evidence-block1-r9 supabase/scripts/visual_historial_h81.mjs supabase/migrations/20260601000334_…sql … 20260601000338_…sql supabase/scripts/semilla_visual_historial_h81.sql` (template = `preparar_esquema_local.sh <container> 326 plantilla339`; needs the `.next` build of this worktree). Library and launcher are the same files used for the support-limit inspection (`visual_compilada_lib.mjs`, `lanzar_visual_compilada.sh`).
