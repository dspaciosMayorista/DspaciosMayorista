-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 307 · #53 · Mínimo de confirmación configurable (NETO = PVP), vencimiento que NUNCA cancela un contrato con pagos,
--       y elegibilidad de pago completo para el acceso de aliados a los vouchers.
--
-- REGLAS DEL DUEÑO (2026-11-15):
--   1. NETO y PVP resuelven igual las condiciones de confirmación. El mínimo es configurable (30 %, otro porcentaje o importe, o 100 %
--      cuando el hotel lo exige). Superadmin puede cambiar condiciones y límites. Auditoría y consistencia financiera intactas.
--   2. El vencimiento automático NUNCA cancela un contrato con algún pago registrado, ni siquiera bajo el mínimo. Sin pagos: como siempre.
--      NO corre ningún lote histórico ni confirma, cancela o reescribe nada existente.
--   3. Un voucher puede prepararse internamente, pero un aliado solo accede cuando el contrato está 100 % pago (sin excepción anticipada).
--
-- QUÉ HACE (todo ADITIVO o redefinición con la MISMA firma; no edita migraciones aplicadas):
--   A. Tabla `contrato_minimo_acuerdo` (solo inserción, auditada): el mínimo vigente de un contrato es su ÚLTIMA fila. CLASIFICADA en las guardas de identidad (284, modo estricto)
--      y como tabla de PREPARACIÓN para el reuso de consecutivos (`dtm_reuso_bloqueos`, cuerpo de la 304 + este nombre): un acuerdo de mínimo no es un compromiso real.
--   B. `p75_priv.regla_confirmacion` (de la 288): SIN rama NETO. Precedencia: acuerdo → condición congelada → % de config_cobros.
--   C. `public.fijar_minimo_confirmacion`: solo superadmin, solo contrato pendiente; VERIFICA LA IDENTIDAD del contrato (UUID declarado; exigida si el número nació de un reuso);
--      no confirma nada por sí misma.
--   D. `public.liberar_vencidas` (de la 285): conserva los pendientes vencidos que tengan algún pago.
--   E. `public.contratos_pagados_completos` / `contrato_pagado_completo`: único criterio SQL de «pagado completo» (moneda de cobro,
--      total de cobro y tolerancia 0,5 COP / 0,01 USD, las mismas de `estado_minimo`). Solo service_role.
--   NO toca: confirmar_venta, materialización de obligaciones, CxP, comisiones, ciclo #97 (apagado en Producción) ni el INTERRUPTOR del reuso de consecutivos (dtm_reuso_config);
--      solo agrega la tabla nueva a la lista de preparación de `dtm_reuso_bloqueos` para que NO se convierta en un bloqueo nuevo.
-- Orden: preflight_307 → esta migración → postcheck_307 → desplegar el código. El código nuevo exige la 307; el viejo sigue funcionando con ella.
-- Rollback: supabase/scripts/rollback_307_minimo_vencimiento_voucher.sql.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── A. Acuerdo de mínimo por contrato (solo inserción) ─────────────────────────────────────────
create table if not exists public.contrato_minimo_acuerdo (
  id            bigint generated always as identity primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  contrato_uid  uuid not null,
  tenant        text not null,
  tipo          text not null check (tipo in ('porcentaje', 'importe', 'total')),
  porcentaje    numeric(7,4),        -- fracción 0 < p ≤ 1 (0,30 = 30 %)
  importe       numeric(15,2),       -- en la moneda indicada (debe ser la de COBRO del contrato al fijarlo)
  moneda        text check (moneda in ('COP', 'USD')),
  motivo        text,                -- opcional: NO hay flujo de justificación obligatoria
  creado_por    uuid default auth.uid(),
  creado_en     timestamptz not null default now(),
  constraint contrato_minimo_acuerdo_forma check (
    (tipo = 'porcentaje' and porcentaje > 0 and porcentaje <= 1 and importe is null and moneda is null)
    or (tipo = 'importe' and importe > 0 and moneda is not null and porcentaje is null)
    or (tipo = 'total' and porcentaje is null and importe is null and moneda is null))
);
create index if not exists contrato_minimo_acuerdo_uid_idx on public.contrato_minimo_acuerdo (contrato_uid, id desc);

alter table public.contrato_minimo_acuerdo enable row level security;
revoke all on public.contrato_minimo_acuerdo from anon, authenticated;
grant select on public.contrato_minimo_acuerdo to authenticated;
drop policy if exists "minimo_acuerdo: lectura" on public.contrato_minimo_acuerdo;
create policy "minimo_acuerdo: lectura" on public.contrato_minimo_acuerdo for select
  using (public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_contrato(numero_contrato));

-- Solo inserción: ningún UPDATE salvo el TRASLADO DE NÚMERO de la renumeración (fn_renumerar_contrato mueve todas las hijas por FK: cambia únicamente numero_contrato, hacia una venta que ya existe
-- con la MISMA vida/uuid); el DELETE solo lo hace la cascada al eliminar el contrato (el padre ya no existe).
create or replace function public.tg_minimo_acuerdo_solo_insercion() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato) then return old; end if;
  if tg_op = 'UPDATE' and new.numero_contrato is distinct from old.numero_contrato
     and (to_jsonb(new) - 'numero_contrato') = (to_jsonb(old) - 'numero_contrato')
     and exists (select 1 from public.ventas v where v.numero_contrato = new.numero_contrato and v.contrato_uid = old.contrato_uid) then
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'Un acuerdo de mínimo no se modifica ni se borra: fija uno nuevo (queda el historial).';
end $$;
revoke all on function public.tg_minimo_acuerdo_solo_insercion() from public, anon, authenticated;
drop trigger if exists trg_minimo_acuerdo_solo_insercion on public.contrato_minimo_acuerdo;
create trigger trg_minimo_acuerdo_solo_insercion before update or delete on public.contrato_minimo_acuerdo
  for each row execute function public.tg_minimo_acuerdo_solo_insercion();
drop trigger if exists trg_auditoria on public.contrato_minimo_acuerdo;
create trigger trg_auditoria after insert or update or delete on public.contrato_minimo_acuerdo
  for each row execute function public.fn_auditoria();

-- Guarda de identidad (284): tabla hija escrita por número → modo ESTRICTO como las demás (sin esta fila, `contrato_instalar_guardas()` aborta con GUARDA_SIN_CLASIFICAR).
do $$ begin
  if to_regclass('public.contrato_guardas_config') is null then raise exception '307: falta la 284 (guardas de identidad).'; end if;
end $$;
insert into public.contrato_guardas_config (tabla, modo, motivo)
values ('contrato_minimo_acuerdo', 'estricto', 'acuerdo de mínimo de confirmación (#53): se escribe por número y la guarda exige la identidad del contrato')
on conflict (tabla) do nothing;
select public.contrato_instalar_guardas();

-- ── B. Regla ÚNICA del mínimo para confirmar (misma firma y forma de salida que la 288; sin rama NETO) ──
create or replace function p75_priv.regla_confirmacion(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.ventas; v_mo text; v_mc text; v_total numeric; v_moneda text; v_pct numeric; n integer; s numeric; m text; t numeric; a public.contrato_minimo_acuerdo;
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return null; end if;
  -- Total de cobro y moneda de cobro: espejo de registrar_abono / lib/finanzas/cobro.ts → cobroDeVenta.
  v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  if v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then
    v_total := v.total_cobro; v_moneda := v_mc;
  else
    v_total := coalesce(v.precio_venta, 0); v_moneda := v_mo;
  end if;
  -- 1) Acuerdo fijado por superadmin (último de ESTA vida del contrato). NETO y PVP por igual.
  select * into a from public.contrato_minimo_acuerdo x where x.contrato_uid = v.contrato_uid order by x.id desc limit 1;
  if found then
    if a.tipo = 'total' then
      return jsonb_build_object('regla', 'acuerdo', 'minimo', v_total, 'moneda', v_moneda, 'trm', null, 'acuerdo_tipo', 'total');
    elsif a.tipo = 'porcentaje' then
      return jsonb_build_object('regla', 'acuerdo', 'minimo', round(v_total * a.porcentaje, 2), 'moneda', v_moneda, 'trm', null, 'acuerdo_tipo', 'porcentaje', 'acuerdo_porcentaje', a.porcentaje);
    elsif a.moneda = v_moneda then
      return jsonb_build_object('regla', 'acuerdo', 'minimo', least(a.importe, v_total), 'moneda', v_moneda, 'trm', null, 'acuerdo_tipo', 'importe');
    else
      -- La moneda de cobro cambió después de fijar el importe: no se adivina una conversión; se exige el total (falla cerrado) hasta que se fije de nuevo.
      return jsonb_build_object('regla', 'acuerdo', 'minimo', v_total, 'moneda', v_moneda, 'trm', null, 'acuerdo_tipo', 'importe', 'acuerdo_moneda_distinta', true);
    end if;
  end if;
  -- 2) Condiciones congeladas (hotel/proveedor/paquete): su suma, en su moneda y con su TRM. Un hotel que exige el 100 % ya viene así.
  select count(*), coalesce(sum(c.monto_exigido), 0), min(upper(c.moneda)), max(c.trm) into n, s, m, t
    from public.contrato_condiciones c where c.numero_contrato = p_numero;
  if n > 0 then
    return jsonb_build_object('regla', 'condicion_congelada', 'minimo', s, 'moneda', coalesce(m, v_moneda), 'trm', t);
  end if;
  -- 3) Sin condiciones (histórico o snapshot ausente): % de config_cobros (30 % por defecto). MISMA política para NETO y PVP.
  select c.pct_abono into v_pct from public.config_cobros c where c.tipo_paquete = coalesce(v.tipo_paquete, '');
  return jsonb_build_object('regla', 'legacy_pct', 'minimo', v_total * coalesce(v_pct, 0.3), 'moneda', v_moneda, 'trm', null);
end $$;
revoke all on function p75_priv.regla_confirmacion(text) from public, anon, authenticated;
grant execute on function p75_priv.regla_confirmacion(text) to service_role;

-- ── C. Fijar el mínimo (solo superadmin; solo contrato PENDIENTE; NO confirma por sí misma) ───────────────
create or replace function public.fijar_minimo_confirmacion(p_numero text, p_tipo text, p_valor numeric default null, p_moneda text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v public.ventas; v_total numeric; v_moneda text; v_pct numeric; v_id bigint; v_existe boolean;
begin
  if auth.uid() is null or public.mi_rol()::text is distinct from 'superadmin' then
    raise exception using errcode = '42501', message = 'Solo superadmin puede cambiar el mínimo de confirmación.';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  v_existe := found;
  -- Identidad (284), BAJO el bloqueo y ANTES de cualquier otra decisión: un UUID viejo o ajeno se rechaza (F4601) y un número nacido de un reuso sin identidad declarada también (F4602).
  -- NUNCA se copia el uid vigente a la declaración de quien llama.
  perform public.contrato_verificar_identidad(p_numero, true);
  if not v_existe then raise exception using errcode = 'P0001', message = 'El contrato no existe.'; end if;
  if v.estado is distinct from 'pendiente' then
    raise exception using errcode = 'P0001', message = 'El mínimo solo se cambia en un contrato pendiente; este ya no espera confirmación.';
  end if;
  -- Total y moneda de COBRO (los mismos de la regla).
  if v.moneda_cobro is not null and upper(v.moneda_cobro) <> upper(coalesce(v.moneda, 'COP')) and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then
    v_total := v.total_cobro; v_moneda := case when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
  else
    v_total := coalesce(v.precio_venta, 0); v_moneda := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
  end if;
  if v_total <= 0 then raise exception using errcode = 'P0001', message = 'El contrato no tiene un total de cobro mayor a cero.'; end if;
  if p_tipo = 'porcentaje' then
    if p_valor is null or p_valor <= 0 or p_valor > 100 then raise exception using errcode = 'P0001', message = 'El porcentaje debe estar entre 0 (exclusivo) y 100.'; end if;
    v_pct := round(p_valor / 100, 4);
    if v_pct <= 0 then raise exception using errcode = 'P0001', message = 'El porcentaje es demasiado pequeño.'; end if;
    insert into public.contrato_minimo_acuerdo (numero_contrato, contrato_uid, tenant, tipo, porcentaje, motivo) values (v.numero_contrato, v.contrato_uid, v.tenant, 'porcentaje', v_pct, nullif(btrim(p_motivo), '')) returning id into v_id;
  elsif p_tipo = 'importe' then
    if p_valor is null or p_valor <= 0 then raise exception using errcode = 'P0001', message = 'El importe debe ser mayor a cero.'; end if;
    if upper(coalesce(p_moneda, v_moneda)) <> v_moneda then raise exception using errcode = 'P0001', message = format('El importe se fija en la moneda de cobro del contrato (%s).', v_moneda); end if;
    if p_valor > v_total + (case when v_moneda = 'USD' then 0.01 else 0.5 end) then raise exception using errcode = 'P0001', message = 'El importe no puede superar el total de cobro del contrato.'; end if;
    insert into public.contrato_minimo_acuerdo (numero_contrato, contrato_uid, tenant, tipo, importe, moneda, motivo) values (v.numero_contrato, v.contrato_uid, v.tenant, 'importe', round(p_valor, 2), v_moneda, nullif(btrim(p_motivo), '')) returning id into v_id;
  elsif p_tipo = 'total' then
    insert into public.contrato_minimo_acuerdo (numero_contrato, contrato_uid, tenant, tipo, motivo) values (v.numero_contrato, v.contrato_uid, v.tenant, 'total', nullif(btrim(p_motivo), '')) returning id into v_id;
  else
    raise exception using errcode = 'P0001', message = 'Tipo de mínimo inválido (porcentaje, importe o total).';
  end if;
  return jsonb_build_object('ok', true, 'acuerdo_id', v_id) || coalesce(p75_priv.estado_minimo(p_numero), '{}'::jsonb);
end $$;
revoke all on function public.fijar_minimo_confirmacion(text, text, numeric, text, text) from public, anon;
grant execute on function public.fijar_minimo_confirmacion(text, text, numeric, text, text) to authenticated, service_role;

-- ── D. Vencimiento que NUNCA cancela un contrato con pagos (misma firma que la 285) ─────────────────────────
create or replace function public.liberar_vencidas(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = 'public', 'pg_temp' set lock_timeout = '5s' as $function$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  v_cand text[];
  v_nums text[];
  v_sillas integer := 0;
begin
  -- 1) Bloquea los candidatos por estado y plazo (como siempre). El bloqueo de la fila impide que un abono nuevo (FK sobre la venta) se inserte mientras decidimos.
  select array_agg(numero_contrato order by numero_contrato) into v_cand
    from (select numero_contrato from public.ventas
           where estado = 'pendiente' and plazo < v_hoy
           order by numero_contrato for update) v;
  if v_cand is null then
    return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', 0, 'sillas', 0, 'conservadas_con_pago', 0);
  end if;
  -- 2) Regla del dueño: con ALGÚN pago registrado el contrato NO se cancela (ni siquiera bajo el mínimo). Se lee DESPUÉS del bloqueo (instantánea nueva).
  select array_agg(c order by c) into v_nums from unnest(v_cand) c
   where not exists (select 1 from public.abonos a where a.numero_contrato = c and (coalesce(a.valor_abono, 0) > 0 or coalesce(a.monto_cop, 0) > 0));
  if v_nums is null then
    return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', 0, 'sillas', 0, 'conservadas_con_pago', cardinality(v_cand));
  end if;
  -- Tarea automática: no recibe contratos de ninguna pantalla; los eligió por estado y los bloqueó arriba. Declara lo que LEYÓ bajo bloqueo (#75).
  perform public.contrato_declarar_identidad(x.numero_contrato, x.contrato_uid) from public.ventas x where x.numero_contrato = any (v_nums);
  v_sillas := public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = any(v_nums) and estado = 'en_plazo'),
    'Reserva vencida');
  update public.ventas set estado = 'cancelado' where numero_contrato = any(v_nums) and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', cardinality(v_nums), 'sillas', v_sillas, 'conservadas_con_pago', cardinality(v_cand) - cardinality(v_nums));
end $function$;

-- ── E. Pago completo (acceso de aliados a vouchers): UN criterio, en la moneda de COBRO y con la tolerancia de estado_minimo ──────
create or replace function public.contratos_pagados_completos(p_numeros text[]) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select c.numero_contrato
    from (
      select v.numero_contrato, v.estado,
             -- Espejo de regla_confirmacion / cobroDeVenta: la moneda de cobro solo manda si difiere de la del contrato y trae total y TRM.
             case when v.moneda_cobro is not null and upper(v.moneda_cobro) <> upper(coalesce(v.moneda, 'COP')) and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0
                  then v.total_cobro else coalesce(v.precio_venta, 0) end total,
             case when (case when v.moneda_cobro is not null and upper(v.moneda_cobro) <> upper(coalesce(v.moneda, 'COP')) and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0
                             then v.moneda_cobro else coalesce(v.moneda, 'COP') end) ilike 'usd' then 0.01 else 0.5 end tol,
             coalesce((select sum(a.valor_abono) from public.abonos a where a.numero_contrato = v.numero_contrato), 0) pagado
        from public.ventas v where v.numero_contrato = any (p_numeros)) c
   where c.estado is distinct from 'cancelado' and c.total > 0 and c.pagado > 0 and c.pagado + c.tol >= c.total
$$;
revoke all on function public.contratos_pagados_completos(text[]) from public, anon, authenticated;
grant execute on function public.contratos_pagados_completos(text[]) to service_role;

create or replace function public.contrato_pagado_completo(p_numero text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.contratos_pagados_completos(array[p_numero]))
$$;
revoke all on function public.contrato_pagado_completo(text) from public, anon, authenticated;
grant execute on function public.contrato_pagado_completo(text) to service_role;

-- ── F. Estado de confirmación para la ficha: mismo booleano de siempre + el DETALLE del mínimo vigente (solo roles internos que ven el contrato) ──────
create or replace function public.estado_confirmacion_pago(p_numero text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('confirmacion_pendiente', p75_priv.alcanza_minimo(p_numero))
         || case when public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_contrato(p_numero)
                 then jsonb_build_object('detalle', p75_priv.estado_minimo(p_numero)) else '{}'::jsonb end
$$;

-- ── G. Reuso de consecutivos (287/289/304): el acuerdo de mínimo es PREPARACIÓN, no un compromiso real. Cuerpo de la 304 con UN solo cambio: este nombre en `prep`.
--      No toca `dtm_reuso_config` (el interruptor sigue como esté). Con pagos, abonos o cualquier otra relación real el contrato sigue bloqueado como antes. ──
create or replace function public.dtm_reuso_bloqueos(p_numero text, p_vivo boolean)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b    text[] := '{}';
  v    public.ventas%rowtype;
  j    jsonb;
  k    text;
  r    record;
  x    boolean;
  -- Campos de `ventas` que deben seguir vacíos: facturación emitida y agrupación de conversión de varios contratos. El resto de los campos comerciales ES preparación.
  campos constant text[] := array['facturado','numero_documento','grupo_conversion'];
  -- Tablas de PREPARACIÓN: no bloquean por existir. Las que tienen estado real se comprueban aparte más abajo (sillas, vuelo, facturación, CxP, comisión, plan #97).
  prep constant text[] := array[
    'contrato_alojamiento_bernalo','contrato_condiciones','contrato_financiero_pendiente','contrato_hoteles','contrato_items','contrato_obligaciones_previstas',
    'contrato_pasajeros','contrato_programa_estancia','contrato_programa_estancia_costo','contrato_servicios','contrato_vuelos','restriccion_overrides','cuotas',
    'rentabilidad','avisos','cotizaciones','comision_plan','contrato_facturacion','contrato_vuelo_control','sillas','cuentas_por_pagar','aliados_b2b',
    'contrato_resumen_precios','contrato_minimo_acuerdo'];
begin
  begin
    if p_numero is null or p_numero !~ '^DTM-[0-9]{4,}$' then
      return array['NO_ES_DTM'];
    end if;

    select * into v from public.ventas where numero_contrato = p_numero;
    if p_vivo then
      if not found then return array['NO_EXISTE']; end if;
      if not coalesce((select c.habilitado from public.dtm_reuso_config c limit 1), false) then
        b := b || 'REUSO_DESHABILITADO'::text;
      end if;
      if v.tenant is distinct from 'mayorista' then b := b || 'TENANT_NO_MAYORISTA'::text; end if;
      if v.estado is distinct from 'pendiente' then
        b := b || ('ESTADO_ACTUAL_' || upper(coalesce(v.estado, 'NULL')));
      end if;
      if v.financiero_estado is distinct from 'completo' then b := b || 'FINANCIERO_INCOMPLETO'::text; end if;
      -- «Nunca confirmado»: el estado actual no lo prueba; lo prueba la historia de auditoría de `ventas`.
      if not exists (select 1 from public.auditoria a
                      where a.tabla = 'ventas' and a.accion = 'INSERT' and a.registro_id = p_numero) then
        b := b || 'SIN_EVENTO_DE_CREACION_EN_AUDITORIA'::text;
      end if;
      if exists (select 1 from public.auditoria a
                  where a.tabla = 'ventas' and a.registro_id = p_numero
                    and ((a.antes is not null and a.antes->>'estado' is distinct from 'pendiente')
                      or (a.despues is not null and a.despues->>'estado' is distinct from 'pendiente'))) then
        b := b || 'ESTADO_DISTINTO_DE_PENDIENTE_EN_HISTORIA'::text;
      end if;
      j := to_jsonb(v);
      foreach k in array campos loop
        if not public.dtm_valor_vacio(j->>k) then b := b || ('CAMPO_COMERCIAL_' || upper(k)); end if;
      end loop;
    elsif found then
      b := b || 'EXISTE_EN_VENTAS'::text;
    end if;

    -- Relaciones: toda tabla del esquema public con columna numero_contrato / contrato_numero o FK hacia ventas. Las de PREPARACIÓN se saltan; cualquier otra (incluida una futura) bloquea.
    for r in
      select distinct t.relname::text as tabla, t.col
        from (
          select c.relname, a.attname::text as col
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           where c.relkind in ('r', 'p') and a.attname in ('numero_contrato', 'contrato_numero')
          union
          select c.relname, a.attname::text
            from pg_constraint k
            join pg_class c on c.oid = k.conrelid
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
           where k.contype = 'f' and k.confrelid = 'public.ventas'::regclass
        ) t
       where t.relname <> 'ventas' and not (t.relname = any (prep))
       order by 1
    loop
      begin
        execute format('select exists (select 1 from public.%I where %I = $1)', r.tabla, r.col) into x using p_numero;
        if x then b := b || ('RELACION_' || upper(r.tabla)); end if;
      exception when others then
        b := b || ('LECTURA_FALLIDA_' || upper(r.tabla));
      end;
    end loop;

    -- Estado real de las tablas de preparación que pueden esconder un compromiso. Cada comprobación falla cerrado de forma independiente.
    begin   -- sillas: solo las asignaciones en plazo se liberan; confirmada, emitida, cambio, etc. bloquean
      if exists (select 1 from public.sillas s where s.numero_contrato = p_numero and s.estado is distinct from 'en_plazo') then b := b || 'SILLAS_NO_LIBERABLES'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_SILLAS'::text; end;

    begin   -- vuelo emitido
      if exists (select 1 from public.contrato_vuelo_control c where c.numero_contrato = p_numero and coalesce(c.estado_emision, 'pendiente') is distinct from 'pendiente') then b := b || 'VUELO_EMITIDO'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_VUELO_CONTROL'::text; end;

    begin   -- clasificación contable ya presentada a la DIAN o con asiento/revisión
      if exists (select 1 from public.contrato_facturacion f where f.numero_contrato = p_numero
                  and (coalesce(f.dian_emitida, false) or f.asiento_factura_id is not null or f.revision_id is not null)) then b := b || 'FACTURACION_EMITIDA'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_CONTRATO_FACTURACION'::text; end;

    begin   -- CxP: sin pagos, sin retenciones y sin protección #63
      if exists (select 1 from public.cuentas_por_pagar c join public.cxp_pagos p on p.cuenta_por_pagar_id = c.id where c.numero_contrato = p_numero) then b := b || 'CXP_CON_PAGOS'::text; end if;
      if exists (select 1 from public.cuentas_por_pagar c join public.retenciones_cxp p on p.cuenta_por_pagar_id = c.id where c.numero_contrato = p_numero) then b := b || 'CXP_CON_RETENCIONES'::text; end if;
      if exists (select 1 from public.cuentas_por_pagar c where c.numero_contrato = p_numero and c.aceptacion_63_id is not null) then b := b || 'CXP_63_PROTEGIDA'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_CXP'::text; end;

    begin   -- comisión: solo la ya DESCONTADA en el precio (NETO), sin pagos ni revisiones, es preparación
      if exists (select 1 from public.aliados_b2b a where a.numero_contrato = p_numero and not coalesce(a.descontada_en_precio, false)) then b := b || 'COMISION_EXIGIBLE'::text; end if;
      if exists (select 1 from public.aliados_b2b a join public.comision_b2b_pagos p on p.aliado_b2b_id = a.id where a.numero_contrato = p_numero) then b := b || 'COMISION_CON_PAGOS'::text; end if;
      if exists (select 1 from public.aliados_b2b a join public.comision_b2b_revision p on p.aliado_b2b_id = a.id where a.numero_contrato = p_numero) then b := b || 'COMISION_CON_REVISION'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_COMISION'::text; end;

    begin   -- plan de comisión de #97 (solo inserción): se borra con el contrato SOLO si la 286 aplicada trae la versión esperada de la liberación (LIBERACION_PLAN_V2, por contrato_uid) y el plan no está materializado
      if p_vivo and to_regclass('public.comision_plan') is not null then
        execute 'select exists (select 1 from public.comision_plan where contrato_uid = $1)' into x using v.contrato_uid;
        if x then
          if coalesce(obj_description(to_regprocedure('p97_priv.tg_solo_insercion()'), 'pg_proc'), '') not like 'LIBERACION_PLAN_V2:%' then
            b := b || 'PLAN_COMISION_SIN_LIBERACION_97'::text;
          end if;
          execute 'select exists (select 1 from public.comision_plan c join public.aliados_b2b a on a.plan_id = c.id where c.contrato_uid = $1 and not coalesce(a.descontada_en_precio, false))' into x using v.contrato_uid;
          if x then b := b || 'PLAN_COMISION_MATERIALIZADO'::text; end if;
        end if;
      end if;
    exception when others then b := b || 'LECTURA_FALLIDA_PLAN_COMISION'::text; end;

    begin
      if exists (select 1 from storage.objects o where starts_with(o.name, p_numero || '/')) then
        b := b || 'ARCHIVOS_EN_STORAGE'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_STORAGE'::text;
    end;

    -- Referencias MANUALES de texto (sillas.contrato_manual): sin FK ni columna numero_contrato; una silla que apunta al contrato por referencia manual bloquea el número.
    begin
      if exists (select 1 from (select distinct s.contrato_manual as ref from public.sillas s where s.contrato_manual is not null) m
                  where exists (select 1 from public._resolver_contrato_manual(m.ref) rm where rm.numero_contrato = p_numero)) then
        b := b || 'REFERENCIA_MANUAL_EN_SILLA'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_REFERENCIA_MANUAL'::text;
    end;

    begin
      if exists (select 1 from public.asientos_contables s
                  where s.referencia ~ ('(^|[^0-9A-Za-z])' || p_numero || '($|[^0-9])')
                     or s.descripcion ~ ('(^|[^0-9A-Za-z])' || p_numero || '($|[^0-9])')) then
        b := b || 'ASIENTOS_CONTABLES'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_ASIENTOS'::text;
    end;

    return b;
  exception when others then
    return array['LECTURA_FALLIDA: ' || sqlerrm];
  end;
end;
$$;
comment on function public.dtm_reuso_bloqueos(text, boolean) is
  'Migración 289 (#75) + 304 (#94: contrato_resumen_precios) + 307 (#53: contrato_minimo_acuerdo) son preparación. Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato elegible.';
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
