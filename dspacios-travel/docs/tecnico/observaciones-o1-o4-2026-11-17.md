# O1–O4 — owner decisions on the four functional observations (2026-11-17)

Integrated worktree `.worktrees/int-review` (branch `claude/int-review-batch`, base `origin/main` 51ea60612). Nothing staged, committed, pushed, deployed or run remotely. #125 is untouched and keeps its own release path (and migration 310).

## 1. Decisions and what was built

### O1 — Public Receptivo photos
**Decision:** every person who can view the catalog (visitor, ally, internal user) sees the published Receptivo photos; unrelated internal service data stays protected.
**Cause:** the photo map was read with the visitor's own session from `servicios_adicionales`, which only internal roles can read (it also holds net costs), so visitors, allies and `venta` received no photo URL.
**Implementation (smallest):** `lib/tarifario/fotosServicio.ts › leerFotosServicios` selects **only `id, foto_url`** for the service ids that are already in the person's visible tariff rows, using the server's service client (`lib/tarifario/datos.ts` and `lib/tarifario/resumen.ts`; falls back to the session client when no service key exists). No RLS policy was added or widened and no other column is exposed.
**Missing/broken photo:** the existing `ImagenCatalogo` fallback («Sin foto», no retry) is unchanged and was exercised.

### O2 — Upload size
**Decision:** reduce supported images before enforcing the final limit; keep the Storage limit, the format validation and bounded browser resources; clear error for unsupported/unreducible oversized files.
**Implementation:** `lib/imagenes/reducirImagen.ts › prepararSubidaImagen(file, {maxMb, reducir, errorTipo})`: (1) not an image → the uploader's existing type message; (2) original above `TOPE_ORIGINAL_BYTES` (40 MB) → error **without decoding** (bounded CPU/memory); (3) reduce (when the uploader reduces and the format allows); (4) **then** compare the final size with the limit (Receptivo 8 MB, Programa cover 10 MB, unchanged). Non-reducible oversized files (GIF/SVG/HEIC, decode error, no gain) get «La imagen pesa X MB y supera el máximo de N MB; este formato (…) no se puede reducir automáticamente. Exporta una versión JPG o WebP más liviana.»; reducible-but-still-too-big files say so. Flyer/historia pieces are not reduced and keep the limit on the original. Wired in `ServicioFotoCell.tsx` and `ProgramaImagenes.tsx`.

### O3 — Mandatory hotel age configuration
**Decision:** no invented/default infant or child ages; every hotel that accepts minors needs explicit valid ages; Adults Only is exempt and rejects minors; clear warning; block quotations with minors when the configuration is missing (actionable reason, never silent omission); adults-only searches continue; complete configuration required to save/publish a non-Adults-Only hotel; historical contracts/quotations preserved; tariff-specific overrides respected but never used to invent the hotel configuration; no backfill; check all pricing entry points.
**Core:** `lib/calc/reglaEdadTarifa.ts`
- `validarEdadesGeneralesHotel(general, nombre?)` — `edad_infante_max` and `edad_nino_max` integers, `0 ≤ infante < niño ≤ 17` (minimums are derived: infante 0, niño infante+1; the stored `_min` columns are ignored). Returns the derived rule or the missing/invalid fields and an actionable message (`mensajeEdadesHotel`; `mensajeEdadesAlGuardar` for forms).
- `normalizarReglaEdadGeneral` (which invented 2/10) was **removed**. `resolverReglaEdadEstadia` / `resolverReglaEdadEstadiaSegura` validate the hotel configuration **first** and fail with `codigo: "edades_hotel_incompletas"` even when the tariff rows carry an override (overrides still win when the hotel is configured). `REGLA_SIN_MENORES` is the marker for queries without minors (never applied: classifying zero minors reads no threshold). `REGLA_EDAD_DEFAULT` survives only as the visible starting value of the optional «edades propias» override editor.
**Entry points (all changed or checked):**
| Entry point | Behaviour now |
| --- | --- |
| Booking search / Vista tabla / extra night (`composicionHotelBusqueda.ts` → `cotizar.ts › buscarHoteles`) | with minors: hotel returned in `enRevision` with `codigo` + `motivo` (hotel name, missing fields, where to fix, «solo con adultos» continues); the same text becomes the diagnosis when every hotel is blocked; without minors the rule is not consulted |
| Date suggestions (`liquidacionHotel.ts › compatibleConComposicion`) | no suggestion with minors for an unconfigured hotel; unaffected without minors |
| Reservation / quotation (`computo.ts`, published route and by-dates route; minors by age or by count; hotel-request occupancy `solicitudHotelServidor.ts`) | rejected with the actionable message; solo adultos reserves |
| Dynamic packages (`paqueteDinamico/menores.ts`, `PaqueteTotalForm.tsx`) | a catalog hotel without valid ages → `edadesIncompletas` message; manual hotels must **enter** their ages (the 2/10 prefill was removed) |
| Unit hotels (`tarifaAlojamientoEditor.ts` / `tarifasUnidadActions.ts`) | same validator and message |
| Client editors (`VistaBooking.tsx` booking editor, `ReservaForm.tsx`, `reservar/nuevo/page.tsx`) | no `?? 2/10`; the editor shows the message, the form warns and the server rejects |
| Hotel save/publish | `crearHotel`, `actualizarHotelConfig`, `cargarHotelesMasivo` (CSV: new optional `adults_only` column) and **`generarTarifario`** refuse a non-Adults-Only hotel without valid ages, naming hotel and field; `NuevoHotelForm` starts empty with an Adults Only switch; `HotelConfigEditor` shows an always-visible warning with the missing/invalid fields |
**Migration 311** (`20260601000311_hoteles_edades_sin_default.sql`): drops the four column defaults (0/2/2/10) so a hotel inserted without ages stays «not configured». No row is modified (no backfill). Owner stages (each one SELECT): `supabase/scripts/preflight_311_hoteles_edades.sql` → migration → `postcheck_311_hoteles_edades.sql`; rollback script provided. The application never relies on the defaults (the forms and the CSV send explicit values or nulls), so 311 and the code have no ordering dependency; running 311 first is recommended. `types/database.ts`: the four columns are now `number | null` (matching the real schema).

### O4 — Additional night is a reference
**Decision:** label it as referential, explain the full recalculation, offer a simple way to extend the return date and rerun the complete search with the same travelers and filters, never confirm by adding the reference to an old total (server recalculates), cover season boundary / duration threshold / unavailable night, avoid duplicate requests.
**Implementation:** `TablaResultadosBusqueda.tsx` — «Valor referencial» badge, amber explanation, and the button «Extender el regreso a dd/mm/aa y recalcular la estadía completa» (`CalendarPlus` icon, disabled while a search runs). `TarifarioPublic.tsx › PorcionTerrestreTabla` reuses the existing one-search-per-click mechanism (`sugerenciaPedida` with a nonce) so the search keeps destination, rooms, travelers, ages and filters. The browse-mode note was reworded. **Server:** unchanged by design — `buscarHoteles`, `cotizarPorFechas` and `computarReserva` already liquidate the exact requested dates; the reference (`total(N+1) − total(N)`) is display-only and is not an input of any reservation path (proved by test, §2).

## 2. Evidence (integrated source)

| Check | Result |
| --- | --- |
| Real database + real actions, migrations 303, 304, 307–309, 311 on a disposable DB (`sh supabase/scripts/test_pg_local.sh pg304 g106_base PG102 pruebas/edadesNocheReferencia.pg.ts <migrations>`) | **18/18**: adults-only continues; minors blocked with reasons; override does not invent ages; `computarReserva` by ages and by counts; `crearHotel`/`actualizarHotelConfig`/CSV/`generarTarifario`; 311 default removed; O4 season boundary, **duration threshold** (reference 0, 4 nights = 3), unavailable night, **server recalculates after the promotion changes** (4 nights = 1.000.000 ≠ old 750.000 + reference 0), extension = same requests as a normal search |
| Unit: `reglaEdadTarifa` (rewritten: it asserted the invented default), `fotosServicio` 4/4, `prepararSubidaImagen` 7/7, uploader wiring, related files | pass; the full unit and React suites show only the clean baseline's failing names (details in `pending-owner-local-review.md` §10) |
| Production build | `ma7YBYcCzRt2ajHVLQJ2Q`, exit 0, 962 files fingerprinted; peak 3,099 MB, minimum free 2,013 MB |
| Compiled app, Edge, desktop + 390 px (browser journeys in `supabase/scripts/localreview/`) | O3+O4 **76/76** · #105+O1+O2 **28/28** · #53 60/60 · #102 22/22 · #106 35/35 · #124 35/35 · #1 20/20 |
| Resources | images: 12 photo requests on load for every role, 0 at rest, ≤ 1 request for a broken photo; extension: one browser request per click and the same PostgREST calls as a normal search; O2: one decode per upload, only for originals ≤ 40 MB; no polling or retry added; hosted metrics not measured |

## 3. Coordination, limits and what was not done

- **#125** (`.worktrees/promo-multibase`) edits `computo.ts`, `cotizar.ts`, `liquidacionHotel.ts`, `hoteles/actions.ts`, `CalculadoraEditor.tsx`, `checkout/actions.ts`, `types/database.ts` in other regions. This round touched `computo.ts` (two age blocks), `cotizar.ts` (type + one block + one import), `liquidacionHotel.ts` (one block + import), `hoteles/actions.ts` (create/update/CSV) and `types/database.ts` (four nullability changes). No file was copied across worktrees; conflicts, if any, are resolved by each task's own integration.
- No existing hotel was changed or backfilled; stored ages count as configured. The preflight reports how many hotels hold exactly the old default values so the owner can decide with Producto — nothing is inferred.
- The calculators' optional «edades propias» override editor still starts from a visible 2/10 suggestion that a person must choose to enable; it never resolves a quotation.
- Not measured: hosted Vercel/Supabase metrics, real phones, production data.

## 4. U1 — unit-hotel bypass of the mandatory hotel ages (Codex re-audit, 2026-11-17) — corrected

**Finding (confirmed by Codex and reproduced here):** `tarifasUnidadActions.ts › resolverReglasEdadTarifa` returned success *before reading the hotel* whenever the tariff carried explicit age rules, and the pure `aplicarFallbackReglasEdad` had the same unconditional early return. A non-Adults-Only hotel with all four age columns NULL therefore accepted creation **and publication** of a unit tariff; and nothing at the pricing boundary re-checked the hotel, so already-published unit tariffs kept quoting minors.

**Rule applied (unchanged from O3):** an explicit tariff rule may define the *effective classification of that tariff*; it never replaces the hotel's mandatory configuration. Adults Only is exempt from age ranges and rejects minors. Solo-adult queries never consult the ages.

| Boundary | Change |
| --- | --- |
| `aplicarFallbackReglasEdad` (pure, `lib/calc/tarifaAlojamientoEditor.ts`) | validates the hotel configuration **first** (via `reglasEdadDesdeConfiguracionHotel` → `validarEdadesGeneralesHotel`), then keeps explicit rules untouched. `EdadesGeneralesHotel` gained an optional `nombre` so the reason names the hotel. |
| Unit tariff **create / update / duplicate / publish** (`tarifasUnidadActions.ts › resolverReglasEdadTarifa`) | the early return is gone; the hotel row (`nombre, edad_infante_max, edad_nino_max, adults_only`) is read once per operation (never per room) and validated. Publishing a draft whose hotel lost its ages is refused; the draft and every already-published tariff payload are left untouched. |
| Pricing/quote/reserve of **already-published** unit tariffs (`lib/reservar/computoReservaBernalo.ts`) — shared by the unit search, public quote and checkout, and the advisor reservation | with minors in any room: Adults Only → `hotel_solo_adultos`; missing/invalid ages → `edades_hotel_incompletas` with the actionable message. The hotel's age/Adults-Only columns ride on the existing `armado_hoteles(hoteles(...))` read — **0 additional requests** (asserted). Public messages for both codes were added to the fixed public map (no internal detail leaks). |
| Unit search (`lib/tarifario/evaluarDisponibilidadUnidad.ts`, `app/tarifario/busquedaUnidadActions.ts`, `BuscadorBooking.tsx`) | uses the hotel row the batch read already loads (no new query): with minors and invalid ages the hotel becomes verdict `bloqueado_edades`, returned as `enRevision` (`codigo: "edades_hotel_incompletas"`, hotel name, missing fields, where to fix, "solo adultos continúa") and merged into the same amber block the person-priced hotels already use — never omitted silently, and it does **not** mark the search incomplete. Solo adultos still lists the hotel. |
| Unchanged by design | unit pricing, capacity, commission and the deferred unit promotions; historical contracts, quotations and stored tariff payloads; no hotel row is modified. |

**Evidence.**
- Real database + real actions (`pruebas/edadesHotelUnidadU1.pg.ts`, 12/12): create rejected for a hotel with NULL ages and for invalid ages (message names hotel and fields, no draft row); valid hotel + a legitimate override creates and publishes with the override kept verbatim; Adults Only creates/publishes; a hotel whose tariff was published while configured and then lost its ages: publishing another draft, updating it and duplicating the published tariff are refused while the published payload is byte-identical; `computarReservaBernalo` with minors → `edades_hotel_incompletas` (NULL and invalid), configured hotel quotes, Adults Only → `hotel_solo_adultos`, solo adultos quotes and prices equal across the unconfigured hotels; a rejected quote issues exactly 2 requests and none to `/hoteles`; the unit search lists the unconfigured hotels in `enRevision` with minors and as available without minors. **Mutation check:** restoring the old early returns makes the creation/publication cases fail (5 of 12), proving the regression test reproduces U1.
- Pure and wiring tests: `aplicarFallbackReglasEdad` (override + no ages → refused, override + Adults Only → accepted), evaluator verdicts (`bloqueado_edades`, solo adultos unaffected), and the source-reading assertions that encoded the old early return and the old result shape were updated (the old assertion «does not read the hotel when the tariff has explicit rules» now asserts the opposite).
- The first 18 O3/O4 database cases are unchanged (see §2). Test launcher: the stale header reference to `supabase/scripts/test_o3o4_edades_noche.sh` was replaced by the generic `test_pg_local.sh` command (prefix `PG102`; exact command in the header of each `.pg.ts`).

### U1 — verification summary (final code)

| Check | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | clean |
| Real database, real actions | `edadesHotelUnidadU1.pg.ts` **12/12** · `edadesNocheReferencia.pg.ts` **18/18** (unchanged) — migrations 303, 304, 307, 308, 309, 311 on a disposable copy of `g106_base` |
| Full unit suite | 9,963 tests, 31 failures = exactly the clean baseline's failing names (one source-reading assertion of `computoReservaBernalo.ts` — the hotel select now carries `adults_only` and the two age columns — was updated and re-verified 29/29) |
| Full React suite | 1,885 tests, 26 failures = the clean baseline's names (three test files mocked the old unit-search result shape; they now include `enRevision: []`) |
| Production build | `86q0YvzUiAE86_Sz8qKQf`, exit 0, 962 files fingerprinted, peak 2,241 MB (the launcher's memory guard refused the first attempts while other sessions held RAM; it was never bypassed) |
| Compiled app, Edge, desktop + 390 px | new `humo_revision_u1.mjs` **20/20** (solo adultos: both unit hotels listed and no warning; with a minor of 5: «U1 · Hotel por unidad SIN edades» appears only in the amber block with its missing fields and where to fix it, the configured hotel stays available at 750.000; no horizontal overflow) · O3+O4 76/76 · #105+O1+O2 28/28 · #53 60/60 · #102 22/22 · #106 35/35 · #1 20/20 · #124 passed |
| Review data | restored to the snapshot: 73 contracts, 2 quotations (C-0002 USD still open and unconverted, valid until 2027-01-16), 5 acknowledgments, plus the synthetic `CARTAGENA O3` and `CARTAGENA U1` data. The snapshot was rebuilt (`localreview.ps1 foto`) **before** any journey ran, to add the U1 seed. |

Limits: the unit-hotel tariff actions were exercised through the real actions with a service-role catalog client (to skip the agency-context RLS that other suites cover), so catalog session authorization is not re-proved here; a full unit quote-to-contract (checkout) journey was not run in the browser — the shared pricing boundary `computarReservaBernalo` is covered by the real-database cases, and checkout/advisor flows call it unchanged. The mapped public message for the two new codes is covered by wiring only.
