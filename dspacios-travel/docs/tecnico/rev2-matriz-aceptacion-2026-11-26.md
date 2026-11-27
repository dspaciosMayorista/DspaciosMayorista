# Consolidated owner-review — acceptance matrix (two feedback batches merged)

Date: 2026-11-26. Scope: worktree `dspacios-travel/.worktrees/revision-consolidada`. Source: the owner's two feedback batches on the consolidated local walkthrough (`docs/tecnico/revision-consolidada-guia-2026-11-25.md`, 96 steps). Executor evidence and owner acceptance are kept separate: nothing here is claimed as Codex-audited or owner-accepted for the corrected items.

Status vocabulary:
- **A** accepted — owner accepted as is; preserved, must not regress.
- **A+C** accepted with correction — the information/behavior was accepted but a presentation/behavior change was requested.
- **R** rejected / needs correction.
- **E** explanation required — the owner asked for an explanation, demonstration or documentation, not (only) a code change.
- **D** deferred owner production verification — NOT a local pass.

Superseded conclusions are listed in §3; earlier evidence is retained untouched.

## 1. Matrix

| Step | Owner verdict | Status | Batch-2 action (area report) | Evidence column (filled at hand-off) |
|---|---|---|---|---|
| B3-01 Recent presence | information useful; list must not fill the dashboard | A+C | compact entry + modal, tabs internal/allies, bounded search/pagination | see `rev2-b3` |
| B3-02 Purchase-deadline alerts | move to general ALERTAS with «Revisado» | R | out of the bell, into ALERTAS, per-person review | see `rev2-b3` |
| B3-03 Alert destinations | must open the owning hotel/service/flight validity | R | saved source identity, new hotel/service validity sources | see `rev2-b3` |
| B3-04 Bell in CRM | remove the general bell from the CRM header | R | bell removed, CRM-specific behavior kept | see `rev2-b3` |
| B3-05 Non-package roles get no alerts | accepted | A | preserved | — |
| B3-06 Packages list state/validities | accepted | A | preserved | — |
| B1-01 Movement history | information correct, page too long | A+C | collapsible/modal history | see `rev2-b1` |
| B1-02, B1-03, B1-04 | accepted | A | preserved | — |
| B1-05 Voucher per service | different passengers on different flights: explain and demonstrate | E | limitation shown in the voucher; no allocation model invented | see `rev2-b1` |
| B1-06 Voucher without PNR / preview | ally-portal visibility of the explanatory note | E | evidence + consistency | see `rev2-b1` |
| B1-07 … B1-16 (incl. legacy return) | accepted | A | preserved | — |
| B2-01 Referrals | accepted for current scope; deeper work deferred | A | preserved | — |
| B2-02, B2-03, B2-04, B2-04b | accepted | A | preserved | — |
| B2-05 Public registration with code (real mail) | owner production verification | D | not a local pass | — |
| B2-06, B2-07, B2-08, B2-09, B2-10 | accepted | A | preserved | — |
| B2-11 Public-quotation notice | holder must be visible before deciding | R | holder card in working screens | see `rev2-b2holder` |
| B2-12a Load hotel net | holder must be visible before deciding | R | same card | see `rev2-b2holder` |
| B2-12 Read per person / convert | accepted | A | preserved | — |
| S339-01 Portal quota | accepted | A | preserved | — |
| S339-02 Internal view | add rejection workflow | R | reject with reason, ally e-mail (local capture), ally correction path | see `rev2-s339reject` |
| S339-03 … S339-09 | accepted | A | preserved | — |
| H103-01, H103-02 | accepted | A | preserved | — |
| H103-03 Exclusion calendar | keep compact display; calendar helper into a modal | R | modal | see `rev2-h103` |
| H103-04 Reusable sets | owner expected a new validity with the set's name | E | distinction made explicit; proposal | see `rev2-h103` |
| H103-05 … H103-10 | deferred to production | D | not a local pass | — |
| H103-11, H103-12 | accepted | A | preserved | — |
| H103-13 Mail decisions | explain how the supplier message is edited | E | hardcoded today; smallest editable approach | see `rev2-h103` |
| B95-01 Generate tariff | owner believes it already existed | E | reconcile with original task | see `rev2-reglas-negocio…` |
| B95-02 Reserve with assistance | separate price for an additional service contradicts the rule | R | no individual additional-service prices in customer documents | see `rev2-f95docs` |
| B95-03 … B95-12 | accepted | A | preserved | — |
| B95-13 Manual contract: catalog choice | destination catalog dropdown, hotels by destination relation | R | structured destination/hotel selection | see `rev2-f95forms` |
| B95-14 Adults-only hotel / dates | accepted only for the minor case; date defect open | A+C | return < departure rejected (client + server) | see `rev2-f95forms` |
| B95-15 Manual quotation with catalog hotel | infants, direct vs platform, document structure | R | see forms/docs | see `rev2-f95forms`, `rev2-f95docs` |
| B95-16 Comparative | trace the Tarifario path | E | source trace + exercised journey, including the anonymous visitor with a child (D0/J2c; fixed read of `hotel_acomodaciones`) | see `rev2-f95docs`, `rev2-f95tarifario`, `rev2-publico-ninos` |
| B95-17 Comparative on mobile | accepted | A | preserved | — |
| B95-18 Choose option B → contract | not approved: structure, chosen option details | R | conversion fidelity | see `rev2-f95docs` |
| B95-19 Full payment / rounding row | not approved: «Ajuste por redondeo» | R | customer-facing row removed or precise decision | see `rev2-f95docs` |
| B95-20 USD comparative / usability | not approved: unstructured accommodation text | R | structured validation | see `rev2-f95forms` |
| H88-01 Catalog hotel info | card stretches; check ordinary packages | A+C | modal quotation + ordinary-package check | see `rev2-h88` |
| H88-02, H88-03 | explanations to be rewritten | E | rewritten; not counted as accepted | see `rev2-h88` |
| H88-04, H88-05 | accepted | A | preserved | — |
| NETA-01 … NETA-04 | accepted | A | preserved | — |
| NETA-05 USD bloqueo, cost TRM | could not identify USD / enter the TRM after save | R | explicit USD, editable provisional cost TRM | see `rev2-neta` |
| NETA-06 USD contract costs | accepted conditional on fixing the TRM issue | R | same | see `rev2-neta` |
| NETA-07 … NETA-09 | accepted | A | preserved | — |
| INT-01 … INT-04 (section 12) | accepted | A | content adjusted by B3-02/B3-04: the bell no longer carries purchase-deadline alerts and the CRM header no longer carries the general bell | see §3 |

## 2. Deferred owner production verifications (never local passes)

B2-05 (real e-mail registration with referral code), H103-05 … H103-10, and the real Hostinger mailbox check after the desired changes. Local simulated checks continue to run but do not close these.

## 3. Superseded conclusions (kept, not deleted)

| Earlier conclusion | Superseded by |
|---|---|
| B3-02/B3-03: «the bell shows purchase-deadline notices» | B3-02: they live in the dashboard ALERTAS area (batch 2). The old `avisos` rows keep existing; the bell no longer lists/counts them. |
| B3-04 / INT-03: «the bell appears in the CRM next to PORTAL» | B3-04: removed; the slot is reserved for CRM-specific notifications. |
| B1-01: expanded movement list | compact/collapsible history |
| H103-03: calendar always visible | calendar in a modal; the compact exclusions list is the primary display |
| NETA-05/06: cost TRM frozen at conversion («no cambia después») | provisional cost TRM editable after save under narrow conditions (see `rev2-neta`) |
| B95-19: «ajuste impreso» | the customer-facing adjustment row is removed (see `rev2-f95docs`) |

Evidence from the previous round (`revision-consolidada-evidencia-*.md`, `evidence-*`, `evidencia-r*-95-*`) is retained; where a step changed, its old evidence is superseded for that step only.

## 4. Final evidence (2026-11-27, build `nlM_PWhr2xm4wxi_tCJHS`)

Every row marked «see `rev2-…`» above was exercised in the full walkthrough on a fresh disposable clone: 117 steps, 1617/1617 checks OK (`docs/tecnico/rev2-entrega-final-2026-11-27.md`, log `C:/tmp/consolidada/rev2/ensayo_final3.log`). Customer-document fallbacks and the contrast case were inspected at 1280/768/390 px with print layout (79/79 checks, `visual_documentos.mjs`). Statuses A/A+C/R/E/D above are the owner's verdicts and are NOT changed by this evidence: nothing here is owner-accepted or audit-closed.

| Row | Local evidence now | Still open |
|---|---|---|
| B3-02/B3-03/B3-06 | steps pass with counts derived from fixture dates and the business date | «Revisado» per person vs shared; validity coverage |
| B1-01 | compact history verified at 3 widths | — |
| B1-05 | limitation shown, no allocation modelled | policy decision |
| B2-11/B2-12a | holder card verified (public form stores type «CC» by default) | — |
| S339-02 | reject workflow verified (S339-11) | — |
| H103-03 | modal verified with visible-dialog scope | H103-05…10 deferred to production |
| B95-02/B95-18/B95-19 | document shows one package row, service without price, no adjustment row | rounding presentation (3 × 477.33 vs 1,432.00) |
| B95-13/B95-20 | destination → hotels, city cleared on destination change, counters per hotel (two product fixes, tests with failure-path controls) | — |
| B95-16 | anonymous visitor with a child: exact totals, no net/supplier data | — |
| NETA-05/06 | USD cost TRM provisional, editable, service added after the contract (NETA-06c), confirmation | mixed accrual without a TRM to inherit; post-confirmation correction |
