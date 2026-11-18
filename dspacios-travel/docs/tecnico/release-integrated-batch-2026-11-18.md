# Consolidated release handoff — 2026-11-18

Current source: claude/int-review-batch, base 51ea60612152a266d0bade6bb8c2d471353f9449. Final production build FreOT3YH2M3PLd17-pfnV matches 969 source/config files. No application code changed for this release documentation update; no repeat build is required solely for it.

## Release scope and gates

- Includes #1 CRM quotation people, #53 confirmation/expiry/ally vouchers and USD document display, #102 booking/table/ages/additional-night behavior, #105 images, #106 unified contract management, #124 calculator conflict handling and #125 multi-base promotions/free child/full tariff previews, including owner corrections.
- Codex technical re-audit passed. Owner reviewed the consolidated flow, accepted document rows, additional night, child promotion behavior and #106 management, and explicitly moved the further payment/display requests into task #126. Ally voucher access had already been accepted. #126 improvements, supplier email #103 and development/hosting evaluation #104 are not implemented here.
- Owner executed Production migrations **307 → 308 → 309 → 310 → 311**, each preflight/apply/postcheck completed on 2026-11-18. See remote-migrations-307-311-2026-11-18.md. Do not rerun them or edit applied SQL.
- Commission cycle #97 remains OFF and consecutive reuse remains ON according to the owner checks. Migration 310 did not activate follow-base/free-child modes on existing promotions.
- Application staging/commit/push, PR, one final Preview and production merge are still owner actions. Hosted acceptance is not inferred from local checks. Earlier executor documents saying not audited/not accepted/SQL unapplied are dated history superseded by this handoff and the audit.

## Evidence and remaining limits

- Executor final full suites: unit 10158 tests, 30 failures; React 2010 tests, 26 failures, same failing names as clean baseline. These are baseline failures, not green suites. tsc and production build passed on the final source.
- Latest independent Codex correction checks: 77 focused unit, 20 rendered and 17 unique real-action cases passed, including real NETO Reservar quotation/conversion and its one-row rendered document. All eight pages of C-0005/DTM-0004 PDFs inspected. Earlier integrated SQL, pricing, permission and browser checks are recorded in the handoff/audit; independent versus executor evidence remains distinguished.
- Local request evidence: Booking/table person+unit search 2 server actions per click, no actions or REST traffic at 30 seconds idle (executor); the reviewed presentation helpers introduce no network I/O, polling or retries. Hosted Vercel/Supabase CPU, memory, transfer and deployment metrics remain for owner Preview observation; no unmeasured savings claimed.
- Historical multi-child benefits without sealed individual attribution show a group payable amount; no invented per-child price. Distinct adult rows without a room-child link are not arbitrarily merged.
- Two real catalog hotels need authoritative age configuration in Producto: 254 DECAMERON MARYLAND and 239 OCEAN CORAL SPRING. Existing ages were not bulk-rewritten. Do not invent their ranges.
- Review data/backups and other worktrees are preserved. Local logs, compiled output, credentials and generated image-measurement JSON artifacts are excluded from staging. Test harnesses use synthetic local data.

## Final owner Preview checklist

Use the actual catalog to configure one promotion spanning successive base seasons and inspect the full dated matrix, publication, search and a quotation. Verify the chosen category/regimen, infant base-rate behavior and free-child eligibility where configured. Confirm document row structure and currency display, table unit results and management layout/states. Observe Network/Observability during actions and idle. The shared Production database is real: test writes and cleanup require the owner's deliberate choice; do not create real contracts automatically.
