-- Rollback de la 253 (cuerpo copiado byte a byte de la 242, para que el preflight de la 253 pueda volver a pasar): deja `p40_exigir_cotizacion_vigente` como la dejó la 242 (solo vigencia).
begin;

do $$
begin
  if coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')), '') !~ 'SALIDA_PASADA' then
    raise exception 'ROLLBACK 253 ABORTADO: la 253 no está aplicada (la guarda no contiene COTIZACION_SALIDA_PASADA).';
  end if;
  -- No pisa un cambio posterior a la 253: solo revierte si el cuerpo vigente es exactamente el de la 253.
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')), chr(13), '')) <> '96ba71a5a88766e69d9b1e2908b89c2c' then
    raise exception 'ROLLBACK 253 ABORTADO: la guarda fue modificada después de la 253 (md5 %); no se sobrescribe.',
      md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')), chr(13), ''));
  end if;
end $$;

create or replace function public.p40_exigir_cotizacion_vigente(p_cotizacion bigint)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado text;
  v_vigencia date;
  v_hoy date := public.fecha_negocio();
begin
  select c.estado, c.vigencia_hasta into v_estado, v_vigencia from public.cotizaciones c where c.id = p_cotizacion;
  if not found then
    return;  -- la función protegida rechaza la inexistente con su propio mensaje
  end if;
  if v_estado = 'abierta' and v_vigencia is not null and v_vigencia < v_hoy then
    raise exception 'COTIZACION_VENCIDA: la cotización % venció el % (hoy en Bogotá: %); renueva su vigencia o genera una cotización nueva.',
      p_cotizacion, v_vigencia, v_hoy using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.p40_exigir_cotizacion_vigente(bigint) from public, anon, authenticated;
grant execute on function public.p40_exigir_cotizacion_vigente(bigint) to service_role;
commit;
