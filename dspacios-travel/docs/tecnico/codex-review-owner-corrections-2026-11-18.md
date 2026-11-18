# Codex re-audit — owner correction batch, 2026-11-18

Source: `.worktrees/int-review/dspacios-travel`, base 51ea60612. Final build fingerprint independently verified: **aw6VTv30k99_9jBP-jGY2**, **969 files**, current source/config matches.

## Current verdict — round 2: C1/C2 CLOSED; technical re-audit passed

Final source/config fingerprint independently verified: **FreOT3YH2M3PLd17-pfnV**, **969 files**. Owner acceptance and publication remain pending. Before the next owner session, the missing Dubai examples must be added through the recorded backed-up additive procedure; do not restore the owner's database.

### Independent round-2 verification (2026-11-18)

- Reviewed the corrected item fold, its contract renderer and frozen-summary row grouping. A zero-price child joins the single unambiguous adult package row; genuinely different child tariffs remain separate. Multiple partially benefited children without sealed attribution retain only an honest aggregate payable value, with no displayed per-child average and no negative benefit row.
- Focused unit tests: **77/77** across document folding, summary rows and full-matrix boundaries. Real-component rendered document tests: **20/20**.
- Disposable database real-action suites: USD payment/confirmation/reversal **6/6**, real NETO free-child cart/Reservar PVP suite **5/5**, unit-table capacity/USD **5/5**. Executed with the appropriate launcher: PG_REACT=1 for the payment run and PG_REACT=0 for the NETO/unit files. An initial NETO invocation with the unnecessary React loader failed at its server stub; rerunning with the documented TypeScript loader passed, without changing application code.
- Additionally closed the reported Reservar NETO gap independently. A temporary extension of the existing NETO harness created a real agency quotation (`tipoAsesor=agencia`, `modoCompra=neta`, 10% commission), converted it through `crearCotizacion`/`convertirCotizacion`, and read back price **1317600**, commission **146400**, mode neta. The extended run passed **6/6**, comprising the existing five cases and this one new audit case. Its persisted items rendered through the real ContratoDocumento as **one row: 2 adults, 1 child, adult NETO 658800, Niño gratis, total 1317600**, with no promotion name. The temporary test and its disposable database were removed. Unique real-action cases across these runs: **17**, not 22 (the five NETO cases were repeated).
- Rendered and visually inspected **all four pages of C-0005 and all four pages of DTM-0004** from the executor's final-build PDFs. C-0005 has two rows (adult/free-child package 1464000 plus paying child 293000); DTM-0004 has one row (2 adults, 1 child, 360000). No negative row or visible clipping found. Executor reading of DTM-0003 and pending-USD PDFs remains executor evidence; Codex did not repeat the whole compiled-browser sweep or build.
- Corrected Codex's earlier route claim: `app/cotizacion/[id]/page.tsx` reads the quotation by numeric id and renders its printable document. `/cotizacion/5` is valid; it was wrong to call it a guessed manual-only route. The detail-page link and actual public share link remain good owner navigation.
- Changes in this round are pure document presentation: no added polling, retries or network calls in the reviewed fold/renderer. Earlier measured search/table request counts remain executor evidence on unchanged dependencies; hosted metrics/savings are unmeasured.

### Residual limits and preparation

- Historical data lacking sealed per-child amounts cannot produce individual payable tariffs safely; aggregate child value is shown honestly. With several distinct adult rows and no room-to-child linkage, a zero child remains separate rather than being assigned arbitrarily. These limits do not recreate C1/C2's mandatory examples or invent prices.
- PDF inspection is representative as detailed above; do not state that Codex read every generated document or verified legal content. Full suites and broader browser/matrix/layout sweeps are executor evidence.
- Dubai hotels 912511/912512 remain absent from owner review data until the executor performs the backed-up additive preparation. Preserve the confirmed USD contract/payment and existing owner progress; verify the build and service database target before handing back the environment. Do not start another owner session until that preparation is complete.
- Codex did not modify application code, stage, commit, push, deploy or execute remote SQL. Owner rev_revision was not changed. Shared pg304 and existing services were not stopped.

## Original blocked verdict and findings — superseded history

The matrix still accepts document structures that contradict the owner's single-package-row requirement. Passing the supplied tests does not establish that requirement.

### C1 — P2 — Free-child contract still renders separate adult and child rows

`components/contrato/ContratoDocumento.tsx:275,851`: package unification is limited to quotations with manual services; the regular Reservar contract without a frozen passenger summary maps the folded item rows separately. The correction removes the negative promotion row but leaves an adult package row and a separate zero-price child row.

Independent render of the actual component with the DTM-0004-shaped real-action items: **2 value rows**, text `1 hab Doble ... 2 / 0 / 180000 / 0 / 360000` followed by `Niño gratis ... 0 / 1 / 0 / Niño gratis / 0`. Expected: **one package row containing 2 adults and 1 child**, child payable tariff zero, total 360000. The owner permits another row for a genuinely different child tariff; therefore C-0005 should have two relevant package/tariff rows, not adult + free child + paying child as the current acceptance matrix proposes.

Correct the expected rendered structure first. Preserve real adult/class/currency/coverage differences; do not average tariffs, edit stored historical items or weaken total reconciliation.

### C2 — P2 — Partial benefit for multiple children falls back to a negative row

`lib/contrato/plegarNinoGratis.ts:15,30–42`: presentation attribution parses class/count from the signed description and explicitly skips multiple same-class children with partial benefits (or mixed classes unless fully waived). The old signed negative row survives.

Independent helper reproduction: two rooms, two Niño 1 passengers at 100000 each, signed partial accommodation benefit −50000 naming both children. Result: `plegado=false`, **one remaining negative row**. This is a supported type of benefit (partial promotional accommodation / other services retained), not authorization to reintroduce the forbidden display. Use reliable sealed per-child attribution where available, cover multiple children/rooms with actual retained charges, and report unresolved historical attribution honestly instead of inventing a split or claiming broad support.

## Independent execution and evidence boundaries

- Existing rendered correction tests: **12/12 pass**, despite C1/C2. Their acceptance criteria need correction; do not count that green result as closing these findings.
- Real component render and helper probes reproduced C1/C2; no application code changed.
- Voucher observation: on **rev_verif_corr only**, in a transaction rolled back afterwards, DTM-10604 started with `entrega=pendiente`, `acuse_anterior=true`, one historical event. Real registrar_seguimiento_contrato mark/unmark RPCs returned pending/false with three events (original plus two). **No history deletion reproduced**: the indicator follows the latest event. Persistent history and its visibility must not be conflated; do not modify migration 309 merely to keep that particular banner true.
- Build execution, full suites, compiled browser and PDFs are executor evidence, not independently rerun here. Codex did not modify rev_revision or reset owner data.

## Remaining acceptance gaps: proportional closure

- G1/G4: supplement SQL-forced rendering with a real payment/confirmation/reversal path and a real NETO free-child quotation/conversion/document. Existing unchanged real-action evidence may be reused when source/environment equivalence and exact coverage are shown, but a SQL-flipped PVP document alone does not prove a real NETO flow.
- G2: validate the new unit-table entry path with representative capacity rejection, Adults Only and USD cases; reuse authoritative pricing tests where applicable.
- G6: check applicable day/group boundaries, closures and effective regimen/base supplements in the new complete matrix; do not activate production features or invent support for inactive modes. Keep unimplemented combinations explicit.
- G3/G8: unchanged earlier-build evidence is not automatically invalid. Establish the affected dependency/source diff; repeat only changed/affected browser/PDF behavior. Final corrected document structure needs fresh visual inspection of all affected pages.
- G7: a missing additional automation is not itself a product defect when compiled browser evidence proves the behavior; add a focused regression if it meaningfully detects recurrence.
- G9: hosted metrics remain owner Preview work; measured local requests/idle behavior are still required. No savings claimed.
- G10: no data-loss finding after the independent RPC probe above.
- G11: prepare the missing Dubai examples for owner review only through a backed-up additive procedure after the correction/audit gate, preserving the confirmed USD contract and payment.
- Fix walkthrough navigation: C-0005 is a Tarifario quotation; use `/dashboard/cotizaciones/5` or its actual public share link, not a guessed manual-quotation `/cotizacion/5` route.

The next executor matrix must derive expected rows from the owner's actual instruction, not from the implementation's current row counts. Keep all owner-approved ally-voucher access behavior. No staging, commit, push, deployment or remote SQL by Codex.
