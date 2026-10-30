-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 241 · #40 E2 — El tipo de documento sobrevive a la conversión cotización → contrato
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_241_tipo_documento_conversion.sql
--
-- Problema: la 240 guarda `ventas.cliente_tipo_documento`, pero (a) la conversión de una cotización manual la hace la función SQL
-- `convertir_cotizacion_a_contrato` (198), que solo copia el NÚMERO; y (b) en una venta NETO el cliente comercial es el ALIADO y la persona es el «titular
-- de la reserva» (239): el tipo de cada uno necesita su propia columna, o el del titular acabaría guardado como tipo del aliado.
-- Qué hace: (1) agrega `ventas.titular_tipo_documento` (nullable, mismo catálogo que la 240); (2) redefine SOLO el wrapper
-- `convertir_cotizacion_manual_controlada` (222) para que, tras convertir, copie `payload.cliente.tipoDoc` de la cotización a
-- `ventas.cliente_tipo_documento` (catálogo; «PASAPORTE» → PAS; algo fuera del catálogo o sin número ⇒ NULL, nunca falla la conversión).
-- El resto del wrapper es IDÉNTICO al de la 222 (mismas guardas, mismo orden, misma ACL).
-- Qué NO hace: no toca la 198 ni la 240 (ya pueden estar aplicadas), no toca RLS, vistas ni datos existentes (sin backfill: no se inventa un tipo).
-- Orden de despliegue (las dos van juntas, scripts en supabase/scripts/): preflight 240 → migración 240 → postcheck 240 → preflight 241 → migración 241 → postcheck 241 → recién después el código nuevo (que escribe ambas columnas; sin la 240 y la 241 las conversiones fallan).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is null
     or to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null then
    raise exception 'MIGRACIÓN 241 ABORTADA: faltan las funciones de conversión (198/222).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cliente_tipo_documento') then
    raise exception 'MIGRACIÓN 241 ABORTADA: falta la 240 (ventas.cliente_tipo_documento).';
  end if;
end;
$$;

alter table public.ventas add column if not exists titular_tipo_documento text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_titular_tipo_documento_catalogo') then
    alter table public.ventas add constraint ventas_titular_tipo_documento_catalogo
      check (titular_tipo_documento is null or titular_tipo_documento in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT'));
  end if;
end;
$$;

comment on column public.ventas.titular_tipo_documento is '241 (#40 E2): tipo del documento del titular de la reserva (NETO, junto a titular_documento). NULL = no aplica / no se eligió. Nunca es el tipo del cliente aliado.';

-- Wrapper de la 222 + copia del tipo. La copia va DESPUÉS de convertir (la 198 ya insertó la venta) y de completar_conversion, dentro de la misma transacción.
create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida: la 198 devuelve el número existente sin escribir nada.
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  -- #50: todo rechazo nuevo ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  -- 241: el tipo elegido para el titular en la cotización pasa al contrato junto al número que ya copió la 198 (mismo número con CC y con CE no se confunden).
  update public.ventas v
     set cliente_tipo_documento = t.tipo
    from (
      select case
               when nullif(btrim(c.payload#>>'{cliente,numeroDoc}'), '') is null then null
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) = 'PASAPORTE' then 'PAS'
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then upper(btrim(c.payload#>>'{cliente,tipoDoc}'))
               else null
             end as tipo
        from public.cotizaciones c where c.id = p_cotizacion_id
    ) t
   where v.numero_contrato = v_res and v.cotizacion_id = p_cotizacion_id;
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

-- CREATE OR REPLACE conserva la ACL; se reafirma (mismo criterio que la 222).
revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;

commit;
