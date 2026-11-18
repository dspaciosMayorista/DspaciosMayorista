-- ============================================================================
-- 309 — #106 Gestión integral de contratos para superadmin (Mayorista + Minorista)
-- ============================================================================
-- QUÉ HACE (todo aditivo; ninguna tabla, función ni policy existente se modifica):
--   1. `contrato_seguimiento`: bitácora APPEND-ONLY de acuses operativos MANUALES de superadmin («el voucher se entregó» / «la factura se envió»).
--      Es el reporte del personal de que la acción ocurrió; NO es prueba de entrega ni de envío de correo, y no ejecuta nada (ni pago, ni asiento,
--      ni emisión de factura, ni envío de voucher). Cada fila lleva actor, instante, canal, nota y una FOTO de lo que existía al registrar
--      (qué vouchers / qué factura), para poder avisar «hay documentos nuevos desde el acuse» sin inventar una entrega.
--   2. `registrar_seguimiento_contrato(...)`: ÚNICA vía de escritura (SECURITY DEFINER; superadmin; verifica la IDENTIDAD del contrato por
--      `contrato_uid`, igual que las demás escrituras tras la 284: un número reutilizado con un uid viejo se rechaza con CONTRATO_CAMBIO F4601).
--   3. `fn_gestion_contratos(filtros, orden, limite, desplazamiento)`: lectura paginada en el servidor, solo superadmin (42501 para cualquier otro rol o
--      cuenta desactivada, también por la API directa). Una sola consulta devuelve la página, el conteo exacto y el resumen por agencia y moneda.
--      El saldo usa EXACTAMENTE la regla de cobro de la 235 / lib/finanzas/cobro.ts › cobroDeVenta (moneda y total de COBRO).
--      SECURITY DEFINER a propósito: la comprobación explícita `mi_rol() = 'superadmin'` de la primera línea ES la frontera (solo lee, y solo devuelve
--      lo que un superadmin ya puede leer). Como INVOKER, la RLS evaluaba `mi_rol()` fila por fila en cada tabla (≈ 4,8 s con 20 000 contratos y
--      ≈ 94 s en un filtro por saldo, porque esos predicados además hacen que el planificador subestime las filas y elija bucles anidados); medido
--      en docs/tecnico/gestion-contratos-106.md. `comision_plan` tampoco tiene lectura para `authenticated`, así que esta es también la única forma de
--      saber «tiene plan de comisión sellado» (sin exponer importes).
-- QUÉ NO HACE: no toca `ventas`, `abonos`, facturación, vouchers, comisiones ni las policies de otros roles; no escribe históricos; no rellena
--   «entregado/enviado» por inferencia (sin acuse el estado es «sin registrar»).
-- IDENTIDAD (284): la tabla lleva `numero_contrato` (FK a ventas, ON DELETE CASCADE) y se registra en `contrato_guardas_config` (modo estricto).
--   `dtm_reuso_bloqueos` ya bloquea el reuso de un DTM- con cualquier tabla con numero_contrato que tenga filas (RELACION_CONTRATO_SEGUIMIENTO).
-- Orden: preflight → 309 → postcheck. Rollback: supabase/scripts/rollback_309_gestion_contratos.sql (borra tabla y funciones nuevas, nada más).
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.ventas') is null or to_regclass('public.abonos') is null or to_regclass('public.vouchers') is null
     or to_regclass('public.facturacion') is null or to_regclass('public.contrato_facturacion') is null
     or to_regclass('public.aliados_b2b') is null or to_regclass('public.comision_b2b_pagos') is null
     or to_regclass('public.comision_b2b_revision') is null or to_regclass('public.comision_plan') is null
     or to_regclass('public.contrato_guardas_config') is null then
    raise exception '309: faltan tablas base (ventas, abonos, vouchers, facturacion, contrato_facturacion, aliados_b2b, comision_b2b_pagos, comision_b2b_revision, comision_plan, contrato_guardas_config).';
  end if;
  if to_regprocedure('public.comision_b2b_total(public.aliados_b2b)') is null or to_regprocedure('public.comision_b2b_descontada(public.aliados_b2b)') is null
     or to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is null or to_regprocedure('public.contrato_instalar_guardas()') is null
     or to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.fn_auditoria()') is null then
    raise exception '309: faltan funciones base (comision_b2b_total/descontada de la 205, contrato_declarar_identidad/instalar_guardas de la 284, mi_rol, fn_auditoria).';
  end if;
  if to_regclass('public.contrato_seguimiento') is not null then
    raise exception '309: contrato_seguimiento ya existe; esta migración se corre una sola vez.';
  end if;
end $$;

-- ── 1) Bitácora de acuses manuales (append-only) ───────────────────────────────────────────────────────
create table public.contrato_seguimiento (
  id              bigint generated always as identity primary key,
  numero_contrato text        not null references public.ventas(numero_contrato) on delete cascade,
  contrato_uid    uuid        not null,
  tenant          text        not null,
  tipo            text        not null check (tipo in ('voucher_entregado', 'factura_enviada')),
  accion          text        not null check (accion in ('marcar', 'desmarcar')),
  canal           text        check (canal is null or canal in ('whatsapp', 'correo', 'portal', 'presencial', 'otro')),
  nota            text        check (nota is null or char_length(nota) <= 500),
  referencia      jsonb       not null default '{}'::jsonb,
  actor_id        uuid        not null,
  actor_email     text,
  actor_nombre    text,
  creado_en       timestamptz not null default now(),
  constraint contrato_seguimiento_canal_chk check (accion <> 'marcar' or canal is not null)
);
comment on table public.contrato_seguimiento is
  '#106 (309): acuses operativos MANUALES de superadmin (voucher entregado / factura enviada). Reporte del personal, NO prueba de entrega. Append-only: el estado vigente es el último evento por (contrato, tipo).';
comment on column public.contrato_seguimiento.referencia is
  'Foto de lo que existía al registrar el acuse: voucher {n,max_id}; factura {asiento,legacy_max}. Si luego cambia, el acuse se muestra como desactualizado, nunca como vigente.';

create index contrato_seguimiento_contrato_ix on public.contrato_seguimiento (numero_contrato, tipo, id desc);

alter table public.contrato_seguimiento enable row level security;
revoke all on public.contrato_seguimiento from public, anon, authenticated;
grant select on public.contrato_seguimiento to authenticated;
drop policy if exists "contrato_seguimiento: lectura superadmin" on public.contrato_seguimiento;
create policy "contrato_seguimiento: lectura superadmin" on public.contrato_seguimiento for select
  using (public.mi_rol() = 'superadmin');
-- Sin policies ni privilegios de INSERT/UPDATE/DELETE para la API: solo escribe la función de abajo.

create or replace function public.tg_contrato_seguimiento_inmutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'SEGUIMIENTO_INMUTABLE: los acuses operativos no se modifican; se registra un evento nuevo (desmarcar / marcar).' using errcode = 'F4701';
end $$;
revoke all on function public.tg_contrato_seguimiento_inmutable() from public, anon, authenticated;
create trigger trg_contrato_seguimiento_inmutable before update on public.contrato_seguimiento
  for each row execute function public.tg_contrato_seguimiento_inmutable();

drop trigger if exists trg_auditoria on public.contrato_seguimiento;
create trigger trg_auditoria after insert or update or delete on public.contrato_seguimiento
  for each row execute function public.fn_auditoria();

insert into public.contrato_guardas_config (tabla, modo, resolvedor, columnas_exentas, motivo)
values ('contrato_seguimiento', 'estricto', null, null, 'acuses operativos manuales del contrato (309): se escriben con la identidad del contrato y se borran con él')
on conflict (tabla) do nothing;
select public.contrato_instalar_guardas();

-- ── 2) Foto de lo que existe hoy para cada tipo de acuse ───────────────────────────────────────────────
-- NULL = no hay nada que acusar (sin voucher / sin factura): no se puede marcar «entregado/enviado» algo que no existe.
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

-- ── 3) Escritura: único camino, solo superadmin, con identidad del contrato ───────────────────────────
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

-- ── 4) Lectura paginada y agregada (SECURITY DEFINER con comprobación explícita de superadmin; solo lectura) ────────────────────────────────
-- p_filtros: objeto jsonb con claves en lista blanca (cualquier otra se rechaza). Valores vacíos = sin filtro.
--   tenant (mayorista|minorista) · numero · cliente · venta_desde · venta_hasta · salida_desde · salida_hasta · estado (pendiente|confirmado|cancelado|otro)
--   saldo (con_saldo|pagado|sobrepago|sin_total) · moneda_cobro (COP|USD) · voucher (con|sin) · voucher_entrega (pendiente|entregado)
--   factura (emitida = validada en la DIAN | sin_emitir) · factura_envio (pendiente|enviada|desactualizada)
--   comision (pendiente|parcial|pagada|descontada|revision_neto|retenida|prevista|sin_definir|no_aplica)
-- p_orden: lista blanca. Desempate SIEMPRE por numero_contrato (paginación estable).
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

commit;
