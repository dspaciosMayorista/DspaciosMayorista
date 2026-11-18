# Owner corrections 2026-11-18 — PROMO workstream (item 7 + both promotion follow-ups)

Status: **implemented in `.worktrees/int-review`; executor tests green; heavy verification (tsc, production build, disposable database + real actions, browser/PDF inspection) NOT run by this workstream.** Nothing staged, committed, pushed or deployed. No database was touched. Codex has not audited this.

## 1. What changed

| Area | File | Change |
| --- | --- | --- |
| Derived matrix engine | `lib/hoteles/promocionesDinamicas.ts` | New `promocionesSigueBase()` (+ `MAX_LINEAS_MATRIZ = 2000`); `promocionesDinamicasHotel()` now also returns the «follow the winning base each night» promotions (it used to skip them). Per promotion, regimen and **date segment (winning base)**: all 7 accommodations (Sencilla, Doble, Triple, Múltiple, Niño 1, Niño 2, Infante). Read-only; no stored rows; unavailable rates shown as «sin tarifa»; non-selling nights listed in `notas`. |
| Day groups | `lib/calc/promoCalculadora.ts` | `planPromoPorNoche` accepts `dias` (ISO weekdays): nights outside the rule's days are not part of the promotion. Existing callers unchanged. |
| Presentation helpers | `lib/hoteles/tarifasVista.ts` | `textoCuentaPromo` handles «sin tarifa» and the infant (keeps its base rate); grouping key now includes the date segment. |
| «Tarifas generadas» | `PromocionesDinamicasBox.tsx`, `page.tsx` | Same grouped cards as the weekday-rule promotions, one block per `base · date segment · day group`; badges «Por noche, sobre la base ganadora», «Un niño gratis por habitación (al cotizar)», «Calculadas · solo lectura»; honest note that these are **hotel accommodation tariffs per person and night, not a room-composition quote**. Adults-only hotels omit child/infant lines. |
| Calculator preview | `CalculadoraEditor.tsx` | Mixta **and** Dubai show the same box («Tarifas resultantes de promociones por noche», `vistaPrevia`) computed from the numbers on screen. In Mixta the promotion's row is no longer a row of editable zeros: it is a read-only «Promo dinámica» row. |
| Discoverability | `CruceBasesMixta.tsx` (`SeccionCruceBases`) | Section **always visible** in Mixta and Dubai, anchored `#cruce-bases`: explains «one promotion over successive bases», shows the dated preview per promotion, or the 3 steps when none exists yet. |
| Dubai cross-base | `CalculadoraEditor.tsx` (`DubaiForm`) | Receives `vigencias`; lists promotions that cross several bases (regimen selector), same preview + explicit button (`guardarReglasPromocion`, one action, rule `{grupo_id:null, valor, dias:null}`) as Mixta. The legacy «base → promo» pairs still work unchanged and now warn when their promotion crosses several bases. `generarTarifasDubai` now runs once per change (was twice). |
| Tests | `pruebas/matrizPromoDerivada125.test.ts` (29), `pruebas/matrizPromoDerivada125.react.ts` (8) | See §3. |
| Example data | `supabase/scripts/localreview/semilla_dubai_dos_bases_125.sql` | **Not executed.** Additive/idempotent seed for hotels 912511 (to configure) and 912512 (already configured + package 912512). |

No migration, no server action change, no new stored rows, no constraint change.

### Rule decision that contradicts the brief (please read)

The brief said «Dubai supplements added after the discount, never discounted». The **current code and its test** (`generarTarifasDubai` header, `pruebas/promocionDubaiSuplementoDescuento.test.ts`) say the opposite and were set deliberately: the promotion % applies to the **complete regimen tariff (base + supplement)**. `docs/tecnico/calculadoras-hotel.md` §4 and `CLAUDE.md` still carry the older wording (the §4 text even says so itself). I preserved the code rule. The cross-base mode discounts the stored regimen row (which already includes the supplement), so it equals the legacy pair for adults and children; verified by test (FULL Doble 117.000 = (100.000 + 30.000) × 0.9). If the owner actually wants the old rule it is a separate, pricing-wide change.

One real difference remains and is documented in the UI: **infant**. The legacy Dubai pair also discounts the infant (FULL BASE A: 45.000), the shared follow-the-base engine does not (50.000, «el infante conserva su tarifa base», owner doc). Tested on both sides.

## 2. Owner navigation (exact)

Credentials per the review environment (`administracion@revision.test` or `superadmin@revision.test` through `/login`). Hotel ids are the review database ids.

| Hotel | What it demonstrates | Route |
| --- | --- | --- |
| **912501** «Hotel PRE BF 125» | Common/Mixta, **to configure**: BASE A 1–5 dic, BASE B 6–12 dic, promotion «PRE BF» 4–8 dic −10 % | `/dashboard/producto/hoteles/912501?tab=temporadas#cruce-bases` |
| **912503** «Hotel PRE BF 125 ACTIVO» | Mixta, already following the base: derived matrix in «Tarifas generadas» | `/dashboard/producto/hoteles/912503?tab=tarifas` (matrix) and `?tab=temporadas` (preview) |
| **912511** «Hotel Dubai 2 bases 125 (configurar)» — *new, needs the seed* | **Dubai**, to configure: one promotion over BASE A → BASE B | `/dashboard/producto/hoteles/912511?tab=temporadas#cruce-bases` |
| **912512** «Hotel Dubai 2 bases 125 ACTIVO» — *new, needs the seed* | Dubai, configured + package 912512 for search/quote | `/dashboard/producto/hoteles/912512?tab=tarifas` |
| **12401** «Hotel 124 · Dubai (calculadora)» | The #124 stale-calculator message example. It is a different scenario (a calculator saved from another tab) and **has no cross-base promotion**, so the cross-base section correctly shows its three-step guide only; it is not the prepared cross-base example. | `/dashboard/producto/hoteles/12401?tab=temporadas` |

Walk-through on **912511** (Dubai): `?tab=temporadas` → «Tarifa por fórmula (calculadora)» → scroll to **«Una promoción sobre varias bases sucesivas»** (`#cruce-bases`). It lists «PRE BF DUBAI» once with two dated segments for PAM: **BASE A 4–5 dic 100.000 → 90.000**, **BASE B 6–8 dic 150.000 → 135.000**; the régimen selector above it switches to FULL: **130.000 → 117.000** and **180.000 → 162.000** (supplement inside the complete tariff). Press «Calcular por noche sobre la base ganadora» and confirm (1 action, no row written). Then the preview box «Tarifas resultantes de promociones por noche» and, in `?tab=tarifas`, «Promociones dinámicas por grupo» show the matrix below. The existing «Promociones» block (pairs) is untouched; if a pair already uses a cross-base promotion it says so.

Expected matrix (−10 %, per person and night, hotel accommodation tariffs — **not** a free-child quote):

| Segment | Regimen | Sencilla | Doble | Triple | Múltiple | Niño 1 | Niño 2 | Infante |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4–5 dic BASE A | PAM | 108.000 | 90.000 | 85.500 | 81.000 | 45.000 | 36.000 | 20.000 |
| 4–5 dic BASE A | FULL | 135.000 | 117.000 | 112.500 | 108.000 | 72.000 | 63.000 | 50.000 |
| 6–8 dic BASE B | PAM | 162.000 | 135.000 | 128.250 | 121.500 | 67.500 | 54.000 | 30.000 |
| 6–8 dic BASE B | FULL | 189.000 | 162.000 | 155.250 | 148.500 | 94.500 | 81.000 | 60.000 |

Hotel 912501/912503 (Mixta, owner doc numbers, Triple/Múltiple per the seed): BASE A 108.000 / 90.000 / 85.500 / 81.000 / 45.000 / 36.000 / infante 20.000; BASE B 162.000 / 135.000 / 126.000 / 121.500 / 67.500 / 54.000 / infante 30.000.

## 3. Acceptance matrix (hand-calculated expectations; executor evidence only — Codex/lead evidence pending)

Legend: `U` = `pruebas/matrizPromoDerivada125.test.ts`, `R` = `pruebas/matrizPromoDerivada125.react.ts`. All 29 U and 8 R pass; related suites re-run green (574 unit across promotion/calculator/Dubai/matrix files, 60 React across the neighbours).

| # | Requirement | Representative input | Hand-calculated expected | Actual evidence | Status | Untested variants |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Mixta matrix, all 7 accommodations, both segments | BASE A 120/100/95/90/50/40/20k, BASE B 180/150/140/135/75/60/30k, −10 % | rows in §2 | U «números del dueño»; R «Tarifas generadas» modal lines | PASS | other categories |
| 2 | Dubai verified on its own: stored base rows | Dubai params §2 | PAM/FULL × A/B hand tables | U «filas guardadas que genera Dubai» | PASS | Dubai with per-base own supplements / own ages |
| 3 | Dubai matrix PAM and FULL, supplement inside complete tariff | same | table in §2 | U (4 table assertions) + engine cross-check of all 14 FULL values | PASS | USD hotel, 3+ regimens |
| 4 | Dubai UI: one promotion over two bases, dated preview, regimen switch | vigencias A, B, PRE BF | PAM 100→90 / 150→135; FULL 130→117 / 180→162 | R «Dubai (propio)» ×3 | PASS (jsdom) | browser interaction pending |
| 5 | One explicit action, no stored rows | button click | exactly 1 `guardarReglasPromocion` with rule `{null,10,null}`, 0 router refreshes | R | PASS (action mocked) | real action → DB persistence pending (§4) |
| 6 | Boundary: promotion edges | nights 3, 4, 8, 9 dic | 3 and 9 dic at base (100.000 / 150.000); 4 = 90.000, 8 = 135.000; none in matrix | U (shared engine as contrast) | PASS | |
| 7 | Boundary: base switch 5→6 dic | | two segments, never merged/averaged | U | PASS | |
| 8 | Day group | rule weekday 7 (Sunday) | only 6 dic; 6 dic 135.000, 7 dic 150.000 (engine) | U; line shows its days | PASS | multi-weekday groups across 3 bases; weekday groups on a base sold by day groups (see risks) |
| 9 | Closure of a base | blackout BASE B 7 dic | 7 dic not sold (engine null), B split 6 / 8, note shows 07/12/2026 | U | PASS | closure of a category/accommodation only |
| 10 | Closure of the promotion | blackout 5 dic | 5 dic sold at 100.000, segments A 4, B 6–8 | U | PASS | |
| 11 | Missing rate | BASE A without Niño 1 | null shown as «sin tarifa», never 0; other 6 still shown | U + text helper | PASS | |
| 12 | Free published child vs missing | Niño base 0 | stays 0 (not null) | U | PASS | |
| 13 | Infant exclusion | infant 20.000 | stays 20.000 in matrix and engine, flagged «conserva su tarifa base» | U + R | PASS | |
| 14 | Free-child promotion does not zero the generic child tariff | `nino_gratis` on | Niño 1 = 45.000, badge «al cotizar» | U + R text | PASS | room-composition quote: not this workstream |
| 15 | Regimen restriction | promotion restricted to PAM | only PAM block | U | PASS | |
| 16 | Tie of equal-priority bases | two bases, same nights | those nights not sold, note «empate» | U | PASS | |
| 17 | Promotion priority = base priority | priority 1 | no lines, «No se vende» | U | PASS | |
| 18 | Adults only | | 4 room accommodations only | U | PASS | |
| 19 | Bounded | 400 categories | ≤ 2000 lines + note | U | PASS | |
| 20 | Derived vs saved rows distinguishable | Mixta promotion row | no inputs / zeros; «Promo dinámica» + lock; box «Calculadas · solo lectura» | R | PASS (jsdom) | visual check pending |
| 21 | Role without cost visibility | `promos = null` | no amount rendered | R | PASS | |
| 22 | Discoverability | hotels with and without cross promotion, Mixta and Dubai | section `#cruce-bases` always present; 3 steps when empty | R | PASS | real navigation by link pending |
| 23 | Existing pairs preserved | Dubai pair on a cross-base promotion | pair preview still rendered, warning, no action | R | PASS | |
| 24 | Real chain: preview → publication → search → quotation (Dubai two-base) | hotel 912512 / package 912512 | see §4 | **NOT RUN** | OPEN | the whole chain |

Fixture limits (labelled, not product defects): one category, COP, no day groups on the bases, no closures in the seed (closures are covered only by the unit tests), dates 2026 in the seed and 2027 in the React fixtures.

## 4. Heavy verification the lead must run (disposable database copy, never the owner database)

1. `tsc` and the production build (cold build ≥ 3 GB free RAM).
2. Seed `supabase/scripts/localreview/semilla_dubai_dos_bases_125.sql` on a **disposable copy** (it only inserts ids 912511/912512 and refuses to run twice). It was **not executed or syntax-checked against Postgres**; run it first and read back the 8 base rows against the table in the file header.
3. Real actions, as `administracion`:
   - On 912511: `guardarReglasPromocion` with `sigueBase: true` (the page button) → read back `hotel_temporadas.promo_sigue_base = true` for «PRE BF DUBAI», one `hotel_promocion_reglas` row `(null, 10, null)`, and **no new `tarifa_hotel` row**.
   - `generarTarifasCalculadora` for the saved Dubai calculator → the 8 base rows must equal the seeded numbers (diff 0) and **no «PRE BF DUBAI» row** must appear; the pair mechanism must still be able to write its own row on a separate promotion.
   - On 912512: publish the tarifario of package 912512 with the real generator, then search and quote 4 → 7 dic (3 nights: 4, 5 on BASE A; 6 on BASE B), room Doble, 2 adults. Hand expectation per person (markup 20 %, COP rounded up to the next 1.000): PAM 90.000 + 90.000 + 135.000 = 315.000 / 0.8 = 393.750 → **394.000**; FULL 117.000 + 117.000 + 162.000 = 396.000 / 0.8 = **495.000**. Room = ×2 (788.000 / 990.000). Confirm the saved quotation/contract rows and the document show the same numbers. Also a Sencilla, a Niño 1 (PAM: 45.000 + 45.000 + 67.500 = 157.500 / 0.8 = 196.875 → 197.000) and the infant (PAM, base rate, never promoted: BASE A 20.000 + 20.000, BASE B 30.000 = 70.000 / 0.8 = 87.500 → **88.000**; FULL: 50.000 + 50.000 + 60.000 = 160.000 / 0.8 = **200.000**; the earlier 75.000 wrongly used 20.000 × 3).
   - Negative checks: night 3 dic and 9 dic quote at the base rate; a stay crossing a blackout is rejected.
4. Mixta twin on 912501 (configure) and 912503 (already active) to keep parity checked against the same engine.
5. Browser (final production build, real login): 912511/912512/912501/912503 at desktop, ~768–900 px (the «Valores por categoría» table has `min-w-[860px]` and the matrix cards use `sm:grid-cols-2`) and 390 px. Read the screenshots: the section `#cruce-bases` title/steps, the read-only «Promo dinámica» row, matrix cards and modal (7 lines, long labels such as category names), the wording «Tarifas de alojamiento… no una cotización». Check the `#cruce-bases` anchor scrolls on load.
6. Consumption (`VALIDACION_CONSUMO_VERCEL.md`): see §5; measure on the compiled app the server render time of `/dashboard/producto/hoteles/<id>` with the matrix (hotels 912503/912512) vs. a hotel without one, and the request count while opening, switching régimen and idling 60 s.

## 5. Requests, computation and idle behaviour (analysis; local measurement pending)

- **No new request anywhere.** The matrix is derived from data the pages already load (`hotel_temporadas` + nested rules, `tarifa_hotel`, calculator state). No fetch, effect, timer, poll or retry was added. The only server calls remain the existing explicit ones (`guardarReglasPromocion` on the button, saves/generation). React tests assert 0 action calls on mount, on régimen switch and on showing the matrix, and 0 `router.refresh()` after the action.
- **Server render («Tarifas generadas»):** `promocionesSigueBase` runs only when the hotel has at least one follow-the-base promotion and only for roles that see costs (as before). Work per promotion: `planPromoPorNoche` once per regimen (≤ 60 segments, each range capped at 1.500 nights, bases scanned per night) + at most `MAX_LINEAS_MATRIZ = 2000` line objects. Output is shipped to the client as part of the already-sent `promosDinamicas` prop; the modal detail is rendered only on opening (as before).
- **Calculator:** the matrix is memoised and guarded (`vigencias.some(promo_sigue_base)`), so hotels without such a promotion pay nothing. It recomputes on parameter edits (typing a price), bounded as above. Dubai now generates the rows **once** per parameter change and shares them between base preview, pair preview, the cross-base section and the matrix (previously the generator ran twice per change). `resolverBasePromo` per candidate promotion recomputes only when the vigencias or the preview régimen change.
- **Idle:** nothing runs at rest. **Not measured in a browser or on hosted infrastructure; no hosted savings or costs are claimed.**

## 6. Risks / limits

1. Bases sold by weekday groups (`hotel_temporada_grupos`, currently forced inactive by migration 293) are not expanded: the matrix lists a note instead of inventing a per-group number.
2. The matrix lines use the stored/generated per-person rows exactly as the engine does; per-room discounts (`habitacion_noche`) do not apply to follow-base promotions (percent only).
3. In Mixta preview the matrix shows only the régimen selected in the calculator (Mixta values are per régimen); «Tarifas generadas» shows all stored regimens.
4. The Dubai pair vs. cross-base infant difference (§1) is intentional and documented, not reconciled.
5. `docs/tecnico/calculadoras-hotel.md` §4 and `CLAUDE.md` still contain the older Dubai promotion wording; not edited by this workstream (outside scope, avoids colliding with the other forks' doc edits).
6. The seed is unexecuted; the whole real-action chain (row 24) is open.


## 7. Corrections by the compiled-build verification (VERIF-2, 2026-11-18)

- **Infant for 4→7 dic, PAM (§4 / the executor's "75.000" guess):** the engine returns **$88.000** (and FULL **$200.000**). By hand: the infant keeps its base rate per night (A 20.000, 20.000; B 30.000) = 70.000 ÷ 0,8 = 87.500 → 88.000; FULL 50.000 + 50.000 + 60.000 = 160.000 ÷ 0,8 = 200.000. 75.000 was an estimate and is wrong.
- **Hotel 12401** does list a cross-base promotion «Promo» (ALTA 1 ene–31 mar 2030, then BAJA 1 abr–30 jun 2030 **with no tariff**), so it shows the dated preview for ALTA and an honest «La base no tiene tarifa — esa noche no se vende» for BAJA, plus the button; it does not show only the three-step guide. It is still not the prepared example (912511/912512 are).
- Two defects found and fixed in the verification: the `#cruce-bases` direct link did not exist on load (the editor starts closed) and the calculator-type `<select>` overflowed a 390 px screen. Details and evidence: `owner-corrections-verif-search-promo-2026-11-18.md`.
