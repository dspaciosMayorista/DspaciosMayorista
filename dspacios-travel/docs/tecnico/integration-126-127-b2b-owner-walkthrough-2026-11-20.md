# Consolidated owner review — #126 + #127 + Portal/B2B (one walkthrough)

**Revision 2 (owner feedback O-1…O-4, 2026-11-20): sections G1–G4 and the notes in C.7, C.8 and E.2 are new; everything the owner already accepted is unchanged. G is awaiting Codex audit before renewed owner review (evidence: `owner-feedback-o1-o4-evidence-2026-11-20.md`).**

**Status of revision 1: PREPARED AND EXECUTED, NOT YET HANDED TO THE OWNER.** It goes to the owner only after Codex approves the evidence (`integration-126-127-b2b-int1-int3-evidence-2026-11-20.md`). Local only; synthetic and copied data; nothing here touches production, `rev_revision` (pg304) or `aiomotor-db`.
Every step below was executed exactly as written, with the roles named, by `supabase/scripts/localreview_integrado/guion_revision_integrada.mjs` on a fresh clone of the seeded review database: **127 checks, 0 failures** (the clone was deleted; the review database is untouched, see §0).

## 0. Start, stop, URL
```
powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 iniciar    (≈25 s; fails with a non-zero exit and a log path if anything is unhealthy — it never prints «Lista» in that case)
powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 detener    (databases are kept)
powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 estado
```
* **Always open `http://localhost:3070`** (never `127.0.0.1:3070`): the build, the Auth site URL and the cookies use the name `localhost`. Next listens on `127.0.0.1` only (not reachable from the network).
* Test mailbox (verification codes): `http://127.0.0.1:54383`. Codes are valid for **600 s**.
* Database `rev_verif_int_revision` in container `pgb2b` = copy of the owner-review data + migrations 312–324 + synthetic examples. **Password of every account: `Revision2026!`** (except the two pending registrations, §E).
* **Review browser with the accounts already saved (no typing):** `powershell -File supabase\scripts\localreview_integrado\navegador_revision.ps1` opens a **dedicated Microsoft Edge profile** (`%LOCALAPPDATA%\dspacios-local-revision-int\edge-perfil`, separate from your personal Edge) at `http://localhost:3070/login`. Its saved passwords are **only the 15 synthetic `@revision.test` logins**; click the e-mail field and **pick the account from the list** (Edge fills e-mail and password), then «Acceder…». It does not change the product login. If you ever need to rebuild it: close that Edge window and run `navegador_revision.ps1 -Preparar` (it re-seeds and re-checks that Edge fills the form).
* Needs ≈1.5 GB RAM. Migrations 312–324 are applied in this copy only, not in production.
* Mayorista has a synthetic RNT here (`RNT-REVISION-SINTETICO`); with real data an empty RNT blocks Mayorista documents by design (#49).
* **Several steps change data and cannot be repeated identically** (accepting a version, registering payments, sending a request). To redo the whole review from the initial state: `powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 restaurar -Confirmar` (discards ALL review progress; restores the pristine copy `rev_verif_int_revision_pristina` and its storage; without `-Confirmar` it refuses), then `iniciar`.

### Synthetic examples added for this review (additive, idempotent: `sembrar_revision_integrada.mjs`)
| Record | Value |
|---|---|
| Freelance **Camila Ríos Demo** | account `freelance@revision.test`, ficha 96701, CC 1020304050, Bancolombia Ahorros 00096701234, retención 10 %, comisión 11 % |
| Freelance **Beto Viajes Demo** | account `freelance2@revision.test`, ficha 96702 (isolation counterpart) |
| Contract **DTM-96701** (Camila) | Ana Gómez · SAN ANDRÉS · salida 15/03/2027 · PVP $ 5.000.000 · base comisionable 4.000.000 × 11 % = **440.000** · retención 10 % = **44.000** · **total a cobrar 396.000** |
| Contract **DTM-96702** (Beto) | Luis Mora · CARTAGENA · 20/03/2027 · PVP 3.000.000 · comisión 275.000 · total 247.500 |
| Contract **DTM-96703** (agency «Rev Aliado Uno», `aliado@revision.test`) | Marta Ruiz · SANTA MARTA · 10/04/2027 · PVP 4.000.000 · comisión 320.000 (agency path) |
| Quotation **C-REV78** (Camila, direct) | $ 1.800.000 · CARTAGENA · 20/03/2027 → 24/03/2027 · valid until 28/02/2027 |
| Quotation **C-0006** (assisted wording, created by `administracion@` for Camila) | $ 5.000.000 · Cartagena · 20/03/2027 · valid until 28/02/2027 · public link `http://localhost:3070/cot/60a668e6-220f-4a23-aff4-95177abf4914` |
| Pending registrations (verified, no request) | `continuar@revision.test` / `continuar2@revision.test`, registration password `ClaveContinuar-2026` |
| Sample images | `%LOCALAPPDATA%\dspacios-local-revision-int\muestras\firma-camila.png`, `logo-camila.png` |
| Request recipient (#78) | `config_solicitudes.emails` = `administracion@revision.test` (was empty) |
| #126 | contract `DTM-12601` (USD 1.000, pending, **no payments yet**, linked to ally `aliado@`), `DTM-12602`, `DTM-12603`, `DTM-12611…12616` (dates below) |
| #127 | hotel `GRAND SIRENIS CARTAGENA 127` (id 12701), `HOTEL OTRO CARTAGENA 127` (12702), package 12701, accounts `admin127@revision.test`, `venta127@revision.test` |

### Before the #126-E step on a later day
The six contracts DTM-12611…12616 were dated relative to **2026-11-20** (Bogotá). If you review on another day run once:
`docker exec -i -e PGPASSWORD=postgres pgb2b psql -h 127.0.0.1 -U supabase_admin -d rev_verif_int_revision -X -q < supabase\scripts\localreview_integrado\reanclar_126e.sql` (only moves those six dates; idempotent).

## A. #126 — superadmin@revision.test
1. **Payments in USD, each with its own TRM.** `http://localhost:3070/dashboard/contratos/DTM-12601` → tab **Cartera** → form «Registrar abono».
   * It asks «TRM de este pago» (not prefilled) and offers «Pesos (COP)» / «Dólares (USD)».
   * Pago 1: value `1230000`, TRM `4.100` → preview «Acredita USD 300 … saldo después del pago: USD 700». Click «Registrar abono». *Expect:* panel «Cobrado en pesos (real) $ 1.230.000» and «Equivalente del saldo (provisional) ≈ $ 2.870.000» (700 × 4.100).
   * Pago 2: value `2940000`, TRM `4200` → «Acredita USD 700 … saldo USD 0». Register. *Expect:* «Total cobrado en pesos $ 4.170.000» (1.230.000 + 2.940.000), no provisional notice; the receipt link (`/recibo/…`) opens in USD.
2. **Contract management — «Viaje más reciente» (#126-E).** `http://localhost:3070/dashboard/gestion-contratos?orden=salida_asc&numero=DTM-1261`
   * *Expect (review day 2026-11-20):* only departures from **today (Bogotá) onward**, nearest first: **DTM-12612 (20/11) → DTM-12613 (21/11) → DTM-12614 (22/11)**. NOT shown: yesterday (DTM-12611, 19/11), the contract without date (DTM-12615) and the very old one (DTM-12616, 16/10/2025).
   * `…/dashboard/gestion-contratos?numero=DTM-1261` (normal order): all six appear.
   * `…?orden=salida_asc&numero=DTM-1261&salida_desde=2025-07-08`: the past ones (DTM-12616, DTM-12611) reappear; the contract without date stays out (an explicit date range excludes undated).

## A2. #126-B/C/D — administracion@revision.test
1. **Promotion label (D).** `/tarifario` → «Vista tabla» → destination **DEMO 125**, Ida `04/12/2026`, Regreso `09/12/2026`, 2 adultos, 1 habitación → «Buscar hoteles». *Expect:* label **«Promoción PRE BF»**. Same search `02/12/2026 → 07/12/2026`: the label says **«solo en algunas noches»**. `09/12/2026 → 12/12/2026`: **no label**.
2. **Unit hotel with children (B).** Destination **CARTAGENA U1**, `10/06/2030 → 13/06/2030`, 2 adultos, 1 habitación, **2 menores, ages 8 and 2**. *Expect:* each child is listed and says «incluido», «cargo propio» or «paga como adulto»; no invented per-person rate for the unit hotel.
3. **Infant-only group (C).** `/dashboard/paquetes/912512` → tab «Tarifario resultado» → expand «Hotel Dubai 2 bases 125 ACTIVO». *Expect:* «Solo tarifa de infante · adultos en «Promoción · PRE BF DUBAI»»; never «Sin tarifa doble».

## B. #127 — admin127@revision.test (hotel closure)
1. **Publish.** `/dashboard/paquetes/12701` → «Tarifario resultado» → «Generar tarifario» (the seed leaves the package armed but unpublished).
2. **Before.** `/tarifario` (Vista Booking): origin **BOGOTÁ**, destination **CARTAGENA 127**, departure **30/12/26–02/01/27**. *Expect:* both **GRAND SIRENIS CARTAGENA 127** and **HOTEL OTRO CARTAGENA 127**.
3. **Close.** `/dashboard/producto/hoteles/12701` → «Black out general» → from `29/12/2026` to `09/01/2027` → «Agregar cierre».
4. **After (no need to regenerate).** Same search: **GRAND SIRENIS 127 is no longer offered; HOTEL OTRO still is.** Departure **26/12/26–29/12/26** (check-out on the first closed day) and **10/01/27–13/01/27** (first night after) still list GRAND SIRENIS 127.
5. Unit-priced hotels support only TOTAL and CATEGORY closures (open owner decision — `general-hotel-closure-127.md` §2). Hotel 12703 carries the unsupported accommodation closure seed on purpose.

## C. Portal B2B — freelance `freelance@revision.test` (Camila Ríos Demo)
1. **Panel.** `/portal/b2b`: «Panel del aliado», contract **DTM-96701**, «Comisión por cobrar $ 396.000»; **six tabs, no «Agentes»**.
2. **Unsigned account** `/portal/comision/DTM-96701`: «CUENTA DE COBRO … Versión sin aceptar»; PVP 5.000.000 · base 4.000.000 · 11 % · comisión 440.000 · retención −44.000 · **Total a cobrar 396.000** («Trescientos noventa y seis mil pesos»); Bancolombia · Ahorros · 00096701234. **No accept button yet** (no signature).
3. **Signature and logo.** `/portal/b2b/perfil` → «Mi firma» → «Elegir archivo» and, in the file window, **paste this full path into «Nombre de archivo» and press Enter**: `C:UsersUsuarioAppDataLocaldspacios-local-revision-intmuestrasirma-camila.png` → «Subir firma» → «Firma guardada.». Then «Logo en tus cotizaciones» → the same way with `C:UsersUsuarioAppDataLocaldspacios-local-revision-intmuestraslogo-camila.png` → «Subir logo» → «Logo actualizado.». (Both are small synthetic PNGs; the folder opens with `explorer "%LOCALAPPDATA%dspacios-local-revision-intmuestras"`. Any other PNG/JPG also works.)
4. **Accept.** Back on `/portal/comision/DTM-96701`: tick the box → **«Aceptar y firmar esta versión»** → «Aceptación electrónica — versión 1», the signature image above the name, «No es una firma digital certificada», total 396.000. Reloading does not create a second acceptance. (Agencies cannot do this — §D.)
5. **Isolation.** `freelance2@revision.test` (Beto): `/portal/comision/DTM-96701` shows no cuenta de cobro; `/portal/b2b` lists DTM-96702 and not DTM-96701. Camila cannot open `/portal/comision/DTM-96702`.
6. **History of her data (#25).** Role `gerencia@revision.test`: `/dashboard/aliados` → expand the row «Camila Ríos Demo» → «Corregir» → phone `+573009990000` → «Guardar corrección». Then Camila → `/portal/b2b/perfil` → «Historial de tus datos»: **Teléfono +573001234567 → +573009990000**; the full bank account never appears. `administracion@` can open «Corregir» but the base **rejects** the save (the phone does not change).
7. **Request a contract (#78).** Camila → `/portal/b2b/cotizaciones` (Directas): **C-REV78 · $ 1.800.000** → «Solicitar contrato» → «Contrato solicitado». *Expect:* exactly one event «solicitada» and **one notice, only to `administracion@revision.test`**; there, the bell shows «Solicitud de contrato de un aliado: cotización C-REV78» linking to `/dashboard/cotizaciones/<id>`. No e-mail is sent. Beto does not see C-REV78.
   *Why the conversion screen shows blank passenger rows for C-REV78:* it is a **sample quotation seeded without a titular or passengers** (empty payload), so there is nothing to carry over. It is left as the owner reviewed it. A quotation that the ally generates through the checkout carries the **titular** (see **G3**); quotations created by staff in Reservar carry their passengers.
8. **Logo on her quotation (#32).** Public link `http://localhost:3070/cot/60a668e6-220f-4a23-aff4-95177abf4914` (open it signed out or in another browser): «Cotización presentada por Camila Ríos Demo» with her logo, legal issuer (agency NIT/RNT) unchanged.
   *What the small gray line means:* «…presentada por <ally>, emitida por <agency> · NIT · RNT. El logo es del aliado que presenta la cotización; la agencia emisora y responsable es la indicada.» The **logo/name is the ally's presentation brand**; the **legal issuer** (the agency that actually issues the quotation and answers for its terms) is printed on purpose and is not changed by the ally's logo. Nothing about the legal issuer or the terms was modified; a shorter visual treatment can be proposed separately later.
9. **Clients (#76/#77).** `/portal/b2b/clientes`: «Ana Gómez · 1 contrato». «Agregar cliente» → name `Cliente Demo de Camila`, phone `3105550101`, e-mail `cliente.demo@revision.test`, tick the authorization box → «Guardar cliente». Beto does not see any of Camila's clients; `superadmin@revision.test` sees them at `/crm/clientes-aliados`.
10. **Responsive.** Open the pages above at 1280, 820 and 390 px: no horizontal scroll.

## D. Portal B2B — agency `aliado@revision.test` (Rev Aliado Uno)
1. `/portal/b2b`: DTM-96703 is listed; **seven tabs incl. «Agentes»**.
2. `/portal/comision/DTM-96703`: «Esta comisión corresponde a una agencia (persona jurídica). Las agencias deben enviar su factura electrónica para cobrar la comisión, no una cuenta de cobro.» No accept/sign control.
3. `/portal/b2b/perfil`: **no «Mi firma» section** (agencies do not sign).
4. After step A1 above, `/portal/b2b/cartera?vista=pagos` shows DTM-12601's payments as **USD $700 / USD $300, saldo USD $0**, never the peso equivalents; the receipts open in USD.

## E. Registration of new allies (#62, B5/B6) — visitor, no session
1. `/login` → link **«Solicitar acceso B2B»** → `/portal/registro`.
2. **Continue a verified registration.** Fill: Tipo de aliado `freelance`, Nombre `Aliado Continuar Demo`, Tipo de documento `CC`, Número `1010101010`, Correo `continuar@revision.test`, Contraseña / Repetir `ClaveContinuar-2026` → «Continuar: enviar código al correo». *Expect:* **«Continúa tu registro»** («Tu correo … ya está verificado»), not a code step. Wrong password `ClaveEquivocada9` → «No pudimos confirmar tu identidad…» and no request is created. Correct password `ClaveContinuar-2026` → «Continuar y enviar solicitud» → «¡Solicitud enviada! Revisaremos tu registro…». **Forgot the password?** Instead of typing it, use **«Olvidé mi contraseña»** in that step (G4). (Second chance: `continuar2@revision.test`, name `Aliado Continuar Demo Dos`, document `1010101011`.)
3. **Brand-new registration with a typed code.** Same form with name `Aliado Nuevo Demo`, CC `1020202020`, correo `nuevo.aliado@revision.test`, password `ClaveNueva-2026`. Open the mailbox (54383), read the 6-digit code, **wait more than 30 s**, then type it in «Verificar y enviar solicitud»: a wrong code is refused; the right one is accepted (600 s validity) → «Revisaremos tu registro».
4. `administracion@revision.test` → **Aprobaciones B2B** (`/dashboard/usuarios/b2b`): both «Aliado Continuar Demo» and «Aliado Nuevo Demo» appear as pending.

## G. Owner-feedback corrections (O-1…O-4) — new
### G1. O-1 — the hotel age-configuration message is internal only
1. Signed out (a visitor; also try `freelance@revision.test` and `aliado@revision.test`): `/tarifario` (Vista Booking) → «Porción terrestre» → destination **CARTAGENA O3** → 10/06/2030 → 13/06/2030 · 2 adults · 1 room · **1 minor, age 5** → «Buscar hoteles». *Expect:* **«O3 · Hotel con edades completas»** is quoted; the three hotels without valid ages (SIN edades, edades inválidas, sin edades con override) are **not listed**, and there is **no** box «hoteles no se pudieron cotizar» and **no** text naming «Infante hasta», «Niño hasta» or «Producto → Hoteles».
2. Same search as `administracion@revision.test` (also in **Vista tabla**): the box appears with «falta: «Infante hasta (edad)», «Niño hasta (edad)»» and «Producto → Hoteles → Configuración del hotel». That detail is only for staff.
3. **Adults only** (0 minors) behaves as before for everyone: all hotels are quoted. Destination **CARTAGENA U1** (unit hotels) follows the same rule with 1 minor.
4. Nothing about the safety rule changed: a hotel without valid ages is still never sold with minors, and Adults Only hotels still refuse minors.

### G2. O-2 — adult/child breakdown for a unit-priced hotel
1. Any role (visitor works): `/tarifario` → «Porción terrestre» → **CARTAGENA U1** → 10/06/2030 → 13/06/2030 · 2 adults · 1 room · **minors 8 and 2** → «Buscar hoteles».
2. *Expect on «U1 · Hotel por unidad con edades» (card; staff also see it in Vista tabla):* «Niño de 8 años: cargo propio $ 150.000 en total (se cobra por noche, 3 noches; ya incluido en el total)», «Infante de 2 años: sin cargo propio (tarifa $0 del hotel)» and the new block: **Base de la unidad (incluye 1 menor sin cargo propio) $ 600.000** · «2 adultos · equivalente informativo ≈ $ 300.000 c/u (base ÷ 2; el precio real es por unidad, no por persona)» · **+ Cargos propios de menores (ya suman al total) $ 150.000** · **Total de la reserva $ 750.000**. The total did not change (750.000); the equivalent is only a reading of the unit price.
3. Rooms with different accommodations, or a minor who pays as an adult, show the base **without** the per-adult equivalent (they would average different tariffs).

### G3. O-3 — request → staff → contract (what exists, and what does not)
> **SUPERSEDED (2026-11-21, revision 3):** the advisor-list limitation (step 2), the «not built» gaps (step 4) and the passenger statements below were corrected by migration 325 and later fixes; use `owner-review-325-walkthrough-2026-11-21.md` (§H1–H4) for O-3. The text below is kept as history.
1. As Camila (`freelance@revision.test`): `/tarifario` → search CARTAGENA O3, 10/06/2030 → 13/06/2030, 2 adults → «Agregar al carrito» → checkout: Nombres `Laura`, Apellidos `Vega Demo`, **Tipo `CE`**, Documento `1234567` (digits only: a CE number with letters is refused at conversion), Teléfono `3105550199` → «Generar cotización y enviar solicitud». Then `/portal/b2b/cotizaciones` → tab **«Asistidas»** (a quotation generated through the checkout carries the ally's ficha, so the portal files it there) → that quotation → «Solicitar contrato».
2. As `administracion@revision.test`: the bell shows «Solicitud de contrato de un aliado: cotización C-…» → it opens the quotation. **To generate the contract use `superadmin@revision.test`** (or the `venta` advisor): `administracion@`/`gerencia` see an **empty advisor list** on the conversion screen while the advisor is required — a pre-existing limitation reported to Codex, not changed. As superadmin: «Confirmar → generar contrato». *Expect:* passenger 1 arrives as **Laura Vega Demo, CE 1234567** (the titular Camila typed, with the document type she chose); passenger 2 is **blank** — the checkout asks the ally for the titular only, so there is nothing else to carry. Leaving passenger 2 incomplete is refused without creating a contract; completing it creates the contract with both passengers and **no payment**.
3. The quotation then says «Convertida en contrato…» (no second conversion). Staff register the payment first (`/dashboard/contratos/<n>` → Cartera). Only then can Camila attach evidence: `/portal/b2b/cartera?vista=soportes` → «Soportes vigentes: 0 de 1 pago registrado» → «Subir soporte» (PNG/JPG/PDF; sample files in C.3). Staff see it under «Soportes de pago del aliado» («Un soporte no registra ni aprueba un pago»); the payment count does not change; replacing keeps the old file in «Historial conservado»; Beto sees nothing.
4. **Not built (bounded gaps, proposals in the evidence doc):** (a) the ally cannot attach proof **before** the contract (evidence belongs to registered payments of a contract), so staff cannot review a proof *before* registering the payment; (b) the ally cannot supply a passenger list when requesting (only the titular). Quotations that staff created in Reservar **do** carry passengers and convert without retyping (e.g. C-0005).

### G4. O-4 — «Olvidé mi contraseña» from «Continúa tu registro»
1. Signed out: `/portal/registro` → fill the form for `continuar2@revision.test` (name `Aliado Continuar Demo Dos`, CC `1010101011`, password `ClaveContinuar-2026`) → «Continuar: enviar código al correo» → **«Continúa tu registro»** → click **«Olvidé mi contraseña»**. (A pending registration is inactive by design; the recovery link now reaches the password form — it used to bounce to the login with «inactivo».)
2. `/recuperar` opens with the e-mail already written → «Enviar enlace» → the generic «Si el correo está registrado…» message (the same for any e-mail). Open the test mailbox `http://127.0.0.1:54383`, open the recovery e-mail and its link → «Crea tu nueva contraseña» → write a new password twice → «Guardar contraseña».
3. You return to **«Continúa tu registro»** with «Contraseña actualizada. Escribe tu contraseña NUEVA…». The old password no longer works; the **new** one → «Continuar y enviar solicitud» → «¡Solicitud enviada!». **Exactly one** approval request exists; the e-mail verification did not change and the account stays inactive until staff approve it (`administracion@` → Aprobaciones B2B).
4. **E.3 (brand-new registration with a typed code) is still an owner check** — it was not accepted yet.

## F. Known and open items (not defects of this review)
* Stale suites that fail identically on the clean base, the three `portalB2B65` base failures (possible real base defect: direct contract `DTM-6501` absent from the ally's lists) and `NETO-ED1/ED4` (minimum «= total», stale since 307): see the evidence doc. Baseline parity does not prove those behaviors are correct.
* Hosted Vercel/Auth/Supabase consumption and settings are unverified owner-side gates; no hosted savings claim.
