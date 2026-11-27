# REV2 · Anonymous public checkout / comparative with children (D0/D1) — 2026-11-26

Status: implemented and proven on a disposable clone; NOT accepted by Codex or the owner. No migration. Owner database and the app on 3090 untouched.

## 1. Defect (reproduced before the fix)
Anonymous visitor, public checkout (`crearSolicitudReserva`) or comparative (`crearComparativaCarrito`), double room with 1 child aged 8, hotel configured for 2 children per double:

`No se pudo cotizar Hotel Alfa 95T: La habitación seleccionada admite máximo 0 niño(s); hay 1.`

Cause: `computarReserva` (`lib/reservar/computo.ts`) read `hotel_acomodaciones` with the caller's own session; the read policy of migration 027 is `auth.uid() is not null`, so an anonymous visitor got zero rows and the engine fell back to the defaults (`pax_max = pax_tarifa` → 0 children). Staff, agency and freelance sessions were unaffected. Not introduced by this batch (pre-existing since 027).

## 2. Fix (smallest, access controls unchanged)
Two reads in `computarReserva` (by-dates route and published-row route) now use the service-role client, selecting only `acomodacion, pax_tarifa, pax_max, adt_*, chd_*, inf_*`. This is the same pattern the module already uses for the same table in `lib/reservar/solicitudHotelServidor.ts`, `lib/tarifario/datos.ts` and `app/tarifario/checkout/actions.ts`. The second read keeps the existing `SUPABASE_SERVICE_ROLE_KEY ? admin : session` guard.

Why not a public SELECT policy (migration): it would expose the table through the REST API to anyone with the anon key and needs a production migration for a read the server already does; the server-side read exposes nothing new (capacity columns only; no prices, costs or suppliers leave the engine, and the returned quotation carries none).

Request cache key renamed `sb:hotel_acomodaciones:*` → `admin:hotel_acomodaciones:*` (nothing else used it).

## 3. Proof (real actions, disposable DB `r2a_*` cloned from `rev2_plantilla_347`; never `rev_consolidada`)
Runner: `R2_ARCHIVOS=pruebas/f95tarifario.rev2.pg.ts sh supabase/scripts/test_rev2_95docs.sh r2a_<name> pgrevc rev2_plantilla_347` (through `heavy.mjs`).

| Test | What it proves |
|---|---|
| D0 | anonymous + 1 child: request created, price **900.000** = 2 × 375.000 + 150.000 (hand oracle); 3 persons; no supplier name or net/cost amounts in the stored quotation |
| D0b | same request with internal (superadmin, administración), agencia and freelance sessions still succeeds; internal price equals the visitor's |
| D0c | rejections (visitor and staff alike): 3 children in a double → «máximo 2 niño(s)» (no longer «máximo 0»); 2 children accepted; Adults-Only hotel rejects the child; adults-only control price 750.000 unchanged |
| D0d | anonymous REST: cannot read `hotel_acomodaciones`, `tarifa_hotel`, `proveedores`; cannot insert/update `hotel_acomodaciones`; stored capacity unchanged |
| J2c | anonymous comparative WITH a child, options A and B: totals 1.020.000 / 1.080.000, chosen option converted by staff, child's real tariff kept (150.000 / 0), paid to zero balance |
| existing J1, J1b, J2, J3, J4 | unchanged, still pass |

Result: **11 pass · 0 fail · 0 todo** (before: 10 tests, D0 was `todo`).
Mutation control (fix reverted, tests unchanged): D0, D0c and J2c fail with «admite máximo 0 niño(s); hay 1»; D0b and D0d stay green (they do not depend on the fix). Fix restored and re-verified.

Rehearsal step added: **B95-16c** (`pasos/55_bloque95_tarifario.mjs`), anonymous comparative with 2 adults + 1 child, expects A 1.020.000 / B 1.080.000 and no «máximo 0 niño(s)». Not yet executed against the compiled app.

## 4. Not covered / residual risks
- The bloqueo (flight-block) path reads the same table in the second changed read; it is not exercised by this suite (only porción terrestre). The change there is the same expression.
- Production uses the real service-role key; the fallback to the session client when the key is missing keeps the old (anonymous-defaults) behavior and the dev/CI condition is unchanged.
- Does not change who can read the table through the REST API: still authenticated-only (verified by D0d).
