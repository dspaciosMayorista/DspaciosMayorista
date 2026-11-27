# Supplier requests, promotion codes and supplier-payment notices (#103) — code map

Reference sheet (not business rules). Migrations **328** (requests + codes + payment-notice rows) and **329** (payment evidence). Neither is applied anywhere but disposable databases. Rollbacks/preflights/postchecks in `supabase/scripts/*_328_*` and `*_329_*`.

## Data
| Table | Purpose |
| --- | --- |
| `solicitudes_proveedor` | ONE e-mail sent to a supplier. `tipo = 'solicitud'` (one contract: `numero_contrato` + `contrato_uid` required) or `'pago'` (a payment notice, no contract columns). State: `enviando → enviada → entregada → respondida → confirmada/rechazada`, plus `fallida` and `incierta`. Holds `clave_envio` (idempotency), `token_respuesta` (reply correlation), the lease (`envio_iniciado_en`, `intentos`), the code AS SENT (`codigo_*`, `sin_promocion`) and the exact data the mail was built from (`snapshot`). |
| `solicitud_proveedor_eventos` / `_avisos` | provider/internal events (unique per request+type+dedupe) and one in-app notice per (event, user). |
| `hotel_codigos_promocion` | the promotion code a hotel requires **per validity** (`hotel_temporadas` row); `requerido` + `codigo` null = required but not typed yet. |
| `cxp_pago_soportes`, `solicitud_proveedor_pagos` (329) | evidence files of supplier payments; which payments a notice reported. Private bucket `soportes-pago-proveedor`, no `storage.objects` policy. |

`cxp_pagos` is **not changed**: one row = one payment applied to one obligation (one contract/service line) — that row is the allocation.

## Contract identity (284)
`solicitudes_proveedor` is classified `estricto` in `contrato_guardas_config` (without that row `contrato_instalar_guardas()` aborts). A request stores the `contrato_uid` the screen opened; INSERT is checked against the live contract (`fn_solicitud_proveedor_uid`), later changes are rejected. Asynchronous events declare the request's OWN stored uid inside `registrar_evento_solicitud_proveedor`; if that contract life is gone the event is ignored. A DTM number with a supplier request is not a reuse candidate (the blocker fails closed on unclassified tables). Renumbering moves the row by FK; the uid, token and events follow.

## Code
| File | Role |
| --- | --- |
| `lib/solicitudProveedor/documento.ts` | structured supplier-request e-mail: HTML table + plain text from one data object (no prices, no voucher) |
| `lib/solicitudProveedor/codigos.ts` | which coded validity covers a stay; explicit choice rules (`resolverCodigo`) |
| `lib/solicitudProveedor/avisoPago.ts` | payment-notice e-mail and totals per currency from persisted payment lines |
| `lib/solicitudProveedor/cargar.ts` | server loaders (RLS session + explicit tenant): contract data, coded validities, payments, evidence → attachments |
| `lib/solicitudProveedor/servicio.ts` | send with lease, recovery, `incierta`, deterministic event keys; event processing |
| `lib/solicitudProveedor/transporte.ts` | Mailpit capture / Resend; `idempotente` flag, text part, attachments, 20 s timeout |
| `lib/solicitudProveedor/nucleo.ts` | tokens, recipients, neutral webhook body, HMAC and **Svix (Resend)** signature + event mapping |
| `app/api/solicitud-proveedor/webhook/route.ts` | `x-firma` (neutral HMAC) or `svix-*` (Resend) entry |
| `…/contratos/[numero]/solicitud-proveedor-actions.ts`, `SolicitudesProveedor{Seccion,Panel}.tsx` | request preview/send, decisions, notices read (scoped to the contract) |
| `…/producto/hoteles/[id]/codigos-actions.ts`, `CodigosPromocion.tsx` | configure the code per validity |
| `…/pagos/avisos/{page,actions,AvisosPagoClient}` | payment notices: list, upload evidence, preview, send, history |
| `lib/tarifario/pendientes.ts`, `paquetes/actions.ts → estadoTarifariosDeHotel / reanudarTarifariosDeHotel`, `EstadoTarifarios.tsx` | persisted regeneration debt, banner, resume |

## Send safety (H103-3, corrected in round 2: R2-1, R2-2, R2-6)
- **One row = one frozen send.** The row stores `payload` (the exact html/text, attachment references with sha256, and the payment ids it reported) when it is created. `enviarSolicitud` only creates NEW sends; `reintentarEnvio(solicitudId)` re-sends **that** stored message (same recipients, same key, same attachment bytes — hashes re-verified). It never re-reads the contract, the code choice or the payments. A changed contract/code/payment set is a different request (different key) or an explicit «Reenviar como nueva» (key v+1, only after a fresh preview of the same supplier).
- **Lease.** `enviando` is a 120 s lease; one caller takes over an expired claim (`reclamar_envio_solicitud_proveedor`, compare-and-swap on the database clock).
- **Ambiguity is sticky.** `ambiguo` is set by an uncertain send (timeout, network, 5xx, 409, killed worker) and a bounce; it is cleared only by a recorded successful send. A later clear failure does not erase it.
- **Window.** For every retry of an `enviando` claim or an `ambiguo` failure the provider must be idempotent **and** `ahora − created_at < ventanaIdempotenciaMs` (Resend 24 h; the app uses 23 h; Mailpit is not idempotent). Otherwise nothing is sent: the row becomes `incierta` (`envio_incierto`), resolved by a late provider event or an explicit «Reenviar como nueva». A clear (known-unsent) failure may be retried at any age.
- **Payment relations are written before sending** and checked; on failure nothing is sent and the request stays retryable, the retry repairs the relation idempotently.
- Event keys are `tipo:solicitud:intento` so retried recording stores once. The payment-notice key is built from **persisted, immutable** content (payment ids, supplier, amount, currency, TRM, evidence hashes) — never from the cumulative-paid figure, which changes when a later installment is registered.

## Promotion codes — fail-closed rules (R2-3, R2-4)
- Every read that decides whether a code is required (contract, hotel rows, hotel catalogue, validities, code table) propagates its error; an error blocks the send (it is never read as «no code required»).
- The hotel must be one of the catalogue hotels matched by name to this reservation's hotel rows (`SolicitudCargada.filasHotel`); an existing but unrelated hotel is rejected. If two same-name catalogue hotels match, the sender's explicit choice picks the one used for the stay (documented, test Q6). A multi-stay reservation requires a code decision per covered stay.

## Hostinger inbound adapter (code only, OFF)
`app/api/solicitud-proveedor/hostinger/route.ts` + `lib/solicitudProveedor/hostinger.ts` + `avisoInterno.ts` (internal-notice e-mail now shared with the neutral/Resend route). A bearer-authenticated `message.received` notification only TRIGGERS a bounded, paginated, GET-only pass over the configured mailbox's INBOX (same pass as the scheduled drain `/api/cron/respuestas-hostinger`; a durable cursor and parked-replies backlog (migration 330) let every later pass continue where the previous stopped; one shared deadline/attempt budget bounds each pass; 202 while incomplete); replies are correlated by the Reply-To token and handed to the existing `procesarEvento` (namespace `rfc822` is never matched against `mensaje_id`). Contract verified from the official OpenAPI, assumptions and the checks still needed (build, pg re-run, real-stack with a simulated API): [hostinger-entrada-103.md](hostinger-entrada-103.md). Tests: `pruebas/hostinger103.test.ts` (31, simulated HTTP), `prueba_hostinger_estado_103.mjs` + `hostingerAlmacen103.pg.ts` (real SQL/store), lifecycle `ciclo_327_330.sh`.

## Several stays of one supplier (R3-2)
- A request carries **only what the sender marks** under «Estancias de esta solicitud» (`SolicitudesProveedorPanel`): each contract hotel row of that supplier (`contrato_hoteles.id`) and, if any, the supplier's service lines. The selector appears only when there is more than one thing to choose; the default (everything) sends **no** selection, exactly as before.
- `armarSolicitud(..., seleccion)` applies the selection to rows already filtered by contract **and** supplier, so a stay of another supplier/contract can never enter (every chosen id must be found, otherwise the request is rejected); an empty or malformed selection is an error, never «everything». The e-mail (HTML and text), the stored `snapshot` and the frozen `payload` contain only the selected stays; `contenido.seleccion` is part of the idempotency key, so two requests for different stays are two requests and an identical one dedupes.
- The code rules are judged on the stays the message carries: the chosen hotel must match one of **those** stays (an unrelated hotel, or the hotel of a stay that is not in the request, is rejected); another coded hotel among the selected stays still blocks the send (`one request = one code choice`), and the message now tells the sender how to proceed (mark one hotel's stays and send the other hotel in its own request).
- Retry is unchanged: by id, re-sending that request's own frozen message (tests Y4).

## Regeneration recovery (R2-5)
`estadoTarifariosDeHotel` returns `reanudarSolo` = work owed, **no** computation alive (`recalculando` younger than 3 min), at least one package that is not `fallido`, and the oldest unpublished change at least 120 s old (unknown change time counts as old). `EstadoTarifarios.tsx` calls `reanudarTarifariosDeHotel(hotelId, inicioMs, { automatica: true })` on its own (at most 2 attempts per page view; `fallido` packages are left to the manual button) and, while the banner is shown, follows the persisted state with the **narrow** `estadoTarifariosDeHotel` read (R3-3; never a periodic `router.refresh()`): one read per 15 s, at most 20 per page view, one operation at a time (chained timer, never overlapping a resume or another read), no read and no budget spent while the tab is hidden (an immediate read when it becomes visible if the interval has passed), a stop after 3 consecutive failed reads (the banner says so; «Ver estado»/«Actualizar ahora» restart it), and exactly ONE whole-page refresh when a read finds no debt left. Tabs are independent: cost grows linearly with the number of visible tabs. With no debt the component is not mounted: no idle polling.

## Tests
Rollbacks 328/329 under real concurrency (R3-1): `supabase/scripts/prueba_carrera_rollback_103.mjs [--sin-candados]` (disposable database; the flag is the negative control). Pure: `pruebas/solicitudEstructurada103.test.ts`, `solicitudProveedor103.test.ts`, `auditoriaR2_103.test.ts` (the auditor's probes with corrected expectations), `pendientesAuto103.test.ts`. Real database + local Mailpit: `pruebas/solicitudProveedor103.pg.ts` (needs 328 + 329), `latenciaCierres103.pg.ts` (needs 315 + 327). Rendered: `solicitudesProveedor103.react.ts`, `avisosCodigos103.react.ts` (includes the `EstadoTarifarios` automatic-recovery cases B3–B6). Lifecycle 327→328→329 (apply, postcheck, rollback in reverse order, re-apply): `supabase/scripts/ciclo_327_329.sh`.
