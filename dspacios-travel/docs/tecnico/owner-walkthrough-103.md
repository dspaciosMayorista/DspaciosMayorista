# Owner walkthrough — hotel calendar, tariff updates, supplier requests, promotion codes and supplier-payment notices (block #103)

Date: 2026-11-22 · Branch `claude/hotel-calendario-rendimiento-103` · For the owner. **Nothing is running right now.** The review session starts only when you ask for it. Everything below uses **synthetic data on your own computer**: no real customer, supplier, bank or mailbox is involved and **no e-mail leaves the machine** (outgoing mail is captured in a local inbox). The mail-policy questions that remain open are in a separate paper: [owner-mail-policy-decisions-103.md](owner-mail-policy-decisions-103.md).

## 1. Before you start

| Item | Where / what |
|---|---|
| Start (and resume) | Ask the executor, or run `node review.mjs start` in `supabase\scripts\hostinger_journey_103` (worktree `.worktrees\hotel-cal-103\dspacios-travel`). **First time ≈ 3–4 minutes. Every later time it RESUMES exactly where you left off** (no re-creation, no re-seeding). It prints «REVIEW SESSION READY» only after it has observed every service answering and the saved-account sign-in working; otherwise it says «NOT READY» and why. |
| Stop | `node review.mjs stop`. **It deletes nothing**: your database changes, uploaded proof files, captured mail, the simulated supplier mailbox, the configuration, the credentials sheet and the browser profile are all kept. You can stop and resume as often as you like. |
| Delete the review data | Only on your explicit, separate instruction (`node review.mjs reset --destroy-review-data`). Normal stop/start never does it, and the lower-level commands refuse to run over a seeded review. |
| Application | http://127.0.0.1:3047/login (only this computer can open it) |
| Captured outgoing mail (nothing is really sent) | http://127.0.0.1:19083 — a local inbox; refresh it after each send. It also keeps its messages across stop/start. |
| **Accounts** | Four synthetic accounts, one password, listed in `C:\Users\Usuario\hostinger-review-103\review_credentials.txt` (outside the repository): `admin103@walk.test` (administracion), `ops103@walk.test` (operaciones), `sup103@walk.test` (superadmin), `venta103@walk.test` (venta). **You do not need to type them** — see «Signing in» below. |
| Sample payment proof for W9 | `C:\Users\Usuario\hostinger-review-103\soporte-walk.pdf` (synthetic, created by the seed) |
| Data you will see | Hotel «Hotel Prueba 103» (CARTAGENA WALK) with season ALTA, two promotions («Promo Semana Santa» with code **SS-2027-X**, «Promo sin digitar» with a required but missing code), a general closure «Mantenimiento Walk» (10–12 Feb 2027), a saved date set «Semana Santa Walk» (25–28 Mar 2027), two packages carrying an «unfinished tariff update», contracts **DTM-2001** (Cliente Walkthrough, 3 travellers, one hotel stay, one transfer), **DTM-2002/2003** (payments), **DTM-2004** (Cliente Dos Estancias: two hotel stays of the same supplier), and payments of «Proveedor Pago 103». |
| Time | ≈ 45 minutes for W1–W11. |

**Signing in without typing.** Run `node review.mjs browser` (or `node review.mjs browser ops103` to propose another account first). It opens Microsoft Edge with a **dedicated review profile** (not your personal one) whose saved passwords are only the four synthetic accounts. Click the e-mail field, **pick the account from the list**, and press the normal sign-in button — the server authenticates exactly as always (no shortcut was added to the product). To change role: sign out in the application and pick another account from the same list. `review.mjs start` re-checks this with a real Edge each time.

**What is verified and what is not.**
- **Rehearsal (this round).** The exact W1–W11 sequence below, in this order, was executed by the executor on a **separate disposable fixture** (own folder, own dedicated database container; your review folder was not touched) through that same browser profile and real sign-in: **49 / 49 checks** in the final run (sign-in by saved account, W1–W11 including the optional steps). Two earlier rehearsal runs had found preparation defects (listed below), which were fixed and rehearsed again; their logs are kept. The same run then did a full `stop` → `start` cycle and compared fingerprints (database rows, uploaded file bytes, captured mail, simulated mailbox, files, saved accounts): identical. It also checked that destructive commands are refused over review progress.
- **Defects the rehearsal found and that are now fixed in the preparation (not in the product):** the closures block is on the **Configuración** tab, not Temporadas (W5 below says so); the first version of `stop` deleted the review data (now it deletes nothing); `down` stopped services before refusing a destructive command; the payment-proof upload (W9) needed file storage, which the review stack lacked; the dedicated database copy lost object ownership, which stopped the storage service from starting; restarting reordered the saved accounts (now the first proposal is kept); a stop/start can no longer report success without the state having been observed.
- **Still not verified:** the real Hostinger mailbox and notification, hosted behaviour, and the **owner-facing headed Edge dropdown** itself (a headless browser cannot open the dropdown; the executor verified that the saved account fills the form — fields in the browser's autofill state — and then signs in through the real Auth service for the three accounts the walkthrough uses: administracion, operaciones and venta; `sup103` is saved but was not used).

## 2. What the block does, in one paragraph each

1. **Hotel tariff updates and calendar.** Changing a hotel's validities, exclusions, closures or percentage promotions no longer makes the screen wait for every package to be regenerated: the change is saved at once, the affected combinations are hidden (never shown with an old price) and the packages are refreshed in the background. If something is left unfinished the screen says so and finishes it by itself.
2. **Exclusion calendar and named date sets.** Pick nights inside a validity that do not apply (e.g. 30–31 Dec) by clicking days; copy a saved set (e.g. Semana Santa) into a validity — a copy, not a live link.
3. **Promotion codes.** A promotion can require a code the supplier expects in the request.
4. **Supplier requests from a contract.** A structured e-mail (table + plain text) to a hotel/supplier with the holder, stays and traveller names/ages — **no prices**. If the stay falls inside a coded promotion, the sender must choose the code or declare «no usa la promoción».
5. **Supplier replies.** A reply updates the card to «Respondió» and creates notices. **A reply never confirms or rejects anything by itself.**
6. **Supplier-payment notices.** From payments already registered, prepare a notice for one supplier (partial payments, USD with exchange rate, totals per currency), attach proof, preview and send. Sending never changes payments, accounting entries or bank reconciliation.

## 3. Steps

Sign in with the account named in each step (see «Signing in without typing»). Use a normal browser window; for W11 narrow it. Steps build on each other (W3–W5 change the sample hotel; W6–W8 use the same contract), so follow the order.

### W1 — An unfinished tariff update finishes by itself (admin103)
1. Open the page of **Hotel Prueba 103**, tab **Temporadas** — direct address: `http://127.0.0.1:3047/dashboard/producto/hoteles/20301?tab=temporadas`.
2. Do **not click anything**; watch the top of the page for up to one minute.
- **Expect:** an amber notice about packages not yet updated («Quedaron 2 paquetes sin actualizar…» or «Completando la actualización de tarifarios automáticamente…»); it **disappears by itself** within about a minute. Reload the page: **no notice**. (This sample «unfinished update» is consumed the first time; after a stop/resume it does not come back.)

### W2 — Promotion codes (admin103, same page and tab)
1. Scroll to the promotion-codes section.
- **Expect:** «Promo Semana Santa» shows the code **SS-2027-X** with the note «Pedir en el asunto»; «Promo sin digitar» shows the amber warning **«Exige código pero no se ha digitado»**.

### W3 — Exclude two nights in a validity (admin103, tab Temporadas)
1. In the validity list press **Editar** on **ALTA**.
2. In the exclusion calendar choose month **diciembre 2026** and click **30** and **31**.
3. Press **Guardar cambios**. Then press **Editar** on ALTA again and open December 2026.
- **Expect:** the two days appear as excluded; after saving, an update notice may appear briefly and clears by itself; on reopening, **30 and 31 December are still excluded**.

### W4 — Copy a saved date set (admin103, tab Temporadas)
1. Press **Editar** on **Promo Semana Santa**.
2. In the saved-sets selector choose **Semana Santa Walk (2027)** and press **Aplicar (copiar fechas)**.
3. Press **Guardar cambios**.
- **Expect:** **4 nights (25–28 March 2027)** are marked excluded in that validity. (The set is copied, not linked: changing the saved set later does not change this validity — the executor can show it on request.)

### W5 — General closure («Black out general») (admin103, tab **Configuración**)
1. Open the hotel page on its default tab: `http://127.0.0.1:3047/dashboard/producto/hoteles/20301` (tab **Configuración**). The **Black out general** block is there (not on Temporadas). Open it: it lists **Mantenimiento Walk** (10–12 Feb 2027).
2. Delete it.
- **Expect:** the row disappears **without reloading**, with a message that the tariffs are being updated; reload: still gone.

### W6 — A supplier request with a promotion code (admin103)
1. Open contract **DTM-2001** (`http://127.0.0.1:3047/dashboard/contratos/DTM-2001`) → section **«Solicitudes a proveedores por correo»**. A line states «Modo de captura local: el correo NO sale de esta máquina.»
2. **Proveedor:** `Hotel Prueba 103` · **Correo(s) del proveedor:** `reservas@walk.test` → **Vista previa**.
3. The preview asks you to choose the code: **«Código de promoción exigido por el hotel»**. Note that **Enviar solicitud** is disabled. Choose **Promo Semana Santa — SS-2027-X**.
4. Press **Enviar solicitud**. Press it **a second time**.
5. Open the local inbox (http://127.0.0.1:19083).
- **Expect:** «Solicitud enviada»; the history shows **Enviada** with **Código SS-2027-X**; the second press sends nothing; the inbox holds **exactly one** message to `reservas@walk.test` with an HTML table and a plain-text part containing the code **SS-2027-X**, the holder, and the three travellers (**Ana Walk, Luis Walk, Sofía Walk**), **no prices**, and a Reply-To of the form `respuestas+<long token>@walk.test`.
6. Optional: **Proveedor** `Receptivo 103`, **Correo(s)** `tours@walk.test` → **Vista previa**: the transfer «Traslado aeropuerto – hotel» is listed and there is **no code section**.

### W7 — Two stays of the same supplier, each with its own code (admin103)
1. Open **DTM-2004**. In «Solicitudes a proveedores por correo» type **Proveedor** `Hotel Prueba 103`, **Correo(s)** `reservas@hotel.test`. The block **«Estancias de esta solicitud»** lists both hotels: Hotel Prueba 103 and Otro Hotel 103.
2. With both ticked press **Vista previa**.
   - **Expect:** blocked with a clear message: one request carries one code — send one hotel per request.
3. Untick **Otro Hotel 103** → **Vista previa** → choose the code **SS-2027-X** → **Enviar solicitud**.
4. Tick **Otro Hotel 103**, untick **Hotel Prueba 103** → **Vista previa** → choose **Promo Otro Hotel — OTRO-CODE** → **Enviar solicitud**.
- **Expect:** **two** messages in the local inbox: one with **SS-2027-X** and only the first stay, one with **OTRO-CODE** and only the second stay; **no message carries both codes**; two requests in the history.

### W8 — The supplier replies (admin103 + one command)
1. After W6, play the supplier's reply with **either** of these (same settings, from any new terminal window, in `supabase\scripts\hostinger_journey_103`):
   `node review.mjs reply DTM-2001 "Confirmamos disponibilidad con el código."`
   or `node review_reply.mjs DTM-2001 "Confirmamos disponibilidad con el código."`
   It places the reply in a **simulated** mailbox and triggers the application's real inbound route — the same thing Hostinger's notification would do. The executor can run it for you.
2. Reload contract **DTM-2001**.
- **Expect:** the request shows **«Respondió»** and the reply text; a line **«1 respuesta(s) nueva(s) · marcar leídas»**; it is **not** shown as confirmed by the supplier («Confirmada por el proveedor» does not appear). Press **marcar leídas**: the count disappears (only for this contract). The local inbox gains one **internal notice** «Respuesta del proveedor · …» to `interno@walk.test`.

### W9 — A supplier-payment notice (ops103)
1. Sign in as `ops103@walk.test`. Open `http://127.0.0.1:3047/dashboard/pagos/avisos` — the screen titled «Aviso de pago a proveedores».
2. **Proveedor:** `Proveedor Pago 103`.
   - **Expect:** four payments listed: **DTM-2001 COP 1.500.000** (a partial of a 4.000.000 obligation), **DTM-2002 COP 2.500.000**, **DTM-2003 USD 100,00 (TRM 4000)** and **USD 50,00 (TRM 4100)**.
3. Tick all four («Incluir el pago…»). Under «Subir soporte de los pagos marcados» choose `C:\Users\Usuario\hostinger-review-103\soporte-walk.pdf` → **Guardar soporte**.
   - **Expect:** «Soporte guardado. Aún no se ha enviado nada». (The file goes to the stack's real file storage and survives stop/resume.)
4. Tick the attached file next to the payments. **Referencia del pago (opcional):** `TRF-WALK-889`. **Correo(s) del proveedor:** `pagos@proveedor-walk.test` → **Vista previa**.
   - **Expect:** a relation of **3 reservations**, the partial («esta vez 1.500.000 de 4.000.000», cumulative), USD lines with their rates, **separate totals per currency (COP 4.000.000; USD 150,00)** and the file name.
5. Press **Enviar aviso**; press it again.
   - **Expect:** exactly **one** message in the local inbox with the **PDF attached** (same size, 1.869 bytes) and the text «AVISO DE PAGO»; the second press sends nothing; «Avisos enviados» lists it as **Enviada**, not confirmed or reconciled; payments, accounting entries and bank reconciliation are unchanged (the executor can show the before/after counts).

### W10 — A sales advisor cannot reach these screens (venta103)
1. Sign in as `venta103@walk.test`. Try `/dashboard/pagos/avisos`, the hotel page of W1 and contract DTM-2001.
- **Expect:** the notice screen and the hotel page are refused/redirected; on the contract, the section «Solicitudes a proveedores por correo» is **not present**.

### W11 — Phone width (optional)
Narrow the window to about 390 px on W1 and W9.
- **Expect:** no sideways scrolling of the whole page; on W9 the payments table scrolls sideways **inside its card** (amount and proof columns need a swipe) — acceptable, not polished.

## 4. What this walkthrough cannot show

- **Real mail.** Outgoing mail goes only to the local inbox; the reply in W8 comes from a simulation. Whether the real Hostinger mailbox accepts the reply address with the token, and what its notification really contains, are **unverified** and are part of the mail decisions.
- **Hosted behaviour.** Duration limits, request cost and the scheduler of the real hosting are unmeasured.
- **Automatic inbound reading.** With the entry switched on, a reply is recorded when Hostinger notifies or when the daily drain runs — W8 triggers it by hand.

## 5. Evidence behind these steps

`supabase/scripts/hostinger_journey_103/` — `rehearsal_walkthrough.mjs` and its evidence (`evidence_rehearsal_*`), `checks_review.mjs` (failure reporting and shared settings, no services), journey 32/32, harness checks, PostgreSQL ownership checks; and `docs/tecnico/hotel-calendar-performance-email-delivery-2026-11-22.md`, `hostinger-entrada-103.md`. The build under review is `.next/BUILD_ID IPfbW6qGGDVtuQda4XvBH`, source fingerprint `1a60f0e3c5fa791147bb7a1f4bac67a2c8d94a9ba095bab09ef7e28919f00bd6` (1,061 files). Migrations 327–330 exist only as files and on disposable databases; nothing is applied to your real database by this walkthrough.

## 6. Result sheet (tick while walking)

| Step | Worked as expected? | Notes |
|---|---|---|
| Sign in with the saved account list | ☐ yes ☐ no | |
| Stop and start again: nothing lost | ☐ yes ☐ no | |
| W1 update finishes by itself | ☐ yes ☐ no | |
| W2 promotion codes | ☐ yes ☐ no | |
| W3 exclude nights | ☐ yes ☐ no | |
| W4 copy a saved set | ☐ yes ☐ no | |
| W5 general closure | ☐ yes ☐ no | |
| W6 request with code | ☐ yes ☐ no | |
| W7 two stays | ☐ yes ☐ no | |
| W8 supplier reply | ☐ yes ☐ no | |
| W9 payment notice | ☐ yes ☐ no | |
| W10 advisor limits | ☐ yes ☐ no | |
| W11 phone width | ☐ yes ☐ no | |
