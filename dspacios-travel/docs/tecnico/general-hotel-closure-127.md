# #127 — General hotel closure (`hotel_blackouts`) vs published tariffs

Status: round 2 (Codex audit G1/G2/V1 corrected) implemented and verified locally on a disposable database; **not** committed, pushed, deployed, or applied remotely. Branch `claude/127-blackout-general` (worktree off origin/main `312608a59`).
Owner case: hotel 62 GRAND SIRENIS CARTAGENA, package 36 (bloqueo), stay 2026-12-30 → 2027-01-02 (3 nights), double room offered at COP 3.225.000 p.p. inside a total closure 2026-12-29 → 2027-01-09.
Hotel 74 / package 33 (second reported case): inputs not supplied. It is covered by the same rule (nothing is hotel-specific) but was **not** reproduced.

## 1. Root cause

Two different things were called "blackout":

| | Table / column | Meaning | Reader before this change |
|---|---|---|---|
| Season exclusion | `hotel_temporadas.blackouts` | removes ONE season on those nights; another eligible season may still win | live evaluator **and** generator (already correct, untouched) |
| **General closure** | `hotel_blackouts` (064/145) | closes the hotel (total) or a category / accommodation on those nights, above EVERY season | **live evaluator only** (`evaluarHotelPorFechas`, porción by dates) |

The generator (`generarTarifario`) never read `hotel_blackouts`, so a bloqueo / dinámico / empaquetado offer was published for a closed stay. `crearBlackout` only revalidated the hotel admin page (no regeneration, no invalidation trigger: 181/260 cover `tarifa_hotel` and `hotel_temporadas` only). Sales for those modules price from the **published row** (`computarReserva` published branch), so nothing stopped a closed stay from being quoted/converted: the closure was enforced in exactly one of the five paths.

## 2. The rule (single source: `lib/tarifario/cierresHotel.ts`)

* A closure touches a stay when `fecha_inicio <= last occupied night` and `fecha_fin >= first night`. Both closure endpoints are inclusive; the check-out day is **not** an occupied night.
* `total` closes everything. Otherwise empty/NULL `categorias` / `acomodaciones` mean "all"; both present = intersection. (`total = false` with both empty closes everything, exactly as the live evaluator always did.)
* A closure never reprices anything: it removes the combination. Remaining prices are byte-identical.
* «From» window (porción): only sellable *entries* compete (`subventanasEntradaVendible`); the price engine `lib/calc/paquetes.ts` is **not touched** (it is fingerprinted by `salidaVinculada63Wiring.test.ts`): the generator evaluates one window per sellable sub-interval and keeps the cheapest. No applicable closure = one window = identical call to before.
* **Price provenance of a «from» row (Codex G1).** An open date somewhere in the window does NOT prove that the *published price* is still attainable (the cheap entries may be the closed ones: 225.000 stays public while the real minimum is 375.000). So:
  * the generator publishes a window row whose window is touched by an applicable closure **with its sellable witness**: `desde_entrada` = the earliest sellable entry whose own price (same engine, `liquidarHotelMasBaratoConTemporada` on that single entry) equals the published total (`testigoDesde`). If no sellable entry reproduces the total, the row is **not published**.
  * display and migration 315 treat a row WITH a witness as an exact stay (hidden iff that stay is closed); a row WITHOUT a witness (published before the closure, or by older code) is hidden when ANY applicable closure touches ANY stay of its window (`ventanaTocadaPorCierre`: the closure intersects [desde, hasta + noches − 1]) until a verified regeneration publishes it with its witness. Fail closed on failed or absent regeneration.
  * unaffected rows (closure outside the window, another category/accommodation, another hotel) keep price, row and the absent witness exactly. Reopening: a witnessed row stays visible (its stay is still attainable, price merely higher than the new minimum) and the regeneration that follows restores the true price without a witness.
  * side effect to know: for those rows the card shows the existing «N noches · Entrada dd/mm/aaaa» justification line (the field hotels with day-groups already use).
* **Priced-under-request hotels (Codex G2).** `aplicarNetaSolicitud` substitutes tariffs and vigencias with the operator's synthetic rate but now keeps the hotel's general closures: valuation (`asignarNetaSolicitud`), reservation and conversion of an already-priced quotation all refuse a closed stay. A pending, unpriced inquiry is a separate product state and is unchanged. The rejection text is the existing «no tariff for those dates» (the live path cannot know the cause).
* **Unit-priced hotels (`modelo_tarifario = 'unidad'`): the supported closure dimensions are TOTAL and CATEGORY only.** The system has no accommodation ↔ unit mapping and none was approved by the owner, so a closure restricted by accommodation (alone or together with categories) is **not applied** to a unit tariff. It is not reinterpreted: `crearBlackout` rejects it for a unit hotel with an explicit message, and the hotel screen explains the supported dimensions and flags an already-stored unsupported closure «No aplica: tarifa por unidad». No exception, mapping or fail-closed reinterpretation was invented; whether such a closure should block a unit stay is an **open owner decision**.

## 3. Enforcement points

| # | Layer | File | Behaviour |
|---|---|---|---|
| 1 | Generation / publication | `paquetes/actions.ts` (`generarTarifario`) | one closure read per generation (all hotels), closed combinations are not published (rows, children classes, synthetic infante row); read error = technical failure, nothing published |
| 2 | Display (table, Booking, summary, detail, dashboard tarifario) | `lib/tarifario/vigencia.ts` (`filtrarTarifarioVencidas`) | hides published rows whose stay/window is closed even if never regenerated; one read per row set; read error hides hotel rows (fail closed) |
| 3 | Checkout page of an open cart | `reservar/nuevo/page.tsx` | closed rows removed; nothing left → "closed" message; read error → "could not validate" |
| 4 | Authoritative sales (reserve, cart quotation, direct quotation, conversion, B2B) | `lib/reservar/computo.ts` (`computarReserva`) | re-checks against the database on every action; rejects closed rooms/children classes instead of dropping them silently |
| 5 | Unit-priced hotels (compute + search) | `lib/reservar/computoReservaBernalo.ts` | same rule, `no_cotizable` |
| 6 | Live porción by dates | `lib/reservar/liquidacionHotel.ts` | unchanged behaviour; now calls the shared rule (same results) |
| 7 | Saving / reopening a closure | `producto/hoteles/[id]/blackouts-actions.ts` | regenerates the hotel's packages (bounded, same as a rate edit) and tells the operator if any failed |
| 6b | Hotels priced under request | `lib/reservar/solicitudHotel.ts` (`aplicarNetaSolicitud`) | closures are preserved when the synthetic rates replace the tariffs (G2) |
| 8 | Database | migration **315** (new, NOT applied) | closing a stay hides the published rows immediately (`tarifario_fila_oculta`), whatever path saved the closure |

Order-independent: the application fixes (1-7) work with or without 315; 315 only adds immediate hiding for any reader of `tarifario_resultado_publicable`.

## 4. Migration 315 (`20260601000315_tarifario_oculta_por_cierre_general.sql`)

Number: 312/313 are reserved by #126 and 314 by B2B; 315 was the next free number in all worktrees at the time. Renumber if the owner prefers.
Additive and idempotent; requires 181/260 (`tarifario_invalidar`, `tarifario_fila_oculta`) and 145. Statement-level triggers on `hotel_blackouts`:
* INSERT/UPDATE: bumps the revision of the packages that use the hotel and hides, per row, only the published rows whose stay touches a closed night for their category/accommodation (porción «desde» rows: with a witness as an exact stay; without one, whenever a closure touches any stay of the window — the same rule as the application, parity-tested over 2.000+ cases).
* DELETE (reopen): bumps the revision only; rows already hidden stay hidden until the regeneration (fail closed; the application regenerates on delete).
* Nothing is hidden when the migration itself is applied. Functions are SECURITY DEFINER with fixed `search_path` and not executable by `anon`/`authenticated`.
Owner steps: `supabase/scripts/preflight_315_cierre_general.sql` → apply → `postcheck_315_cierre_general.sql` (one integral query each). Rollback: `rollback_315_tarifario_oculta_por_cierre_general.sql`.
Suggested order: deploy the code (works without 315) → apply 315 → save/reopen one closure on a test hotel.

## 5. Evidence (local, disposable database; see the report for the acceptance matrix)

* `pruebas/cierresHotel127.test.ts` — 39 unit tests (boundaries, partial closures, «from» window touched / witness, sub-windows vs day-by-day scan, display rule, loader, workload).
* `pruebas/cierreGeneral127.pg.ts` — 36 real-action tests (generation, cart, quotation, conversion, display loader, `crearBlackout`/`eliminarBlackout`, porción live search, **G1 partial-window cases**: stale row, failed regeneration, verified regeneration with witness, reopening, unaffected prices, all-closed; migration 315 triggers incl. the same G1 cases in the database; SQL-vs-TS parity over 2.000+ cases; read failure; workload).
* `pruebas/cierreGeneralSolicitud127.pg.ts` — 8 real-action tests (**G2**): priced-under-request valuation, conversion of a stale priced quotation, reopening, inclusive endpoints, partial closures, read failure, porción, unaffected hotel.
* `pruebas/cierreGeneralDinEmp127.pg.ts` — 9 real-action tests (**V1**): dinámico (manual departures) and empaquetado (system ticket) end to end — generation, published view, display loader, quotation, conversion, no regeneration, reopening, 315 trigger, read failure.
* `pruebas/cierreGeneralUnidad127.pg.ts` — 8 real-action tests for unit-priced hotels, incl. the explicit rejection of an unsupported accommodation-only closure.
* Mutation checks executed: disabling the sales guard / the generator closure / the display filter makes 7 / 6 / 4 tests fail (round 1); restoring the old whole-window display rule reproduces Codex G1 (G1-1, G1-2 and the SQL parity test fail); restoring `blackouts: []` in the under-request transform reproduces G2 (5 of 8 fail).
* Rendered checks on the FINAL local production build (`next build` exit 0 after the last source change, real login through GoTrue, synthetic data, Edge) at **desktop 1366, tablet 820 and mobile 390**, 96 assertions, 0 failures: `supabase/scripts/localreview127/humo_127.mjs` — owner-stay Booking before/after, real save from the admin screen (1 server-action request), stale checkout link message, reopening, porción search with the stale/regenerated/reopened price (225.000 → none → 375.000 → 225.000), unit hotel note and «No aplica» flag, and the **regeneration warning** (revoked regeneration RPC) inside the viewport at every width. Screenshots were read visually.
* Wider regression: unit suite 10197 tests / 30 failing and React suite 2010 / 26 failing — the failing NAMES are identical to a clean origin/main worktree (baseline, not green); `alcance262.pg.ts` 86/86; `pvpInfanteFijo254.pg.ts` has the same 5 failures as clean origin/main (stale since 288). `tsc` clean; eslint: 0 errors on the touched files.
* Existing tests whose fakes needed the new table were updated (empty `hotel_blackouts`, `.gte` support); four source-pattern guards were updated for the intentional structure changes (`precioFinalAutoritativoWiring`, `tarifaInfante226Cableado`, `publicacionLotesCableado`). No assertion was weakened; the comparison with a clean origin/main worktree is by test name.

## 6. Resource profile

* Generation: +1 paginated read set (page + empty page = 2 requests) per generation regardless of hotels/stays; sub-windows add `engine calls = sellable intervals` only for combinations with an applicable closure (none otherwise).
* G1 witness: one engine call per entry of the window ONLY for rows whose window is touched by an applicable closure (none otherwise); measured generation of the 5-row porción package 60–135 ms with or without a closure. Display needs no extra read (the witness is in the row).
* Display: +2 requests per displayed row set (not per card). Sale: +2 requests per action. Save/reopen a closure: one bounded regeneration of the hotel's active packages (same as a rate edit). No polling, no new background job, no extra Vercel function.
* Not measured: hosted Vercel/Supabase metrics (local only).

## 7. Known limits / not covered

* Unit-priced hotels: accommodation-restricted closures are unsupported (see §2) — an open owner decision, not an approved exception.
* Deploy note: porción «from» rows published by the previous code while a closure already touches their window have no witness and stay hidden until their package is regenerated (fail closed by design). Regenerate the packages of hotels with active closures after publishing.
* After a regeneration the closed row no longer exists, so a stale link reports "tariff not found" instead of the closure message (still a rejection).
* The live porción search keeps its generic "no tariff for those dates" message for closed stays (existing behaviour, does not reveal the reason).
