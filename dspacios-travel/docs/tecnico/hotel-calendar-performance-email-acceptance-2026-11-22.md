# Hotel calendar, save/delete latency and supplier emails — acceptance matrix (executor)

Date: 2026-11-22 · Branch `claude/hotel-calendario-rendimiento-103` · Base `origin/main` cd9bb1946 (already contains #450). Executor: Opus. Audit: Codex. All deliverables in English; product UI stays Spanish.

## 0. Reconciliation (facts, not assumptions)

| Item | Finding |
| --- | --- |
| Release base | `origin/main` = cd9bb1946 "Integrate #126/#127 follow-ups and the B2B portal block (migrations 312–326) (#450)". The brief says merge/Production Ready were not yet reported; the merge commit is already on `origin/main`, so this worktree is based on it. Production Ready is still an owner check. The dirty main checkout (stale, f4489c721) is not used. |
| Migration numbers | Highest on any local/remote branch: **326**. This block reserves **327** (reusable date sets) and **328** (supplier request/email tracking) — to be re-checked right before delivery. No applied migration is edited. |
| Existing data model for D | `hotel_temporadas.rangos` (validity ranges) and `hotel_temporadas.blackouts` (exclusions inside a validity) already exist since migration 053; `validarTemporada` already requires every exclusion to sit inside a coverage range. The gap is **UI** (visual selection) and **reusable named sets by year**. |
| General closure | `hotel_blackouts` (hotel-wide, takes precedence over every validity). Untouched semantics. |
| Latency root cause (code trace) | `crearBlackout`/`eliminarBlackout` and every season action `await` `regenerarTarifariosDeHotel*`, which regenerates every active package using the hotel (2 at a time, each with its own generation budget) **before** the server action returns; the client then calls `router.refresh()`. The row list is a server prop, so the deleted row only disappears after the whole chain. Measured below (§5). |
| Email integrations | Only Resend exists (`lib/email/resend.ts`, `lib/notificaciones.ts`, CRM email config). No inbound mail, no webhook, no IMAP. No Hostinger code. |

## 1. Acceptance matrix

| # | Requirement | Acceptance evidence |
| --- | --- | --- |
| A1 | Latency of save/delete of seasons and general closures is measured per phase (DB write, regeneration, UI completion) with request counts, equivalent inputs before/after | Real-action measurement on a disposable DB (existing #127 harness, N packages); table of ms + PostgREST requests before/after |
| A2 | The user-visible save/delete no longer waits for the regeneration of every package | Action returns after the DB write; regeneration continues server-side (`after()`); UI says it is updating |
| A3 | Closure/promotion correctness is preserved | After regeneration completes: published tariffs reflect the closure/season exactly as before (same #127 assertions); selling is still validated live (`computarReserva`) so a not-yet-regenerated tarifario can never sell a closed stay |
| A4 | Unrelated published offers untouched; failure behavior preserved | Only packages using the hotel are regenerated; a regeneration failure is logged and marked by the existing generation machinery, never silently reported as success |
| B1 | Successful delete removes the row immediately, no manual refresh | Rendered test: click Eliminar → row gone before regeneration finishes |
| B2 | Failed delete keeps the row and shows the error | Rendered test with failing action |
| B3 | Create adds the row immediately and keeps the form behavior | Rendered test |
| D1 | One validity (e.g. full year) with excluded nights/ranges chosen on a visual calendar | Rendered component test: select/deselect days, shift-range, month navigation, year boundary |
| D2 | Existing range presentation/data stay compatible | Round-trip: ranges ⇄ day selection is lossless; old `blackouts` jsonb loads unchanged |
| D3 | Exclusions apply to that validity only; hotel-wide closure keeps precedence | Pure + real-engine tests: excluded night inside season A does not close the hotel and does not affect season B; general closure still closes regardless of season |
| D4 | Named, reusable date sets by year (holidays, Easter, school recess, mid-year, custom) | Table + CRUD + UI; set identifies its year; unique (name, year) |
| D5 | Applying a set **copies** dates (snapshot), never links | Test: edit/delete the set afterwards → seasons that used it unchanged; UI states this |
| D6 | No invented holidays / no universal school calendar | Sets are empty until the owner creates them; no seeded dates; UI text says so |
| D7 | Multi-range / year boundaries; dates outside the validity are reported, not silently dropped | Unit tests: Dec 31→Jan 1, leap day, set partly outside validity (applied part + dropped count shown) |
| E1 | The actual supplier service-request document is sent to the supplier | Reuse the existing per-provider voucher/«service request» content; email carries the document (print-ready HTML) and a stable reference |
| E2 | Sending, delivery, reply and supplier confirmation are distinct states | State machine table + tests: `pendiente → enviado → entregado → respondido → confirmado/rechazado`, monotonic, idempotent |
| E3 | Replies are associated with their request reliably | Correlation by a unique per-request reply token in Reply-To/Message-ID, not by subject; unknown/forged tokens ignored |
| E4 | No duplicate sends or notifications | Idempotency key per (request, supplier, version); retries do not resend; duplicate webhook deliveries notify once |
| E5 | Internal users notified on reply | In-app notification row + email only to configured recipients (decision pending); authorization tested |
| E6 | Local synthetic services only; no external recipient | Local capture (Mailpit already present in the local stack) and a local webhook simulator; tests assert nothing leaves the machine |
| E7 | Live sends stay OFF until owner decisions | Feature flag off by default; sender/reply address, event and recipients are configuration, not code |
| R1 | Resource/cost evidence (Vercel + external) | `VALIDACION_CONSUMO_VERCEL.md` table; measured local vs unmeasured hosted explicitly separated |
| R2 | Final local production build, real-action journeys, rendered desktop/intermediate/mobile | Evidence section in the delivery report |

## 2. Genuine open decisions (with recommendation)

| # | Decision | Recommendation |
| --- | --- | --- |
| Q1 | Does applying a named set **copy** dates into the season or **link** to the set? | **Copy (snapshot).** Seasons already persist their own `blackouts`; linking would silently change published prices when someone edits a set, which the brief forbids. Editing a set later offers an explicit "re-apply" per season (not built unless asked). |
| Q2 | Should sets be per hotel or a shared catalogue? | **Shared catalogue (hotel-agnostic)**, because holidays and school recess repeat across hotels; each hotel still owns its copy. A set with a destination field is out of scope. |
| Q3 | What is the "supplier service-request document"? | The code has no document by that name. The closest existing artifacts are the per-provider **voucher** (hotel / traslado / asistencia, `vouchers` table, `VoucherDocumento`) and the pending hotel «a solicitud» quote (#120). This block implements the send/reply tracking around a **request** record that carries the voucher content as its document; the owner should confirm that the voucher is the intended document (if the request is the #120 rate request, only the document builder changes, not the tracking). |
| Q4 | Mail provider | Hostinger mailbox UI shows an API token and webhook screen, but nothing tested. Recommended: keep **Resend** for outbound (already integrated, domain verification already part of the plan) and use its inbound/webhook **only if** the owner confirms inbound routing; otherwise provider-neutral webhook endpoint secured by a shared secret, so the Hostinger webhook (or any forwarder) can post to it. No provider change, purchase or DNS is made by this work. |
| Q5 | Sender / reply-to, trigger event, internal recipients | Needed before enabling. Defaults proposed: sender `operaciones@…` (owner chooses), event = explicit "Enviar solicitud" button per provider group (never automatic on contract creation), recipients = the contract's advisor + role `operaciones`. |

Q1/Q2 are implemented with the recommendation (reversible: schema keeps sets independent). Q3–Q5 are configuration/decision gates: the implementation is provider-neutral and flag-gated.

## 3. Correction round 2026-11-22 (Codex audit H103-1 … H103-5) and owner clarification (B–E)

**Supersession:** rows E1/E2 and decision Q3 of sections 1–2 (the voucher as the supplier document) are superseded by B1/B2 below — the owner does NOT want the customer voucher sent. Final evidence and numbers: [delivery report](hotel-calendar-performance-email-delivery-2026-11-22.md).

Status legend: **OPEN** = not started · **WIP** = code written, not yet proven · **PROVEN-LOCAL** = proven by the named test on a disposable database / local capture (hosted behaviour is never claimed). This table is updated again at delivery; nothing here is marked PROVEN until its test has actually run and is cited.

| # | Requirement | Planned independent evidence | Status |
| --- | --- | --- | --- |
| H1 | Supplier requests join the contract identity system (migration 284): classified in `contrato_guardas_config`, guard installed, installer succeeds; privileged actions carry the screen's identity; async events use the request's OWN stored `contrato_uid`; reuse blocker and renumbering inspected | pg test: installer success + failure-before (GUARDA_SIN_CLASIFICAR), missing / foreign / stale identity rejected, reuse-born contract, webhook event on reuse-born contract, stale life ignored, renumbering keeps request/token/events, `dtm_reuso_bloqueos` lists the table | PROVEN-LOCAL (solicitudProveedor103.pg I1–I6) |
| H2 | Deferred regeneration is safe when it never starts, is interrupted, or overlaps another edit; visibility correct at once (validity dates, exclusions, promotions, closures); persisted completion/failure/retry; before/after TOTAL work, not only response time | pg test on disposable DB: publishable rows after each change type with regeneration NOT run; pending state persisted; resume claims; overlapping edit; counts of requests/queries before vs after | PROVEN-LOCAL (latenciaCierres103.pg H2-1…10); total work NOT reduced; no scheduler |
| H3 | Interrupted/uncertain email sends recover without blind resend, never stay «enviando» forever | pg test: killed worker before send, accepted-before-record, concurrent recovery, no duplicate message (idempotent fake provider + Mailpit) | PROVEN-LOCAL (pg S1–S6, P7) |
| H4 | Reading one contract marks only that contract's notices read; other contracts' and other users' notices untouched | pg test A/B contracts + second user | PROVEN-LOCAL (pg N1 + negative control) |
| H5 | Exact-source production build without font substitution; real-role compiled walkthrough at 3 widths; failures compared by exact name against a clean baseline | `next build` of the delivered tree (hash of the tracked+untracked source recorded); real local login with synthetic users; Edge headless screenshots; baseline worktree at origin/main | PROVEN-LOCAL: exact-source cold build 60 s, fingerprint 5728a0f0…; unit/react failures identical to clean baseline by name; walkthrough 41/43 then 5/5 after fixing script defects |
| B1 | Supplier request is a STRUCTURED email (HTML tables + plain-text alternative), not the customer voucher; no attachment required | email renderer from authoritative reservation/service data; Mailpit inspection of HTML and text parts | PROVEN-LOCAL (unit B1/B2, pg K3, walkthrough F2.6) |
| B2 | Fields/presentation agreed with the owner | proposed field list in the delivery report as a decision, not as accepted | OPEN — owner decision (proposal in report §3-B) |
| C1 | Explicit per-hotel, per-promotion/validity required code (not one permanent code, not derived from a name) | table + editor; test: code varies per validity | PROVEN-LOCAL (pg K1–K5, react C1/C2) |
| C2 | Code shown in preview and outgoing email; send rejected when required code is missing or belongs to another hotel/promotion | pg + unit tests | PROVEN-LOCAL (unit C3, pg K2/K3, react P9/P10, walkthrough F2.2–F2.4) |
| C3 | Tariff calculations unchanged | existing price/promotion suites unchanged (names compared) | PROVEN-LOCAL (no tariff rows touched; #127 + calendar suites unchanged) |
| D1 | Supplier-payment email: explicit preview/send action; relation derived from persisted payments + allocations (partial, several contracts); never an invented split | pg test with payments: partial, multi-contract, with/without allocations | PROVEN-LOCAL (unit D1/D2, pg P1, walkthrough F3.5) |
| D2 | Selected evidence files attached; supplier/tenant ownership of payment and files checked | pg + storage test; cross-supplier / cross-tenant rejected | PROVEN-LOCAL (pg P2/P5/P6; real Storage in walkthrough F3.3/F3.7) |
| D3 | Sending/retrying never creates/re-posts a payment, never marks reconciled/confirmed; send history, dedupe, retry | row counts of payments/asientos/conciliation before == after | PROVEN-LOCAL (pg P3/P4 fingerprint; walkthrough F3.8/F3.9) |
| E1 | Mail integration reconciled with Hostinger evidence + existing integrations; concrete supported outbound/inbound path; genuine owner decisions listed | report section built from official documentation fetched in this session | DONE (report §3-E); Svix adapter unit-proven, not live; Hostinger adapter not built |

### Genuine owner decisions still required (do not block independent work)

1. Corporate sender address and reply/inbound address.
2. Recipients for internal notices (the original matrix said «contract advisor + operaciones»; the code uses request creator + operaciones — to be reconciled).
3. Trigger for supplier-payment emails (explicit button only until agreed).
4. Field list and presentation of the supplier request (this round proposes one; not assumed final).
5. Where required promotion codes live (this round proposes a per-validity field; confirm).

## 4. Correction round 3 — Codex round-2 audit (R2-1 … R2-7)

Status legend as in §3. «PROVEN-LOCAL» = proven by the named test on a disposable database / local capture; independent Codex re-run pending. Numbers and the full evidence table: [delivery report §0](hotel-calendar-performance-email-delivery-2026-11-22.md).

| # | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| R2-1 | Every ambiguous retry (claim taken over, ambiguous failure, bounce) respects the provider's idempotency window; outside it nothing is sent and the request is `incierta` | pg W1–W7; unit `auditoriaR2_103`; negative control (window check removed) fails W1/W4/W5/W7 | PROVEN-LOCAL |
| R2-2 | A retry re-sends the stored frozen message (html/text/recipients/attachment hashes); the payment key excludes mutable derived values; a new version is an explicit, reviewed action | pg X1/X1b/X2/X3; rendered D4/P5/D1; negative controls (rebuild from current data; `pagadoAcumulado` in key) fail X1/X2 | PROVEN-LOCAL |
| R2-3 | Catalogue/contract read errors fail closed | pg Q1/Q2; unit; negative control fails Q2 | PROVEN-LOCAL |
| R2-4 | An existing unrelated hotel cannot bypass the code; multi-stay and same-name cases defined | pg Q3–Q7; unit; negative control fails Q4 | PROVEN-LOCAL (same-name policy = sender's explicit choice — owner/auditor to confirm) |
| R2-5 | Regeneration debt is completed without a button when old and nothing is alive; banner follows the persisted state; no idle polling; `fallido` left to a person | pg A1–A4; unit `pendientesAuto103`; rendered B3–B6; compiled-app F1.1/F1.1b/F1.4/F1.9; negative controls fail A1 | PROVEN-LOCAL (hosted timing unmeasured) |
| R2-6 | Payment-relation write errors stop the send before the provider call and leave a retryable request | pg L1; negative control fails L1 | PROVEN-LOCAL |
| R2-7 | Complete guarded rollbacks and final lifecycle 327→328→329 | `ciclo_327_329.sh`: «CICLO COMPLETO: 0 fallas»; postcheck 328/329 OK; schema signature equal before/after/re-applied | PROVEN-LOCAL (never run on a hosted database) |
| H5′ | Exact build + compiled walkthrough + exact-name comparison against clean baseline repeated for the final tree | source fingerprint `6713a415…b607e` equal before/after build; walkthrough 42/44 (+5/5 corrected script); unit 10,621/29 vs 10,579/29 and react 2,148/26 vs 2,148/26 with identical failing names | PROVEN-LOCAL; one intermittent Google-Fonts build failure observed once (not reproduced, not root-caused) |
| M1 | Mail route (Hostinger vs Resend) proposal from official documentation, no provider/DNS/billing change | delivery report §0.4 | PROPOSAL — owner decision; three items untested (token in local part, Hostinger webhook payload, Resend plan limits) |

Still open (unchanged): owner decisions listed in delivery report §0.6; no migration has been applied to any non-disposable database.

## 5. Correction round 4 — Codex round-3 audit (R3-1 … R3-3)

Legend as in §3/§4; independent Codex re-run pending. Numbers and the measurement table: [delivery report §0.R3](hotel-calendar-performance-email-delivery-2026-11-22.md)

| # | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| R3-1 | Rollbacks 328/329 atomic; locks from before the guard to commit; bounded lock timeout; consistent lock order; in-flight write seen, late write blocked, timeout leaves everything unchanged; lifecycle intact | `prueba_carrera_rollback_103.mjs` 22/22 on a disposable DB; negative control (`--sin-candados`) 8 failures; auditor's reproducer now blocked; `ciclo_327_329.sh` «CICLO COMPLETO: 0 fallas» | PROVEN-LOCAL (never against a hosted database) |
| R3-2 | Separate-send path for several stays of one supplier, each with its code; message + snapshot filtered; unrelated-hotel rejection and retry safety kept | pg Y1–Y4 (62/62), negative control fails exactly Y1–Y4, unit probe port, rendered P11/P12 (12/12), compiled E1–E9 (9/9, local capture) | PROVEN-LOCAL (same-name policy still owner/auditor to confirm) |
| R3-3 | Polling uses the narrow read; measured on the compiled route; hidden tab, overlap, persistent error, completion, limits | rendered B1–B12 (18/18) + 5 negative controls; compiled S0–S5 7/7 and S6a/S6b 2/2: 20 reads = 120 requests vs 700 for 20 whole-page refreshes (35 each); idle 0; error stops at 3; completion 1 refresh; hidden 0 | PROVEN-LOCAL (hosted cost/usage unmeasured; tabs uncoordinated by design) |
| H5″ | Exact build for the changed inputs | build EXIT=0; source fingerprint `8e432e7c…ea55ea2d6e` (full value in the delivery report) equal before/after/report | DONE (font failure still not root-caused) |
| H-IN9 | Owner review preparation OW-1…OW-4: stop/start preserves review progress; honest failure reporting; one settings source for every review entry point; saved-account browser profile verified with real autofill + Auth sign-in; exact W1–W11 rehearsed on a separate fixture | `rehearsal_walkthrough.mjs` 49/49 (`evidence_rehearsal_run3.json`), `rehearsal_lifecycle.mjs` 13/13, `checks_review.mjs` 12/12, `checks_harness.mjs` 22/22, `checks_pg_ownership.mjs` 32/32 | LOCAL; simulated provider; headed browser dropdown, real Hostinger, hosted behaviour unverified; the owner's own session has not been started |
| H-IN8 | HJ-3: the harness mutates only a dedicated, ownership-verified PostgreSQL container (cluster roles never changed in a shared container); read-only source | `supabase/scripts/hostinger_journey_103/checks_pg_ownership.mjs` 32/32; `checks_harness.mjs`; full sequence on the dedicated container | LOCAL; Windows only; hosted/live unverified |
| H-IN7 | HJ-1 reproducible harness in the repository (settings, generated credentials outside repo, validated disposable DB) and HJ-2 loopback-only, ownership-verified launcher | `supabase/scripts/hostinger_journey_103/checks_harness.mjs` 29/29; setup→journey→teardown through the harness on the retained build | LOCAL; Windows only; hosted/live unverified |
| H-IN6 | Final-source production build + compiled real-stack journey with a simulated Mail API: webhook/cron authentication, persistent continuation across an app restart, failure recovery, concurrency, dedupe, internal notices, local measurements | build exit 0; journey 32/32 (`supabase/scripts/hostinger_journey_103/evidence_run3.*`) | LOCAL SIMULATED PROVIDER ONLY; real Hostinger contract, hosted limits, live mailbox and production DB unverified |
| H-IN5 | HIN-4: no `since` filter (arrival vs sender time); HIN-5: threshold persistence at start, full-page and partial-page saves across days | `hostinger103.test.ts` 42/42 (X6, X7); individual mutation controls restored | CODE + SIMULATED-HTTP ONLY; sender-date first-sweep rule still an owner decision (A12); build/real stack/live pending |
| H-IN4 | HIN-2a progress saved inside a page (long already-recorded prefix, slow database) and HIN-2b eligibility preserved across days for unfinished sweeps (threshold saved with the sweep; age never a stop rule), with CAS/dedupe/budget preserved | `hostinger103.test.ts` 40/40 (P1–P4, X1–X5); real SQL 0 failures; store over PostgREST 6/6; `ciclo_327_330.sh` 0 fallas; individual negative controls | CODE + SIMULATED-HTTP + DISPOSABLE-DB ONLY (330 amended in place, unapplied elsewhere; build, real stack, live mailbox pending; A12) |
| H-IN3 | HIN-2 durable continuation (replies behind any amount of newer unrelated mail, failed downloads and concurrent runs recover without new mail; cursor/backlog in migration 330) and HIN-3 shared deadline/attempt budget inside retries, waits and database work | `hostinger103.test.ts` 31/31 (S1–S9, B1–B6, C1–C2); real SQL `prueba_hostinger_estado_103.mjs` 0 failures; store over PostgREST 5/5; `ciclo_327_330.sh` 0 fallas; individual negative controls | CODE + SIMULATED-HTTP + DISPOSABLE-DB ONLY (migration 330 unapplied elsewhere; build, real stack, live mailbox pending; search `uid` range semantics unverified live) |
| H-IN2 | HIN-1/HIN-2 (first correction, superseded by H-IN3 for scan depth): failed downloads and replies beyond the 25-message/10-download limits recover without an unrelated new e-mail; bounded per invocation (time, requests, pages); honest 202 when incomplete; concurrent/duplicate safe | `hostinger103.test.ts` 27/27 (R1–R13) + 10 negative controls; scheduled drain `/api/cron/respuestas-hostinger` | CODE + SIMULATED-HTTP ONLY (build, real database, real stack, live mailbox pending; scan depth limit of 500 messages documented) |
| H-IN | Hostinger inbound adapter, code only: authenticate the notification, fetch the message through an injectable client, correlate to the request/notice, reuse `procesarEvento`, keep dedupe/identity/tenant isolation, never confirm automatically; live OFF | `hostinger103.test.ts` 15/15 (simulated HTTP; negative controls); contract and assumptions in [hostinger-entrada-103.md](hostinger-entrada-103.md) | CODE + SIMULATED-HTTP ONLY (plus-addressing, webhook payload, retry/pause policy unverified; build and real-stack checks pending) |
