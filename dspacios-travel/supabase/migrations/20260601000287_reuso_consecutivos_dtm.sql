-- ───────────────────────────────────────────────────────────────────────────
-- 287 · Reutilización de consecutivos DTM (Mayorista) de contratos PENDIENTES, NUNCA CONFIRMADOS y VACÍOS (#75)
--
-- ALCANCE APROBADO POR EL DUEÑO (2026-11-07)
--   · Solo Mayorista (DTM-####). Minorista NO se toca (numeros_contrato_liberados, siguiente_numero_contrato() y
--     la rama MIN de eliminar_contrato quedan idénticas).
--   · Solo contratos que TODAVÍA EXISTEN, están en estado «pendiente», nunca fueron confirmados y están vacíos
--     salvo por el cliente titular. Quedan fuera: números ya eliminados, huecos de la secuencia, contratos con
--     cualquier relación (aunque no tengan pagos), cancelados y confirmados.
--   · El historial técnico del número (tabla `auditoria`) SE CONSERVA tal cual para consulta interna. No se separa
--     cada vida con UUID ni con sufijos `~2`; no se borra ni se altera auditoría. `auditoria` solo la leen
--     superadmin y gerencia (policy de la 087/189): ni B2B ni B2C acceden a ese historial.
--   · NO se modifica la migración 281 (#86) ni `fn_renumerar_contrato`.
--
-- QUÉ HACE
--   1. `dtm_reuso_bloqueos(numero, vivo)` — ÚNICA definición de elegibilidad. FALLA CERRADO: cualquier lectura que
--      falle, o la ausencia de evidencia, se convierte en un motivo de bloqueo. Con `vivo = true` (al liberar)
--      exige: existe, tenant mayorista, estado actual pendiente, financiero completo, evento de creación en
--      auditoría y NINGÚN estado distinto de «pendiente» en toda la historia, campos comerciales de `ventas` vacíos
--      (solo cliente/titular/asesor/firma/fechas de cabecera), y CERO filas en cualquier otra tabla del esquema
--      `public` que tenga columna numero_contrato / contrato_numero o una FK hacia `ventas` (detección dinámica:
--      una tabla futura bloquea sin tocar esta función), CERO objetos de Storage con prefijo `<numero>/` y cero
--      asientos que lo nombren. Con `vivo = false` (al reutilizar) exige además que ya no exista en `ventas`.
--   2. `eliminar_contrato(numero, true)` sobre DTM-: bajo `FOR UPDATE` de la venta evalúa la elegibilidad ANTES de
--      tocar nada; si hay motivos rechaza (`REUSO_NO_ELEGIBLE: …`) y no cambia nada. Si es elegible elimina como
--      siempre y registra el número en `numeros_dtm_liberados` EN LA MISMA TRANSACCIÓN (eliminación + liberación
--      atómicas). Con p_reusar=false o sobre MIN- el comportamiento es el de la 196.
--   3. `reservar_numero_contrato(tenant)` (solo service_role) — Mayorista: toma el menor DTM liberado con
--      `FOR UPDATE SKIP LOCKED`, lo VUELVE A VERIFICAR (los que ya no son elegibles pasan a `bloqueado`, nunca se
--      borran) y lo entrega con un TICKET; si no hay ninguno elegible usa la secuencia como hoy. Minorista: igual
--      que hoy (ticket nulo).
--   4. Trigger BEFORE INSERT en `ventas`: un DTM que está en el pool solo se puede crear presentando SU ticket
--      (`ventas.reserva_token`, columna transitoria que el trigger descarta); re-verifica la elegibilidad y
--      consume la fila del pool en la misma transacción que crea el contrato. Fallo de creación → la transacción
--      se revierte, la reserva sigue siendo de quien la tiene y nadie más puede crear ese número.
--   5. Reserva vencida: tras 30 minutos (valor técnico provisional) otra solicitud PUEDE tomar el número y
--      reemplaza el ticket; el ticket anterior deja de servir. Mientras nadie la tome, su dueño puede crear.
--
-- ⚠️ RIESGO ABIERTO — EL REUSO NACE DESHABILITADO (`dtm_reuso_config.habilitado = false`)
--   El dueño aceptó conservar el historial técnico interno, pero NO autorizó que una escritura hecha desde una
--   pantalla del contrato ANTERIOR llegue al contrato NUEVO que reutiliza el número. Hoy eso SÍ ocurre: toda
--   operación identifica el contrato solo por el texto de `numero_contrato` (abonos, pasajeros, confirmar,
--   editar, servicios, archivos, eliminar…), así que una pantalla abierta antes de la reutilización escribe sobre
--   el contrato nuevo y nada en la base puede distinguirla de una operación legítima (reproducido en
--   scripts/repro_287_escritura_antigua.sh). Cerrarlo exige que el número reutilizado NO sea la clave con la que
--   las operaciones encuentran el contrato (ver docs/tecnico/reutilizacion-consecutivos.md §13). Mientras esa
--   protección no exista, `eliminar_contrato(DTM-…, true)` se RECHAZA con REUSO_DESHABILITADO. Habilitarlo es una
--   decisión explícita posterior: `update public.dtm_reuso_config set habilitado = true`.
--
-- LÍMITES CONOCIDOS
--   · El pool solo lo consumen los creadores de la aplicación (4 INSERT a `ventas` vía lib/contrato/numeracion.ts).
--     `convertir_cotizacion_a_contrato` (164) sigue pidiendo su número a la secuencia; no se modifica.
--   · La auditoría del contrato anterior y la del nuevo comparten el mismo texto de número (aceptado por el dueño).
--   · Un escritor de una tabla SIN FK puede insertar una fila entre la verificación al liberar y el commit: la
--     re-verificación al reservar y al crear lo detecta y bloquea el número.
--   · Documentos ya entregados al cliente anterior (cotización pendiente impresa/compartida) no dejan registro.
--   · El pool se recorre por consecutivo NUMÉRICO (DTM-9999 antes que DTM-10000), no por texto.
--
-- Orden de despliegue: preflight_287 → esta migración → postcheck_287 → código (el código viejo sigue funcionando
-- con la migración aplicada: no consume el pool y no envía ticket). Reversión: scripts/rollback_287_*.sql
-- (se niega si el pool tiene números o hay tickets en vuelo). Número de migración: antes 282; renumerada a 287 en la entrega 3 (la 286 es de #97; debe correr DESPUÉS de la 284 y la 285). La 283 está tomada por el perfil
-- del portal B2B (#25, rama codex/portal-b2b-vuelos); esta es la 287.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare v_md5 text;
begin
  if to_regclass('public.contrato_soportes_pago') is null or to_regclass('public.avisos') is null then
    raise exception '287: falta la 281 (#86). Aplicarla antes.';
  end if;
  if to_regprocedure('public._resolver_contrato_manual(text)') is null or to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'nacio_de_reuso')
     or to_regprocedure('public.soporte_verificar_identidad(text)') is null then
    raise exception '287: faltan la 284 y la 285 (identidad del contrato). Aplicarlas antes: el reuso sin ellas permitiría escrituras desde pantallas antiguas.';
  end if;
  if to_regclass('public.numeros_dtm_liberados') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'reserva_token') then
    raise exception '287: ya aplicada (existen numeros_dtm_liberados o ventas.reserva_token). No se re-aplica.';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p
   where p.oid = 'public.eliminar_contrato(text,boolean)'::regprocedure;
  if v_md5 is distinct from 'dcb90b8387d26b522d916c9ca8cfe685' then
    raise exception '287: la definición de eliminar_contrato en esta base NO es la esperada (migración 196, md5 dcb90b8387d26b522d916c9ca8cfe685; hay %). La 287 la reemplaza; no se aplica sobre una versión distinta.', v_md5;
  end if;
  if to_regprocedure('public.siguiente_numero_contrato_para_tenant(text)') is null
     or to_regclass('public.contrato_seq_mayorista') is null then
    raise exception '287: falta siguiente_numero_contrato_para_tenant o contrato_seq_mayorista (migración 159).';
  end if;
end $$;

-- ── 1) Pool de DTM liberados ───────────────────────────────────────────────
create table public.numeros_dtm_liberados (
  numero          text primary key check (numero ~ '^DTM-[0-9]{4,}$'),
  estado          text not null default 'disponible' check (estado in ('disponible', 'asignado', 'bloqueado')),
  motivo_bloqueo  text,
  liberado_en     timestamptz not null default now(),
  liberado_por    uuid,
  asignado_token  uuid,
  asignado_en     timestamptz,
  constraint numeros_dtm_liberados_ticket_coherente check ((estado = 'asignado') = (asignado_token is not null))
);
comment on table public.numeros_dtm_liberados is
  'Consecutivos DTM de contratos pendientes/vacíos eliminados con reuso (#75, migración 287). Solo lo escriben eliminar_contrato y reservar_numero_contrato (SECURITY DEFINER). Un número bloqueado se conserva con su motivo; nunca se borra evidencia.';
alter table public.numeros_dtm_liberados enable row level security;
create policy "numeros_dtm_liberados: superadmin lee" on public.numeros_dtm_liberados
  for select using (public.mi_rol() = 'superadmin');
revoke all on public.numeros_dtm_liberados from public, anon, authenticated;
grant select on public.numeros_dtm_liberados to authenticated;
grant all on public.numeros_dtm_liberados to service_role;

-- Interruptor del reuso (una sola fila). NACE DESHABILITADO: ver «RIESGO ABIERTO» en la cabecera. Solo gobierna la
-- LIBERACIÓN (eliminar_contrato) y, apagado, también la ENTREGA y el CONSUMO del pool: reservar_numero_contrato usa la secuencia y el trigger rechaza un ticket
-- emitido antes de apagar (REUSO_APAGADO). Apagar NO borra números liberados ni reservas; los contratos ya reutilizados conservan identidad y guardas.
create table public.dtm_reuso_config (
  id             boolean primary key default true check (id),
  habilitado     boolean not null default false,
  nota           text,
  actualizado_en timestamptz not null default now()
);
insert into public.dtm_reuso_config(habilitado, nota)
values (false, 'Deshabilitado hasta implementar la protección contra escrituras de pantallas antiguas (#75, docs/tecnico/reutilizacion-consecutivos.md §13).');
comment on table public.dtm_reuso_config is
  'Migración 287 (#75). habilitado=false (defecto): eliminar_contrato rechaza liberar un DTM para reutilización (REUSO_DESHABILITADO). Cambiarlo es una decisión explícita del dueño, no un parámetro operativo.';
alter table public.dtm_reuso_config enable row level security;
create policy "dtm_reuso_config: superadmin lee" on public.dtm_reuso_config
  for select using (public.mi_rol() = 'superadmin');
revoke all on public.dtm_reuso_config from public, anon, authenticated;
grant select on public.dtm_reuso_config to authenticated;
grant all on public.dtm_reuso_config to service_role;

-- Ticket transitorio de la reserva: el trigger lo valida y lo deja en NULL; nunca persiste.
alter table public.ventas add column reserva_token uuid;
comment on column public.ventas.reserva_token is
  'Migración 287: ticket TRANSITORIO de la reserva de un DTM reutilizado. El trigger trg_ventas_reserva_dtm lo valida y lo descarta (siempre NULL tras el INSERT).';

-- ── 2) Elegibilidad ───────────────────────────────────────────────────────
create function public.dtm_valor_vacio(p_valor text) returns boolean
language sql immutable parallel safe as $$
  select p_valor is null or btrim(p_valor) = '' or p_valor in ('false', 'null')
      or (p_valor ~ '^-?[0-9]+(\.[0-9]+)?$' and p_valor::numeric = 0)
$$;

create function public.dtm_reuso_bloqueos(p_numero text, p_vivo boolean)
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
revoke all on function public.dtm_valor_vacio(text) from public, anon, authenticated;
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;

-- Vista previa para la UI (solo superadmin): mismos motivos que verá eliminar_contrato.
create function public.contrato_reuso_preview(p_numero text) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'Solo un superadmin puede consultar la elegibilidad de reutilización.';
  end if;
  return public.dtm_reuso_bloqueos(p_numero, true);
end $$;
revoke all on function public.contrato_reuso_preview(text) from public, anon;
grant execute on function public.contrato_reuso_preview(text) to authenticated;

-- ── 3) eliminar_contrato: MISMO cuerpo que la 196; cambia solo el candado de DTM y el registro en el pool ──
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

-- ── 4) Reserva de consecutivo (Mayorista: pool + secuencia; Minorista: como antes) ───────────────────────
create function public.reservar_numero_contrato(p_tenant text)
returns table(numero text, token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant text := btrim(coalesce(p_tenant, ''));
  r        public.numeros_dtm_liberados%rowtype;
  b        text[];
  t        uuid;
  v_hab    boolean;
begin
  if v_tenant = '' then
    raise exception 'tenant requerido para reservar el número de contrato.';
  end if;

  if v_tenant = 'minorista' then
    numero := public.siguiente_numero_contrato_para_tenant('minorista');
    token := null;
    return next;
    return;
  end if;
  if v_tenant <> 'mayorista' then
    raise exception 'tenant inválido: % (debe ser "mayorista" o "minorista")', v_tenant;
  end if;

  -- Apagado: NO se entrega nada del pool (los números y reservas se conservan intactos) y se usa la secuencia. FOR SHARE sobre la fila del interruptor:
  -- apagar (UPDATE) espera a que terminen las reservas en curso, y una reserva que empieza después de apagar ya lo ve apagado.
  select c.habilitado into v_hab from public.dtm_reuso_config c limit 1 for share;

  while coalesce(v_hab, false) loop
    -- Disponible, o reservada hace más de 30 min (valor técnico provisional) y sin contrato creado: otra solicitud
    -- puede tomarla y reemplaza el ticket (el anterior deja de servir). SKIP LOCKED: dos solicitudes simultáneas
    -- nunca reciben el mismo número.
    select * into r from public.numeros_dtm_liberados p
     where p.estado = 'disponible'
        or (p.estado = 'asignado' and p.asignado_en < clock_timestamp() - interval '30 minutes')
     order by substring(p.numero from '[0-9]+$')::bigint, p.numero
     limit 1
       for update skip locked;
    exit when not found;

    b := public.dtm_reuso_bloqueos(r.numero, false);
    if cardinality(b) > 0 then
      update public.numeros_dtm_liberados
         set estado = 'bloqueado', motivo_bloqueo = array_to_string(b, ', '), asignado_token = null, asignado_en = null
       where numeros_dtm_liberados.numero = r.numero;
      continue;
    end if;

    t := gen_random_uuid();
    update public.numeros_dtm_liberados
       set estado = 'asignado', asignado_token = t, asignado_en = clock_timestamp()
     where numeros_dtm_liberados.numero = r.numero;
    numero := r.numero; token := t;
    return next;
    return;
  end loop;

  numero := 'DTM-' || lpad(nextval('public.contrato_seq_mayorista')::text, 4, '0');
  token := null;
  return next;
end;
$$;
comment on function public.reservar_numero_contrato(text) is
  'Migración 287 (#75). Mayorista: devuelve un DTM liberado verificado + ticket, o uno nuevo de la secuencia (ticket nulo). Minorista: delega en siguiente_numero_contrato_para_tenant. Solo service_role.';
revoke all on function public.reservar_numero_contrato(text) from public, anon, authenticated;
grant execute on function public.reservar_numero_contrato(text) to service_role;

-- ── 5) Trigger de creación: un DTM del pool solo se crea con SU ticket ──────────────────────────────────
create function public.trg_ventas_reserva_dtm() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.numeros_dtm_liberados%rowtype;
  b text[];
begin
  if new.tenant is distinct from 'mayorista' then
    new.reserva_token := null;
    return new;
  end if;

  select * into r from public.numeros_dtm_liberados where numero = new.numero_contrato for update;
  if found then
    if r.estado <> 'asignado' or new.reserva_token is distinct from r.asignado_token then
      raise exception 'RESERVA_AJENA: el consecutivo % está en reutilización y no está reservado para esta solicitud.', new.numero_contrato
        using errcode = 'P0001';
    end if;
    -- Apagado: un ticket emitido antes de apagar ya no crea un contrato reutilizado. Se conserva el número y la reserva (nada se borra).
    -- FOR SHARE: si el apagado es concurrente, o este INSERT confirma antes (orden transaccional) o ve el interruptor apagado.
    if not coalesce((select c.habilitado from public.dtm_reuso_config c limit 1 for share), false) then
      raise exception 'REUSO_APAGADO: el consecutivo % estaba reservado para reutilización pero el reuso está deshabilitado; esta reserva ya no sirve. El número se conserva. Genera el contrato de nuevo (recibirá un número nuevo).', new.numero_contrato
        using errcode = 'P0001';
    end if;
    b := public.dtm_reuso_bloqueos(new.numero_contrato, false);
    if cardinality(b) > 0 then
      raise exception 'REUSO_NO_ELEGIBLE: % (%)', new.numero_contrato, array_to_string(b, ', ')
        using errcode = 'P0001';
    end if;
    delete from public.numeros_dtm_liberados where numero = r.numero;
    new.nacio_de_reuso := true;   -- entrega 3: este contrato nace de un número reutilizado; desde ahora toda escritura exige la identidad (migración 284)
  elsif new.reserva_token is not null then
    raise exception 'RESERVA_INEXISTENTE: el ticket presentado no corresponde a ninguna reserva vigente de %.', new.numero_contrato
      using errcode = 'P0001';
  end if;

  new.reserva_token := null;
  return new;
end $$;
revoke all on function public.trg_ventas_reserva_dtm() from public, anon, authenticated;
create trigger trg_ventas_reserva_dtm before insert on public.ventas
  for each row execute function public.trg_ventas_reserva_dtm();

notify pgrst, 'reload schema';

commit;
