-- Rollback DESTRUCTIVO de la migración 286. SE NIEGA si existe algún acuerdo sellado: eliminar la evidencia no es lo mismo que desactivar la función.
--   · Para APAGAR la exigencia conservando todo: supabase/scripts/desactivar_286_exigir_acuerdo.sql.
--   · Este rollback solo procede cuando comision_plan está VACÍA (p. ej. se aplicó la 286 pero nunca se usó el código nuevo).
-- Restaura la envoltura de conversión de la 242 y p50_priv.calcular de la 222, y elimina tabla, trigger, funciones y esquema.
begin;
do $$
declare v_n bigint; v_c bigint;
begin
  if to_regclass('public.comision_plan') is not null then
    select count(*), count(distinct coalesce(cotizacion_id::text, contrato_uid::text)) into v_n, v_c from public.comision_plan;
    if v_n > 0 then
      raise exception 'ROLLBACK_286 NEGADO: existen % plan(es)/acuerdo(s) sellado(s) de % cadena(s) (cotización o contrato). El rollback destructivo borraría esa evidencia. CONSERVA: la tabla comision_plan con todas sus versiones, las filas de aliados_b2b ya completadas (comision_valor, pct_recobro_aliado) y el vínculo ventas.aliado_id. Para desactivar la función sin perder nada ejecuta desactivar_286_exigir_acuerdo.sql; si de verdad necesitas eliminarlo, exporta la tabla primero y hazlo a mano con aprobación expresa.', v_n, v_c using errcode = 'P0001';
    end if;
  end if;
  if to_regclass('p97_priv.ciclo') is not null and (select activo from p97_priv.ciclo limit 1) then
    raise exception 'ROLLBACK_286 NEGADO: el ciclo de vida de la comisión está ENCENDIDO. Primero desactívalo (desactivar_286_ciclo_comision.sql); los planes y comisiones se conservan.' using errcode = 'P0001';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'plan_id') then
    execute 'select count(*) from public.aliados_b2b where plan_id is not null' into v_n;
    if v_n > 0 then
      raise exception 'ROLLBACK_286 NEGADO: % comisión(es) ya materializada(s) desde un plan (aliados_b2b.plan_id). Conservar. Para apagar la exigencia sin perder nada: desactivar_286_exigir_acuerdo.sql.', v_n using errcode = 'P0001';
    end if;
  end if;
end $$;
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
  -- 242 (#40 E3): una abierta vencida se rechaza ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform public.p40_exigir_cotizacion_vigente(p_cotizacion_id);
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

revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;
-- p50_priv.calcular vuelve a su versión de la 222 (sin la regla del recobro por participación monetaria).
create or replace function p50_priv.calcular(p_cot bigint, p_reconoce boolean, p_pct numeric, p_rec_ali numeric)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  v_precio bigint;
  v_t bigint := 0;
  v_r bigint;
  v_n bigint;
  v_rec_ali bigint;
  v_costos bigint;
  v_base bigint;
  v_ord bigint;
  v_part bigint;
  v_d bigint;
  v_neto bigint;
  v_suma_pesos bigint := 0;
  r record;
  i int;
  k int;
  n_rows int := 0;
  n_tick int := 0;
  v_ord_arr int[] := '{}';
  v_srv bigint[] := '{}';
  v_tip text[] := '{}';
  v_pvp bigint[] := '{}';
  v_pesos bigint[] := '{}';
  v_pos int[] := '{}';
  v_shares bigint[];
  v_desc bigint[];
  v_filas jsonb := '[]'::jsonb;
begin
  select * into c from public.cotizaciones where id = p_cot;
  if not found then
    raise exception 'COMPARATIVA_DATOS: la cotización % no existe.', p_cot using errcode = 'P0001';
  end if;
  v_precio := round(coalesce(c.precio_venta, 0) * 100)::bigint;
  v_r := round(greatest(coalesce((c.payload->>'recobro')::numeric, 0), 0) * 100)::bigint;
  v_n := round(greatest(floor(coalesce((c.payload->>'ninos')::numeric, 0)), 0)
               * greatest(coalesce((c.payload->>'tarifaNino')::numeric, 0), 0) * 100)::bigint;
  v_rec_ali := least(round(greatest(coalesce(p_rec_ali, 0), 0) * 100)::bigint, v_r);
  select coalesce(sum(round(coalesce(s.costo_neto, 0) * 100)), 0)::bigint into v_costos
    from public.cotizacion_servicios s where s.cotizacion_id = p_cot;

  -- Filas de servicio con valor > 0, en el mismo orden que p39_priv.componentes_manual.
  for r in
    select (row_number() over (order by s.orden, s.id) - 1)::int as ord, s.id as sid, s.tipo_servicio as tip,
           round(s.valor * 100)::bigint as v
      from public.cotizacion_servicios s
     where s.cotizacion_id = p_cot and coalesce(s.valor, 0) > 0
     order by s.orden, s.id
  loop
    n_rows := n_rows + 1;
    v_ord_arr := v_ord_arr || r.ord;
    v_srv := v_srv || r.sid;
    v_tip := v_tip || r.tip;
    v_pvp := v_pvp || r.v;
    if r.tip = 'aereo' then
      v_t := v_t + r.v;
      n_tick := n_tick + 1;
    end if;
  end loop;

  -- Unidades sobre las que se reparte la comisión ordinaria: filas no-tiquete,
  -- niños (si hay) y recobro (solo si NO se reconoce la participación).
  for i in 1..n_rows loop
    if v_tip[i] <> 'aereo' then
      v_pesos := v_pesos || v_pvp[i];
      v_pos := v_pos || i;
    end if;
  end loop;
  if v_n > 0 then
    v_pesos := v_pesos || v_n;
    v_pos := v_pos || 0;
  end if;
  if not coalesce(p_reconoce, false) and v_r > 0 then
    v_pesos := v_pesos || v_r;
    v_pos := v_pos || (-1);
  end if;
  for i in 1..coalesce(array_length(v_pesos, 1), 0) loop
    v_suma_pesos := v_suma_pesos + v_pesos[i];
  end loop;

  v_base := greatest(v_precio - v_t - case when coalesce(p_reconoce, false) then v_r else 0 end, 0);
  if v_suma_pesos > 0 and coalesce(p_pct, 0) > 0 then
    -- Mismo redondeo que #30 (`Math.round(base x pct)` / `round(v_base * v_pct)`): a la unidad de moneda.
    v_ord := (round(v_base::numeric / 100 * p_pct) * 100)::bigint;
  else
    v_ord := 0;
  end if;
  v_part := case when coalesce(p_reconoce, false) then v_rec_ali else 0 end;
  v_d := v_ord + v_part;
  v_neto := v_precio - v_d;

  v_shares := p50_priv.repartir(v_ord, v_pesos);
  if n_rows > 0 then v_desc := array_fill(0::bigint, array[n_rows]); end if;
  for k in 1..coalesce(array_length(v_pesos, 1), 0) loop
    if v_pos[k] > 0 then v_desc[v_pos[k]] := v_shares[k]; end if;
  end loop;
  for i in 1..n_rows loop
    v_filas := v_filas || jsonb_build_object(
      'orden', v_ord_arr[i], 'servicio_id', v_srv[i], 'tipo', v_tip[i],
      'pvp', v_pvp[i], 'descuento', v_desc[i], 'neto', v_pvp[i] - v_desc[i]);
  end loop;

  return jsonb_build_object(
    'precio', v_precio, 'tiquetes', v_t, 'recobro', v_r, 'ninos', v_n, 'rec_ali', v_rec_ali,
    'base', v_base, 'ordinaria', v_ord, 'participacion', v_part, 'descuento', v_d, 'neto', v_neto,
    'costos', v_costos, 'solo_tiquetes', (n_rows > 0 and n_tick = n_rows), 'filas', v_filas);
end $$;

drop trigger if exists trg_cot_acuerdo97 on public.cotizaciones;
drop function if exists public.crear_cotizacion_manual_con_acuerdo(uuid, text, jsonb, jsonb, bigint, numeric);
-- La RPC de reserva vuelve a la de la 205 (inserta la fila exigible al crear).
CREATE OR REPLACE FUNCTION public.registrar_comision_b2b_reserva(p_numero text, p_aliado_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rol    text := public.mi_rol()::text;
  v        public.ventas;
  a        public.aliados;
  v_param  numeric;
  v_pct    numeric;
  v_bruto  numeric;
  v_base   numeric;
  v_id     bigint;
begin
  -- Usuario y rol: quienes convierten una cotización en contrato (RLS de
  -- cotizaciones, 154) y el propio aliado. mi_rol() es NULL sin sesión o con
  -- el usuario inactivo (140).
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
    raise exception 'No autorizado para registrar la comisión de la reserva.' using errcode = '42501';
  end if;

  -- Venta: bloqueada para serializar llamadas concurrentes del mismo contrato.
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  -- Tenant: mismo criterio que convertir la cotización (solo superadmin cruza).
  if not public.puede_ver_tenant_cotizacion(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- Solo una reserva EN CURSO (nace con financiero_estado = pendiente, 172):
  -- esta función no sirve para meterle comisiones a contratos viejos. Un
  -- contrato histórico quedó 'completo' (default de la 172); uno que se quedó
  -- atascado en 'pendiente' tampoco cuenta: pasados 5 minutos de
  -- financiero_actualizado_en (nace con now()), la reconciliación de la 172
  -- ya lo trata como abandonado. Misma frontera aquí.
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

  -- Aliado.
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

  -- Sin duplicados.
  if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
    raise exception 'El contrato % ya tiene comisión B2B.', p_numero using errcode = '23505';
  end if;

  -- Importe recalculado (espejo de planComisionReserva / pctComisionAliado):
  -- % del aliado, si no el parámetro general de su tipo, si no 12 %/11 %.
  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v.tipo_asesor = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  v_pct := coalesce(a.pct_comision, v_param, case when v.tipo_asesor = 'agencia' then 0.12 else 0.11 end);
  -- En neta, ventas.precio_venta ya es PVP − comisión.
  v_bruto := coalesce(v.precio_venta, 0) + case when v.modo_compra = 'neta' then coalesce(v.comision_b2b, 0) else 0 end;
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0));
  if v.modo_compra in ('neta','comisionable')
     and abs(round(v_base * v_pct) - coalesce(v.comision_b2b, -1000000)) > 1 then
    raise exception 'La comisión de la venta % (%) no coincide con la calculada (%).',
      p_numero, v.comision_b2b, round(v_base * v_pct) using errcode = 'P0001';
  end if;

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
end;
$function$;
revoke all on function public.registrar_comision_b2b_reserva(text, bigint) from public, anon;
grant execute on function public.registrar_comision_b2b_reserva(text, bigint) to authenticated, service_role;
drop function if exists public.materializar_comision_b2b(text);
drop function if exists p97_priv.materializar(text, boolean);
drop function if exists p97_priv.ciclo_activo();
drop function if exists p97_priv.dependencias_ciclo();
drop function if exists p97_priv.exigir_dependencias();
drop function if exists public.p97_ciclo_comision_activo();
drop function if exists public.p97_dependencias_comision_faltantes();
drop table if exists p97_priv.ciclo;
drop index if exists public.aliados_b2b_plan_uq;
alter table public.aliados_b2b drop column if exists plan_id;
drop function if exists public.p97_regla_neto_activa();
drop function if exists p97_priv.es_posterior_al_corte(bigint);
drop function if exists p97_priv.exige_acuerdo(bigint);
drop function if exists p97_priv.tg_nueva_version();
drop function if exists p97_priv.aplicar(bigint, text);
drop function if exists p97_priv.validar(bigint);
drop function if exists p97_priv.insertar_version(bigint, bigint, numeric, text, numeric, uuid);
drop function if exists p97_priv.importes(bigint, bigint, numeric);
drop table if exists public.comision_plan;
drop function if exists p97_priv.tg_solo_insercion();
-- Precisión de aliados_b2b.pct_recobro_aliado: se vuelve a numeric(5,4) SOLO si ningún valor perdería información (todo valor == su redondeo a 4 decimales).
-- Si alguna fila (p. ej. una conversión de la 286: 33.333/100.000) quedaría distinta, la columna se DEJA ancha y se avisa: estrecharla cambiaría un importe pactado.
do $$
declare v_perdida bigint;
begin
  select count(*) into v_perdida from public.aliados_b2b where pct_recobro_aliado is not null and pct_recobro_aliado <> round(pct_recobro_aliado, 4);
  if v_perdida = 0 then
    alter table public.aliados_b2b alter column pct_recobro_aliado type numeric(5,4);
    raise notice 'pct_recobro_aliado vuelve a numeric(5,4) (0 filas con pérdida).';
  else
    raise warning 'pct_recobro_aliado se DEJA en numeric(25,20): % fila(s) perderían información al estrecharla a 4 decimales. Revísalas antes de estrecharla a mano.', v_perdida;
  end if;
end $$;
drop table if exists p97_priv.corte;
drop schema if exists p97_priv;
commit;
