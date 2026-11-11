-- ROLLBACK de la migración 289 (#75, elegibilidad ampliada): restaura dtm_reuso_bloqueos y eliminar_contrato a la definición de la 287. Una transacción.
-- No toca datos. Verifica por md5 que lo restaurado es EXACTAMENTE la 287. Si el reuso estaba habilitado, NO lo cambia (esa decisión es aparte).
begin;
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
  -- Campos de `ventas` que deben estar vacíos. Quedan permitidos: cliente/titular, asesor y su firma, canal,
  -- tipo de cliente/asesor, fechas de cabecera, pax por defecto, moneda por defecto y observaciones.
  campos constant text[] := array[
    'destino','tipo_paquete','fecha_salida','fecha_regreso','hotel','aerolinea','receptivo','asistencia',
    'otros_proveedores','precio_venta','costo_hotel','costo_aereo','costo_receptivo','costo_asistencia','otros_costos',
    'facturado','numero_documento','asistencia_medica','plan_nombre','tours_traslados','plazo','agencia_nombre',
    'agencia_asesor','freelance_nombre','paquete_armado_id','bloqueo_ref_id','impuesto','b2b_usuario_id',
    'modo_compra','comision_b2b','comision_estado','recobro_total','recobro_empresa','recobro_aliado','trm_contrato',
    'aliado_id','empaquetado_ref_id','cotizacion_id','financiero_registrado_en','aceptacion_63_id',
    'moneda_cobro','trm_cobro','total_cobro','cotizacion_origen_id','grupo_conversion'];
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

    -- Relaciones: toda tabla del esquema public con columna numero_contrato / contrato_numero o FK hacia ventas.
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
       where t.relname <> 'ventas'
       order by 1
    loop
      begin
        execute format('select exists (select 1 from public.%I where %I = $1)', r.tabla, r.col) into x using p_numero;
        if x then b := b || ('RELACION_' || upper(r.tabla)); end if;
      exception when others then
        b := b || ('LECTURA_FALLIDA_' || upper(r.tabla));
      end;
    end loop;

    begin
      if exists (select 1 from storage.objects o where starts_with(o.name, p_numero || '/')) then
        b := b || 'ARCHIVOS_EN_STORAGE'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_STORAGE'::text;
    end;

    -- Referencias MANUALES de texto (sillas.contrato_manual): no tienen FK ni la columna numero_contrato, así que el barrido dinámico no las ve.
    -- Una silla que apunta a este contrato por referencia manual bloquea el número (misma regla de resolución que las guardas de la 284).
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
  'Migración 287 (#75). Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato que cumple las guardas. Falla cerrado. Solo la usan eliminar_contrato, reservar_numero_contrato y el trigger de ventas.';
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;

create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bloqueos text[];
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  -- Migración 287 (#75): un DTM- solo se libera para reutilización si es un contrato pendiente, nunca confirmado
  -- y vacío. La venta se bloquea ANTES de evaluar (serializa con los escritores que tienen FK hacia ella) y la
  -- evaluación ocurre antes de tocar cualquier dato: si hay motivos, no cambia nada.
  if p_reusar and p_numero ~ '^DTM-' then
    perform 1 from public.ventas where numero_contrato = p_numero for update;
    v_bloqueos := public.dtm_reuso_bloqueos(p_numero, true);
    if cardinality(v_bloqueos) > 0 then
      raise exception 'REUSO_NO_ELEGIBLE: %', array_to_string(v_bloqueos, ', ')
        using errcode = 'P0001',
              hint = 'No se cambió nada. Elimina el contrato sin reutilizar su consecutivo si solo necesitas borrarlo.';
    end if;
  end if;

  -- Migración 196 (R1 + R2): libera las sillas del contrato con la regla
  -- única `_vaciar_sillas`: quita contrato y TODOS los datos del grupo D;
  -- devuelta y no vendida conservan su estado (nota en bloqueo_cambios).
  perform public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = p_numero),
    format('Contrato %s eliminado', p_numero));

  -- Desvincula la cotización de origen (vuelve a 'abierta' para reconvertir).
  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  -- Hijas SIN cascade (factura_items cae por cascade de facturacion).
  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  -- Ventana ESTRECHA del bypass (migración 166): encendida justo antes del
  -- ÚNICO delete que puede cascadear a contrato_condiciones, apagada
  -- inmediatamente después. `set local` ya está acotado a esta transacción
  -- (esta llamada RPC); apagarlo explícitamente además acota la ventana al
  -- tiempo de esta única sentencia, no al resto de la transacción.
  set local app.eliminando_contrato = 'true';

  -- La venta (contrato_pasajeros/hoteles/vuelos/items/condiciones, vouchers,
  -- adjuntos: cascade).
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

do $$
begin
  if md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) is distinct from '286eb0058b7593e0f1dfff59fe0f442a' then
    raise exception 'ROLLBACK_289: dtm_reuso_bloqueos no quedó idéntica a la 287.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = 'public.eliminar_contrato(text,boolean)'::regprocedure), chr(13), '')) is distinct from 'c7a510c064a67fd40e5cb84ea6a3d8d1' then
    raise exception 'ROLLBACK_289: eliminar_contrato no quedó idéntica a la 287.';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
