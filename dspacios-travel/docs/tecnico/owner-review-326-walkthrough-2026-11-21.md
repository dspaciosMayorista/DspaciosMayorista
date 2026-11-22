# Owner review — focused walkthrough of the four corrected behaviors (build `yst02koH-RpbWrYjRyQ1A`, migration 326 applied locally)

Date: 2026-11-21. Environment: the existing local review stack (`http://localhost:3070` — always `localhost`, not `127.0.0.1`), owner review database `rev_verif_int_revision`, saved browser credentials untouched. Owner acceptance and publication remain **pending**.

## State prepared (this round)

| Step | Result |
|---|---|
| SQL-325 fixture fix | The test used the server's `current_date` (UTC), the function compares against the **Bogotá** date; after 19:00 in Colombia the fixture's «yesterday» equalled Bogotá's today and assertion 6c («expired quotation accepted») failed. The fixture now derives its dates from `(now() at time zone 'America/Bogota')::date`. The expiry assertion is unchanged. Reproduced the failure first, then passed on a fresh disposable clone at a moment when UTC was already the next day; a mutation (the function stops rejecting expired quotations) makes 6c fail again. |
| Backup | `rev_verif_int_revision_pre326_20261121_1955.dump` (pg_dump custom format, 3 770 273 bytes, readable TOC) and `storage_pre326_20261121_1955\` (30 files, listing identical to the live storage). Marker: `ultimo_respaldo_pre326.txt`. Both in `%LOCALAPPDATA%\dspacios-local-revision-int\`. |
| Migration 326 | `aplicar_migraciones.sh pgb2b rev_verif_int_revision 326`: preflight 6 controls OK → migration (single transaction) → postcheck 7 controls OK. Nothing failed, nothing was skipped. Only `cotizacion_pasajeros_aliado_guardar` changed (still SECURITY DEFINER, same owner, `service_role` only). |
| Nothing else moved | Row count + md5 of every table of `public` and `auth` (241 tables) and path/size of all 30 stored files are **identical** before and after the migration, and identical to the fingerprint taken at the start of the whole session. Counts: 9 quotations, 59 payments, 89 sales, 1 evidence, 1 saved ally passenger list, 17 users. |
| Not done (as requested) | no rebuild, reset, restore, reseed, password overwrite or state-changing test on owner data; no login sessions were opened by me. |

## Health of the existing final build

* `.next/BUILD_ID` = `yst02koH-RpbWrYjRyQ1A`; no application source file is newer than the build.
* Launcher status: app on `:3070` listening only on `127.0.0.1`; auth, REST, storage, mail and `pgb2b` containers up; `/login` 200, `/tarifario` 200, gateway auth health 200, REST root 200, mail test inbox 200 (`http://127.0.0.1:54383`).
* The app log has one `[medicion-error] … error_auth_getUser` line per **anonymous** visit to `/tarifario` (it also appears on my own health check, which returned 200): existing measurement instrumentation for a visitor without session, not an application failure.

## The four corrected behaviors — where to look in the owner data

Accounts: `freelance@revision.test` (Camila, ficha 96701), `administracion@revision.test`; password as usual. All pages below read data; the steps that save something say so.

**1. Direct versus assisted quotation origin** — `http://localhost:3070/portal/b2b/cotizaciones?vista=directas` as Camila.
* Expected by the data: **Directas** = C-0007 (NETO, sealed `aliado_directo`; it used to appear under Asistidas) and C-REV78 (no plan, her own). **Asistidas** = empty; the tab counts equal the visible rows.
* To see an assisted one (creates a quotation): as `administracion@`, search `/tarifario` → add a hotel → `/tarifario/checkout` → «Tipo de venta» → **Aliado (B2B)** → choose Camila → PVP con comisión or NETO → fill the client → generate. It must land under Camila's **Asistidas** and not under Directas. A quotation Camila makes herself in NETO or commission lands under **Directas**.

**2. Compact passenger presentation**
* Ally panel (saves a passenger): Camila → `…/portal/b2b/cotizaciones?vista=directas` → C-REV78 → «Preparar la solicitud (opcional)» → «Agregar pasajero» → name/document → «Guardar pasajeros»: the row collapses to «Pasajero 2 · name · TYPE number · nac. …» with «Editar» / «Quitar» and, when something is missing, «Faltan: documento, nacimiento».
* Staff conversion: `http://localhost:3070/dashboard/cotizaciones/9` (C-0008, cart, 1 hotel, 4 travelers) → «Confirmar → generar contrato». Incomplete rows are open; a row that becomes complete collapses with **Listo**; an infant row stays open until a responsible adult is chosen and then shows «responsable: …». (Nothing is generated unless you press «Generar contrato(s)».)
* Note: C-0008's validity ends on 2026-11-22; after that date the conversion screen will report it expired.

**3. «Agregar pasajero» only while travelers are missing**
* C-REV78 has 2 travelers: in the ally panel one additional passenger fills the declared universe — the button disappears with «Ya están todos los viajeros…»; **Quitar** brings it back.
* C-0008 (4 travelers, one hotel): in the staff conversion the four rows already equal the declared travelers, so «+ Agregar pasajero» is not offered; removing a row brings it back.
* The two behaviors that need a cart with **two independent hotels** (ambiguous universe, safety bound) and the **30-passenger capture limit** have no seeded quotation in the owner data; they were exercised only on the disposable copy (journey sections Z.3c and ZR, `evidence-326/`). Building one requires adding two hotels to one cart and quoting it — a state-changing step I did not take.

**4. Regular tariff attached to its passenger** — `http://localhost:3070/tarifario` (Vista Booking): «Porción terrestre» → destination **DEMO 125** → Ida 04/12/2026, Regreso 07/12/2026 → 2 adultos, 1 habitación, **2 menores**, edades **8** y **1** → «Buscar hoteles». On the cards of Hotel PRE BF 125 the 8-year-old appears as a highlighted block: «**Niño 1 · 8 años**: tarifa regular ~~$ …~~ · a pagar **$ …** c/u · …», adults and the infant without a note. Searching only reads data.

## Evidence index

`docs/tecnico/owner-review-corrections-b2b-evidence-2026-11-21.md` (matrix, results, limits; section 7 = R326-1) and `docs/tecnico/evidence-326/` (journey logs, screenshots at 1366/820/390 px, failing-name lists, build ids).
