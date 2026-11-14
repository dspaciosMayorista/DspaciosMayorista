-- ROLLBACK de la migración 288 (#75, obligaciones al confirmar). Restaura las 4 funciones a su texto anterior y elimina lo que creó la 288.
-- SE NIEGA si hay obligaciones previstas SIN materializar (esos contratos pendientes perderían sus CxP previstas) o si las funciones ya no son las de la 288.
-- Conserva (no borra evidencia): ventas.obligaciones_materializadas_en y cuentas_por_pagar.clave_prevista (columnas nullable, inofensivas).
begin;

do $$
begin
  if to_regclass('public.contrato_obligaciones_previstas') is null then
    raise exception 'rollback 288: la 288 no está aplicada.';
  end if;
  if exists (select 1 from public.contrato_obligaciones_previstas where materializada_en is null) then
    raise exception 'rollback 288: hay % obligación(es) prevista(s) sin materializar; revertir ahora haría perder las CxP de esos contratos pendientes. Confírmalos o elimínalos antes.',
      (select count(*) from public.contrato_obligaciones_previstas where materializada_en is null);
  end if;
  if position('p75_priv.' in (select prosrc from pg_proc where oid = 'public.confirmar_venta(text)'::regprocedure)) = 0
     or position('p75_priv.' in (select prosrc from pg_proc where oid = 'public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)'::regprocedure)) = 0
     or position('p75_priv.' in (select prosrc from pg_proc where oid = 'public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure)) = 0 then
    raise exception 'rollback 288: alguna de las funciones ya no es la de la 288 (alguien la cambió después); revisa antes de revertir.';
  end if;
end $$;

-- Las bases verbatim vuelven a su nombre público original.
do $$
begin
  execute replace(pg_get_functiondef('p75_priv.registrar_financiero_base(text,text,jsonb,jsonb)'::regprocedure),
                  'FUNCTION p75_priv.registrar_financiero_base(', 'FUNCTION public.registrar_financiero_contrato(');
  execute replace(pg_get_functiondef('p75_priv.registrar_abono_base(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)'::regprocedure),
                  'FUNCTION p75_priv.registrar_abono_base(', 'FUNCTION public.registrar_abono(');
  -- 1b: la conversión de cotización y la transferencia de pagos previos vuelven a su cuerpo original.
  execute replace(pg_get_functiondef('p75_priv.convertir_cotizacion_base(bigint,uuid)'::regprocedure),
                  'FUNCTION p75_priv.convertir_cotizacion_base(', 'FUNCTION public.convertir_cotizacion_a_contrato(');
  execute replace(pg_get_functiondef('p75_priv.transferir_pagos_previos_base(bigint,text,uuid)'::regprocedure),
                  'FUNCTION p75_priv.transferir_pagos_previos_base(', 'FUNCTION public.transferir_pagos_previos_a_abonos(');
end $$;

-- 1b: el trigger de protección de obligaciones #63 vuelve a la definición de la 227 (sin el traslado a «prevista»).
CREATE OR REPLACE FUNCTION public.trg_cxp_borrada_63()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato and v.aceptacion_63_id = old.aceptacion_63_id) then
    raise exception 'p63_cxp_protegida: la obligación aceptada % del contrato % no se elimina mientras el contrato exista', old.obligacion_63, old.numero_contrato;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_venta(p_numero text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
declare v record; v_n integer; v_sillas integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sesión requerida.';
  end if;
  -- Con la RLS de quien llama (INVOKER): si no la ve, no la confirma.
  select estado, financiero_estado into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Contrato no encontrado o sin acceso.';
  end if;
  if v.financiero_estado = 'pendiente' then
    raise exception using errcode = 'P0001', message =
      'Este contrato tiene el registro de costos/cuentas por pagar incompleto (fallo técnico al crearlo) — no se puede confirmar todavía. Un administrador debe reintentarlo antes de continuar.';
  end if;
  if v.estado = 'confirmado' then
    -- Testigo para el ayudante DEFINER (ver cabecera): solo después de que la
    -- RLS de quien llama dejó leer la venta con FOR UPDATE.
    perform set_config('app.confirmar_venta_token', p_numero || '|' || auth.uid()::text, true);
    v_sillas := public._confirmar_sillas_de_venta(p_numero);
    perform set_config('app.confirmar_venta_token', '', true);
    return jsonb_build_object('ok', true, 'ya_confirmado', true, 'sillas_confirmadas', v_sillas);
  end if;
  if v.estado is distinct from 'pendiente' then
    raise exception using errcode = 'P0001', message =
      format('Solo se confirma una venta pendiente (estado actual: %s).', coalesce(v.estado, 'sin estado'));
  end if;
  update public.ventas set estado = 'confirmado' where numero_contrato = p_numero;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = '42501', message = 'Sin permiso para confirmar esta venta.';
  end if;
  perform set_config('app.confirmar_venta_token', p_numero || '|' || auth.uid()::text, true);
  v_sillas := public._confirmar_sillas_de_venta(p_numero);
  perform set_config('app.confirmar_venta_token', '', true);
  return jsonb_build_object('ok', true, 'ya_confirmado', false, 'sillas_confirmadas', v_sillas);
end $function$;

drop function if exists public.pendiente_aplicar_servicios(text, bigint[], jsonb, jsonb, bigint[], jsonb, jsonb, bigint[], jsonb);
drop function if exists public.confirmar_tras_conversion(text, uuid);
drop function if exists public.contrato_es_neto(text);
drop function if exists public.estado_confirmacion_pago(text);
drop function if exists public.reintentar_confirmacion_pago(text);
drop function if exists p75_priv.alcanza_minimo(text);
drop function if exists p75_priv.trasladar_cxp_a_previstas(text);
drop function if exists p75_priv.mover_cxp_a_prevista(bigint, text);
drop function if exists public.prevista_cxp_aplicar(text, bigint[], jsonb, jsonb);
drop function if exists p75_priv.confirmar_por_pago(text, uuid);
drop function if exists p75_priv.materializar_obligaciones(text);
drop function if exists p75_priv.normalizar_abonos_previos(text);
drop function if exists p75_priv.estado_minimo(text);
drop function if exists p75_priv.pagado_en(text, text, numeric);
drop function if exists p75_priv.regla_confirmacion(text);
drop function if exists p75_priv.registrar_financiero_base(text, text, jsonb, jsonb);
drop function if exists p75_priv.registrar_abono_base(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid);
drop function if exists p75_priv.convertir_cotizacion_base(bigint, uuid);
drop function if exists p75_priv.transferir_pagos_previos_base(bigint, text, uuid);
delete from public.contrato_guardas_config where tabla = 'contrato_obligaciones_previstas';
drop table public.contrato_obligaciones_previstas;
drop index if exists public.cxp_clave_prevista_uq;
drop schema p75_priv;

do $$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.confirmar_venta(text)'::regprocedure) is distinct from '97809e36dab24bc4ecfddf37a9ef4016'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)'::regprocedure) is distinct from 'b2e0d1e0aa37bcf11e00c58afbabffd9'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure) is distinct from '33e309dc1181020d20809a4f79394dbc'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.convertir_cotizacion_a_contrato(bigint,uuid)'::regprocedure) is distinct from 'edc9975010746e53e4af6a75ad9763dc'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.transferir_pagos_previos_a_abonos(bigint,text,uuid)'::regprocedure) is distinct from '4814691695eb7587c18628ede17f266f'
     or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.trg_cxp_borrada_63()'::regprocedure) is distinct from 'c3150ccad0ef87818956ebc1e53f82d9' then
    raise exception 'rollback 288: las funciones restauradas no coinciden con las originales (md5); se deshace todo.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
