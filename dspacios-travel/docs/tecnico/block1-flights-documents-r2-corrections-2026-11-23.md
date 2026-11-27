> **Round 4 note (ADL-041):** the PNR is now shown on the paid air voucher, vouchers are per contract per service, and Gestión de contratos has an internal «voucher updated» signal; where this document says otherwise about those points, `block1-flights-documents-r4-adl041-2026-11-23.md` prevails. Conversion (C1) statements are unchanged.

# Block 1 — round 2: corrections for Codex findings F1–F4

> **Round 3 (C1) supersedes the conversion statements below**: the normal stale-read interleaving also burned a number; a revalidation under the claim now prevents it. The final build is `x8ch-JG9r34SKHSZuZdF_`. See `block1-flights-documents-r3-c1-2026-11-23.md`. The compiled-page evidence in §4 was captured on build `wVj0gCNVGUu7TMSMiifjm` (no UI code changed since).

Date: 2026-11-23. Worktree `dspacios-travel/.worktrees/block1-vuelos`, branch `claude/block1-vuelos-documentos`, baseline `origin/main` `cd9bb1946`. Author: implementer (Claude). For Codex re-audit.
Input: `docs/tecnico/codex-review-block1-flights-r1-2026-11-23.md` (main checkout). Round 1 report: `block1-flights-documents-reconciliation-2026-11-23.md` (where the two disagree, this document prevails).
No staging, commit, push, remote SQL, live mail or deployment. Owner review environments and data (#95/#61/#41/#42/#51/#33, #103, #88) were not touched; all drivers use throw-away containers/databases that are dropped at the end.

## 0. Status

| Finding | Status | One-line answer |
|---|---|---|
| F1 (P1) conversion success on an incomplete header | **Fixed + proven with the real action** | Success is returned only for `financiero_estado = 'completo'`; a claim (migration 336) is taken **before** a number is spent; a concurrent/replayed conversion spends nothing. Proven with separate sessions, a pause after the header and an injected downstream failure; the round-1 behaviour fails the same scenarios (negative control). |
| F2 (P1) destructive, non-atomic voucher regeneration | **Fixed + proven with the real action and database** | One atomic statement (migration 337): in-place update, one voucher per contract (unique index), failed required reads rejected, token kept. |
| F3 (P2) link/list eligibility disagreement | **Fixed + proven** | The contract page asks the same view the list and the editor use (`ventas_vuelo_sistema`, key only, editor roles only). |
| F4 visual / wording / owner gates | **Inspected in the compiled build; wording corrected** | See §4. Owner questions stay open and are listed in §5. |

Also found and fixed while injecting the failure (not in the audit): in the non-#63 conversion path the `contrato_hoteles` and `contrato_items` inserts ignored their errors, so a failure there produced a "complete" contract without its hotel/items. Both now revert the reservation like every other step (§1.4).

## 1. F1 — conversion completes once, succeeds only when complete

### 1.1 What "completed" means (established, not assumed)
`ventas.financiero_estado` is created `'pendiente'` and flips to `'completo'` **only** inside `registrar_financiero_contrato` (migration 172), which is the **last** step of the reservation (after passengers/seats, hotel, flights, items). Any earlier failure deletes the header again (`revertir_contrato_incompleto`, 171). So `completo` ⇒ a finished contract; `pendiente` ⇒ in progress (or crashed and waiting for the reconciler). A header alone proves nothing.

### 1.2 What changed
| File | Change |
|---|---|
| `supabase/migrations/20260601000336_conversion_cotizacion_reclamo.sql` | Table `cotizacion_conversion_reclamo` (one lease per quotation, RLS on, service_role only) + `reclamar_conversion_cotizacion(p_cotizacion, p_ttl_segundos)` (atomic acquire, NULL while another live lease exists, expired lease taken over) + `liberar_conversion_cotizacion(p_cotizacion, p_token)` (releases only with the matching token). Additive. |
| `lib/cotizacion/conversionReclamo.ts` | `estadoConversionCotizacion` (`ninguna` / `en_curso` / `completa`, tenant-checked, fails closed), `reclamarConversion`, `liberarConversion`, `MENSAJE_CONVERSION_EN_CURSO`. |
| `app/(dashboard)/dashboard/reservar/actions.ts` | `convertirCotizacion` (no #63 offer): read state → `completa` returns that contract (and links the quotation), `en_curso` returns the retryable error, otherwise **claim before numbering**, convert, release in `finally`. The duplicate-key fallback (`ventas_cotizacion_id_key`) now returns a contract **only if complete**, otherwise "in progress". The two silent inserts are checked (§1.4). The #63 offer path keeps its own atomic acceptance and does not use the claim. |
| `types/database.ts` | Types of the new RPCs. |

### 1.3 Evidence — real actions, separate sessions
Driver: `supabase/scripts/recorrido_block1.sh` + `recorrido_block1.mjs` (+ `fixture_recorrido_block1.sql`). It creates a disposable database from a replay of migrations 001–326 plus 334–337, a PostgREST in its own network, a minimal GoTrue, and imports the **real** `convertirCotizacion`/`crearCotizacion`/`generarTarifario`/`guardarTramosContrato`/`generarVoucherVuelo` (only `next/headers`, `next/cache`, `server-only` are replaced; the cookie is scoped per call with `AsyncLocalStorage`, so users act simultaneously with their own sessions). The **pause** is an HTTP gate in the driver's proxy that holds the winner's `POST /contrato_hoteles` (header committed, passengers/seats already taken, financiero still pending). The **downstream failure** is a throw-away trigger (`public.t_gate_hotel`) that raises on that insert. Raw logs: `docs/tecnico/evidence-block1-r2/recorrido_block1.log`; negative control: `docs/tecnico/evidence-block1-r2/negativo/recorrido_block1.log`.

Scenarios (all green with the fix; counts in §6):
- **S1** winner paused after its header; loser from another session; a third session (administración). Loser: *"ya se está convirtiendo"*, **no number spent**, still one header, quotation **not** marked converted. Release: winner completes with **its** number; the replay returns the same contract and spends nothing. Exactly one number for the whole scenario.
- **S2** same pause, then the winner's hotel insert **fails** (injected): header, passengers, payables ("previstas"), items gone; quotation unchanged (`abierta`, no number); claim released; the retry builds one complete contract.
- **S3** five rounds of two sessions starting at the same time: always one complete contract and one number; each answer is either the same completed contract or "in progress".
- **S4** lease semantics: a live lease with no header blocks without spending a number; an expired lease is taken over; a user of the other agency is refused before any claim or number.
- **S5a/S5b (backstop, real)** the loser is paused right before it spends a number, its claim is removed (as if expired and taken over), the winner converts, then the loser resumes: it numbers and hits `ventas_cotizacion_id_key`. Against an **incomplete** header it answers "in progress" (S5a); against a **complete** header it returns that contract and links the quotation (S5b). This is the **only** path that can burn a number (two numbers, one contract).
- **Flight origins** (`origen`): the real generator publishes a package with a negotiated block (10 seats) and two Promociones (one **without** record, one **with** record). For each: winner paused → loser in progress; the winner holds its 2 seats while pending (availability 10→8) and the loser changes none; completion leaves 2 seats `en_plazo`; the shared Promoción row is **byte-identical** (md5) after conversion and after the injected failure; after the failure seats are released (availability restored) and the retry builds one complete contract; the contract carries the record of the Promoción when it has one and none when it has not.
- **Record entered later** (Promoción without record): `control_vuelo` saves the record from the contract editor (real `guardarTramosContrato`): stored on every leg of **that** contract only; the Promoción row and the sibling contract are unchanged; the identical save again is idempotent.

**Negative control** (`RB1_PREVIO=1`): the round-1 behaviour (no claim, any existing header returned as success) is rebuilt from the current file in a temporary module and run through the same scenarios: **15 of 27 checks fail** — the loser returns success for the pending header, the quotation is marked converted, two numbers are spent for one conversion, a lost claim is not noticed, and after the injected failure a converted quotation points at an incomplete contract. This reproduces F1 with the real action.

### 1.4 Defect found by the injection (fixed)
`reservarDesdeTarifarioInterno` ignored the error of `contrato_hoteles` and of `contrato_items` (non-#63 branch). With the injected hotel failure the contract finished "complete" without its hotel. Both inserts now `fallarYRevertir` (same as the vuelo/pasajeros/#63 steps).

### 1.5 Number accounting and limits
- Concurrent or replayed identical conversion: **0 extra numbers** (S1/S2/S3/S4, flight origins).
- A winner that fails after numbering burns **its own** number (unchanged: the consecutive-reuse switch of 287 is OFF by default). The retry takes a new one.
- S5: a loser that lost its claim mid-flight burns one (documented above).
- The claim lasts 300 s; a conversion running longer could be joined by another attempt, which the unique key and `financiero_estado` still stop (S5).
- `convertirCotizacionCarrito` (multi-contract cart conversion) is a different flow and was **not** touched.
- The #63 offer path was not exercised by this driver (unchanged code, own acceptance).

## 2. F2 — air voucher: atomic, idempotent, one per contract

### 2.1 What changed
| File | Change |
|---|---|
| `supabase/migrations/20260601000337_voucher_vuelo_atomico.sql` | Partial unique index `vouchers_vuelo_uno_por_contrato (numero_contrato) WHERE tipo = 'vuelo'` (refuses to install if a contract already has more than one; nothing is deleted) and `guardar_voucher_vuelo(p_numero, p_contenido)`: ONE `INSERT … ON CONFLICT … DO UPDATE`, **SECURITY INVOKER** (RLS of `vouchers` and the contract identity guard apply as before). |
| `.../contratos/[numero]/voucher-actions.ts` | `generarVoucherVuelo`: contract, legs **and passengers** reads are all checked (a failed read is an error, never an empty list); saves through the RPC; no DELETE. |

### 2.2 Token behaviour (explicit)
Regenerating **updates the same row**: `id` and `share_token` (the public link already issued) do not change and the link shows the regenerated content. A failed regeneration changes nothing. Hotel and service vouchers keep their previous behaviour (regenerated services get new rows/tokens). Known interplay: the "documents since acknowledgement" signal of Gestión de contratos (309) counts vouchers and their max id, so an in-place regeneration does not raise "new documents". If the owner wants a changed air voucher to count as new, that is a product decision (a version column or a new row).

### 2.3 Evidence
Real action + database (`recorrido_block1`, group V): first call creates one voucher; the PNR is not in the stored content; regeneration keeps id **and** token and shows the new content; a replay by another operator keeps one row; hotel/service vouchers are byte-identical (md5 of id/token/content) after the air voucher was generated twice **and** after the real `generarVouchersServicios` ran; an injected failure while saving keeps the previous voucher and token (and creates nothing on a first generation; the retry succeeds); two simultaneous first generations (both held at the HTTP layer and released together) end with **one** row, one of them created it; a failed passenger read and a failed flight read are rejected with the voucher unchanged; `venta` (owner or not), `control_vuelo` and the other agency are refused and nothing changes; `operaciones` can regenerate; a contract without legs produces no voucher.
SQL (`supabase/scripts/test_336_337_conversion_voucher.sql`, 21 checks): create/update-in-place (same id and token), the unique index (23505 on a second air voucher; several service/hotel vouchers still allowed), invalid content rejected, RLS (venta writes only its own contract; a colleague's contract is refused and nothing is created), anon cannot execute, and a **negative control** showing that DELETE-then-INSERT with a failing INSERT leaves no voucher.
Pre-existing limitation, unchanged: `venta` cannot read `ventas`, so none of the contract voucher actions (hotel, services, air) work for that role ("Contrato no encontrado", nothing written).

## 3. F3 — editor link = the list's predicate

`lib/vuelos/empaquetadoContrato.ts` (a narrower copy of the rule) is **removed**. The contract page now asks the same authoritative source as the list and the editor: `ventas_vuelo_sistema`, selecting only `numero_contrato`, and only when the viewer's role is one of `ROLES_EDITOR_VUELOS_CONTRATO`. `venta` never issues the query, and the key-only select exposes no cost anyway. A failed read hides the link.
Proof (`origen` group, real client under each session): a dynamic contract with a saved leg and **no airline** qualifies for administración, operaciones and control_vuelo; a genuine land-only dynamic contract returns no row; a Promoción contract qualifies; `venta` and the other agency never get a row. In the compiled page (§4): the link is present on 9701 and on the leg-only contract 9702, absent on the land-only 9704 and for the `venta` owner of 9705, and clicking it lands on `/dashboard/vuelos/contrato/DTM-9701`.
The business definition of "has air" (§5 item 3) still needs the owner; both the list (335) and the link follow whatever the view says.

## 4. F4 — compiled-build inspection, wording, owner gates

### 4.1 What was inspected
The **final production build** (`BUILD_ID wVj0gCNVGUu7TMSMiifjm`, `next build` exit 0, `tsc --noEmit` clean) was served with `next start` against the throw-away PostgREST (`supabase/scripts/visual_block1.mjs`, launched through `recorrido_block1.sh` with `RB1_SEMILLA`/`RB1_SCRIPT`) and driven with Edge headless over CDP at **1280 / 820 / 390 px**. The voucher was generated with the **real "Voucher de vuelo" button of the compiled contract page**, not with a test hook. Screenshots, PDFs and per-page rasters are in `docs/tecnico/evidence-block1-r2/visual/`; measurements in `visual_block1.json`; the console log in `evidence-block1-r2/visual_block1.log` (**0 failures, 32 measurements, 0 horizontal overflows, no page exceptions**).

| Page / variant | 1280 | 820 | 390 | PDF pages | Notes |
|---|---|---|---|---|---|
| Contract page 9701 (editor link + Vouchers panel + "Servicio aéreo" card) | ok | ok | ok | – | link "Registrar o editar vuelo y record →" visible, card shows the issued voucher |
| Editor `/dashboard/vuelos/contrato/DTM-9701` reached by **clicking** the link | ok | ok | ok | – | h1 = contract number; `control_vuelo` opens it directly |
| Air voucher 9701 (complete data) | ok | ok | ok | **1** | legs, times, baggage, passengers; no PNR anywhere on the page |
| Air voucher 9702 (legs with no airline/flight/date/times, no passengers) | ok | ok | ok | **1** | 15 × "No registrado" — every absent value is explicit, nothing inferred |
| Air voucher 9703 (4 legs, multi-city, 80-character airline, long baggage text, 14 passengers with 60-character names) | ok | ok | ok | **3** | each leg card is never split across pages; passengers and the notice land on page 3 |
| Contract document `/c/<token>` (#17) | ok | – | – | **4** | flight section shows airline, origin/destination, baggage, date — **no flight number, no times, no PNR** |
| Quotation document `/cot/<token>` (#17) | ok | ok | ok | **4** | `vuelo AV123 · 08:15–09:45` per leg and the flight-change notice **once** |
| Destination delete modal, destination used only as an air alternative | ok | ok | ok | – | `[modo=fusion]`: lists "1 destino aéreo alternativo de un paquete", asks for the destination to merge into ("Mover y eliminar"), never a plain delete |
| Destination delete modal, unused destination | ok | – | – | – | plain-delete modal, no alternatives text |

Role/eligibility checks on the compiled pages: administración sees the editor link on 9701 and on the leg-only contract 9702 (no airline, no times), **not** on the land-only 9704; the `venta` owner of 9705 is not offered the link and the Vouchers panel is read-only; `control_vuelo` reaches the editor URL directly.
Observed and **unchanged** (pre-existing, shared by every voucher type): the public voucher wrapper keeps its grey page background in the PDF (`printBackground`), visible as a thin grey band on the first/last page.
Not covered: the contract page as `venta` for a colleague's contract, the mobile editor with real leg edits, and any production data (everything above is synthetic).

### 4.2 Wording (no unsupported coverage claim)
"Los tramos aplican a la reserva completa" is **removed** from `VoucherVueloDocumento.tsx` and `lib/voucher/vuelo.ts`. The voucher now lists passengers and saved legs in separate blocks and states: *"Pasajeros y tramos se listan por separado: no hay registrada una asignación de pasajero a tramo."* Verified on the compiled page (all three variants) and by `voucherVueloAtomico18.wiring.test.ts`.

## 5. Owner decisions still open (nothing was invented; independent corrections continued)

1. **#18 PNR on the air voucher** — still omitted (the contract hides it); showing it, or only when `estado_emision = 'emitido'`, is the owner's rule.
2. **#18 one voucher per contract or per passenger** — implemented per contract. Per-passenger needs item 3.
3. **#18 passenger ↔ segment association** — no saved link exists; the voucher now says so explicitly. A rule (and the data to back it) is required before it can say who flies which leg.
4. **#18 token/versioning policy** (new, §2.2): regeneration keeps the same public link and does not raise the "new documents" signal of Gestión de contratos. Confirm that is what the owner wants.
5. **#37 definition of "has air"** — any saved evidence (leg row, non-blank airline, `costo_aereo > 0`, air payable). The preflight lists the contracts that would leave the list; the link now follows the view, so the owner's answer changes both.
6. Unchanged from round 1: shared Promoción record editability once contracts exist (#40); cross-country merge (#29, fails closed); `venta` cannot use contract voucher actions (read of `ventas` is blocked for that role — pre-existing).

## 6. Verification summary (all local, disposable)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` (final code) | exit 0, `BUILD_ID wVj0gCNVGUu7TMSMiifjm` |
| Real-action driver (`recorrido_block1.sh`: F1 S1–S5b, flight origins, F2 V1–V7, F3 view eligibility) | **77/77 OK** (`evidence-block1-r2/recorrido_block1.log`) |
| Negative control (`RB1_PREVIO=1`, round-1 conversion behaviour) | **15 of 27 checks FAIL** (`evidence-block1-r2/negativo/recorrido_block1.log`) — F1 reproduced with the real action |
| SQL `test_334_335_vuelos_destinos.sql` / `test_336_337_conversion_voucher.sql` | 38/38 and 21/21 OK on a replay of 001–326 + 334–337; the same batteries FAIL when the migrations are not applied (`evidence-block1-r2/sql_negative_control_migrations_not_applied.log`) |
| Preflight → apply → postcheck (334–337), one query each | all controls OK / no REVIEW on the clean replay (`evidence-block1-r2/sql_pre_post_tests.log`); `rollback_336_337_conversion_voucher.sql` verified on a copy (table, functions and index gone, no data touched) |
| Compiled-build inspection | 0 failures, 32 measurements, 0 overflows |
| Unit suite (`test:unit`) vs a clean `origin/main` worktree, by test NAME | branch 10,604 tests / 29 failing; `origin/main` 10,579 / 29; **the two failing-name sets are identical** (the 29 already fail on `origin/main`; not investigated). Two guards of mine had failed once (`identidad:n/a` comment, bare `return { ok:false }` after the insert) and were fixed by moving the duplicate-key handling into `resultadoDeConversionExistente` |
| React suite (`test:react`) by name | branch 2,148 / 26 failing; `origin/main` 2,148 / 26; **identical sets**. 12 B2B-conversion tests failed once because the in-memory test harness did not know the new claim RPCs: the harness (`pruebas/support/fechaNegocioArnes.ts`) now emulates them and `comisionReservaFlujo.react.ts` ignores them in its "nothing was called" assertion |
| `test:react:o1o4` / `test:react:resto` / `test:calendar` | 45/45 · 62/62 · 43/43 |
Lists and raw comparison: `evidence-block1-r2/tests_comparison.txt`, `*_failing_names_*.txt`.

## 7. Resource consumption (local measurements; hosted Vercel/Supabase cost NOT measured)

- **Conversion (non-#63)**: +3 small requests per attempt (state read, claim RPC, release RPC); a replay or a concurrent duplicate now stops after **1 read** (no numbering, no passengers, no reservation writes) — cheaper than before for the duplicate case.
- **Air voucher**: 1 RPC instead of DELETE + INSERT (one request fewer).
- **Contract page**: +1 key-only query on `ventas_vuelo_sistema` for the five editor roles only (none for `venta`). On 20,000 synthetic contracts a single-contract lookup took **0.8–3.5 ms** with the 335 view versus **0.3–3.0 ms** before it (`EXPLAIN ANALYZE`, local, three runs each).
- New table `cotizacion_conversion_reclamo`: at most one short-lived row per quotation being converted, deleted on release; expired rows are overwritten by the next attempt.

## 8. Files changed in round 2

New: `supabase/migrations/20260601000336_conversion_cotizacion_reclamo.sql`, `…000337_voucher_vuelo_atomico.sql`, `lib/cotizacion/conversionReclamo.ts`, `pruebas/voucherVueloAtomico18.wiring.test.ts`, `supabase/scripts/{recorrido_block1.sh, recorrido_block1.mjs, fixture_recorrido_block1.sql, visual_block1.mjs, semilla_visual_block1.sql, pdf_paginas_block1.mjs, test_336_337_conversion_voucher.sql, preflight_336_337_conversion_voucher.sql, postcheck_336_337_conversion_voucher.sql, rollback_336_337_conversion_voucher.sql}`, `docs/tecnico/evidence-block1-r2/` (raw logs, screenshots, PDFs, rasters).
Modified: `app/(dashboard)/dashboard/reservar/actions.ts` (claim, completeness, two checked inserts), `.../contratos/[numero]/page.tsx` (view-based link), `.../contratos/[numero]/voucher-actions.ts` (atomic air voucher, required reads), `components/voucher/VoucherVueloDocumento.tsx` + `lib/voucher/vuelo.ts` (wording), `types/database.ts`, `pruebas/empaquetadosConversion40.wiring.test.ts`, `pruebas/voucherVuelo18.test.ts`, `pruebas/support/fechaNegocioArnes.ts` (emulates the claim RPCs), `pruebas/comisionReservaFlujo.react.ts`.
Removed: `lib/vuelos/empaquetadoContrato.ts` (never committed).

## 9. How to re-run (all disposable; nothing touches the owner review databases)

```
cd dspacios-travel
docker start pgblock1        # container holding the template database plantillablock1 (migrations 001–326)
sh supabase/scripts/recorrido_block1.sh pgblock1 plantillablock1              # F1 + flight origins + F2 + F3 (77 checks)
RB1_PREVIO=1 RB1_ESCENARIO=f1 sh supabase/scripts/recorrido_block1.sh pgblock1 plantillablock1 <out_dir>   # negative control
# compiled-build inspection (build first with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399/__ NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-local-block1):
RB1_SEMILLA=supabase/scripts/semilla_visual_block1.sql RB1_SCRIPT=supabase/scripts/visual_block1.mjs RB1_LOG=visual_block1.log sh supabase/scripts/recorrido_block1.sh pgblock1 plantillablock1
node supabase/scripts/pdf_paginas_block1.mjs <visual dir> voucher-vuelo-DTM-9703.pdf:3 …    # per-page rasters of the PDFs
```
Not done / limits: no #63-offer conversion was driven (code unchanged); `convertirCotizacionCarrito` untouched; the baseline failures were not investigated; no production data and no hosted measurements.

