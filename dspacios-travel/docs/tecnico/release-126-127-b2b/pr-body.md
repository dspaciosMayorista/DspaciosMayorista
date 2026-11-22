## Summary

One integrated release of the work reviewed locally by the owner on 2026-11-20/21, on top of `main` at `312608a59` (PR #449). Production database state assumed: migrations 001–311 applied (307–311 on 2026-11-18). **This PR needs migrations 312–319 and 322–326 applied to Production BEFORE the Preview is validated and before merge** (see "Database order").

### Included
- **#126 — follow-ups deferred from #449**: 126-A payment-specific TRM and the currency in which each payment was received (`abonos.moneda_pago`, written atomically with the payment); 126-B child charges in the unit (per-unit) search/quotation; 126-C infant-only base groups; 126-D promotion badges; 126-E «viaje más reciente» order in contract management (departures from today in America/Bogota).
- **#127 — general hotel closure**: a general closure (`hotel_blackouts`) immediately hides already-published tariff rows it closes; unit/request paths respect it.
- **B2B portal block**: #25 ally edits own data + staff-visible change history (no migration); #32 ally logo as primary quotation brand (issuer unchanged); #35 ally identity mandatory for new manual B2B comparatives; #48 NETO manual quotation; #62 sign-up verified by emailed code + password recovery (server-side consumed-recovery record and DB-side registration locks); #76/#77 ally client book; #78 «Solicitar contrato» with internal notice; #84 live contract value after conversion; #98 signature image + electronic acceptance of a frozen cuenta de cobro.
- **Owner-feedback rounds O-1…O-4 and the four accepted corrections**: ally proof (evidence) before confirmation (never a payment); optional additional passengers entered by the ally and carried into every conversion path; advisor selector and document-rule alignment; unit-quotation modal; **direct vs assisted quotation origin by creation**; compact passenger presentation; «Agregar pasajero» only while declared travelers are missing (with the 30-passenger capture limit disclosed and enforced consistently in UI, action and database); regular tariff shown against the child it belongs to.

### Not included / deferred (explicit)
- **New sign-up with emailed code and recovery from a pending registration are NOT validated locally by decision of the owner**; they are production checks after merge (hosted Supabase Auth settings required). Existing-account password recovery was accepted locally.
- #97 commission cycle stays OFF; consecutive-number reuse stays as configured. #101/#103/#104 untouched.

## Database order (owner executes, one stage at a time, each = preflight → migration → postcheck, each preflight/postcheck is one integral read-only query)
312 → 313 → 314 → 315 → 316 → 317 → 318 → 319 → 322 → 323 → 324 → 325 → 326. Dependencies: 313 needs 312; 325 needs 323; 326 needs 325. The stages are additive or guarded `create or replace`, and the new code needs every one of them. Compatibility of the previous build (`312608a59`) with the complete chain was exercised locally (see Evidence); two behaviors change at the database stage even for the old code: the 314 refusal of a case the old code already blocks, and the 315 hiding of published rows when a general closure is written. Whether Vercel serves `312608a59` and the hosted Auth settings are owner checks. Numbers 320/321 were never used. Detail, per-stage effects and rollbacks: `docs/tecnico/release-handoff-126-127-b2b-2026-11-21.md`.

## Evidence (local; hosted not measured)
- Final local production build `yst02koH-RpbWrYjRyQ1A`; `tsc --noEmit` clean.
- Final-source suites: `test:unit` 10 579 tests with 29 failures and `test:react` 2 148 tests with 26 failures — **the same failing test names as the retained baseline lists** (pre-existing failures, not green suites; lists in `docs/tecnico/evidence-326/`); calendar 43/43, `test:react:o1o4` 45/45, `test:react:resto` 55/55.
- Real-flow journeys on disposable copies of the review database, real roles, compiled app: full pass 235/0 on the previous final build; sections P–S, Z and ZR re-run on the final build (131 + 21 OK, 0 failures). SQL tests for 312–326 (A–G for 326), rollbacks and mutation checks recorded in the evidence documents.
- Request/idle behavior: no timers, effects or polling added; resting 31 s = 1 server action (the existing 30 s notification poll) and 0 browser REST reads. Vercel/Supabase hosted metrics are **not** measured.
- **Old-source smoke (REL-2):** the real modules of `312608a59` (real actions → PostgREST → PostgreSQL) on a disposable database with the complete chain 001–326: payment registration/confirmation/reversal and replay, quotation creation and conversion, ally-portal reads (21/24, the same three known failures as on the old schema) and the intentional 315 hiding (control on the old schema fails as expected). Not proved: the commit Vercel serves, hosted Auth settings, Production data volume. `docs/tecnico/release-126-127-b2b/rel2-old-source-smoke.md`.
- Owner accepted the four corrections and existing-account recovery on the local review environment.

## Required hosted checks (owner)
Vercel Preview Ready for the head commit; Supabase Auth settings for code sign-up/recovery (Confirm email ON, «Confirm signup» template containing `{{ .Token }}`, OTP expiry/length, SMTP and rate limits, redirect allow-list including the origin used for recovery links); private buckets `aliado-firmas`, `aliado-logos`, `evidencias-cotizacion`; Network/Observability during actions and idle. After merge: carry actual outstanding production checks to `VALIDACIONES_PRODUCCION.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
