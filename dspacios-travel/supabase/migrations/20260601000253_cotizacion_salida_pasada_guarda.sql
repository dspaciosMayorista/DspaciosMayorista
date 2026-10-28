-- ───────────────────────────────────────────────────────────────────────────
-- 253 · Una cotización ABIERTA cuya fecha de salida ya pasó (día de negocio de Bogotá) no se convierte en contrato.
--
-- La 242 solo miraba `vigencia_hasta`. Una cotización histórica sin vigencia (nula) o con la vigencia ya renovada no vence por esa vía, pero un viaje
-- en el pasado no se puede vender: se rechaza ANTES de numerar con `COTIZACION_SALIDA_PASADA`. `fecha_salida` nula (histórica, sin salida) NO caduca por
-- inferencia; el día de la salida aún cuenta como válido. La guarda vive en `p40_exigir_cotizacion_vigente`, la única puerta que ya llaman
-- `convertir_cotizacion_manual_controlada` y `aceptar_oferta_63` (242): no se re-crea ninguna otra función. Una cotización ya convertida o con aceptación #63
-- preparada sigue su reintento (la 242 ya lo exceptúa antes de llamar a esta función).
--
-- Aditiva: sin tablas ni columnas nuevas; mismo mensaje y mismos permisos que la 242. NO edita la 242 (aplicada).
-- Rollback: volver a crear `p40_exigir_cotizacion_vigente` con el cuerpo de la 242 (supabase/scripts/rollback_253_cotizacion_salida_pasada.sql).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') is null then
    raise exception '253 ABORTADA: falta public.p40_exigir_cotizacion_vigente (migración 242).';
  end if;
  -- Solo reemplaza la guarda auditada de la 242 (o la propia 253 ya aplicada: reaplicar es idempotente); cualquier otro cuerpo es un cambio ajeno que no se pisa.
  if md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')), chr(13), '')) not in ('bfb315e6cf65f62a5da232bc5df45f19', '96ba71a5a88766e69d9b1e2908b89c2c') then
    raise exception '253 ABORTADA: el cuerpo vigente de p40_exigir_cotizacion_vigente no es el de la 242 auditada (md5 %); revisa el cambio previo antes de reemplazarlo.',
      md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')), chr(13), ''));
  end if;
end $$;

create or replace function public.p40_exigir_cotizacion_vigente(p_cotizacion bigint)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado text;
  v_vigencia date;
  v_salida date;
  v_hoy date := public.fecha_negocio();
begin
  select c.estado, c.vigencia_hasta, c.fecha_salida into v_estado, v_vigencia, v_salida from public.cotizaciones c where c.id = p_cotizacion;
  if not found then
    return;  -- la función protegida rechaza la inexistente con su propio mensaje
  end if;
  -- Salida pasada primero: si además venció la vigencia, renovarla no sirve; hay que generar una cotización nueva.
  if v_estado = 'abierta' and v_salida is not null and v_salida < v_hoy then
    raise exception 'COTIZACION_SALIDA_PASADA: la salida de la cotización % era el % (hoy en Bogotá: %); genera una cotización nueva.',
      p_cotizacion, v_salida, v_hoy using errcode = 'P0001';
  end if;
  if v_estado = 'abierta' and v_vigencia is not null and v_vigencia < v_hoy then
    raise exception 'COTIZACION_VENCIDA: la cotización % venció el % (hoy en Bogotá: %); renueva su vigencia o genera una cotización nueva.',
      p_cotizacion, v_vigencia, v_hoy using errcode = 'P0001';
  end if;
end $$;

comment on function public.p40_exigir_cotizacion_vigente(bigint) is
  '253: rechaza una cotización ABIERTA con vigencia_hasta o fecha_salida anteriores al día de negocio de Bogotá; nulas = históricas, no vencen. Se llama ANTES de numerar. Solo service_role.';
revoke all on function public.p40_exigir_cotizacion_vigente(bigint) from public, anon, authenticated;
grant execute on function public.p40_exigir_cotizacion_vigente(bigint) to service_role;

commit;
