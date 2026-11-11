-- ───────────────────────────────────────────────────────────────────────────
-- 289 · Elegibilidad ampliada para reutilizar un consecutivo DTM (#75, Parte 2)
--
-- REGLA APROBADA: un contrato PENDIENTE, nunca confirmado, puede tener preparada toda su información (cliente, pasajeros, hoteles, vuelos previstos, ítems, servicios,
-- condiciones de pago, costos previstos, obligaciones previstas, cotización vinculada, comisión NETO ya descontada del precio). Esa preparación NO impide eliminarlo y
-- reutilizar su número: se borra con el contrato y el siguiente no hereda nada. SIGUEN bloqueando los COMPROMISOS REALES: confirmación previa, dinero recibido o anulado,
-- pagos ejecutados, emisión (vuelo/voucher/factura), comisión exigible o pagada, asientos, conciliación, archivos y soportes de pago, historia inmutable.
--
-- QUÉ CAMBIA (solo estas dos funciones; el resto de 287 —ticket, pool, interruptor, trigger— no se toca)
--   1. dtm_reuso_bloqueos(numero, vivo): reescrita con CLASIFICACIÓN por tabla. Las tablas de preparación ya no bloquean; cada una trae, cuando aplica, una comprobación
--      específica de su estado real (ej. sillas solo si están «en_plazo»; vuelo solo si NO está emitido; CxP sin pagos ni retenciones). Toda tabla NO clasificada (incluida
--      una futura con columna numero_contrato) sigue BLOQUEANDO (falla cerrado). Los campos comerciales de `ventas` dejan de bloquear salvo facturado/numero_documento/grupo_conversion.
--   2. eliminar_contrato(numero, reusar): MISMO cuerpo que la 287 más, SOLO al reutilizar un DTM: (a) borrar los avisos del contrato y (b) borrar el plan de comisión (#97) POR contrato_uid con la marca
--      transaccional `app.p75_eliminando_uid` (no por número). Eliminar SIN reutilizar no cambia nada respecto a la 287. Además: la liberación de sillas, la desvinculación de la cotización, la auditoría y la protección de identidad (284/285) no cambian.
--
-- DECISIONES (documentadas en docs/tecnico/ciclo-pendiente-confirmado-75.md §11)
--   · ARCHIVOS: contrato_adjuntos, contrato_soportes_pago y objetos de Storage `<numero>/…` BLOQUEAN (soportes = evidencia de dinero; Storage no es transaccional con SQL).
--   · HISTORIA INMUTABLE que BLOQUEA mientras no se decida otra cosa: p63_aceptacion (trigger p63_historico: no se borra) y persona_capturas (solo inserción). Un contrato con
--     una de esas filas NO es elegible; desbloquearlo exige cambiar esas inmutabilidades (decisión del dueño, fuera de esta migración).
--   · PLAN DE COMISIÓN (#97, comision_plan): solo inserción. Es PREPARACIÓN y se borra con el contrato SOLO si la 286 aplicada trae la versión esperada (comentario de p97_priv.tg_solo_insercion =
--     'LIBERACION_PLAN_V2: …', que borra únicamente por contrato_uid, plan no materializado y contrato pendiente); si no, bloquea (PLAN_COMISION_SIN_LIBERACION_97). Un plan materializado (comisión
--     exigible que lo referencia) bloquea (PLAN_COMISION_MATERIALIZADO). Los planes de la cotización y los de otra vida del mismo número no se tocan.
--   · COMISIÓN: una fila de aliados_b2b solo es preparación si fue DESCONTADA en el precio (NETO) y sin pagos ni revisiones; cualquier otra es una comisión exigible → bloquea.
--   · CxP: sin pagos, sin retenciones y sin protección #63 son obligaciones sin ejecutar y se borran (como ya hacía eliminar_contrato); con cualquiera de ellos bloquean.
--
-- NO CAMBIA: reuso APAGADO (dtm_reuso_config.habilitado=false), Minorista, la 287/284/285/288, auditoría del número ni protección de identidad.
-- Orden: 288 → 286 (#97) → 289 → activar ciclo de #97 → código. Reversión: scripts/rollback_289_*.sql
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) is distinct from '286eb0058b7593e0f1dfff59fe0f442a' then
    raise exception '289: dtm_reuso_bloqueos no es la de la 287; no se reemplaza.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = 'public.eliminar_contrato(text,boolean)'::regprocedure), chr(13), '')) is distinct from 'c7a510c064a67fd40e5cb84ea6a3d8d1' then
    raise exception '289: eliminar_contrato no es la de la 287; no se reemplaza.';
  end if;
  if to_regclass('public.contrato_guardas_config') is null then raise exception '289: falta la 284.'; end if;
end $$;

-- ── 1) Elegibilidad con clasificación ────────────────────────────────────
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

-- ── 2) eliminar_contrato: cuerpo de la 287 + avisos y plan de comisión ───
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bloqueos text[];
  v_uid      uuid;
  v_dtm      boolean := p_reusar and p_numero ~ '^DTM-';
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  -- 287/289 (#75): un DTM- solo se libera para reutilización si es un contrato pendiente, nunca confirmado y sin compromisos reales. La venta se bloquea ANTES de
  -- evaluar (serializa con los escritores que tienen FK hacia ella) y la evaluación ocurre antes de tocar cualquier dato: si hay motivos, no cambia nada.
  if v_dtm then
    select contrato_uid into v_uid from public.ventas where numero_contrato = p_numero for update;
    v_bloqueos := public.dtm_reuso_bloqueos(p_numero, true);
    if cardinality(v_bloqueos) > 0 then
      raise exception 'REUSO_NO_ELEGIBLE: %', array_to_string(v_bloqueos, ', ')
        using errcode = 'P0001',
              hint = 'No se cambió nada. Elimina el contrato sin reutilizar su consecutivo si solo necesitas borrarlo.';
    end if;
  end if;

  -- Migración 196 (R1 + R2): libera las sillas del contrato con la regla única `_vaciar_sillas`.
  perform public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = p_numero),
    format('Contrato %s eliminado', p_numero));

  -- Desvincula la cotización de origen (vuelve a 'abierta' para reconvertir).
  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  -- 289 (solo al reutilizar un DTM, único caso que ya pasó la elegibilidad): avisos del contrato (sin FK).
  if v_dtm then
    delete from public.avisos where numero_contrato = p_numero;
  end if;

  -- Hijas SIN cascade (factura_items cae por cascade de facturacion).
  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  -- 289: plan de comisión de #97 (solo inserción) del contrato que se elimina, POR IDENTIDAD: la marca transaccional lleva el contrato_uid (no el número) y el trigger de la 286 (LIBERACION_PLAN_V2)
  -- solo la honra para planes no materializados de un contrato pendiente con esa identidad. Los planes de la COTIZACIÓN (sin contrato_uid) y los de otra vida del mismo número no se tocan.
  if v_dtm and v_uid is not null and to_regclass('public.comision_plan') is not null then
    perform set_config('app.p75_eliminando_uid', v_uid::text, true);
    execute 'delete from public.comision_plan where contrato_uid = $1' using v_uid;
    perform set_config('app.p75_eliminando_uid', '', true);
  end if;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  -- Ventana ESTRECHA del bypass (migración 166).
  set local app.eliminando_contrato = 'true';

  -- La venta (contrato_pasajeros/hoteles/vuelos/items/condiciones/previstas, vouchers, adjuntos: cascade).
  delete from public.ventas where numero_contrato = p_numero;

  set local app.eliminando_contrato = 'false';

  if p_reusar then
    if p_numero ~ '^DTM-' then
      -- 287: liberación atómica con la eliminación (misma transacción).
      insert into public.numeros_dtm_liberados(numero, liberado_por) values (p_numero, auth.uid());
    else
      insert into public.numeros_contrato_liberados(numero) values (p_numero)
        on conflict do nothing;
    end if;
  end if;
end;
$function$;

notify pgrst, 'reload schema';
commit;
