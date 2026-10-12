# Servicios incluidos cotizados (carrito → contrato)

> **Estado:** implementado en la rama de #14 (PR #353), sin integrar. Nada de lo
> descrito en §6 (saneamiento) se ha ejecutado. Ninguna consulta de este
> documento se ha corrido contra Preview ni Producción.

## 1. Qué es

Cómo viajan los **servicios incluidos del paquete** (ej. asistencia médica)
desde el checkout del tarifario hasta el contrato, sin exponer costos
internos. `cotizaciones.payload` lo puede leer el rol `venta` (RLS, migración
154), así que no lleva costos ni proveedores. La conversión vuelve a calcular
costo y proveedor en el servidor y verifica que coincidan con lo cotizado.

## 2. Dónde vive

| Archivo | Qué hace |
|---|---|
| `lib/reservar/incluidosCotizados.ts` | Formato del payload, huellas HMAC y `validarIncluidosConversion` (función pura, salvo `node:crypto`). |
| `lib/reservar/computo.ts` | `computarReserva`: lee los incluidos (`armado_servicios`, `servicios_adicionales`, `servicio_tarifa_pax`) con service-role. Por persona: costo para la CxP, sin sumar al precio. Por grupo: cargo único con el pax real. |
| `app/tarifario/checkout/actions.ts` | `crearCotizacionCarrito`: agrega los incluidos **solo de hoteles aceptados** (después de la exclusión por moneda); resumen del documento en memoria, payload con identidad + huellas. |
| `app/(dashboard)/dashboard/reservar/actions.ts` | `convertirCotizacionCarrito`: valida por hotel antes de escribir, CxP con costo recalculado y proveedor del catálogo, línea "Servicios incluidos por grupo" en `contrato_items`. |
| `supabase/scripts/conteo_incluidos_sin_proveedor.sql` | Conteo por paquete de incluidos con costo y sin proveedor (preparado, no ejecutado). |
| `supabase/scripts/conteo_payload_costos_incluidos.sql` | Conteo de cotizaciones con costos en el payload y de las que no podrán convertirse (preparado, no ejecutado). |
| `supabase/scripts/test_conteos_incluidos.sh` | Prueba local (Docker desechable) de las dos consultas con datos sintéticos y bordes. |

## 3. Formato de `payload.serviciosIncluidos`

**Nuevo (desde #353):**

```json
{ "servicioId": 9, "nombre": "ASISTENCIA MEDICA", "categoria": "asistencia", "incluido": true,
  "paqueteId": 34, "ref": "item-0", "huella": "<HMAC costo>", "huellaProveedor": "<HMAC proveedor>" }
```

- `huella` = HMAC-SHA256(clave, `[ref, servicioId, costoNeto en centavos]`).
- `huellaProveedor` = HMAC-SHA256(clave, `[ref, servicioId, "proveedor", proveedorId]`).
- `clave` = HMAC-SHA256(`SUPABASE_SERVICE_ROLE_KEY`, `"dspacios:cotizacion:costo-incluido:v1"`). Solo existe en el servidor; sin ella las huellas no permiten deducir costo ni proveedor (ni probando valores).
- `categoria` va en claro: no es dato del proveedor y decide el documento (asistencia / tours y traslados).

**Anterior (antes de #353):** `{ servicioId, nombre, categoria, incluido, costoNeto, proveedorId, paqueteId }`, sin `ref` ni huellas. Las cotizaciones creadas por aliados B2B antes de #353 suelen tener la lista **vacía** (la lectura de incluidos con la sesión devolvía 0 filas).

## 4. Validación al convertir

Por cada hotel por persona del carrito, **antes de cualquier escritura**
(`validarIncluidosConversion`). Si no hay incluidos cotizados ni recalculados,
no se valida nada (la conversión sigue como siempre).

1. Formato nuevo: el hotel tiene `ref` y las fechas cotizadas (`detalle.hoteles[ref]`) son las recalculadas.
2. Pasajeros recalculados = cotizados (`payload.items[].pax`).
3. Mismo conjunto de servicios incluidos (ni agregados ni quitados).
4. Por servicio, en este orden:
   1. misma **categoría**;
   2. si tiene costo, **tiene proveedor** en el catálogo;
   3. misma **huella de proveedor** (formato anterior: mismo `proveedorId`; si falta la clave → no verificable);
   4. misma **huella de costo** (formato anterior: mismo `costoNeto`; si falta → no verificable).
5. CxP: costo **recalculado**, proveedor resuelto otra vez del catálogo (si no aparece → se revierte el contrato). Nunca se usa un costo del payload ni del navegador.

Cualquier fallo devuelve un mensaje con la causa y "Genera una cotización nueva
desde el tarifario antes de convertirla". Bernalo (hotel por unidad) queda
fuera: sus incluidos se re-liquidan aparte.

## 5. Cotizaciones abiertas: qué pasa si…

| Situación entre cotizar y convertir | Resultado al convertir | Qué hacer |
|---|---|---|
| Cambia el **costo neto** del incluido | Se detiene: "la tarifa neta de «X» cambió…". No se escribe nada. | Regenerar la cotización. |
| Cambia el **proveedor** (mismo costo) | Se detiene: "el proveedor de «X» cambió…". | Regenerar. |
| Cambia la **categoría** | Se detiene: "la categoría de «X» cambió…". | Regenerar. |
| El incluido con costo **no tiene proveedor** | Se detiene: "no tiene proveedor configurado… no se puede registrar su cuenta por pagar". Pasa aunque tampoco lo tuviera al cotizar. | Configurar el proveedor en Producto → Servicios y regenerar. Medir antes con `conteo_incluidos_sin_proveedor.sql`. |
| Se agrega o quita un incluido del paquete | Se detiene: "los servicios incluidos del paquete cambiaron…". | Regenerar. |
| Cambian fechas o pasajeros recalculados | Se detiene con el motivo. | Regenerar. |
| Cambia el **precio de venta** del hotel | **No se detecta**: el contrato usa el precio recalculado (comportamiento previo a #353). | Decisión de negocio pendiente. |
| Se **rota** `SUPABASE_SERVICE_ROLE_KEY` (o cambia su valor, p. ej. al migrar a las llaves nuevas de Supabase) | Todas las cotizaciones abiertas **en formato nuevo con incluidos** dejan de convertirse. ⚠️ El mensaje dirá "el proveedor de «X» cambió" (primera huella que se compara), **aunque la causa sea la llave**. | Regenerarlas. Ver mejora propuesta abajo. |
| Falta `SUPABASE_SERVICE_ROLE_KEY` en el servidor | No se generan cotizaciones con incluidos ni se convierten las existentes ("configuración del servidor incompleta"). | Configurar la variable. |
| Cotización **anterior** con `costoNeto` y `proveedorId` iguales a los actuales | Convierte; la CxP usa el valor recalculado. | — |
| Cotización anterior sin `costoNeto`/`proveedorId`, o con valores distintos | Se detiene ("no permite verificar…" o "cambió…"). | Regenerar. |
| Cotización anterior **sin incluidos guardados** cuyo paquete los tiene hoy (B2B) | Se detiene ("los servicios incluidos cambiaron"). | Regenerar. Medir con la consulta 2 de `conteo_payload_costos_incluidos.sql`. |

**Rotación de la llave — mejora propuesta (no implementada):** guardar junto a
las huellas un identificador público de la clave (ej. los primeros 8
caracteres de HMAC(clave, `"id"`)). Al convertir, si el identificador no
coincide, mostrar "la cotización se generó con una configuración anterior;
regénerala" en vez de atribuirlo a un cambio de proveedor. Coordinar con la
rotación pendiente de llaves de `CLAUDE.md` §12: rotar invalida las huellas de
**todas** las cotizaciones abiertas con incluidos.

## 6. Plan de saneamiento de payloads anteriores (NO aplicado)

Objetivo: que `venta` no pueda leer `costoNeto`/`proveedorId` en cotizaciones
existentes, sin perder la conversión de las que siguen abiertas.

**Requisitos previos**
- #353 desplegado (si no, las cotizaciones nuevas seguirían escribiendo costos).
- Autorización explícita del usuario para cada fase remota.
- Ventana sin conversiones en curso (las conversiones leen el payload).

**Fase 0 — Medición (solo lectura).** Ejecutar `conteo_payload_costos_incluidos.sql` y `conteo_incluidos_sin_proveedor.sql`. Decidir con los conteos por estado y vigencia.

**Fase 1 — Respaldo.** Antes de modificar, exportar `id` + `payload->'serviciosIncluidos'` de las filas objetivo a un archivo protegido, fuera del repo y accesible solo por superadmin. **Contiene costos**: no adjuntarlo a PR, chat ni ticket. No se crea una tabla de respaldo, porque requeriría migración y quedaría legible por más roles.

**Fase 2 — Convertidas y descartadas.** Quitar `costoNeto` y `proveedorId` de cada entrada. Es seguro: una cotización convertida devuelve sus contratos existentes **antes** de leer los incluidos, y una descartada no se convierte. Borrador validado en una base local desechable (no versionado como script ejecutable):

```sql
begin;
with objetivo as (
  select c.id from public.cotizaciones c
  where c.tipo = 'carrito' and c.estado in ('convertida', 'descartada')
    and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array'
                then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) e
                where e ? 'costoNeto' or e ? 'proveedorId'))
update public.cotizaciones c
set payload = jsonb_set(c.payload, '{serviciosIncluidos}',
  (select coalesce(jsonb_agg((x.e - 'costoNeto' - 'proveedorId') order by x.ord), '[]'::jsonb)
     from jsonb_array_elements(c.payload -> 'serviciosIncluidos') with ordinality as x(e, ord)))
from objetivo o where c.id = o.id;
-- postcheck en la misma transacción (debe dar 0) y luego COMMIT o ROLLBACK
```

**Fase 3 — Abiertas.** Dos opciones; recomiendo **A** para vigentes y **B** para vencidas.

- **A. Re-huellar (conserva la conversión).** Un script de servidor (Node, con la llave en el entorno del operador, nunca en el SQL ni en el log) que, por cotización abierta vigente:
  1. asocia cada entrada anterior a su hotel por `paqueteId` (si dos hoteles comparten paquete y no se puede decidir, la omite y queda para regenerar);
  2. toma `ref` del ítem; si el ítem no tiene `ref`, la omite;
  3. calcula `huella`/`huellaProveedor` con el `costoNeto`/`proveedorId` **guardados**, de modo que la verificación siga siendo contra lo cotizado;
  4. escribe el formato nuevo y elimina los valores en claro;
  5. registra solo conteos (procesadas / omitidas).

  Requiere escribir y probar ese script en un PR aparte: es alcance nuevo y no está hecho.
- **B. Quitar sin re-huellar.** Mismo SQL de la fase 2 con `estado = 'abierta'`. Esas cotizaciones quedan **no verificables** y su conversión se detiene: habrá que regenerarlas. Simple, pero afecta a los asesores.

**Fase 4 — Postcheck.** Volver a correr el conteo (`con_costo_neto = 0`, `con_proveedor = 0`) y probar con una sesión simulada de `venta` (transacción con `set local role authenticated` y los claims del JWT, terminando en rollback) que el payload leído no trae esas claves.

**Rollback.** Restaurar `payload->'serviciosIncluidos'` desde el respaldo de la fase 1 para los `id` afectados, en una transacción.

**Qué no hace este plan**
- No toca `auditoria`: el trigger genérico conserva el "antes" de cada `UPDATE` (y ya tiene los inserts originales) **con los costos**. Es legible solo por superadmin y gerencia; depurarla es una decisión aparte.
- No hace backfill de las cotizaciones B2B sin incluidos guardados: no hay costo cotizado que reconstruir; deben regenerarse.
- No recalcula ni cambia precios, contratos ni CxP existentes.

## 7. Cómo leer los conteos

- `conteo_incluidos_sin_proveedor.sql`: cada fila es un paquete con al menos un incluido con costo y sin proveedor, o con modo inválido. Esos paquetes no podrán convertir cotizaciones con #353 hasta completar el proveedor. "Costo" por grupo es aproximado: basta un rango GENERAL con precio > 0.
- `conteo_payload_costos_incluidos.sql`:
  - consulta 1: por agencia/estado/mes, cuántas exponen costo o proveedor, cuántas ya son formato nuevo, cuántas son anteriores no verificables y cuántas están vencidas;
  - consulta 2: abiertas sin incluidos guardados cuyo paquete los tiene hoy (no convertirán).

Las dos son de solo lectura, sin PII ni importes, y tienen guardas para no
abortar ni contar mal:
- todo acceso al payload pasa por `case when jsonb_typeof(...) = 'array'`;
- `paqueteId` se compara como texto (`paquete_id::text = it ->> 'paqueteId'`), sin cast: una cifra fuera del rango de bigint no coincide en vez de abortar;
- `modo` NULL cuenta como no válido (`modo_valido` con `coalesce`), en el conteo y en el HAVING.

Prueba reproducible, solo local: `sh supabase/scripts/test_conteos_incluidos.sh`
(levanta un Postgres desechable en Docker con datos sintéticos, incluidos
`modo` NULL y `paqueteId` fuera de rango, compara valores exactos y verifica
que no se escribe nada). No se han corrido contra Preview ni Producción.

## 8. Enlaces cruzados

- [`reservar.md`](./reservar.md): flujo de reserva y `computarReserva`.
- [`portal-b2b.md`](./portal-b2b.md): `b2b_solicitudes` y facturación del aliado (`getContextoB2B`).
- `CLAUDE.md` §12: rotación de llaves de Supabase.
