-- ───────────────────────────────────────────────────────────────────────────
-- BARRERAS B→C y PREVIA A E · señales observables — SOLO LECTURA.
-- Diseño docs/futuro/traslado-cupos-y-mover-pasajero.md §6.8.5.
--
-- Una sola consulta SELECT: no crea, no modifica, no bloquea nada y no
-- devuelve datos de pasajeros (solo conteos y estados). Antes de correrla,
-- EDITAR la fecha `desde` (CTE `param`): el instante en que el despliegue de
-- Producción con el código B quedó activo (Vercel → Deployments → Production →
-- "Ready" y asignado al dominio). Las señales miran solo lo ocurrido después.
--
-- Por qué funciona: la auditoría (087) registra cada escritura con
-- `creado_en = now()`, y now() es la hora de INICIO de la transacción. Una
-- función atómica (fase B) hace todas sus escrituras en una transacción, así
-- que comparten `creado_en`; el código anterior a B las hacía en peticiones
-- separadas. Una escritura "suelta" (sin su pareja en la misma transacción) es
-- la firma de código viejo escribiendo directo.
--
-- Lectura de resultados (columna `bloquea`):
--   · 'B→C'  → si n > 0, NO activar la 199 (fase C).
--   · 'E'    → si n > 0, NO activar la 200 (fase E).
--   · 'info' → estado de fases y de C0; no bloquea por sí solo.
-- Las señales cubren la estructura (filas, cupos, bloqueo_id) y el historial.
-- Un cambio directo de estado/contrato de una silla (V) NO deja firma
-- distinguible en la auditoría: para eso está el modo aviso C0
-- (c0_aviso_guarda_escritura.sql), cuya tabla se cuenta aquí.
-- ───────────────────────────────────────────────────────────────────────────
with
param as (select timestamptz '2026-10-01 00:00:00-05' as desde),   -- ← EDITAR
aud as (
  select a.creado_en, a.tabla, a.accion, a.cambios, a.antes, a.despues, a.actor_id
    from public.auditoria a, param p
   where a.creado_en >= p.desde and a.tabla in ('sillas', 'bloqueos_vuelo', 'movimientos_silla')
),
-- Las señales cuentan solo escrituras CON sesión (actor_id): las que hace el
-- código desplegado. Sin actor = SQL de mantenimiento o service_role; se
-- informan aparte (fila 5) y no bloquean, pero conviene revisarlas.
api as (select * from aud where actor_id is not null),
tx_bloqueo_ins as (select distinct creado_en from aud where tabla = 'bloqueos_vuelo' and accion = 'INSERT'),
tx_bloqueo_del as (select distinct creado_en from aud where tabla = 'bloqueos_vuelo' and accion = 'DELETE'),
tx_mov_ins     as (select distinct creado_en from aud where tabla = 'movimientos_silla' and accion = 'INSERT'),
fila(orden, bloquea, senal, n, detalle) as (
  -- ── Estado de las fases ──
  select 1, 'info', 'fase B en la base (192–197)',
         (case when to_regprocedure('public.trasladar_cupos(bigint, bigint, integer, text, uuid)') is not null
                and to_regprocedure('public.crear_bloqueo(jsonb, integer)') is not null
                and to_regprocedure('public._vaciar_sillas(bigint[], text)') is not null
                and to_regprocedure('public.confirmar_venta(text)') is not null then 1 else 0 end)::bigint,
         '1 = funciones de 194–197 presentes'
  union all
  select 2, 'info', 'fase C activa (199)',
         (case when to_regprocedure('public._sillas_guarda_escritura()') is not null then 1 else 0 end)::bigint, '1 = activa'
  union all
  select 3, 'info', 'fase E activa (200)',
         (case when to_regprocedure('public._historial_vuelos_inmutable()') is not null then 1 else 0 end)::bigint, '1 = activa'
  union all
  select 4, 'info', 'modo aviso C0 instalado',
         (select count(*) from pg_trigger where tgname in ('sillas_aviso_escritura', 'bloqueos_aviso_cupos'))::bigint, '2 = instalado'
  union all
  select 5, 'info', 'escrituras estructurales SIN sesión desde `desde`',
         (select count(*) from aud where actor_id is null and (accion in ('INSERT', 'DELETE') or cambios ? 'cupos_total' or cambios ? 'bloqueo_id'
             or (tabla = 'movimientos_silla' and accion = 'UPDATE'))),
         'SQL de mantenimiento o service_role: no las hace el código de la app con sesión; revisarlas a mano'
  union all
  -- ── Barrera B→C ──
  select 10, 'B→C', 'C0: avisos de escritura directa desde `desde`',
         case when to_regclass('public.vuelos_guarda_avisos') is null then 0
              else (xpath('/row/n/text()', query_to_xml(format(
                     'select count(*) as n from public.vuelos_guarda_avisos where creado_en >= %L',
                     (select desde from param)), false, true, '')))[1]::text::bigint end,
         'cada fila es una escritura que la 199 rechazaría (tabla vuelos_guarda_avisos)'
  union all
  select 11, 'B→C', 'sillas creadas fuera de crear_bloqueo',
         (select count(*) from api where tabla = 'sillas' and accion = 'INSERT' and creado_en not in (select creado_en from tx_bloqueo_ins)),
         'INSERT de sillas sin un INSERT de record en la misma transacción (crearBloqueo/cambiarSillas viejos)'
  union all
  select 12, 'B→C', 'sillas borradas fuera de eliminar_bloqueo',
         (select count(*) from api where tabla = 'sillas' and accion = 'DELETE' and creado_en not in (select creado_en from tx_bloqueo_del)),
         'DELETE de sillas sin el DELETE del record en la misma transacción (eliminarCupo/eliminarBloqueo viejos)'
  union all
  select 13, 'B→C', 'records creados sin sus sillas',
         (select count(*) from api a where tabla = 'bloqueos_vuelo' and accion = 'INSERT' and coalesce((despues ->> 'cupos_total')::int, 0) > 0
             and not exists (select 1 from aud s where s.tabla = 'sillas' and s.accion = 'INSERT' and s.creado_en = a.creado_en)),
         'INSERT de record con cupos sin INSERT de sillas en la misma transacción (crearBloqueo viejo)'
  union all
  select 14, 'B→C', 'cupos_total cambiado sin historial',
         (select count(*) from api where tabla = 'bloqueos_vuelo' and accion = 'UPDATE' and cambios ? 'cupos_total'
             and creado_en not in (select creado_en from tx_mov_ins)),
         'UPDATE de cupos_total sin movimiento en la misma transacción (cambiarSillas/eliminarCupo viejos)'
  union all
  select 15, 'B→C', 'sillas cambiadas de record sin historial',
         (select count(*) from api where tabla = 'sillas' and accion = 'UPDATE' and cambios ? 'bloqueo_id'
             and creado_en not in (select creado_en from tx_mov_ins)),
         'UPDATE de bloqueo_id sin movimiento en la misma transacción'
  union all
  -- ── Barrera previa a E (también cuentan para B→C) ──
  select 20, 'E', 'movimientos sin operación',
         (select count(*) from api where tabla = 'movimientos_silla' and accion = 'INSERT' and despues ->> 'operacion_id' is null),
         'historial insertado sin operacion_id (cambiarSillas/moverPasajeroSilla viejos); se cuenta en la auditoría aunque la fila se haya borrado después'
  union all
  select 21, 'E', 'historial borrado',
         (select count(*) from api where tabla = 'movimientos_silla' and accion = 'DELETE'),
         'DELETE de movimientos_silla (eliminarCupo/eliminarBloqueo viejos, o una corrección)'
  union all
  select 22, 'E', 'historial editado (salvo tramos de mover_pasajero)',
         (select count(*) from api where tabla = 'movimientos_silla' and accion = 'UPDATE'
             and exists (select 1 from jsonb_object_keys(cambios) k where k <> 'tramos_contrato_actualizados')),
         'UPDATE de movimientos_silla en columnas distintas de tramos_contrato_actualizados'
)
select orden, bloquea, senal, n,
       case when bloquea = 'info' then 'INFO' when n = 0 then 'OK' else 'NO ACTIVAR' end as veredicto,
       detalle
  from fila
union all
select 98, 'B→C', 'RESUMEN barrera B→C', (select coalesce(sum(n), 0) from fila where bloquea in ('B→C', 'E')),
       case when (select coalesce(sum(n), 0) from fila where bloquea in ('B→C', 'E')) = 0 then 'SIN SEÑALES (falta la parte de Vercel)' else 'NO ACTIVAR C' end,
       'suma de 10–15 y 20–22; además deben cumplirse las condiciones de Vercel y Previews (§6.8.5)'
union all
select 99, 'E', 'RESUMEN barrera previa a E', (select coalesce(sum(n), 0) from fila where bloquea = 'E'),
       case when (select coalesce(sum(n), 0) from fila where bloquea = 'E') = 0 then 'SIN SEÑALES (falta la parte de Vercel)' else 'NO ACTIVAR E' end,
       'suma de 20–22; además deben cumplirse las condiciones de Vercel y Previews (§6.8.5)'
order by orden;
