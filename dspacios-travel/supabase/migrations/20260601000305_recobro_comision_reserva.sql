-- ───────────────────────────────────────────────────────────
-- 305 · RECOBRO DEL CARRITO EN LA COMISIÓN B2B DE RESERVA (#14-A)
--
-- QUÉ RESUELVE
-- `registrar_comision_b2b_reserva` (205/286) crea la comisión de una venta B2B recién creada y exige que `ventas.comision_b2b` sea `round((precio − impuesto) × %)`, registrando
-- siempre recobro 0. Con el recobro del carrito (#14-A: recobro DENTRO de la tarifa de adulto, con participación opcional del aliado) esa exigencia rechazaría la venta o,
-- peor, registraría una comisión sin el reparto del recobro. Aquí la función pasa a leer `ventas.recobro_total` (ya incluido en `precio_venta`) y `ventas.recobro_aliado`
-- (participación acotada a [0, recobro]) y aplica la regla ya aprobada de #97:
--   · el recobro COMPLETO sale de la base comisionable solo si la participación final es > 0:  base = max(bruto − impuesto − (participación > 0 ? recobro : 0), 0);
--   · ordinaria = round(base × %);  total al aliado = ordinaria + participación;
--   · `ventas.comision_b2b`: en PVP = la ordinaria; en NETO = lo DESCONTADO del precio (ordinaria + participación), de modo que bruto = precio_venta + comision_b2b;
--   · PVP: el plan (`comision_plan`) nace con `recobro_total`/`recobro_aliado` reales (sus CHECK ya exigen exactamente esta regla);
--   · NETO: la fila descontada de `aliados_b2b` guarda el recobro y la participación como porcentaje exacto (numeric(25,20)); si no se pudiera representar al centavo se rechaza.
-- SIN recobro (0 o NULL) el comportamiento es BYTE A BYTE el de la 286. Nada más cambia: mismas validaciones de rol, tenant, duplicado, estado y aliado.
--
-- Exige la 286 (plan de comisión #97). Aditiva e idempotente. Rollback: supabase/scripts/rollback_305_recobro_comision_reserva.sql
-- ───────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.comision_plan') is null then raise exception '305: falta la 286 (plan de comisión #97).'; end if;
  -- Idempotente: si la 305 ya la reemplazó (su comentario lo dice) no se compara contra la 286.
  if coalesce(obj_description('public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure, 'pg_proc'), '') not like '%305 (#14-A%'
     and md5(replace((select prosrc from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure), chr(13), '')) is distinct from 'ebf1c8610d395d19b53d0e574e3bc365' then
    raise exception '305: registrar_comision_b2b_reserva no es la de la 286; no se reemplaza.';
  end if;
end $$;

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
  v_rec    numeric;
  v_part   numeric;
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
  -- #14-A (305): recobro del carrito. `ventas.recobro_total` (ya incluido en precio_venta) y `ventas.recobro_aliado` (participación, acotada a [0, recobro]). Sin recobro (0/NULL) TODO queda como en la 286.
  v_rec  := greatest(coalesce(v.recobro_total, 0), 0);
  v_part := least(greatest(coalesce(v.recobro_aliado, 0), 0), v_rec);
  if coalesce(v.recobro_aliado, 0) > v_rec + 0.004 or coalesce(v.recobro_aliado, 0) < 0 or coalesce(v.recobro_total, 0) < 0 then
    raise exception 'El recobro de la venta % es inconsistente (participación %, recobro %).', p_numero, v.recobro_aliado, v.recobro_total using errcode = 'P0001';
  end if;
  if v_part > 0 and round(v_rec * round(v_part / v_rec, 20), 2) is distinct from round(v_part, 2) then
    raise exception 'La participación del aliado en el recobro (%) no se puede representar exactamente como porcentaje del recobro (%).', v_part, v_rec using errcode = 'P0001';
  end if;
  v_bruto := coalesce(v.precio_venta, 0) + case when v.modo_compra = 'neta' then coalesce(v.comision_b2b, 0) else 0 end;
  -- Regla #97: el recobro COMPLETO sale de la base solo si lo que se le paga al aliado de él (importe final) es > 0.
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0) - case when v_part > 0 then v_rec else 0 end);
  -- `comision_b2b`: en PVP = la ordinaria; en NETO = lo DESCONTADO del precio (ordinaria + participación).
  if v.modo_compra in ('neta','comisionable')
     and abs(round(v_base * v_pct) + case when v.modo_compra = 'neta' then v_part else 0 end - coalesce(v.comision_b2b, -1000000)) > 1 then
    raise exception 'La comisión de la venta % (%) no coincide con la calculada (%).',
      p_numero, v.comision_b2b, round(v_base * v_pct) + case when v.modo_compra = 'neta' then v_part else 0 end using errcode = 'P0001';
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
      v_rec, case when v_rec > 0 then round(v_part / v_rec, 20) else 0 end, coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0),
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
  values (null, p_numero, v.contrato_uid, v_ver, v.tenant, 0, a.id, v.tipo_asesor, coalesce(v.moneda, 'COP'), v_bruto, coalesce(v.impuesto, 0), v_rec, v_part,
          v_base, round(v_pct, 4), v_origen, round(v_base * round(v_pct, 4)), round(v_base * round(v_pct, 4)) + v_part, auth.uid())
  returning id into v_id;
  -- Un contrato que NACE ya confirmado ('activo': tratamiento histórico) no tiene transición posterior que materialice su plan: se materializa aquí, con la misma función.
  if v.estado in ('confirmado', 'activo') then perform p97_priv.materializar(p_numero, false); end if;
  return v_id;
end;
$$;
revoke all on function public.registrar_comision_b2b_reserva(text, bigint) from public, anon;
grant execute on function public.registrar_comision_b2b_reserva(text, bigint) to authenticated, service_role;

comment on function public.registrar_comision_b2b_reserva(text, bigint) is
  'Migración 305 (#14-A): comisión B2B de reserva con recobro del carrito (regla #97: el recobro sale de la base solo si hay participación). Sin recobro, igual que la 286.';
notify pgrst, 'reload schema';
commit;
