-- ROLLBACK de la 307 (#53). Restaura las CUATRO funciones redefinidas a su texto de las migraciones aplicadas (288, 285 y 304) y retira las funciones nuevas.
-- NO borra datos de negocio: si la tabla `contrato_minimo_acuerdo` (historial de acuerdos de mínimo) tiene filas, SE CONSERVA —con su clasificación y su guarda de identidad— y,
-- como `dtm_reuso_bloqueos` vuelve a la versión de la 304, esos contratos pasan a estar bloqueados para el reuso (RELACION_CONTRATO_MINIMO_ACUERDO) mientras tengan acuerdos.
-- Si la tabla está VACÍA se elimina junto con su clasificación. El INTERRUPTOR del reuso (dtm_reuso_config) nunca se toca.
-- Efecto de volver atrás: la regla NETO vuelve a exigir el total; el vencimiento vuelve a cancelar también los pendientes con pagos; el código de la 307 que
-- llama `contratos_pagados_completos` / `fijar_minimo_confirmacion` falla cerrado (el aliado no ve vouchers) hasta revertir también el código.
-- Una sola transacción. Hacer primero el rollback del CÓDIGO si ya se desplegó.
begin;

create or replace function p75_priv.regla_confirmacion(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.ventas; v_mo text; v_mc text; v_total numeric; v_moneda text; v_pct numeric; n integer; s numeric; m text; t numeric;
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
  if v.comision_estado = 'descontada' then
    return jsonb_build_object('regla', 'neto_total', 'minimo', v_total, 'moneda', v_moneda, 'trm', null);
  end if;
  select count(*), coalesce(sum(c.monto_exigido), 0), min(upper(c.moneda)), max(c.trm) into n, s, m, t
    from public.contrato_condiciones c where c.numero_contrato = p_numero;
  if n > 0 then
    return jsonb_build_object('regla', 'condicion_congelada', 'minimo', s, 'moneda', coalesce(m, v_moneda), 'trm', t);
  end if;
  select c.pct_abono into v_pct from public.config_cobros c where c.tipo_paquete = coalesce(v.tipo_paquete, '');
  return jsonb_build_object('regla', 'legacy_pct', 'minimo', v_total * coalesce(v_pct, 0.3), 'moneda', v_moneda, 'trm', null);
end $$;
revoke all on function p75_priv.regla_confirmacion(text) from public, anon, authenticated;
grant execute on function p75_priv.regla_confirmacion(text) to service_role;

create or replace function public.liberar_vencidas(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = 'public', 'pg_temp' set lock_timeout = '5s' as $function$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Bogota')::date);
  v_nums text[];
  v_sillas integer := 0;
begin
  select array_agg(numero_contrato order by numero_contrato) into v_nums
    from (select numero_contrato from public.ventas
           where estado = 'pendiente' and plazo < v_hoy
           order by numero_contrato for update) v;
  if v_nums is null then
    return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', 0, 'sillas', 0);
  end if;
  -- Tarea automática: no recibe contratos de ninguna pantalla; los eligió por estado y los bloqueó arriba. Declara lo que LEYÓ bajo bloqueo (#75).
  perform public.contrato_declarar_identidad(x.numero_contrato, x.contrato_uid) from public.ventas x where x.numero_contrato = any (v_nums);
  v_sillas := public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = any(v_nums) and estado = 'en_plazo'),
    'Reserva vencida');
  update public.ventas set estado = 'cancelado' where numero_contrato = any(v_nums) and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'hoy', v_hoy, 'liberadas', cardinality(v_nums), 'sillas', v_sillas);
end $function$;

create or replace function public.estado_confirmacion_pago(p_numero text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('confirmacion_pendiente', p75_priv.alcanza_minimo(p_numero))
$$;

-- Elegibilidad del reuso: vuelve EXACTAMENTE a la versión de la 304 (md5 e417b53ecf0de9523e222f9c45debd9a).
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
    'contrato_resumen_precios'];
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
  'Migración 289 (#75) + 304 (#94: contrato_resumen_precios es preparación). Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato elegible. La PREPARACIÓN no bloquea; los compromisos reales sí; lo no clasificado bloquea (falla cerrado).';
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;
do $$ begin
  if md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) is distinct from 'e417b53ecf0de9523e222f9c45debd9a' then
    raise exception 'ROLLBACK_307: dtm_reuso_bloqueos no quedó idéntica a la 304.';
  end if;
end $$;

drop function if exists public.fijar_minimo_confirmacion(text, text, numeric, text, text);
drop function if exists public.contrato_pagado_completo(text);
drop function if exists public.contratos_pagados_completos(text[]);

-- Tabla de acuerdos: se elimina SOLO si está vacía (con filas se conserva, clasificada y guardada).
do $$ begin
  if to_regclass('public.contrato_minimo_acuerdo') is not null and not exists (select 1 from public.contrato_minimo_acuerdo) then
    drop table public.contrato_minimo_acuerdo;
    delete from public.contrato_guardas_config where tabla = 'contrato_minimo_acuerdo';
    drop function if exists public.tg_minimo_acuerdo_solo_insercion();
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
