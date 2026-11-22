# Consolidated owner review — revision 3 (migration 325: proof before confirmation, ally passengers, guardian, recovery)

Prepared 2026-11-21 on the existing final build **`eryDMK_D8Xe0Ho3PLKa0i`** (no rebuild, no product change). **Status: PREPARED, NOT ACCEPTED.** Codex closed R325-1, R325-2 and R325-3; owner acceptance and publication are pending. Local only: nothing here touches production, `aiomotor-db` or any remote service.

## 0. Start, stop, URL (unchanged launcher)
* **Open `http://localhost:3070`** (never `127.0.0.1:3070`). Test mailbox (codes and recovery e-mails): `http://127.0.0.1:54383`. Password of every synthetic account: **`Revision2026!`**.
* The review browser with the 15 saved logins is unchanged: `powershell -File supabase\scripts\localreview_integrado\navegador_revision.ps1` (dedicated Edge profile; saved credentials and its state were not touched).
* Stop: `powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 detener` (databases are kept). Start again: `… iniciar` (≈25 s; it never prints «Lista» unless every gate is healthy).
* **Already running now**: the launcher printed «Lista» and the independent checks below passed.
* ⚠ **Do not use `restaurar -Confirmar` casually:** it discards ALL review progress and restores `rev_verif_int_revision_pristina`, which does **not** contain migration 325. If you ever restore, re-apply it first: `bash supabase/scripts/localreview_integrado/aplicar_migraciones.sh pgb2b rev_verif_int_revision 325`.

## 1. What was done to your review data (and what was not)
| Item | Result |
|---|---|
| Backup before touching anything | `%LOCALAPPDATA%\dspacios-local-revision-int\rev_verif_int_revision_pre325_20261121_1505.dump` (custom format, 3.7 MB; read back with `pg_restore -l`: 5 333 entries, 262 table-data entries) **and** a copy of the stored files `storage_pre325_20261121_1505` (29 files, identical count). The pre-change fingerprint of the database (249 tables, count + md5 of every row) equalled the one taken before round 1 (`c66a9e530f0ac2cc`). |
| Migration 325 | `aplicar_migraciones.sh pgb2b rev_verif_int_revision 325`: **preflight 7 controls OK → migration applied → postcheck 8 controls OK** (it stops on the first REVISAR/FALLO or SQL error; none occurred). |
| Effect on your data | Fingerprint after: 251 tables. The **only** differences: two new **empty** tables (`cotizacion_evidencias`, `cotizacion_pasajeros_aliado`) and one new row in `storage.buckets` (private bucket `evidencias-cotizacion`, no policies). Every pre-existing table, row and stored file is byte-identical. After starting the stack the fingerprint is **unchanged** (no startup side effect). |
| Not done | No reset, restore, reseed or state-changing test on your data; `rev_verif_int_revision_pristina` and `storage_pristina` untouched; the disposable copy `rev_verif_int_o3b` (where the executor ran its journeys) is separate. |
| Health gates | Launcher «Lista»; Auth health 200; PostgREST 200; test mailbox 200; app `/login` 200 and `/tarifario` 200; the app listens **only** on 127.0.0.1; the new tables answer 200 with the service role and are **refused (401) for anon**. |
| Your review progress seen intact | 16 active synthetic accounts, 7 quotations (`C-0001…C-0006`, `C-REV78`), 88 contracts, 59 payments, 1 open contract request (C-REV78) — unchanged. `continuar@revision.test` was already approved by you; `continuar2@revision.test` is still a pending, verified, inactive registration. |

## 2. Focused walkthrough of the corrected flows
Roles are the real ones (no superadmin substitute is needed anywhere below). Create **new** quotations for the flows that write data, so the records you already reviewed (C-0001…C-0006, C-REV78) stay as they are.

### H1. Proof before confirmation (evidence), cart quotation — Camila → administración
1. **Entry rule first (S).** Camila (`freelance@revision.test`): `/tarifario` → «Porción terrestre» → **CARTAGENA O3** → 10/06/2030 → 13/06/2030 · 2 adults · 1 room → «Agregar al carrito» → checkout: Nombres `Laura`, Apellidos `Vega Demo`, Tipo **`CE`**, Documento **`E1234567`**, Teléfono `3105550199` → «Generar…». *Expect:* refused on the spot — «El número de documento debe ser solo números (excepto Pasaporte y PPT)». Change the type to empty → «Elige el tipo de documento…». Use CE and **`1234567`** → the quotation is generated.
2. `/portal/b2b/cotizaciones?vista=asistidas` → that quotation → open **«Preparar la solicitud (opcional)»**. *Expect:* «Comprobantes de pago … **Adjuntar un comprobante no registra ni aprueba ningún pago**».
3. Attach `%LOCALAPPDATA%\dspacios-local-revision-int\muestras\firma-camila.png` → listed with name/size/date. A `.txt` renamed or not (or text named `.png`) → «Solo se admiten archivos PDF, JPG o PNG». The same file again → no duplicate. A second file (`logo-camila.png`) → 2 listed; the bin icon retires one (it disappears from the list; the file is kept). Up to 5 active files.
4. «Solicitar contrato» on the same row (a separate, explicit action).
5. `administracion@revision.test`: the bell says «Solicitud de contrato de un aliado: cotización C-…» → it opens the quotation. *Expect, above «Confirmar → generar contrato»:* **«Evidencia previa del aliado (N vigente)» — «Es evidencia adjunta por el aliado, no un pago»** with an «Abrir» button per file (opens the exact image/PDF). Opening it changes nothing.
6. After generating the contract (H3), `/dashboard/contratos/<n>` shows the same panel above the tabs («Revísala antes de registrar un abono»). **No payment exists** until staff register one in Cartera → «Registrar abono»; do that yourself and see that the evidence list does not change and nothing links itself.
7. Isolation (optional): `freelance2@revision.test` (Beto) sees none of Camila's quotations, files or passengers; `minorista@revision.test` (other agency) cannot open the quotation.

### H2. Ally passengers, optional — same quotation, before step 4 or after
1. In the same panel, **«Pasajeros adicionales»** (up to *travelers − 1*; with 2 adults → 1): «Agregar pasajero» → Nombres `Marco`, Apellidos `Vega Demo`, Tipo `CE`, N° doc `E7654321` → «Guardar pasajeros». *Expect:* «Pasajero 1: el documento debe ser solo números (excepto Pasaporte)» (the same rule as the conversion). Change to `7654321`, Nacimiento `02/02/1987` → saved; reload the page → still there. The name/last name are the only required fields; document and birth date may stay empty.
2. **Restrictions are explicit, not silent.** A dynamic quotation (e.g. `C-0006` if it appears in Camila's list) shows «se convierte con el titular… no admite pasajeros adicionales» and offers no editor; a quotation that already carries passengers says «ya trae sus pasajeros… no se reemplazan desde aquí». `C-REV78` (an ordinary quotation, no passengers) offers the editor — **do not convert C-REV78**: it is a synthetic quotation with an empty payload, built only to show the panel.
3. (Staff conversion in H3 shows the saved passengers already written in the rows.)

### H3. Conversion by the real recipient role — administración (advisor selector)
1. `administracion@revision.test` → the quotation from H1 → «Confirmar → generar contrato». *Expect:* **«Asesor interno que gestiona *» lists 3 advisors — Rev Venta, Rev Venta Dos, venta127** (before this correction the list was empty for this role). The list shows only active `venta` users of this agency; nothing else about users is exposed.
2. The titular is row 1 (Laura Vega Demo, CE 1234567); **row 2 is Marco as the ally wrote him** (CE 7654321, born 02/02/1987) — nothing retyped. Complete what the checkout does not ask (the titular's birth date), choose an advisor and «Moneda de cobro…» → «Generar contrato(s)». Leaving the advisor empty is refused and creates nothing; a CE number with letters in row 2 is refused before sending.
3. The contract keeps both passengers exactly; the quotation now says «Convertida en…» and offers no second conversion.

### H4. Infant and responsible adult (guardian) — cart path
1. Camila: `/tarifario` → «Porción terrestre» → **DEMO 125** → **04/12/2026 → 09/12/2026** (the package is sold 2026-12-01 → 2026-12-31 and today is 2026-11-21; use dates inside that window) · 2 adults · 1 room · **minors with ages 8 and 1** → add to cart → checkout (titular `Nora Prueba Menores`, CE `5555001`) → generate.
2. In the portal panel add three passengers: `Marco Prueba Menores` CE `7654321` born `02/02/1987`; `Sol Prueba Menores` **TI** `1020304050` born `15/06/2018`; `Bebe Prueba Menores` **RC** `1111222233` born `10/03/2025` → «Guardar pasajeros» → «Solicitar contrato».
3. `administracion@` → the quotation → «Confirmar → generar contrato». *Expect:* 4 rows precharged; row labels «Niño · 8a» and «**Infante · 1a**»; under the infant **«Adulto responsable *» left on «Sin vincular (se rechazará al generar)»** — nobody chose a guardian. Complete the titular's birth date, advisor and billing currency, then press «Generar contrato(s)» **without** choosing: *Expect:* refused with the guardian message and no contract. Choose «Marco Prueba Menores» → generated. The contract lists the infant as infant linked to Marco.
4. **Ordinary (non-cart) quotations** now show the same selector, and a rejected attempt no longer spends a contract number. Your data has no ally-owned, convertible, non-cart quotation (the review seeds don't include one and nothing was seeded now), so this path is **executor-verified only** (fixture on a disposable copy; round-3 evidence). If you want to see it yourself: Camila → `/tarifario` → «Hoteles bajo solicitud» (e.g. «Hotel Solicitud Humo») → «Solicitar cotización» → staff load the net price on that quotation → then the ordinary conversion screen appears; it is a long route and optional.

### H5. Recovery and registration (retained checks, unchanged)
* **G4 «Olvidé mi contraseña» from «Continúa tu registro»**: use **`continuar2@revision.test`** (still pending): `/portal/registro` → Tipo `freelance`, Nombre `Aliado Continuar Demo Dos`, CC `1010101011`, correo `continuar2@revision.test`, password `ClaveContinuar-2026` → «Continuar: enviar código al correo» → «Continúa tu registro» → «Olvidé mi contraseña» → recovery e-mail in the mailbox → new password → back to «Continúa tu registro» → continue with the NEW password → «¡Solicitud enviada!» (exactly one request; `administracion@` → Aprobaciones B2B shows it). Full steps: `integration-126-127-b2b-owner-walkthrough-2026-11-20.md` §G4.
* **E.3 (brand-new registration with a typed code)** is still **your** check and not accepted: `nuevo.aliado@revision.test` has not been registered yet (steps in §E of the same document).

### H6. Previously accepted checks (retain; no change expected)
#126 (A/A2), #127 (B), Portal B2B C/D, O-1 (G1) and O-2 (G2, including the modal reached from the recommended card — the compiled modal was exercised by the executor) are untouched by this round. Quick regression glances: G2 search (minors 8 and 2 → 750.000 total), G1 (no internal diagnostic for visitors/allies).

## 3. Honest limits of this review package
* H1–H4 write data in **your** review database; they are meant for you to run once. If you want to redo them from the initial state, `restaurar -Confirmar` discards all progress (and the 325 tables — see §0).
* The proof that races (simultaneous uploads), the non-cart infant path and the minor/infant persistence work was run by the executor on a disposable copy and audited by Codex; none of it was replayed here.
* Open decisions that are **not** approved by this package: retention of retired evidence (files are never deleted), whether `venta` should see evidence, whether evidence should also be attached to payments, the contract page's «Editar asesor» selector, hosted (Vercel/Supabase) consumption, E62.3 and #126-E Preview/real-data gates.
