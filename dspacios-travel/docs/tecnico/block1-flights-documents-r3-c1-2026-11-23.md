> **Round 4 note (ADL-041):** the PNR is now shown on the paid air voucher, vouchers are per contract per service, and Gestión de contratos has an internal «voucher updated» signal; where this document says otherwise about those points, `block1-flights-documents-r4-adl041-2026-11-23.md` prevails. Conversion (C1) statements are unchanged.

# Block 1 — round 3: correction C1 (stale state before a newly acquired claim)

Date: 2026-11-23. Worktree `dspacios-travel/.worktrees/block1-vuelos`, baseline `origin/main` `cd9bb1946`. Input: `docs/tecnico/codex-review-block1-flights-r2-2026-11-23.md` (main checkout). Builds on `block1-flights-documents-r2-corrections-2026-11-23.md` (where they disagree, this document prevails for conversion).
No staging, commit, push, remote SQL, live mail or deployment. Owner review environments and data (#95/#103/#88) untouched; every driver used throw-away databases that were dropped.

## 1. The defect (confirmed, not an expired-lease case)
`convertirCotizacion` read the conversion state, then acquired the claim, then went straight to reservation. If B read «none» and A completed and released **between** B's read and B's claim, B acquired a **fresh, legitimate** claim on a stale read, invoked the reservation, **spent another contract number**, and only the duplicate-key backstop saved the data. Round 2 labelled the lost/expired-claim case (S5) as the only number-burning path; that was wrong — this normal interleaving also burned one.

## 2. The fix
`app/(dashboard)/dashboard/reservar/actions.ts`, `convertirCotizacion` (non-#63 only): once the claim is held, the state is **revalidated before the reservation is invoked**:
- `completa` → return that existing contract (and link the quotation, as before);
- `en_curso` (incomplete header) → the retryable «ya se está convirtiendo» error, **no number**;
- read failure → its error, **no number**;
- only `ninguna` reaches the reservation (which numbers).
The revalidation and the reservation sit inside the **same `try` whose `finally` releases the claim**, so every early return and every error path releases it. The #63 offer path is untouched (it does not use the claim). Voucher, editor link and everything else unchanged.

## 3. Evidence (real actions, separate sessions) — `docs/tecnico/evidence-block1-r3/`
New HTTP gate `pausa_reclamo` in `supabase/scripts/recorrido_block1.mjs` holds **only the first** claim request: the caller is paused after its initial «none» read and before acquiring the claim.

| Scenario | Result with the fix |
|---|---|
| **S6** B paused at that point; A converts completely and releases; B resumes | B returns A's **existing** contract; **exactly one number** (13→14) and **one complete contract**, quotation linked, no claim left, 2 passengers |
| **S7** same gate; A's downstream write **fails** (injected) and reverts; B resumes | A leaves nothing behind and releases; B converts: **one complete contract**; two numbers in total (the failed winner's, burned as before, and B's) |
| **S8** B acquires its claim while an **incomplete** header exists (A's claim gone, e.g. expired) | B answers «in progress», **no number spent** (17→17), B's claim released; A then finishes with one complete contract |
Log: `evidence-block1-r3/recorrido_block1.log` — full conversion group **38/38**. Flight-origin conversions (seats, Promoción without/with record, record later, link eligibility; they all go through `convertirCotizacion`): `recorrido_origen.log`, **33/33**.
**Negative control** (`RB1_PREVIO=2`, the round-2 behaviour rebuilt in a temporary module: claim + completeness, no revalidation): S6 and S8 **fail** on their number checks (S6: 13→15, two numbers for one contract; S8: B spends a number) — this reproduces Codex's probe with the real action (`negativo-ronda2/recorrido_block1.log`, 2 failures of 38).

Other checks on the final source:
- `tsc --noEmit` clean; `next build` exit 0, **`BUILD_ID x8ch-JG9r34SKHSZuZdF_`** (previous round: `wVj0gCNVGUu7TMSMiifjm`).
- Wiring/guard tests (`empaquetadosConversion40.wiring`, `financieroContratoWiring`, `identidadPropagacion.wiring`, `cotizacionesTenant.wiring`): 174/174, including a new assertion that the order is claim → revalidate → reserve and that the revalidation is inside the try/finally that releases the claim.
- Every React test that calls `convertirCotizacion` (8 files, including the three #63 files `salidaVinculada63*`, `cotizacionCobro235`, `empaquetadosUsd230Reserva`): 100/100.
- No unrelated full-suite rerun and no new compiled-page inspection: this change touches no UI, voucher or editor code (the round-2 compiled evidence for those stays valid for its own build; it was not re-captured on the new build).

## 4. Number accounting (corrected)
- Concurrent/replayed identical conversions, **including the stale-read interleaving**: no extra number (S1–S4, S6, S8).
- A winner that fails after numbering burns its own number (unchanged; reuse switch of 287 is OFF).
- The only remaining way for a loser to burn a number is a claim that is **lost/expired after it passed the revalidation** (S5a/S5b: its claim is removed while it is paused right before numbering). That is a lease-expiry case (300 s), not the normal race.
- Unchanged limits: `convertirCotizacionCarrito` untouched; #63-offer conversion not driven by this harness (its tests above pass).

## 5. Files changed in round 3
`app/(dashboard)/dashboard/reservar/actions.ts` (revalidation under the claim), `pruebas/empaquetadosConversion40.wiring.test.ts` (new assertion), `supabase/scripts/recorrido_block1.mjs` (gate `pausa_reclamo`, S6–S8, negative-control mode 2), `docs/tecnico/evidence-block1-r3/` (raw logs).
Re-run: `RB1_ESCENARIO=f1 sh supabase/scripts/recorrido_block1.sh pgblock1 plantillablock1 <out_dir>`; negative control: prefix `RB1_PREVIO=2`.

## 6. Owner decisions (unchanged, still open)
PNR visibility; per-contract vs per-passenger; passenger↔segment association; same-link voucher regeneration vs the «new documents» signal; #37 definition of «has air». None recorded as accepted.
