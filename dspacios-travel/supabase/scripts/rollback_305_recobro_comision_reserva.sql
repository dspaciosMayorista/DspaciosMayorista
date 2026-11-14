-- Rollback de la migración 305 (#14-A): restaura `registrar_comision_b2b_reserva` a la definición de la 286 (sin lectura del recobro). No toca datos.
-- ATENCIÓN: contratos creados con recobro tienen `comision_b2b`/plan calculados con la regla de la 305; tras el rollback la función volvería a rechazar un NUEVO registro con recobro,
-- pero no modifica los ya registrados. Verifica por md5 que lo restaurado es EXACTAMENTE la 286.
begin;
create or replace function public.registrar_comision_b2b_reserva(p_numero text, p_aliado_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    text := public.mi_rol()::text;
  v        public.ventas;
  a        public.aliados;
  v_param  numeric;
  v_pct    numeric;
  v_bruto  numeric;
  v_base   numeric;
  v_id     bigint;
  v_origen text;
  v_ver    integer;
begin
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
    raise exception 'No autorizado para registrar la comisión de la reserva.' using errcode = '42501';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant_cotizacion(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  if v.financiero_estado is distinct from 'pendiente'
     or v.financiero_actualizado_en < now() - interval '5 minutes' then
    raise exception 'La comisión de reserva solo se registra mientras se crea el contrato %.', p_numero using errcode = 'P0001';
  end if;
  if v.tipo_asesor not in ('agencia','freelance') then
    raise exception 'El contrato % no es una venta B2B.', p_numero using errcode = 'P0001';
  end if;
  if v.aliado_id is distinct from p_aliado_id then
    raise exception 'El aliado no coincide con el de la venta %.', p_numero using errcode = 'P0001';
  end if;
  select * into a from public.aliados where id = p_aliado_id;
  if not found then
    raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
  end if;
  if a.tipo is not null and a.tipo <> v.tipo_asesor then
    raise exception 'El aliado es de tipo %, la venta es %.', a.tipo, v.tipo_asesor using errcode = 'P0001';
  end if;
  if v_rol in ('agencia','freelance')
     and (select u.aliado_id from public.usuarios u where u.id = auth.uid()) is distinct from p_aliado_id then
    raise exception 'Un aliado solo registra su propia comisión.' using errcode = '42501';
  end if;
  -- Sin duplicados: ni fila (histórica o NETA) ni plan de ESTE contrato (por identidad).
  if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero)
     or exists (select 1 from public.comision_plan c where c.contrato_uid = v.contrato_uid) then
    raise exception 'El contrato % ya tiene comisión B2B.', p_numero using errcode = '23505';
  end if;

  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v.tipo_asesor = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  v_pct := coalesce(a.pct_comision, v_param, case when v.tipo_asesor = 'agencia' then 0.12 else 0.11 end);
  v_origen := case when a.pct_comision is not null then 'aliado' when v_param is not null then 'general' else 'defecto' end;
  v_bruto := coalesce(v.precio_venta, 0) + case when v.modo_compra = 'neta' then coalesce(v.comision_b2b, 0) else 0 end;
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0));
  if v.modo_compra in ('neta','comisionable')
     and abs(round(v_base * v_pct) - coalesce(v.comision_b2b, -1000000)) > 1 then
    raise exception 'La comisión de la venta % (%) no coincide con la calculada (%).',
      p_numero, v.comision_b2b, round(v_base * v_pct) using errcode = 'P0001';
  end if;

  if v.modo_compra = 'neta' or (not p97_priv.ciclo_activo() and v.estado is distinct from 'pendiente') then
    -- NETO (el descuento ya está en el precio: queda REGISTRADA la fila descontada, pagada, nunca por pagar ni pago adicional) o ciclo apagado con contrato NO pendiente
    -- (tratamiento histórico: fila exigible al crear). Un PENDIENTE nunca entra aquí salvo NETO: va al plan, con el interruptor en cualquier posición.
    insert into public.aliados_b2b (
      numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
      precio_venta, base_comision, base_explicita, pct_comision,
      recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion,
      estado, descontada_en_precio
    ) values (
      v.numero_contrato, v.tenant, a.nombre, a.nit, v.tipo_asesor, a.id,
      v_bruto, v_base, true, v_pct,
      0, 0, coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0),
      case when v.modo_compra = 'neta' then 'pagada' else 'pendiente' end,
      v.modo_compra = 'neta'
    ) returning id into v_id;
    return v_id;
  end if;

  -- PVP/comisionable (pendiente con cualquier interruptor; no pendiente con ciclo encendido): dependencias verificadas y PLAN ligado a la identidad del contrato; la fila exigible nace al confirmar.
  perform p97_priv.exigir_dependencias();
  select coalesce(max(c.version), 0) + 1 into v_ver from public.comision_plan c where c.cotizacion_id is null and c.contrato_uid = v.contrato_uid;
  insert into public.comision_plan (cotizacion_id, numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total,
                                    recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_por_id)
  values (null, p_numero, v.contrato_uid, v_ver, v.tenant, 0, a.id, v.tipo_asesor, coalesce(v.moneda, 'COP'), v_bruto, coalesce(v.impuesto, 0), 0, 0,
          v_base, round(v_pct, 4), v_origen, round(v_base * round(v_pct, 4)), round(v_base * round(v_pct, 4)), auth.uid())
  returning id into v_id;
  -- Un contrato que NACE ya confirmado ('activo': tratamiento histórico) no tiene transición posterior que materialice su plan: se materializa aquí, con la misma función.
  if v.estado in ('confirmado', 'activo') then perform p97_priv.materializar(p_numero, false); end if;
  return v_id;
end;
$$;
revoke all on function public.registrar_comision_b2b_reserva(text, bigint) from public, anon;
grant execute on function public.registrar_comision_b2b_reserva(text, bigint) to authenticated, service_role;

comment on function public.registrar_comision_b2b_reserva(text, bigint) is null;
do $$
begin
  if md5(replace((select prosrc from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure), chr(13), '')) is distinct from 'ebf1c8610d395d19b53d0e574e3bc365' then
    raise exception 'ROLLBACK_305: registrar_comision_b2b_reserva no quedó idéntica a la 286.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
