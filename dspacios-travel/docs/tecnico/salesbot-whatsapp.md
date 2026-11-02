# SalesBot por WhatsApp (#56) — hoja técnica

Primera entrega: menú guiado para **Bloqueos** y **Porción terrestre** con traspaso a asesor. Reutiliza el flujo determinista de `lib/salesbot/conversacion/flujo.ts` (`avanzar`) y los motores de venta vigentes (`lib/salesbot/paquetes/lectura.ts`); no calcula precios ni disponibilidad por su cuenta.

## Archivos
| Archivo | Qué hace |
| --- | --- |
| `app/api/whatsapp/webhook/route.ts` | GET handshake + POST. Apagado (404) salvo `WHATSAPP_BOT_ACTIVO=1`. Firma HMAC antes de parsear. Responde 200 a todo POST firmado. |
| `lib/whatsapp/config.ts` | Estados `apagado` / `simulado` (procesa, NO llama a Meta) / `real`. Lista de números de prueba. |
| `lib/whatsapp/firma.ts` | `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo, comparación en tiempo constante) y handshake. |
| `lib/whatsapp/entrante.ts` | Payload de Meta → mensajes (texto, `button_reply`, `list_reply`; lo demás = inválido). |
| `lib/whatsapp/saliente.ts` | `MensajeBot` → texto / botones (≤3, título ≤20) / lista (≤10 filas, título ≤24, descripción ≤72). |
| `lib/whatsapp/turno.ts` | Un turno: deduplicación, bienvenida, traspaso, recortes del canal público, llamada a `avanzar`. |
| `lib/whatsapp/servicios.ts` | Consultas del flujo con el cliente **anónimo** (lo que ve un visitante). Programas y agencias fallan cerrado. |
| `lib/whatsapp/almacen.ts` | Sesión, mensajes procesados y traspasos (service-role, tablas sin policies). |
| `lib/whatsapp/envio.ts` | Único archivo que llama a `graph.facebook.com`; solo en estado `real` y a números permitidos. |
| `supabase/migrations/…269_salesbot_whatsapp.sql` | 3 tablas, RLS activa, sin acceso para anon/authenticated. **Sin correr.** Rollback en `supabase/scripts/rollback_269_*`. |
| `proxy.ts` | `/api/whatsapp/webhook` entra a la lista exacta de rutas sin sesión (como los cron). |
| `lib/salesbot/paquetes/lectura.ts` | Solo se exportó `cargarContextoPaquetes` (antes interno); sin cambio de comportamiento. |

El canal vive fuera de `lib/salesbot/` a propósito: las pruebas-guardia de SalesBot prohíben allí cliente admin, `.update(` y variables de entorno nuevas.

## Reglas del canal público
- Solo Bloqueos y Porción. «Programas» y todo B2B (agencias, comisiones) se rechazan; un asesor los atiende.
- «Asesor» = fila en `salesbot_wa_traspasos` + aviso por correo (si hay `SALESBOT_WA_AVISO_EMAIL`); el bot calla 2 h; «empezar de nuevo» lo devuelve al bot.
- Sesión de 6 h; pasada esa vigencia vuelve la bienvenida.
- No se guarda el texto del cliente: solo el estado saneado del flujo.
- Primer mensaje del cliente = bienvenida con menú (no se interpreta su frase).

## Variables de entorno (nombres; nunca valores en el repo)
`WHATSAPP_BOT_ACTIVO`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ENVIO_REAL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (def. v25.0), `WHATSAPP_NUMEROS_PRUEBA`, `SALESBOT_WA_AVISO_EMAIL`, `SALESBOT_WA_AVISO_REMITENTE`, más las que ya existen (`SUPABASE_*`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`).

## Requisitos de la Cloud API (documentación de Meta, consultada 2026-11-01)
- Botones: máx. 3, título ≤20, id ≤256, cuerpo ≤1024. Lista: ≤10 filas en total, título de fila ≤24, descripción ≤72, id ≤200, botón ≤20, cuerpo ≤4096.
- Ventana de servicio de 24 h desde el último mensaje del cliente; fuera de ella solo plantillas aprobadas. El bot solo responde, nunca inicia.
- Webhook: HTTPS con certificado válido, handshake `hub.*`, firma `X-Hub-Signature-256`, reintentos hasta 7 días (hay duplicados), lotes de hasta 1000 eventos.
- **No confirmado en la documentación consultada:** límite del mensaje de texto (se usa 4096) y el comportamiento exacto del número de pruebas.

## Fiabilidad: reintentos e idempotencia
Meta reintenta un POST no-200 hasta 7 días y puede repetir entregas. La ruta responde **200** si todo quedó atendido y **503** si algún mensaje hay que reintentar.
- **Bandeja durable** (`salesbot_wa_mensajes`): el id se «alquila» (lease 60 s) pero NO se da por atendido hasta el final. La respuesta se calcula una vez y se guarda (`resultado`); un reintento la reaplica.
- **Orden de efectos:** traspaso guardado → equipo avisado → respuesta enviada → sesión guardada → mensaje completado. Cada paso es idempotente o lleva marca: traspaso `UNIQUE(mensaje_id)`, aviso `avisado_en` + `Idempotency-Key` de Resend (24 h), envío con contador `enviados` (se reanuda en el primer cuerpo no aceptado), sesión que solo avanza.
- **Traspaso:** el cliente NO recibe «un asesor te escribirá» hasta que la solicitud esté guardada Y el aviso por correo haya salido. Sin canal de aviso (`SALESBOT_WA_AVISO_EMAIL`) el bot no promete asesor. En modo real la configuración exige correo y `RESEND_API_KEY`.
- **Errores de Meta:** 429, 5xx, 401 y 403 → se reintenta; otro 4xx (número inválido, ventana cerrada) → se descarta ese cuerpo y se registra.
- **Tope:** más de 6 intentos o 20 h → `abandonado` con registro (y, si el cliente no recibió nada y sigue la ventana de 23 h, un aviso honesto). Tras ~24 h Meta ya no admite respuestas libres.
- **Límite que NO se puede eliminar:** la Cloud API no tiene clave de idempotencia. Si Meta acepta un envío y el registro local falla dos veces seguidas, el reintento repite ESE cuerpo (como máximo uno por mensaje).
- **Versión:** default `v25.0` (Graph v26.0 es la última, 29-jul-2026, pero el changelog de WhatsApp solo documenta hasta v24.0; v21.0 vence el 21-ene-2027). Revisar antes de cada vencimiento.
- **Operación:** solicitudes sin avisar = `select * from salesbot_wa_traspasos where avisado_en is null`. Pendiente: purga de la bandeja (>30 días) y pantalla de traspasos.

## Concurrencia: dos mensajes del mismo wa_id en vuelo
- **Turno exclusivo por cliente** (`salesbot_wa_sesiones.lock_por/lock_hasta`, lease 90 s): `tomarTurno` es un compare-and-set atómico. El segundo mensaje cede (503, Meta reintenta; **ceder no gasta intentos**) y al volver lee la sesión ya confirmada por el primero.
- **Orden:** un mensaje con `ts` menor que sigue en curso pasa primero (compuerta de 120 s, `cedeAlPrevio`); pasado ese tiempo un anterior atascado deja de bloquear al cliente.
- **Avance de sesión atómico y fenceado:** `avanzarSesion` es UN `UPDATE ... WHERE lock_por = :yo AND ultimo_ts <= :ts`. Sin lectura previa ni upsert. Si el lease se perdió → `perdido` (no escribe, no responde, reintenta); si el mensaje es más viejo que el último aplicado → `obsoleta` (no retrocede el estado ni responde con algo viejo).
- **Límite que no se puede eliminar:** si el mensaje posterior llega al servidor y termina ANTES de que el anterior se reclame, el servidor no tiene forma de saber que existía el anterior. El estado queda consistente (sin pérdidas) pero el anterior se descarta como obsoleto.
- **Orden de efectos del turno:** tomar turno → calcular/guardar resultado → traspaso + aviso → avanzar sesión → enviar → completar → soltar turno.

## Recuperación de avisos de traspaso
- Un traspaso cuyo correo agota los reintentos del webhook queda guardado con `avisado_en` NULL (el cliente recibió solo el aviso honesto, nunca la confirmación).
- **Cron** `/api/cron/avisos-whatsapp` (Vercel, cada 15 min; `CRON_SECRET` obligatorio; inerte con el canal apagado) lo vuelve a avisar sin depender del cliente: gracia de 10 min para no competir con Meta, reclamo por fila (compare-and-set, dos corridas no duplican), retroceso 5 min → 10 → 20 … tope 6 h, **nunca se rinde**; el correo reutiliza la misma `Idempotency-Key`. Si el cron falla devuelve 500 y Vercel lo muestra como corrida fallida.
- Cola visible a mano: `select id, wa_id, creado, aviso_intentos, aviso_proximo from salesbot_wa_traspasos where avisado_en is null order by creado`.
- Si se apaga el canal, los avisos pendientes esperan hasta reactivarlo.

## Pruebas
- `pruebas/salesbot56WhatsApp.test.ts` (61): almacén en memoria con la MISMA semántica atómica y pausas con ruido (PRNG con semilla) para intercalar turnos de verdad; incluye 60 corridas × 2 órdenes de llegada, fencing, clientes distintos, recuperación y mutación (sin exclusividad las pruebas de concurrencia FALLAN).
- **Esquema (PR aparte, ya fusionado antes que este):** `sh supabase/scripts/test_269_salesbot_whatsapp.sh` — preflight → migración → postcheck → 5 casos negativos → concurrencia SQL con sesiones `psql` paralelas → rollback y re-aplicación.
- **Aplicación (este PR):** `sh supabase/scripts/test_269_app_salesbot_whatsapp.sh` — aplica esa migración, levanta PostgREST real y corre `test_269_concurrencia_real.ts` con el almacén de producción (9 pruebas, 25 clientes con dos mensajes simultáneos). Ambos usan contenedores locales desechables y **no** tocan Supabase real.

## Orden de despliegue
1. PR de esquema (migración 269): preflight → 269 → postcheck. 2. PR de aplicación. El canal sigue **apagado** (`WHATSAPP_BOT_ACTIVO` sin definir) hasta configurar Meta; con él apagado el webhook responde 404 y el cron no hace nada, así que el código puede desplegarse antes o después de la migración sin efecto.

## Pendiente / límites conocidos
- No hay pantalla para que los asesores vean los traspasos ni respondan desde el sistema (hoy: correo + tabla).
- Con el cliente anónimo, la lectura de `armado_paquetes.pct_mk` puede bloquearse por RLS; el flujo ya falla cerrado (omite el total) cuando un paquete suma servicios incluidos por grupo (H-PQ1). Validar con datos reales cuántos totales se omiten.
- Pruebas: `pruebas/salesbot56WhatsApp.test.ts` (61). No hay prueba contra Meta ni contra Postgres real.
