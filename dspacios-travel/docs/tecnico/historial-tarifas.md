# Historial de tarifas de hotel — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`calculadoras-hotel.md`](./calculadoras-hotel.md),
> [`tarifas-hotel.md`](./tarifas-hotel.md) · Pendientes #15/#26 de `TASKS.md`.
> Migración **203** (reservada para Tarifas; renumerada desde la "201" provisional porque la
> 201 de `main`/Producción es de Vuelos). **Sin aplicar** en ningún entorno remoto. Orden:
> después de la 201 (probada sobre la cadena real 1–201). No depende de la 202 (reservada para
> CRM) ni de la 204 (reservada para Contabilidad): puede aplicarse antes que ellas.
>
> **Cruce futuro con la 202:** si esa migración (u otra posterior) instala auditoría global
> adjuntando `trg_auditoria` a las tablas de `public`, debe **excluir**
> `tarifa_hotel_historial` y `hotel_temporadas_historial` (como la 087 excluye `auditoria` y
> `tarifario_resultado`): ya son historial inmutable y auditarlas duplicaría cada versión en
> `auditoria`. Ambas tablas lo dicen en su `comment on table`, y el postcheck de la 203 trae el
> chequeo "historiales sin triggers propios" para re-correrlo después de esa migración.

## 1. Qué se guarda y dónde

| Fuente | Qué guarda | Desde | Quién la lee |
|---|---|---|---|
| `tarifa_hotel_historial` (203) | Versión anterior completa de cada fila de `tarifa_hotel` antes de reemplazarla, editarla o borrarla, con autor, fecha, motivo y **foto de su vigencia en ese momento** (`vigencia`, `vigencia_fuente`) | Aplicación de la 203 | Roles internos (RLS) — ficha del hotel, "Historial interno de tarifas" |
| `hotel_temporadas_historial` (203) | Versión anterior completa de cada vigencia antes de editarla o eliminarla | Aplicación de la 203 | Roles internos (RLS) |
| `auditoria` (087/108) | `antes`/`despues` de todo INSERT/UPDATE/DELETE de ambas tablas | Aplicación de la 087 | superadmin y gerencia (RLS) |

Ninguna de estas tablas ni funciones la lee el motor de cotización, reserva o tarifario
(lo verifica `pruebas/tarifasPromoMixtaPreservacion.test.ts`): el historial nunca se cotiza,
se publica ni se restaura.

### Foto de la vigencia (no metadatos actuales)

El trigger de `tarifa_hotel` busca la vigencia por nombre **en el instante del cambio**:

- `actual` — existía con ese nombre: se copian sus filas de `hotel_temporadas`.
- `historial` — ya no existía con ese nombre (la app renombra primero la vigencia y después
  hace la cascada a las tarifas; o la vigencia se eliminó antes): se toma su última versión en
  `hotel_temporadas_historial`.
- `no_encontrada` — sin rastro.

La ficha muestra estado (vigente / compra cerrada / compra futura / sin vigencia) **a la fecha
del cambio**, fechas de viaje y de compra, descuento, prioridad y régimen de esa foto
(`lib/calc/historialTarifas.ts::resumenVigenciaHistorica`). La única columna "de hoy" es
**Hoy (doble)**, rotulada como tal.

### Consulta

`consultar_historial_tarifas(hotel, búsqueda, cursor, límite)` — paginación por cursor
(`registrado_en desc, id desc`, estable aunque entren versiones nuevas) y búsqueda en servidor
(categoría, régimen, temporada, temporada base, motivo, operación, autor; `%` y `_` literales).
SECURITY INVOKER: decide la RLS. Probada con 1.200 versiones (6 páginas, sin repetidos).

## 2. Tarifas borradas ANTES de la 203 — qué se puede recuperar

Todo sale de `auditoria`:

- **Sí:** cada UPDATE/DELETE de `tarifa_hotel` desde que se aplicó la 087, con la fila completa
  anterior (precios, categoría, régimen, temporada, notas, edades…), fecha y actor.
- **Sí, reconstruida:** la vigencia de ese momento, cruzando los eventos de `hotel_temporadas`
  (último evento anterior → su `despues`; si no hay, primer evento posterior → su `antes`; si
  no hay, la fila actual). Si con ese nombre no existía ninguna vigencia en ese momento se
  usa su última versión anterior (`auditoria_previa`).
- **No:** nada anterior a la 087; columnas que no existían en esa época (p. ej.
  `precio_final_autoritativo` antes de la 179) salen vacías; un actor `null` significa
  service_role/sistema; TRUNCATE no se audita.

### Consulta verificable (solo lectura)

1. `supabase/scripts/auditoria_tarifas_recuperables_lectura.sql` — corre antes o después de la
   203: cobertura por tabla, versiones recuperables por hotel (`hoy_sin_fila` = lo que solo vive
   en auditoría), pérdidas por hotel/temporada/régimen y la verificación del respaldo del hotel 59.
2. Con la 203 aplicada: `select * from reconstruir_tarifas_desde_auditoria(<hotel_id | null>)`,
   que agrega la vigencia reconstruida y tres marcas: `existe_fila_actual`,
   `capturado_por_historial` (el trigger de la 203 ya guardó ese mismo cambio) y
   `ya_incorporado`.

Ambas probadas contra Postgres local con un escenario de renombre, eliminación y edición
posterior de vigencias (`supabase/scripts/pruebas/test_203_*.sh`, bloque A).

### Plan de incorporación — NO ejecutado, requiere autorización

Objetivo: que las versiones de antes de la 203 aparezcan en el mismo historial interno, sin
tocar `tarifa_hotel` ni publicar nada.

1. Correr la consulta 1 y revisar con el dueño el inventario por hotel.
2. Decidir el alcance: todos los hoteles **excepto el 59** (BLU BY TAMACÁ) — su PC/PAM de la
   vigencia 674 sigue solo como respaldo hasta nueva autorización.
3. En una transacción:
   ```sql
   insert into tarifa_hotel_historial
     (tarifa_id, hotel_id, operacion, motivo, datos, vigencia, vigencia_fuente, autor_email, registrado_en, auditoria_id)
   select tarifa_id, hotel_id, operacion, 'auditoria_previa_203', datos, vigencia, vigencia_fuente,
          autor_email, registrado_en, auditoria_id
   from reconstruir_tarifas_desde_auditoria(null)
   where not capturado_por_historial and not ya_incorporado and hotel_id <> 59;
   ```
   `auditoria_id` es único: repetirlo no duplica.
4. Verificar: conteo insertado = conteo de la consulta con el mismo filtro; ninguna fila de
   `tarifa_hotel` ni de `tarifario_resultado` cambió (comparar conteos/sumas antes y después).
5. Rollback: `delete from tarifa_hotel_historial where motivo = 'auditoria_previa_203';`
   (solo como postgres; la API no puede escribir el historial).

La ficha ya rotula ese motivo ("Auditoría · antes del historial").
