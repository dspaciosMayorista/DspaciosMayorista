-- Rollback de la migración 304 (#94): elimina la tabla del resumen de precios del contrato, su validación y su clasificación en las guardas de identidad, y
-- RESTAURA `dtm_reuso_bloqueos` a la versión de la 289 (sin `contrato_resumen_precios` en la lista de preparación). Los documentos vuelven a mostrar el detalle por ítem.
-- Orden: primero la tabla (la elegibilidad 289 bloquearía un contrato con una fila de una tabla no clasificada), luego la función.
begin;

drop table if exists public.contrato_resumen_precios;
delete from public.contrato_guardas_config where tabla = 'contrato_resumen_precios';
select public.contrato_instalar_guardas();
drop function if exists public.p94_resumen_valido(jsonb);
drop function if exists public.p94_entero(jsonb);

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
    'rentabilidad','avisos','cotizaciones','comision_plan','contrato_facturacion','contrato_vuelo_control','sillas','cuentas_por_pagar','aliados_b2b'];
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
  'Migración 289 (#75). Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato elegible. La PREPARACIÓN no bloquea; los compromisos reales sí; lo no clasificado bloquea (falla cerrado).';
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;

comment on function public.dtm_reuso_bloqueos(text, boolean) is
  'Migración 289 (#75). Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato elegible. La PREPARACIÓN no bloquea; los compromisos reales sí; lo no clasificado bloquea (falla cerrado).';
do $$
begin
  if md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) is distinct from '9335ed80ca236f434802527daaeeb10d' then
    raise exception 'ROLLBACK_304: dtm_reuso_bloqueos no quedó idéntica a la 289.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
