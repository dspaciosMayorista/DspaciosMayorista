-- ROLLBACK 338 (back to the state after 337). Restores the three 309 functions VERBATIM, the 337 one-per-contract index/function, the 157 flight-editor function and the original views, and drops
-- every 338 object (service identity column on contrato_vuelos, triggers, helper, vouchers columns). No voucher is deleted. It REFUSES to run if a contract has more than one air voucher
-- (retired ones count: the 337 index could not hold them) — resolve those by hand first. The application of this branch uses guardar_vouchers_vuelo and contrato_vuelos.servicio_aereo:
-- roll back only together with the previous application build.
begin;
do $$ begin
  if exists (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) then
    raise exception 'rollback 338: hay contratos con más de un voucher de vuelo (servicios distintos); resuélvelo a mano antes de revertir.';
  end if;
end $$;
create or replace function public.seguimiento_referencia(p_numero text, p_tipo text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select case p_tipo
    when 'voucher_entregado' then
      (select case when count(*) = 0 then null else jsonb_build_object('n', count(*), 'max_id', max(v.id)) end
         from public.vouchers v where v.numero_contrato = p_numero)
    when 'factura_enviada' then
      -- Owner definition (2026-11-17): an invoice is «issued» ONLY when it is DIAN-validated (contrato_facturacion.dian_emitida). An accounting entry,
      -- a draft or a legacy numbered row alone does not qualify, so there is nothing to mark as «sent» until the DIAN mark exists.
      (select case when coalesce(cf.dian_emitida, false) = false then null
                   else jsonb_build_object('asiento', cf.asiento_factura_id, 'legacy_max', fl.max_id) end
         from (select 1) x
         left join public.contrato_facturacion cf on cf.numero_contrato = p_numero
         left join lateral (select max(f.id) as max_id from public.facturacion f
                             where f.numero_contrato = p_numero and nullif(btrim(f.numero_factura), '') is not null) fl on true)
  end
$$;
revoke all on function public.seguimiento_referencia(text, text) from public, anon, authenticated;

create or replace function public.registrar_seguimiento_contrato(
  p_numero text, p_contrato_uid uuid, p_tipo text, p_accion text, p_canal text default null, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vta   record;
  v_ult   record;
  v_ref   jsonb;
  v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
  v_usr   record;
  v_id    bigint;
  v_vigente boolean;
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'SEGUIMIENTO_SOLO_SUPERADMIN: solo superadmin registra acuses operativos.' using errcode = '42501';
  end if;
  if p_numero is null or btrim(p_numero) = '' or p_contrato_uid is null then
    raise exception 'SEGUIMIENTO_PARAMETROS: faltan el número de contrato y su identidad.' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('voucher_entregado', 'factura_enviada') then
    raise exception 'SEGUIMIENTO_PARAMETROS: tipo de acuse inválido.' using errcode = '22023';
  end if;
  if p_accion is null or p_accion not in ('marcar', 'desmarcar') then
    raise exception 'SEGUIMIENTO_PARAMETROS: acción inválida.' using errcode = '22023';
  end if;
  if p_accion = 'marcar' and (p_canal is null or p_canal not in ('whatsapp', 'correo', 'portal', 'presencial', 'otro')) then
    raise exception 'SEGUIMIENTO_PARAMETROS: indica el canal por el que se entregó/envió.' using errcode = '22023';
  end if;
  if v_nota is not null and char_length(v_nota) > 500 then
    raise exception 'SEGUIMIENTO_PARAMETROS: la nota admite hasta 500 caracteres.' using errcode = '22023';
  end if;

  -- Serializa a quien acusa lo mismo sobre el mismo contrato (doble clic, dos pantallas).
  perform pg_advisory_xact_lock(hashtextextended('seguimiento|' || p_numero || '|' || p_tipo, 0));

  -- Identidad: la pantalla trae el uid que leyó; si el número ya es de otro contrato, o ya no existe, no se escribe nada.
  select v.numero_contrato, v.contrato_uid, v.tenant into v_vta from public.ventas v where v.numero_contrato = p_numero for key share;
  if not found or v_vta.contrato_uid <> p_contrato_uid then
    raise exception 'CONTRATO_CAMBIO: el contrato que abriste con el número % ya no es el vigente (otra persona lo eliminó o lo reemplazó). No se cambió nada.', p_numero using errcode = 'F4601';
  end if;
  perform public.contrato_declarar_identidad(p_numero, v_vta.contrato_uid);

  select s.accion, s.referencia into v_ult from public.contrato_seguimiento s
   where s.numero_contrato = p_numero and s.contrato_uid = v_vta.contrato_uid and s.tipo = p_tipo
   order by s.id desc limit 1;
  v_ref := public.seguimiento_referencia(p_numero, p_tipo);

  -- Vigencia del último acuse. VOUCHER (owner definition): generating a replacement voucher (a row with a higher id; regeneration deletes and re-inserts)
  -- clears the delivered mark so it can be marked again for the new voucher; the old acknowledgment stays in this append-only log and in the audit.
  -- Deleting a voucher or editing its content does NOT clear it. FACTURA: unchanged (the mark is stale when the invoice reference changes).
  v_vigente := coalesce(v_ult.accion = 'marcar', false)
    and case p_tipo
          when 'voucher_entregado' then coalesce((v_ult.referencia ->> 'max_id')::bigint, 0) >= coalesce((v_ref ->> 'max_id')::bigint, 0)
          else v_ult.referencia = v_ref end;

  if p_accion = 'marcar' then
    if v_ref is null then
      raise exception 'SEGUIMIENTO_SIN_DOCUMENTO: el contrato % no tiene %; no hay nada que acusar.', p_numero,
        case p_tipo when 'voucher_entregado' then 'vouchers generados' else 'factura emitida y validada en la DIAN' end using errcode = 'F4702';
    end if;
    if v_vigente then
      raise exception 'SEGUIMIENTO_YA_REGISTRADO: este acuse ya está registrado y vigente.' using errcode = 'F4703';
    end if;
  else
    -- A voucher acknowledgment superseded by a newer voucher is no longer «delivered»: there is nothing to retire (it already reads as pending).
    if v_ult.accion is distinct from 'marcar' or (p_tipo = 'voucher_entregado' and not v_vigente) then
      raise exception 'SEGUIMIENTO_SIN_ACUSE: no hay un acuse vigente que retirar.' using errcode = 'F4704';
    end if;
    v_ref := coalesce(v_ref, '{}'::jsonb);
  end if;

  select u.email, u.nombre into v_usr from public.usuarios u where u.id = auth.uid();

  insert into public.contrato_seguimiento (numero_contrato, contrato_uid, tenant, tipo, accion, canal, nota, referencia, actor_id, actor_email, actor_nombre)
  values (p_numero, v_vta.contrato_uid, v_vta.tenant, p_tipo, p_accion, case when p_accion = 'marcar' then p_canal end, v_nota, v_ref,
          auth.uid(), v_usr.email, v_usr.nombre)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero_contrato', p_numero, 'tipo', p_tipo, 'accion', p_accion);
end $$;
revoke all on function public.registrar_seguimiento_contrato(text, uuid, text, text, text, text) from public, anon;
grant execute on function public.registrar_seguimiento_contrato(text, uuid, text, text, text, text) to authenticated;

create or replace function public.fn_gestion_contratos(
  p_filtros jsonb default '{}'::jsonb, p_orden text default 'venta_desc', p_limite integer default 25, p_desplazamiento integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_f      jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_k      text;
  v_lim    integer := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_off    integer := least(greatest(coalesce(p_desplazamiento, 0), 0), 1000000);
  v_ord    text := coalesce(p_orden, 'venta_desc');
  v_ten    text; v_num text; v_cli text; v_est text; v_sal text; v_mon text; v_vou text; v_vent text; v_fac text; v_fenv text; v_com text;
  v_vd date; v_vh date; v_sd date; v_sh date;
  v_numlike text; v_clilike text;
  v_res    jsonb;
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'gestion_contratos: solo superadmin' using errcode = '42501';
  end if;
  if jsonb_typeof(v_f) is distinct from 'object' then
    raise exception 'gestion_contratos: filtros inválidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(v_f) loop
    if v_k <> all (array['tenant','numero','cliente','venta_desde','venta_hasta','salida_desde','salida_hasta','estado','saldo','moneda_cobro',
                         'voucher','voucher_entrega','factura','factura_envio','comision']) then
      raise exception 'gestion_contratos: filtro desconocido %', v_k using errcode = '22023';
    end if;
    if jsonb_typeof(v_f -> v_k) not in ('string', 'null') then
      raise exception 'gestion_contratos: el filtro % debe ser texto', v_k using errcode = '22023';
    end if;
  end loop;
  if v_ord <> all (array['venta_desc','venta_asc','salida_asc','salida_desc','saldo_desc','numero_asc']) then
    raise exception 'gestion_contratos: orden inválido' using errcode = '22023';
  end if;

  v_ten  := nullif(btrim(v_f ->> 'tenant'), '');
  v_num  := nullif(btrim(v_f ->> 'numero'), '');
  v_cli  := nullif(btrim(v_f ->> 'cliente'), '');
  v_est  := nullif(btrim(v_f ->> 'estado'), '');
  v_sal  := nullif(btrim(v_f ->> 'saldo'), '');
  v_mon  := nullif(btrim(v_f ->> 'moneda_cobro'), '');
  v_vou  := nullif(btrim(v_f ->> 'voucher'), '');
  v_vent := nullif(btrim(v_f ->> 'voucher_entrega'), '');
  v_fac  := nullif(btrim(v_f ->> 'factura'), '');
  v_fenv := nullif(btrim(v_f ->> 'factura_envio'), '');
  v_com  := nullif(btrim(v_f ->> 'comision'), '');
  begin
    v_vd := nullif(btrim(v_f ->> 'venta_desde'), '')::date;  v_vh := nullif(btrim(v_f ->> 'venta_hasta'), '')::date;
    v_sd := nullif(btrim(v_f ->> 'salida_desde'), '')::date; v_sh := nullif(btrim(v_f ->> 'salida_hasta'), '')::date;
  exception when others then
    raise exception 'gestion_contratos: fecha inválida' using errcode = '22023';
  end;
  if (v_ten is not null and v_ten not in ('mayorista','minorista')) or (v_est is not null and v_est not in ('pendiente','confirmado','cancelado','otro'))
     or (v_sal is not null and v_sal not in ('con_saldo','pagado','sobrepago','sin_total')) or (v_mon is not null and v_mon not in ('COP','USD'))
     or (v_vou is not null and v_vou not in ('con','sin')) or (v_vent is not null and v_vent not in ('pendiente','entregado'))
     or (v_fac is not null and v_fac not in ('emitida','sin_emitir')) or (v_fenv is not null and v_fenv not in ('pendiente','enviada','desactualizada'))
     or (v_com is not null and v_com not in ('pendiente','parcial','pagada','descontada','revision_neto','retenida','prevista','sin_definir','no_aplica')) then
    raise exception 'gestion_contratos: valor de filtro inválido' using errcode = '22023';
  end if;
  if v_num is not null then v_numlike := '%' || replace(replace(replace(v_num, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  if v_cli is not null then v_clilike := '%' || replace(replace(replace(v_cli, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;

  with
  base as materialized (
    select v.numero_contrato, v.contrato_uid, v.tenant, v.cliente, v.destino, v.tipo_paquete, v.fecha_venta, v.fecha_salida, v.fecha_regreso,
           v.estado, v.moneda, v.precio_venta, v.moneda_cobro, v.trm_cobro, v.total_cobro, v.canal, v.tipo_asesor, v.comision_estado, v.financiero_estado,
           case when lower(btrim(coalesce(v.estado, ''))) in ('cancelado', 'anulado', 'anulada') then 'cancelado'
                when lower(btrim(coalesce(v.estado, ''))) = 'pendiente' then 'pendiente'
                when lower(btrim(coalesce(v.estado, ''))) in ('confirmado', 'activo') then 'confirmado'
                else 'otro' end as estado_grupo
      from public.ventas v
     where (v_ten is null or v.tenant = v_ten)
       and (v_numlike is null or v.numero_contrato ilike v_numlike escape '\')
       and (v_clilike is null or v.cliente ilike v_clilike escape '\')
       and (v_vd is null or v.fecha_venta >= v_vd) and (v_vh is null or v.fecha_venta <= v_vh)
       and (v_sd is null or v.fecha_salida >= v_sd) and (v_sh is null or v.fecha_salida <= v_sh)
  ),
  ab as (
    select a.numero_contrato, sum(a.valor_abono) as pagado, count(*) as n
      from public.abonos a where a.numero_contrato in (select numero_contrato from base) group by a.numero_contrato
  ),
  vo as (
    select x.numero_contrato, count(*) as n, max(x.id) as max_id from public.vouchers x
     where x.numero_contrato in (select numero_contrato from base) group by x.numero_contrato
  ),
  cf as (
    select c.numero_contrato, c.asiento_factura_id, coalesce(c.dian_emitida, false) as dian from public.contrato_facturacion c
     where c.numero_contrato in (select numero_contrato from base)
  ),
  fl as (
    select f.numero_contrato, count(*) as n, max(f.id) as max_id from public.facturacion f
     where f.numero_contrato in (select numero_contrato from base) and nullif(btrim(f.numero_factura), '') is not null group by f.numero_contrato
  ),
  sg as (
    select distinct on (s.numero_contrato, s.tipo) s.numero_contrato, s.tipo, s.accion, s.canal, s.nota, s.referencia, s.creado_en, s.actor_nombre, s.actor_email
      from public.contrato_seguimiento s join base b on b.numero_contrato = s.numero_contrato and b.contrato_uid = s.contrato_uid
     order by s.numero_contrato, s.tipo, s.id desc
  ),
  al as materialized (
    select a.id, a.numero_contrato, public.comision_b2b_total(a) as total, public.comision_b2b_descontada(a) as descontada
      from public.aliados_b2b a where a.numero_contrato in (select numero_contrato from base)
  ),
  pg as (
    select p.aliado_b2b_id, sum(p.valor) as pagado from public.comision_b2b_pagos p where p.aliado_b2b_id in (select id from al) group by p.aliado_b2b_id
  ),
  cmf as (
    select al.numero_contrato, al.id,
           exists (select 1 from public.comision_b2b_revision r where r.aliado_b2b_id = al.id) as retenida,
           case
             when al.descontada and coalesce(pg.pagado, 0) <= 0 then 'descontada'
             when b.comision_estado = 'descontada' and not al.descontada then 'revision_neto'
             when al.total > 0 and coalesce(pg.pagado, 0) >= al.total - 1 then 'pagada'
             when coalesce(pg.pagado, 0) > 0 then 'parcial'
             else 'pendiente' end as est
      from al join base b on b.numero_contrato = al.numero_contrato left join pg on pg.aliado_b2b_id = al.id
  ),
  cm as (
    select numero_contrato, count(*) as filas,
           bool_or(retenida) as retenida,
           bool_or(est = 'revision_neto') as rev_neto,
           bool_or(est = 'pendiente') as pend,
           bool_or(est = 'parcial') as parc,
           bool_and(est = 'descontada') as todas_desc
      from cmf group by numero_contrato
  ),
  planes as (select distinct p.contrato_uid from public.comision_plan p where p.contrato_uid in (select contrato_uid from base)),
  calc as (
    select b.*,
           coalesce(ab.n, 0) as n_abonos,
           case when b.moneda_cobro is not null and b.moneda_cobro is distinct from coalesce(b.moneda, 'COP')
                     and coalesce(b.total_cobro, 0) > 0 and coalesce(b.trm_cobro, 0) > 0 then true else false end as cobro_convertido,
           coalesce(ab.pagado, 0) as pagado,
           vo.n as vo_n, vo.max_id as vo_max,
           cf.asiento_factura_id, coalesce(cf.dian, false) as dian, coalesce(fl.n, 0) as fl_n, fl.max_id as fl_max,
           cm.filas as cm_filas, cm.retenida, cm.rev_neto, cm.pend, cm.parc, cm.todas_desc,
           (b.contrato_uid in (select contrato_uid from planes)) as tiene_plan,
           sv.accion as sv_accion, sv.referencia as sv_ref, sv.creado_en as sv_en, sv.actor_nombre as sv_actor, sv.canal as sv_canal, sv.nota as sv_nota,
           sf.accion as sf_accion, sf.referencia as sf_ref, sf.creado_en as sf_en, sf.actor_nombre as sf_actor, sf.canal as sf_canal, sf.nota as sf_nota
      from base b
      left join ab on ab.numero_contrato = b.numero_contrato
      left join vo on vo.numero_contrato = b.numero_contrato
      left join cf on cf.numero_contrato = b.numero_contrato
      left join fl on fl.numero_contrato = b.numero_contrato
      left join cm on cm.numero_contrato = b.numero_contrato
      left join sg sv on sv.numero_contrato = b.numero_contrato and sv.tipo = 'voucher_entregado'
      left join sg sf on sf.numero_contrato = b.numero_contrato and sf.tipo = 'factura_enviada'
  ),
  c2 as (
    select c.*,
           case when c.cobro_convertido then c.moneda_cobro else coalesce(c.moneda, 'COP') end as mon_cobro,
           case when c.cobro_convertido then c.total_cobro else c.precio_venta end as total,
           case when c.cobro_convertido then c.total_cobro else c.precio_venta end - c.pagado as saldo
      from calc c
  ),
  c3 as (
    select c.*,
           case when c.total is null or c.total <= 0 then 'sin_total'
                when c.saldo > 0 then 'con_saldo' when c.saldo < 0 then 'sobrepago' else 'pagado' end as saldo_clase,
           c.dian as fac_emitida,
           case when c.dian then 'emitida' when c.asiento_factura_id is not null or c.fl_n > 0 then 'sin_validar' else 'sin_factura' end as fac_estado,
           -- Voucher delivered (owner definition): a mark is current only while no NEWER voucher exists (max id unchanged or lower); a replacement voucher
           -- clears it (reads «pendiente», can be marked again) and the earlier mark stays visible as `acuse_anterior` + in the append-only log.
           case
             when coalesce(c.vo_n, 0) = 0 then 'sin_voucher'
             when c.sv_accion = 'marcar' and coalesce((c.sv_ref ->> 'max_id')::bigint, 0) >= c.vo_max then 'entregado'
             else 'pendiente' end as vou_ent,
           (c.sv_accion = 'marcar' and coalesce(c.vo_n, 0) > 0 and coalesce((c.sv_ref ->> 'max_id')::bigint, 0) < c.vo_max) as vou_superado,
           case
             when not c.dian and c.sf_accion is distinct from 'marcar' then 'sin_factura'
             when c.sf_accion = 'marcar' then
               case when c.dian and c.sf_ref = jsonb_build_object('asiento', c.asiento_factura_id, 'legacy_max', c.fl_max) then 'enviada' else 'desactualizada' end
             else 'pendiente' end as fac_env,
           case
             when coalesce(c.retenida, false) then 'retenida'
             when coalesce(c.cm_filas, 0) = 0 then
               case when c.canal = 'B2B' or c.tipo_asesor in ('agencia', 'freelance') then
                      case when c.comision_estado = 'descontada' then 'descontada' when c.tiene_plan then 'prevista' else 'sin_definir' end
                    else 'no_aplica' end
             when c.rev_neto then 'revision_neto'
             when c.pend then 'pendiente'
             when c.parc then 'parcial'
             when c.todas_desc then 'descontada'
             else 'pagada' end as com_clase
      from c2 c
  ),
  filt as (
    select c.* from c3 c
     where (v_est is null or c.estado_grupo = v_est)
       and (v_sal is null or (case v_sal when 'con_saldo' then c.saldo_clase = 'con_saldo' and c.estado_grupo in ('pendiente', 'confirmado') else c.saldo_clase = v_sal end))
       and (v_mon is null or c.mon_cobro = v_mon)
       and (v_vou is null or (v_vou = 'con' and coalesce(c.vo_n, 0) > 0) or (v_vou = 'sin' and coalesce(c.vo_n, 0) = 0))
       and (v_vent is null or c.vou_ent = v_vent)
       and (v_fac is null or (v_fac = 'emitida' and c.fac_emitida) or (v_fac = 'sin_emitir' and not c.fac_emitida))
       and (v_fenv is null or c.fac_env = v_fenv)
       and (v_com is null or c.com_clase = v_com)
  ),
  pagina as (
    select f.* from filt f
     order by
       (case v_ord when 'venta_asc' then f.fecha_venta end) asc nulls last,
       (case v_ord when 'venta_desc' then f.fecha_venta end) desc nulls last,
       (case v_ord when 'salida_asc' then f.fecha_salida end) asc nulls last,
       (case v_ord when 'salida_desc' then f.fecha_salida end) desc nulls last,
       (case v_ord when 'saldo_desc' then f.saldo end) desc nulls last,
       f.numero_contrato asc
     limit v_lim offset v_off
  ),
  resumen as (
    select f.tenant, f.mon_cobro as moneda, count(*) as contratos,
           count(*) filter (where f.saldo_clase = 'con_saldo' and f.estado_grupo in ('pendiente', 'confirmado')) as con_saldo,
           coalesce(sum(f.saldo) filter (where f.saldo_clase = 'con_saldo' and f.estado_grupo in ('pendiente', 'confirmado')), 0) as saldo_por_cobrar,
           count(*) filter (where f.saldo_clase = 'sobrepago') as sobrepagados,
           count(*) filter (where f.saldo_clase = 'sin_total') as sin_total
      from filt f group by f.tenant, f.mon_cobro
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'limite', v_lim, 'desplazamiento', v_off,
    'resumen', coalesce((select jsonb_agg(jsonb_build_object('tenant', r.tenant, 'moneda', r.moneda, 'contratos', r.contratos, 'con_saldo', r.con_saldo,
                              'saldo_por_cobrar', r.saldo_por_cobrar, 'sobrepagados', r.sobrepagados, 'sin_total', r.sin_total) order by r.tenant, r.moneda) from resumen r), '[]'::jsonb),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'numero', p.numero_contrato, 'uid', p.contrato_uid, 'tenant', p.tenant, 'cliente', p.cliente, 'destino', p.destino, 'tipo_paquete', p.tipo_paquete,
        'fecha_venta', p.fecha_venta, 'fecha_salida', p.fecha_salida, 'fecha_regreso', p.fecha_regreso,
        'estado', p.estado, 'estado_grupo', p.estado_grupo, 'financiero_pendiente', (p.financiero_estado = 'pendiente'),
        'moneda_oferta', coalesce(p.moneda, 'COP'), 'precio_oferta', p.precio_venta,
        'moneda_cobro', p.mon_cobro, 'cobro_convertido', p.cobro_convertido, 'total', p.total, 'pagado', p.pagado, 'saldo', p.saldo,
        'saldo_clase', p.saldo_clase, 'n_abonos', p.n_abonos,
        'voucher', jsonb_build_object('n', coalesce(p.vo_n, 0), 'entrega', p.vou_ent, 'acuse_anterior', p.vou_superado, 'evento', p.sv_accion, 'en', p.sv_en, 'actor', p.sv_actor, 'canal', p.sv_canal, 'nota', p.sv_nota),
        'factura', jsonb_build_object('emitida', p.fac_emitida, 'estado', p.fac_estado, 'contable', (p.asiento_factura_id is not null), 'dian', p.dian, 'registros', p.fl_n,
                                      'envio', p.fac_env, 'evento', p.sf_accion, 'en', p.sf_en, 'actor', p.sf_actor, 'canal', p.sf_canal, 'nota', p.sf_nota),
        'comision', jsonb_build_object('clase', p.com_clase, 'filas', coalesce(p.cm_filas, 0))
      ) order by
        (case v_ord when 'venta_asc' then p.fecha_venta end) asc nulls last,
        (case v_ord when 'venta_desc' then p.fecha_venta end) desc nulls last,
        (case v_ord when 'salida_asc' then p.fecha_salida end) asc nulls last,
        (case v_ord when 'salida_desc' then p.fecha_salida end) desc nulls last,
        (case v_ord when 'saldo_desc' then p.saldo end) desc nulls last,
        p.numero_contrato asc) from pagina p), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.fn_gestion_contratos(jsonb, text, integer, integer) from public, anon;
grant execute on function public.fn_gestion_contratos(jsonb, text, integer, integer) to authenticated;

-- 338 objects
drop trigger if exists t_tramo_marca_vouchers on public.contrato_vuelos;
drop trigger if exists t_00_tramo_candado on public.contrato_vuelos;
drop function if exists public.fn_tramo_candado();
drop function if exists public.bloquear_voucher_vuelo(text);
drop trigger if exists t_tramo_servicio_por_defecto on public.contrato_vuelos;
drop function if exists public.fn_tramo_marca_vouchers();
drop function if exists public.fn_marcar_voucher_servicio(text, uuid, boolean);
drop function if exists public.huella_servicio_aereo(text, uuid);
drop function if exists public.fn_tramo_servicio_por_defecto();
drop function if exists public.servicios_aereos_contrato(text);
drop function if exists public.guardar_vouchers_vuelo(text, jsonb);
drop index if exists public.vouchers_vuelo_uno_por_servicio;
create unique index vouchers_vuelo_uno_por_contrato on public.vouchers (numero_contrato) where tipo = 'vuelo';
create function public.guardar_voucher_vuelo(p_numero text, p_contenido jsonb)
returns table (id bigint, share_token uuid, creado boolean)
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_numero is null or btrim(p_numero) = '' then raise exception 'contrato requerido' using errcode = '22023'; end if;
  if p_contenido is null or jsonb_typeof(p_contenido) <> 'object' or p_contenido->>'clase' is distinct from 'vuelo' then
    raise exception 'el contenido no es un voucher de vuelo' using errcode = '22023';
  end if;
  return query
    insert into public.vouchers as v (numero_contrato, tipo, proveedor, contenido)
    values (p_numero, 'vuelo', 'Servicio aéreo', p_contenido)
    on conflict (numero_contrato) where tipo = 'vuelo'
    do update set contenido = excluded.contenido
    returning v.id, v.share_token, (v.xmax = 0);
end $$;
revoke all on function public.guardar_voucher_vuelo(text, jsonb) from public, anon;
grant execute on function public.guardar_voucher_vuelo(text, jsonb) to authenticated, service_role;

-- Views: remove servicio_aereo from the LIVE definitions (a view cannot lose a column in place: drop + create + same grants).
do $$
declare r record; d text;
begin
  for r in select * from (values ('contrato_vuelos_basica'), ('contrato_vuelos_editor')) t(vista) loop
    d := pg_get_viewdef(('public.' || r.vista)::regclass, true);
    if d !~ E',\\n\\s+\\w+\\.servicio_aereo\\n' then raise exception 'rollback 338: % no tiene servicio_aereo al final de su lista', r.vista; end if;
    execute 'drop view public.' || r.vista;
    execute 'create view public.' || r.vista || ' as ' || regexp_replace(d, E',\\n\\s+\\w+\\.servicio_aereo\\n', E'\n');
    execute 'grant select on public.' || r.vista || ' to authenticated';
  end loop;
end $$;
comment on view public.contrato_vuelos_editor is
  'TODOS los tramos de contrato_vuelos de un contrato (a diferencia de ventas_vuelo_sistema, que solo trae el tramo ida/regreso "principal" para el resumen de la lista) — fuente para el editor operativo de vuelos. Mismo gate que el RPC de escritura (acceso_editar_vuelos_contrato). Migración 157.';

-- Flight editor: the 157 function, verbatim (drop + create + comment + grants).
drop function if exists public.guardar_tramos_contrato(text, jsonb);

create function public.guardar_tramos_contrato(
  p_numero_contrato text,
  p_tramos          jsonb
)
returns table (
  id              bigint,
  numero_contrato text,
  aerolinea       text,
  record          text,
  direccion       text,
  origen_codigo   text,
  origen_ciudad   text,
  destino_codigo  text,
  destino_ciudad  text,
  numero_vuelo    text,
  fecha_salida    date,
  hora_salida     text,
  hora_llegada    text,
  servicios       text,
  orden           integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_tramos     constant int := 20;
  v_claves_validas constant text[] := array[
    'id', 'aerolinea', 'record', 'direccion', 'origenCodigo', 'origenCiudad',
    'destinoCodigo', 'destinoCiudad', 'numeroVuelo', 'fecha', 'horaSalida',
    'horaLlegada', 'servicios'
  ];
  -- Campos de texto libre (no id/direccion/origenCodigo/destinoCodigo, que
  -- ya tienen su propio chequeo de tipo+formato): deben ser ausentes, JSON
  -- null, o JSON string — NUNCA número/boolean/array/objeto. `->>` convierte
  -- cualquiera de esos a texto en silencio (ej. 123 -> '123', true ->
  -- 'true'), así que sin este chequeo se colarían como si fueran texto real.
  v_campos_texto   constant text[] := array[
    'aerolinea', 'record', 'origenCiudad', 'destinoCiudad', 'numeroVuelo',
    'fecha', 'horaSalida', 'horaLlegada', 'servicios'
  ];
  v_tramo          jsonb;
  v_clave          text;
  v_id             bigint;
  v_ids_mantener   bigint[] := '{}';
  v_ids_vistos     bigint[] := '{}';
  v_direccion      text;
  v_origen         text;
  v_destino        text;
  v_fecha          text;
  v_hora_salida    text;
  v_hora_llegada   text;
  v_aerolinea      text;
  v_record         text;
  v_origen_ciudad  text;
  v_destino_ciudad text;
  v_numero_vuelo   text;
  v_servicios      text;
  v_vacio          boolean;
  v_orden          int := 0;
  v_ajenos         int;
  v_encontrados    int;
begin
  if p_numero_contrato is null or length(p_numero_contrato) = 0 or length(p_numero_contrato) > 30 then
    raise exception 'Número de contrato inválido.';
  end if;

  if not public.acceso_editar_vuelos_contrato(p_numero_contrato) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- FASE A — validación de FORMA/TIPO/LÍMITES del payload, sin consultar
  -- contrato_vuelos todavía (nada de esto depende del estado actual de la
  -- base — es válido o no válido por su propia forma). Nada de lo de abajo
  -- toca una sola fila. Aunque cualquier `raise exception` revertiría igual
  -- la transacción entera, el candado del negocio es no empezar a escribir
  -- antes de saber que TODO el payload es válido.
  -- ═══════════════════════════════════════════════════════════════════════
  if p_tramos is null or jsonb_typeof(p_tramos) <> 'array' then
    raise exception 'El listado de tramos debe ser un arreglo.';
  end if;

  if jsonb_array_length(p_tramos) = 0 then
    raise exception 'Debe haber al menos un tramo — este editor no vacía el itinerario a cero.';
  end if;

  if jsonb_array_length(p_tramos) > v_max_tramos then
    raise exception 'No se pueden guardar más de % tramos en un solo contrato.', v_max_tramos;
  end if;

  for v_tramo in select * from jsonb_array_elements(p_tramos)
  loop
    if jsonb_typeof(v_tramo) <> 'object' then
      raise exception 'Cada tramo debe ser un objeto.';
    end if;

    for v_clave in select jsonb_object_keys(v_tramo)
    loop
      if not (v_clave = any(v_claves_validas)) then
        raise exception 'Campo no reconocido en un tramo: %.', v_clave;
      end if;
    end loop;

    -- id: ausente/null, o entero positivo — nunca otro tipo, nunca repetido
    -- dentro del mismo payload. (La existencia real del id se reconfirma en
    -- la Fase B, DESPUÉS del candado — ver más abajo.)
    v_id := null;
    if v_tramo ? 'id' and jsonb_typeof(v_tramo->'id') <> 'null' then
      if jsonb_typeof(v_tramo->'id') <> 'number' then
        raise exception 'El id de un tramo debe ser numérico.';
      end if;
      begin
        v_id := (v_tramo->>'id')::bigint;
      exception when others then
        raise exception 'El id de un tramo es inválido.';
      end;
      if v_id is null or v_id <= 0 then
        raise exception 'El id de un tramo debe ser un entero positivo.';
      end if;
      if v_id = any(v_ids_vistos) then
        raise exception 'Un tramo repite el id % dentro del mismo guardado.', v_id;
      end if;
      v_ids_vistos := array_append(v_ids_vistos, v_id);
      v_ids_mantener := array_append(v_ids_mantener, v_id);
    end if;

    -- direccion: ausente/null/''/'ida'/'regreso' — cualquier otro tipo o
    -- valor se rechaza.
    v_direccion := null;
    if v_tramo ? 'direccion' and jsonb_typeof(v_tramo->'direccion') <> 'null' then
      if jsonb_typeof(v_tramo->'direccion') <> 'string' then
        raise exception 'La dirección de un tramo es inválida.';
      end if;
      v_direccion := v_tramo->>'direccion';
      if v_direccion not in ('', 'ida', 'regreso') then
        raise exception 'La dirección de un tramo debe ser ida, regreso o ninguna.';
      end if;
    end if;

    -- Todo campo de texto libre: ausente/null/string — NUNCA número,
    -- boolean, array u objeto (que `->>` convertiría en texto en silencio).
    foreach v_clave in array v_campos_texto
    loop
      if v_tramo ? v_clave and jsonb_typeof(v_tramo->v_clave) not in ('null', 'string') then
        raise exception 'El campo % de un tramo debe ser texto.', v_clave;
      end if;
    end loop;

    -- Códigos IATA: ausente/null/'' o EXACTO 3 letras (A-Z tras upper/trim);
    -- origen y destino deben venir juntos, o ninguno de los dos.
    if v_tramo ? 'origenCodigo' and jsonb_typeof(v_tramo->'origenCodigo') not in ('null', 'string') then
      raise exception 'El código de origen de un tramo es inválido.';
    end if;
    if v_tramo ? 'destinoCodigo' and jsonb_typeof(v_tramo->'destinoCodigo') not in ('null', 'string') then
      raise exception 'El código de destino de un tramo es inválido.';
    end if;
    v_origen := nullif(upper(trim(coalesce(v_tramo->>'origenCodigo', ''))), '');
    v_destino := nullif(upper(trim(coalesce(v_tramo->>'destinoCodigo', ''))), '');
    if v_origen is not null and v_origen !~ '^[A-Z]{3}$' then
      raise exception 'El código de origen de un tramo debe tener exactamente 3 letras.';
    end if;
    if v_destino is not null and v_destino !~ '^[A-Z]{3}$' then
      raise exception 'El código de destino de un tramo debe tener exactamente 3 letras.';
    end if;
    if (v_origen is not null) <> (v_destino is not null) then
      raise exception 'Un tramo debe traer origen y destino juntos, o ninguno de los dos.';
    end if;

    -- Fecha: ausente/null/'' o fecha ISO ESTRICTA (regex YYYY-MM-DD antes
    -- del cast — Postgres, según DateStyle, podría aceptar otros formatos
    -- si solo se confiara en `::date`) y que además exista de verdad en el
    -- calendario (ej. 2026-02-30 pasa la regex pero no es una fecha real).
    v_fecha := nullif(trim(coalesce(v_tramo->>'fecha', '')), '');
    if v_fecha is not null then
      if v_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'La fecha de un tramo debe tener el formato AAAA-MM-DD.';
      end if;
      begin
        perform v_fecha::date;
      exception when others then
        raise exception 'La fecha de un tramo no existe en el calendario.';
      end;
    end if;

    -- Horas: ausente/null/'' o HH:MM válido (00-23 : 00-59).
    v_hora_salida := nullif(trim(coalesce(v_tramo->>'horaSalida', '')), '');
    v_hora_llegada := nullif(trim(coalesce(v_tramo->>'horaLlegada', '')), '');
    if v_hora_salida is not null and v_hora_salida !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'La hora de salida de un tramo no es válida.';
    end if;
    if v_hora_llegada is not null and v_hora_llegada !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'La hora de llegada de un tramo no es válida.';
    end if;

    -- Longitudes razonables — nunca texto libre sin tope.
    v_aerolinea := nullif(trim(coalesce(v_tramo->>'aerolinea', '')), '');
    v_record := nullif(trim(coalesce(v_tramo->>'record', '')), '');
    v_origen_ciudad := nullif(trim(coalesce(v_tramo->>'origenCiudad', '')), '');
    v_destino_ciudad := nullif(trim(coalesce(v_tramo->>'destinoCiudad', '')), '');
    v_numero_vuelo := nullif(trim(coalesce(v_tramo->>'numeroVuelo', '')), '');
    v_servicios := nullif(trim(coalesce(v_tramo->>'servicios', '')), '');
    if length(coalesce(v_aerolinea, '')) > 80 then raise exception 'La aerolínea de un tramo es demasiado larga.'; end if;
    if length(coalesce(v_record, '')) > 20 then raise exception 'El record (PNR) de un tramo es demasiado largo.'; end if;
    if length(coalesce(v_origen_ciudad, '')) > 80 or length(coalesce(v_destino_ciudad, '')) > 80 then
      raise exception 'El nombre de una ciudad de un tramo es demasiado largo.';
    end if;
    if length(coalesce(v_numero_vuelo, '')) > 15 then raise exception 'El número de vuelo de un tramo es demasiado largo.'; end if;
    if length(coalesce(v_servicios, '')) > 500 then raise exception 'El campo de servicios de un tramo es demasiado largo.'; end if;

    -- Rechaza un tramo completamente vacío. `direccion` NO cuenta como dato
    -- útil por sí sola (un tramo con SOLO direccion='ida' no dice nada del
    -- vuelo real) — deliberadamente NO entra en este chequeo. Un PNR solo
    -- (`record`) SÍ se conserva permitido: puede conocerse antes que el
    -- itinerario completo.
    v_vacio := v_aerolinea is null and v_record is null
      and v_origen is null and v_destino is null and v_numero_vuelo is null
      and v_fecha is null and v_hora_salida is null and v_hora_llegada is null
      and v_servicios is null;
    if v_vacio then
      raise exception 'Un tramo no puede estar completamente vacío (la dirección sola no es información de vuelo).';
    end if;
  end loop;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Payload válido en su FORMA. Recién AHORA se bloquea la fila PADRE
  -- (ventas) por numero_contrato — mismo candado, mismo orden (autorizar →
  -- validar forma → bloquear → re-validar contra el estado real → escribir)
  -- que actualizar_estado_emision_contrato(), para que dos guardados
  -- concurrentes del mismo contrato se serialicen aquí: el segundo espera a
  -- que el primero libere el candado (al hacer commit) y luego reemplaza
  -- TODO de nuevo con su propio payload completo — el resultado final es
  -- siempre uno de los dos guardados completos, nunca una mezcla de campos
  -- de ambos.
  -- ═══════════════════════════════════════════════════════════════════════
  -- ⚠️ Calificado como `ventas.numero_contrato`: esta función devuelve
  -- `returns table (... numero_contrato text ...)`, así que dentro del
  -- cuerpo `numero_contrato` a secas es AMBIGUO (Postgres no sabe si te
  -- refieres a la columna de la tabla o al parámetro OUT implícito de la
  -- función) — hay que calificar toda referencia bare al nombre de columna
  -- desde aquí en adelante.
  perform 1 from public.ventas where ventas.numero_contrato = p_numero_contrato for update;

  -- ═══════════════════════════════════════════════════════════════════════
  -- FASE B — recién CON el candado tomado, re-confirma autorización y que
  -- los ids del payload sigan existiendo y perteneciendo a este contrato.
  -- Estas comprobaciones NO pueden ir en la Fase A: si dos conexiones A y B
  -- validan el MISMO id existente antes de bloquear, A podría tomar el
  -- candado, borrar/reemplazar ese tramo y hacer commit — y B, si solo
  -- confiara en su validación ya obsoleta, seguiría creyendo que el id
  -- existe. En READ COMMITTED (el nivel por defecto), cada sentencia nueva
  -- toma una foto fresca de la base — así que estas consultas, ejecutadas
  -- DESPUÉS de esperar el candado, ya ven el commit de A si lo hubo.
  -- ═══════════════════════════════════════════════════════════════════════
  if not public.acceso_editar_vuelos_contrato(p_numero_contrato) then
    raise exception 'Contrato no encontrado o sin permiso para editarlo.';
  end if;

  if array_length(v_ids_mantener, 1) > 0 then
    select count(*) into v_ajenos
      from public.contrato_vuelos cv
     where cv.id = any(v_ids_mantener) and cv.numero_contrato <> p_numero_contrato;
    if v_ajenos > 0 then
      raise exception 'Uno de los tramos no pertenece a este contrato.';
    end if;

    select count(*) into v_encontrados
      from public.contrato_vuelos cv
     where cv.id = any(v_ids_mantener) and cv.numero_contrato = p_numero_contrato;
    if v_encontrados <> array_length(v_ids_mantener, 1) then
      raise exception 'Uno de los tramos ya no existe (puede haber sido modificado por otro guardado mientras tanto). Vuelve a cargar el editor e inténtalo de nuevo.';
    end if;
  end if;

  -- Borra los tramos existentes que YA NO vienen en el payload. (Mismo
  -- motivo de calificar `numero_contrato` explícito — ver nota arriba.)
  delete from public.contrato_vuelos
   where contrato_vuelos.numero_contrato = p_numero_contrato
     and (array_length(v_ids_mantener, 1) is null or not (contrato_vuelos.id = any(v_ids_mantener)));

  for v_tramo in select * from jsonb_array_elements(p_tramos)
  loop
    v_id := nullif(v_tramo->>'id', '')::bigint;

    if v_id is not null then
      update public.contrato_vuelos set
        aerolinea      = nullif(trim(v_tramo->>'aerolinea'), ''),
        record         = nullif(trim(v_tramo->>'record'), ''),
        direccion      = nullif(v_tramo->>'direccion', ''),
        origen_codigo  = nullif(upper(trim(v_tramo->>'origenCodigo')), ''),
        origen_ciudad  = nullif(trim(v_tramo->>'origenCiudad'), ''),
        destino_codigo = nullif(upper(trim(v_tramo->>'destinoCodigo')), ''),
        destino_ciudad = nullif(trim(v_tramo->>'destinoCiudad'), ''),
        numero_vuelo   = nullif(trim(v_tramo->>'numeroVuelo'), ''),
        fecha_salida   = nullif(v_tramo->>'fecha', '')::date,
        hora_salida    = nullif(trim(v_tramo->>'horaSalida'), ''),
        hora_llegada   = nullif(trim(v_tramo->>'horaLlegada'), ''),
        servicios      = nullif(trim(v_tramo->>'servicios'), ''),
        orden          = v_orden
      where contrato_vuelos.id = v_id and contrato_vuelos.numero_contrato = p_numero_contrato;

      if not found then
        raise exception 'No se pudo actualizar un tramo (id % no pertenece a este contrato).', v_id;
      end if;
    else
      insert into public.contrato_vuelos (
        numero_contrato, aerolinea, record, direccion,
        origen_codigo, origen_ciudad, destino_codigo, destino_ciudad,
        numero_vuelo, fecha_salida, hora_salida, hora_llegada, servicios, orden
      ) values (
        p_numero_contrato,
        nullif(trim(v_tramo->>'aerolinea'), ''),
        nullif(trim(v_tramo->>'record'), ''),
        nullif(v_tramo->>'direccion', ''),
        nullif(upper(trim(v_tramo->>'origenCodigo')), ''),
        nullif(trim(v_tramo->>'origenCiudad'), ''),
        nullif(upper(trim(v_tramo->>'destinoCodigo')), ''),
        nullif(trim(v_tramo->>'destinoCiudad'), ''),
        nullif(trim(v_tramo->>'numeroVuelo'), ''),
        nullif(v_tramo->>'fecha', '')::date,
        nullif(trim(v_tramo->>'horaSalida'), ''),
        nullif(trim(v_tramo->>'horaLlegada'), ''),
        nullif(trim(v_tramo->>'servicios'), ''),
        v_orden
      );
    end if;

    v_orden := v_orden + 1;
  end loop;

  -- Devuelve los tramos YA guardados (con sus id reales, incluidos los recién
  -- asignados a los que llegaron con id null) — el cliente sincroniza su
  -- estado local con esto en vez de confiar en volver a leer después de un
  -- `router.refresh()`, que no actualiza el estado de React por sí solo.
  -- ⚠️ NUNCA `select *`: esta función es SECURITY DEFINER, así que un
  -- `select *` expondría automáticamente cualquier columna que se agregue a
  -- `contrato_vuelos` en el futuro (aunque fuera sensible) sin que nadie
  -- tenga que tocar este RPC — la lista de columnas de `returns table` de
  -- arriba y este `select` explícito son la única superficie real.
  return query
    select cv.id, cv.numero_contrato, cv.aerolinea, cv.record, cv.direccion,
           cv.origen_codigo, cv.origen_ciudad, cv.destino_codigo, cv.destino_ciudad,
           cv.numero_vuelo, cv.fecha_salida, cv.hora_salida, cv.hora_llegada,
           cv.servicios, cv.orden
      from public.contrato_vuelos cv
     where cv.numero_contrato = p_numero_contrato
     order by cv.orden asc, cv.id asc;
end;
$$;

comment on function public.guardar_tramos_contrato(text, jsonb) is
  'Reemplaza ATÓMICAMENTE los tramos de contrato_vuelos de un contrato: actualiza por '
  'id los que ya existían (conserva el id), inserta los que no traen id, borra los que '
  'ya no vienen en el payload — todo en UNA transacción (función plpgsql): si cualquier '
  'paso falla, Postgres revierte TODO, el contrato nunca queda sin vuelos a medio '
  'guardar. Exige al menos un tramo, valida FORMA/tipos/longitudes/IATA/fechas-horas/ids '
  'duplicados en la Fase A (antes del candado), bloquea (SELECT...FOR UPDATE) la fila '
  'padre de ventas por numero_contrato, y en la Fase B (ya con el candado) re-confirma '
  'autorización y que los ids sigan existiendo/perteneciendo al contrato contra el '
  'estado real — evita la ventana TOCTOU de validar ids antes de bloquear. Devuelve '
  'EXPLÍCITAMENTE (returns table, nunca setof + select *) los tramos ya guardados con id '
  'real — un select * expondría cualquier columna futura de contrato_vuelos sin querer, '
  'al ser SECURITY DEFINER. Ver comentario de cabecera de la migración 157.';

revoke all on function public.guardar_tramos_contrato(text, jsonb) from public;
revoke all on function public.guardar_tramos_contrato(text, jsonb) from anon;
grant execute on function public.guardar_tramos_contrato(text, jsonb) to authenticated;

alter table public.vouchers drop constraint if exists vouchers_vuelo_exige_clave, drop constraint if exists vouchers_solo_vuelo_cambia_estado;
alter table public.vouchers drop column if exists servicio_clave, drop column if exists revision, drop column if exists actualizado_en, drop column if exists estado, drop column if exists huella;
drop index if exists public.contrato_vuelos_servicio_aereo_idx;
alter table public.contrato_vuelos drop column if exists servicio_aereo;
notify pgrst, 'reload schema';
commit;
