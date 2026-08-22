-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 156 (inventario de Empaquetados)
--
-- Borra por completo `armado_empaquetados`, `empaquetados` y
-- `empaquetado_cambios`, el RPC `actualizar_control_empaquetado()` y la
-- columna `tarifario_resultado.empaquetado_id` — no hay forma de "revertir
-- parcialmente" una tabla aditiva nueva salvo borrarla. Si ya se cargaron
-- empaquetados reales en producción, este rollback los PIERDE (no hay a
-- dónde migrar esos datos de vuelta: la tabla no existía antes de la 156) —
-- úsalo solo si la migración se corrió por error o antes de tener datos
-- reales cargados. Revisa el conteo antes de correrlo:
--
--   select count(*) from public.empaquetados;
--
-- ⚠️ Si `tarifario_resultado` ya tiene filas con `empaquetado_id` no nulo
-- (generadas por un paquete armado con empaquetados vinculados), este
-- rollback las deja con una referencia rota al borrar la columna — igual
-- que pasaría con cualquier columna de una tabla dependiente; revisa antes:
--
--   select count(*) from public.tarifario_resultado where empaquetado_id is not null;
--
-- ⚠️ Si `ventas.empaquetado_ref_id` ya tiene contratos reales apuntando a un
-- empaquetado (revisión de PR #268, defecto 4 — trazabilidad venta→origen),
-- este rollback también pierde esa relación. Revisa antes:
--
--   select count(*) from public.ventas where empaquetado_ref_id is not null;
--
-- `ventas_basica` (vista de la migración 148, YA en producción) se restaura
-- a su forma exacta de la 148 (sin `empaquetado_ref_id`) — no se puede
-- alterar una columna suelta de una vista.
--
-- Todo el archivo corre en una transacción explícita (`begin`/`commit`). Se
-- pega en el editor SQL de Supabase. Es idempotente (`drop ... if exists`).
-- ───────────────────────────────────────────────────────────────────────────

begin;

alter table public.tarifario_resultado drop constraint if exists tarifario_resultado_origen_excluyente_check;
alter table public.tarifario_resultado drop column if exists empaquetado_id;

-- `ventas_basica` depende de `ventas.empaquetado_ref_id` (la 156 la
-- re-declaró para exponerla) — hay que soltar la vista ANTES de poder
-- borrar la columna, o Postgres rechaza el DROP COLUMN con una dependencia
-- rota. Se restaura EXACTAMENTE como la dejó la migración 148 (sin
-- `empaquetado_ref_id`, que ya no existirá en `ventas` tras el drop de abajo).
-- `ventas_vuelo_sistema` (revisión posterior, hallazgo 2) TAMBIÉN depende de
-- `empaquetado_ref_id` — se suelta aquí mismo, sin restaurarla (no existía
-- antes de esta migración). `acceso_ventas_vuelo_sistema()` (ronda
-- siguiente, hallazgo 1 "AISLAMIENTO DE GERENCIA") es la función que usa esa
-- vista en su `where` — se suelta DESPUÉS de la vista (la vista depende de
-- la función, no al revés) y también sin restaurarla, mismo motivo.
--
-- ⚠️ Revisado (ronda posterior, cierre del hueco `anon EXECUTE` sobre las
-- dos funciones de esta migración — ver el comentario de cabecera de
-- `20260601000156_empaquetados.sql`): este `DROP FUNCTION` se lleva consigo
-- TODO el ACL de `acceso_ventas_vuelo_sistema()` (el `revoke`/`grant`
-- incluidos) — no hay nada que revertir aparte, porque la función deja de
-- existir por completo. `actualizar_control_empaquetado()` (abajo, junto a
-- las tablas) tiene la misma propiedad: su `DROP FUNCTION` también se lleva
-- su ACL completo. Ninguna de las dos se recrea en este rollback — no hace
-- falta repetir el `revoke`/`grant` aquí.
drop view if exists public.ventas_basica;
drop view if exists public.ventas_vuelo_sistema;
drop function if exists public.acceso_ventas_vuelo_sistema(text);

alter table public.ventas drop constraint if exists ventas_origen_excluyente_check;
alter table public.ventas drop column if exists empaquetado_ref_id;

create view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.tenant,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));

grant select on public.ventas_basica to authenticated;

drop policy if exists "armado_empaquetados: interno"        on public.armado_empaquetados;
drop policy if exists "empaquetados: lectura operativa"     on public.empaquetados;
drop policy if exists "empaquetados: escritura control"     on public.empaquetados;
drop policy if exists "empaquetado_cambios: lectura control"   on public.empaquetado_cambios;
drop policy if exists "empaquetado_cambios: escritura control" on public.empaquetado_cambios;

drop function if exists public.actualizar_control_empaquetado(bigint, text, text, text, text);

drop table if exists public.empaquetado_cambios;
drop table if exists public.armado_empaquetados;
drop table if exists public.empaquetados;

commit;
