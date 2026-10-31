-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 263 (PROVISIONAL, NO APLICADA) — reemplazo ATÓMICO de los precios por trayecto de una vigencia.
-- Depende de la 262 (tabla servicio_precio_alcance). Número provisional: 257/260/261 existen en otras ramas; nadie usa la 263 (revisado en local).
--
-- Por qué: borrar + insertar desde la aplicación (dos llamadas) deja la vigencia sin precios si falla el segundo paso o el proceso muere entre ambos. Esta
-- función hace las dos cosas en UNA transacción: cualquier error en cualquier fila (CHECK, rango cruzado, único por persona, RLS) deshace todo y la
-- configuración anterior queda íntegra.
--
-- SECURITY INVOKER a propósito: la RLS de la 262 (superadmin/gerencia/administracion/operaciones) sigue mandando; un rol sin permiso falla en el INSERT y la
-- transacción entera se revierte (su DELETE tampoco se conserva). No concede nada nuevo. EXECUTE solo para `authenticated`.
-- GENERAL es la tarifa histórica y no vendible: no admite precios por trayecto (se rechaza aquí también, no solo en la app).
-- Cada fila trae SU precio: la función no calcula ninguno a partir de otro (ni mitad ni doble).
-- Solo agrega una función: no toca datos ni objetos existentes. Rollback: supabase/scripts/rollback_263_reemplazar_precios_alcance.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.servicio_precio_alcance') is null then
    raise exception '263 ABORTADA SIN MODIFICAR NADA: falta la tabla servicio_precio_alcance (aplica antes la 262).';
  end if;
end $$;

create or replace function public.reemplazar_precios_alcance(p_temporada_id bigint, p_filas jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_nombre text;
  v_n      integer;
begin
  if p_temporada_id is null then
    raise exception 'La vigencia es obligatoria.' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'Los precios deben enviarse como una lista.' using errcode = '22023';
  end if;

  -- Serializa a quienes reemplazan la MISMA vigencia (mismo candado que el trigger de rangos): el resultado es una u otra configuración completa, nunca mezcla.
  perform pg_advisory_xact_lock(hashtextextended('servicio_precio_alcance:' || p_temporada_id::text, 0));

  select nombre into v_nombre from public.servicio_temporadas where id = p_temporada_id;
  if not found then
    raise exception 'Vigencia no encontrada.' using errcode = 'P0002';
  end if;
  if upper(btrim(v_nombre)) = 'GENERAL' then
    raise exception 'GENERAL es la tarifa histórica y no se vende: carga los precios por trayecto en una vigencia con fechas.' using errcode = '22023';
  end if;

  delete from public.servicio_precio_alcance where servicio_temporada_id = p_temporada_id;

  -- Una fila inválida (alcance nulo/ajeno, precio negativo, rango incompleto/cruzado, dos precios por persona, RLS) lanza error y revierte también el DELETE.
  insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio)
  select p_temporada_id, f.alcance, f.pax_desde, f.pax_hasta, f.precio
    from jsonb_to_recordset(p_filas) as f(alcance text, pax_desde integer, pax_hasta integer, precio numeric);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.reemplazar_precios_alcance(bigint, jsonb) from public, anon;
grant execute on function public.reemplazar_precios_alcance(bigint, jsonb) to authenticated;
comment on function public.reemplazar_precios_alcance(bigint, jsonb) is '263 (provisional): reemplaza de forma atómica los precios por trayecto de una vigencia (todo o nada).';

commit;
