-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 241 (ventas.titular_tipo_documento + copia del tipo en la conversión manual).
--   · SE NIEGA si hay contratos con titular_tipo_documento guardado: al quitar la columna se perdería el tipo del titular.
--   · Restaura el wrapper `convertir_cotizacion_manual_controlada` al de la 222 (sin copiar el tipo). El `cliente_tipo_documento` ya guardado (240) NO se toca.
-- Si el código nuevo sigue desplegado, convertir un carrito NETO falla sin la columna: revierte primero el despliegue.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_tipo_documento') then
    raise exception 'ROLLBACK 241 ABORTADO: la 241 no está aplicada.';
  end if;
  if exists (select 1 from public.ventas where titular_tipo_documento is not null) then
    raise exception 'ROLLBACK 241 ABORTADO: hay % contrato(s) con tipo de documento del titular guardado; al quitar la columna se perdería.',
      (select count(*) from public.ventas where titular_tipo_documento is not null);
  end if;
end;
$$;

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
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;

alter table public.ventas drop constraint if exists ventas_titular_tipo_documento_catalogo;
alter table public.ventas drop column titular_tipo_documento;

commit;
