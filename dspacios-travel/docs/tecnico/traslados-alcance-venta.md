# Traslados por alcance — código de venta, CxP enlazadas y consulta de pendientes

> **Alcance de este documento:** el código de la aplicación (catálogo, búsqueda, carrito, cotización, conversión, contrato y CxP), el reintento del cron con CxP de texto anterior y la consulta de pendientes. El esquema de base de datos (migraciones 262–265), sus gates y el orden de aplicación están en la documentación del PR de migraciones 262–265.
>
> **Requisitos:** (1) las migraciones 262–265 (PR de esquema, #422) aplicadas en su orden antes de usar la modalidad (el código lee con tolerancia —sin las migraciones todo se comporta como antes y los editores avisan—, pero no puede vender por alcance sin ellas); (2) los cambios de traslados de #421 (`lib/calc/trasladoFranjas.ts`, `lib/calc/servicioTarifa.ts` y otros archivos que este PR también modifica), ya fusionados en `main`.

## Reglas de negocio
- Un servicio **clasificado como traslado** se vende siempre por alcance (`llegada`, `salida` o `ida_regreso`), con el precio propio de ese alcance en la vigencia aplicable y el rango de pasajeros que cubra al grupo. Sin precio propio no se vende; **nunca** se sustituye con el de otro alcance, con la mitad/doble ni con GENERAL.
- El suplemento por franja horaria y la hora exigida solo cuentan para los **tramos vendidos** (un trayecto: el elegido; ida y regreso: cada tramo con su hora).
- Un servicio sin clasificar (todo el legado), un tour o una asistencia conservan su comportamiento anterior y rechazan un alcance. Un combo con traslado conserva su tarifa y limita el suplemento al tramo que declaró.
- Un traslado por alcance no puede ir incluido en el hotel ni venderse por la reserva interna / oferta #63: se rechaza en el primer punto en que se conoce, con un mensaje claro (al marcarlo incluido, al generar el tarifario, en la pantalla de reserva y en `computarReserva`). Si el tarifario no se pudo publicar, el cliente ve un aviso neutro y el operador el motivo exacto.

## Mapa del código
- **Reglas puras:** `lib/calc/servicioAlcance.ts` (tipos, validaciones, `modalidadAlcance`, precio por alcance), `lib/calc/servicioTarifa.ts` (`costoNetoServicio` con `alcance`), `lib/calc/trasladoFranjas.ts` (rango de pasajeros, tramos vendidos), `lib/calc/servicioVigencias.ts` (referencia de publicación por alcance).
- **Lectura/escritura tolerante:** `lib/servicios/alcanceDatos.ts` (clasificación y precios; el guardado de precios usa la RPC atómica), `lib/servicios/alcanceContexto.ts` (contexto de liquidación y guardas), `lib/servicios/eliminarServicio.ts` (mensajes al eliminar un servicio).
- **Precio, costo y conversión:** `lib/reservar/liquidacionServicio.ts`, `lib/reservar/costosObligacionesCarrito.ts`, `lib/reservar/cotizar.ts`, `lib/reservar/verificarAlcanceConversion.ts` (acredita alcance, precio y composición contra el catálogo vivo, con las horas vigentes, **antes de numerar**), `lib/reservar/tarifarioNoVendible.ts`.
- **Catálogo:** `app/(dashboard)/dashboard/producto/servicios/Alcance262.tsx` (tipo, combo y precios por trayecto y rango; GENERAL no admite precios).
- **Venta:** filtro por tipo y selector de alcance en `app/tarifario/BuscadorReceptivos.tsx`; el alcance viaja por `lib/cart/CartContext.tsx`, `app/tarifario/checkout/page.tsx` y `app/tarifario/checkout/actions.ts`; la conversión (`app/(dashboard)/dashboard/reservar/actions.ts`) escribe la línea de `contrato_servicios` (alcance, servicio, clave de enlace) y la CxP con la clave en `observaciones`.
- **Editor de contrato:** `app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts` y `app/(dashboard)/dashboard/contratos/[numero]/page.tsx` no muestran ni reemplaza las líneas con alcance al guardar los servicios.

## Una cotización anterior o alterada falla de forma segura
Al convertir se vuelve a acreditar cada traslado por alcance: alcance válido, servicio clasificado como traslado, precio vivo igual al cotizado y moneda igual. Alcance ajeno, ausente en un traslado, presente en un servicio que no lo admite, precio cambiado o sin tarifa propia: no se numera nada y se pide recotizar. Si cambió el horario del vuelo, también.

## Reintento del cron con CxP de texto anterior
El texto de las CxP del carrito era «Generado automáticamente desde el carrito (tarifario)», que no empieza por la marca con la que la RPC financiera reconoce y reemplaza sus CxP en un reintento. Ahora es «Generado automáticamente desde el tarifario (carrito)». Medido con el código sin guarda, el cron sobre un contrato `pendiente` con CxP de texto anterior las **duplicaba** y lo dejaba `completo` con la deuda al proveedor doblada.
Guarda actual (`lib/reservar/reconciliacionFinanciera.ts` y `app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts`): si el contrato ya tiene CxP con el texto anterior, el reintento **se niega** —no llama a la RPC, no escribe nada y deja `ultimo_error` explícito—. Nunca se borra ni se modifica una obligación histórica.

## Consulta de pendientes (solo lectura): `supabase/scripts/consulta_cxp_texto_anterior_pendientes.sql`
Una sola consulta (sin DML) con columnas `n · control · observado · esperado · veredicto`. Funciona **antes de aplicar la 262** (no nombra columnas de la 262).
- **Una fila `REVISAR` por contrato** con `financiero_estado = 'pendiente'` que tenga CxP con el texto anterior: tenant, horas pendiente, si hay payload, intentos, `ultimo_error`, nº de CxP con texto anterior, cuántas tienen pagos o retenciones y líneas con alcance.
- Fila 90 (`INFO`): total de CxP con ese texto en contratos ya `completo` (son históricas normales, no un problema).
- Fila 99: `LIMPIO` o `HAY CASOS (n)`.

### Cómo ejecutarla antes de desplegar el código
1. **Cuándo:** antes de desplegar este PR. Mientras el código actual siga en producción, el cron reintenta los contratos `pendiente` y, si tienen CxP de texto anterior, las duplica; la consulta dice cuántos contratos están expuestos. No depende de las migraciones.
2. **Cómo (solo lectura):**
   - Editor SQL de Supabase: pegar el archivo COMPLETO (sin `begin`/`rollback`) y ejecutar. Es una sola sentencia `select`.
   - O desde `psql`, forzando sesión de solo lectura: `PGOPTIONS="-c default_transaction_read_only=on" psql "$DATABASE_URL" -X -A -t -f supabase/scripts/consulta_cxp_texto_anterior_pendientes.sql` (cualquier escritura fallaría con «cannot execute … in a read-only transaction»).
3. **Veredicto `LIMPIO`:** nada que hacer; desplegar normalmente.
4. **Veredicto `HAY CASOS (n)` / filas `REVISAR`:** desplegar este PR cuanto antes (la guarda detiene el reintento duplicador) y tratar cada contrato así:
   - No borrar ni editar CxP por SQL; no lanzar el cron a mano; no resolver con scripts masivos.
   - Priorizar los que tienen pagos o retenciones y los más antiguos.
   - Abrir el contrato y comparar sus CxP con los costos del contrato y con el payload guardado en `contrato_financiero_pendiente`.
   - **CxP completas y correctas** (cada obligación una vez): el contrato está bien y solo falta el estado; lo cierra una persona técnica autorizada con el dueño, caso por caso, y se deja constancia (no se reinserta nada).
   - **Faltan CxP:** agregarlas a mano desde la pestaña de proveedores del contrato y luego cerrar el estado como en el caso anterior.
   - Mientras no se resuelva, el cron solo registra el error explícito (suben `intentos`); no escribe. Volver a ejecutar la consulta: debe bajar hasta `LIMPIO`.
5. **Límite:** la consulta no detecta duplicados ya producidos por el cron anterior en contratos que quedaron `completo` (la fila 90 solo los cuenta como CxP con ese texto). Si se sospecha, revisar esos contratos por repetición de servicio y valor.

## Pruebas
- Unitarias y de cableado (`pruebas/*262*.test.ts`, `pruebas/*265*.test.ts`, `pruebas/trasladosIncompatibles262.wiring.test.ts`, `pruebas/reconciliacionTextoAnterior265.test.ts`) y React (`alcance262Editores`, `buscadorReceptivosAlcance262`, `eliminarServicioObligaciones265`; registradas en `test:react`).
- Recorrido real contra PostgreSQL + PostgREST locales: `supabase/scripts/test_262_venta_alcance.sh <base> <contenedor> <plantilla>` (con `pruebas/alcance262.pg.ts`): búsqueda → cotización → conversión → contrato → CxP, llegada/salida/ida y regreso, modo grupo, suplemento solo en tramos vendidos, cotización anterior o alterada, precio cambiado, GENERAL, legado, combo, asistencia, USD, comparativa, cambio de horario, #63 en COP y USD, reentrada del cron (CxP del texto nuevo y anterior), editor de contrato y borrado de servicio. Este script usa el entorno local de pruebas del PR de migraciones y necesita las migraciones 262–265 de ese PR (ya fusionado, #422).
- Referencia: 64 de 64 en el recorrido real; suite unitaria con los mismos 18 fallos que la base limpia y ninguno exclusivo de esta rama.

## Límites conocidos
- Un contrato con una CxP pagada o con retención no se reemplaza en un reintento: queda `pendiente` con `ultimo_error` y no se revierte automáticamente (guarda deliberada).
- El carrito no convierte salidas dinámicas; las horas de una salida dinámica salen de `salidas_dinamicas`, no del empaquetado.
- Un servicio publicado en un tarifario no se puede eliminar (FK de `tarifario_resultado`); el mensaje ahora lo explica. Un servicio con obligaciones asociadas tampoco.
- No probado: #63 con salida vinculada en USD, un traslado por alcance convertido sobre una oferta #63 (se rechaza antes), un `pendiente` real de producción (se simuló reescribiendo el texto) y la UI en navegador real/Preview.
