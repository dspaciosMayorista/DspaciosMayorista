-- ───────────────────────────────────────────────────────────────────────────
-- 231 · MONEDA DE LA FUENTE EN BLOQUEOS  (#90 · Entrega B)
--
-- CONTEXTO: `bloqueos_vuelo` nunca tuvo moneda; todo el sistema asumió COP (tarifa_neta, tarifa_para_empaquetar, fee_infante). La 230 ya
-- resolvió COP/USD en Empaquetados y en sus salidas vinculadas. Decisión D2 del dueño (2026-10-23): los 95 Bloqueos actuales se compran en
-- COP, pero esa moneda se ACREDITA de forma expresa y trazable (script aparte, tras un preflight); un Bloqueo NUEVO nunca se supone en COP.
--
-- QUÉ HACE (ADITIVA; no edita la 195/199/226/227/230, no toca datos, no cambia policies ni ACL)
--   1. bloqueos_vuelo.moneda ('COP' | 'USD' | NULL = sin acreditar) + moneda_acreditada_en / _por / _ref (constancia). Invariante:
--      moneda es NULL si y solo si no hay constancia (CHECK).
--   2. trg_bloqueos_moneda_90 (BEFORE INSERT/UPDATE): la constancia la escribe el SERVIDOR, no el cliente (en = now(), por = auth.uid(),
--      ref = GUC local `p90.moneda_ref` o 'app'); no se reescribe si la moneda no cambia; una moneda acreditada no vuelve a NULL; en COP
--      un valor positivo menor a 1.000 (neta, reventa o fee de infante) se rechaza con "¿Este valor está en USD?" (regla del dueño).
--   3. Interruptor ESTRICTO (p90_priv.config.exigir_moneda_bloqueo), APAGADO: encendido, un Bloqueo no puede crearse ni cambiar de tarifa sin
--      moneda. Se enciende en un paso aparte (supabase/scripts/encender_231_moneda_obligatoria.sql) cuando el código ya la envía siempre.
--   4. crear_bloqueo (195/226) recibe `moneda` en p_datos (inválida = error; vacía = NULL sin acreditar, salvo interruptor encendido).
--   5. Invalidación del tarifario: tarifario_trg_bloqueos_vuelo vigila `moneda`. Excepción deliberada: acreditar NULL -> COP sin cambiar
--      ningún otro dato NO invalida (NULL siempre se leyó como COP; el precio publicado no cambia) — así la acreditación en bloque de los 95
--      no deja inservible el tarifario de todos los paquetes con Bloqueo. Cualquier otro cambio de moneda (NULL->USD, COP->USD, USD->COP)
--      sí invalida.
--
-- QUÉ NO HACE
--   No convierte ni reescribe ningún precio; no toca tarifario_resultado, ventas, CxP, sillas ni la RPC de #63; no acredita ninguna fila (eso
--   es el script de acreditación, con su propio preflight/postcheck); no cambia el tarifario público.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código nuevo (con el interruptor apagado el código viejo sigue creando Bloqueos sin
--   moneda). Después: desplegar -> acreditar los 95 (script) -> postcheck -> ENCENDER el interruptor estricto (paso OBLIGATORIO,
--   encender_231_moneda_obligatoria.sql) -> postcheck FINAL sin ningún REVISAR.
-- Rollback: supabase/scripts/rollback_231_moneda_bloqueos.sql (estructura; se niega si hay monedas acreditadas) y
--   supabase/scripts/rollback_231_acreditacion_datos.sql (datos).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═══ 0. Prerrequisitos (fallan cerrado) ═══════════════════════════════════
do $$
begin
  if to_regprocedure('public.crear_bloqueo(jsonb, integer)') is null
     or to_regprocedure('public.tarifario_trg_bump_por_bloqueo()') is null
     or to_regclass('public.bloqueos_vuelo') is null
     or not exists (select 1 from pg_trigger where tgname = 'tarifario_trg_bloqueos_vuelo' and tgrelid = 'public.bloqueos_vuelo'::regclass) then
    raise exception '231 ABORTADA: falta la 226 (crear_bloqueo con fee_infante / invalidación por Bloqueo).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name = 'fee_infante') then
    raise exception '231 ABORTADA: falta bloqueos_vuelo.fee_infante (migración 226).';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name = 'moneda') then
    raise exception '231 ya aplicada (bloqueos_vuelo.moneda existe). No se re-aplica.';
  end if;
end $$;

-- ═══ 1. Columnas y CHECK ══════════════════════════════════════════════════
alter table public.bloqueos_vuelo
  add column moneda text,
  add column moneda_acreditada_en timestamptz,
  add column moneda_acreditada_por uuid,
  add column moneda_acreditada_ref text,
  add constraint bloqueos_vuelo_moneda_chk check (moneda is null or moneda in ('COP', 'USD')),
  add constraint bloqueos_vuelo_moneda_constancia_chk check ((moneda is null) = (moneda_acreditada_en is null));

comment on column public.bloqueos_vuelo.moneda is
  'Moneda de tarifa_neta / tarifa_para_empaquetar / fee_infante: COP o USD. NULL = sin acreditar (se lee como COP para no cambiar lo publicado, pero un paquete USD lo rechaza). Se acredita en bloque (script) o al crear/editar el Bloqueo. Migración 231.';
comment on column public.bloqueos_vuelo.moneda_acreditada_en is 'Cuándo se acreditó/cambió la moneda (lo escribe el trigger, no el cliente). Migración 231.';
comment on column public.bloqueos_vuelo.moneda_acreditada_por is 'auth.uid() de quien acreditó/cambió la moneda; NULL si fue por SQL directo (ver moneda_acreditada_ref). Migración 231.';
comment on column public.bloqueos_vuelo.moneda_acreditada_ref is 'Origen de la constancia: ''app'' (formulario) o la referencia de la decisión (p. ej. D2 del dueño) en una acreditación en bloque. Migración 231.';

-- ═══ 2. Interruptor estricto (APAGADO) ════════════════════════════════════
create schema if not exists p90_priv;
revoke all on schema p90_priv from public, anon, authenticated;

create table p90_priv.config (
  id boolean primary key default true check (id),
  exigir_moneda_bloqueo boolean not null default false,
  actualizado_en timestamptz not null default now()
);
insert into p90_priv.config (id) values (true);
revoke all on p90_priv.config from public, anon, authenticated;

create or replace function p90_priv.exigir_moneda_bloqueo()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((select c.exigir_moneda_bloqueo from p90_priv.config c where c.id), false)
$$;
revoke all on function p90_priv.exigir_moneda_bloqueo() from public, anon, authenticated;

-- ═══ 3. Guarda de la moneda (constancia servidor + COP sospechoso) ════════
create or replace function public.trg_bloqueos_moneda_90()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cambia boolean;
  v_ref    text;
  v_sospechoso text[];
begin
  if TG_OP = 'UPDATE' and OLD.moneda is not null and NEW.moneda is null then
    raise exception using errcode = '22023',
      message = 'MONEDA_BLOQUEO: una moneda ya acreditada no se puede dejar en blanco; cámbiala a COP o USD.';
  end if;

  v_cambia := NEW.moneda is not null and (TG_OP = 'INSERT' or NEW.moneda is distinct from OLD.moneda);

  -- La constancia la escribe el servidor: lo que mande el cliente en estas tres columnas no cuenta.
  if v_cambia then
    v_ref := nullif(btrim(coalesce(current_setting('p90.moneda_ref', true), '')), '');
    NEW.moneda_acreditada_en := now();
    NEW.moneda_acreditada_por := auth.uid();
    NEW.moneda_acreditada_ref := coalesce(v_ref, 'app');
  elsif TG_OP = 'UPDATE' then
    NEW.moneda_acreditada_en := OLD.moneda_acreditada_en;
    NEW.moneda_acreditada_por := OLD.moneda_acreditada_por;
    NEW.moneda_acreditada_ref := OLD.moneda_acreditada_ref;
  else
    NEW.moneda_acreditada_en := null;
    NEW.moneda_acreditada_por := null;
    NEW.moneda_acreditada_ref := null;
  end if;

  -- Interruptor estricto (apagado de fábrica): sin moneda no se crea ni se cambia la tarifa.
  if NEW.moneda is null and p90_priv.exigir_moneda_bloqueo()
     and (TG_OP = 'INSERT'
          or NEW.tarifa_neta is distinct from OLD.tarifa_neta
          or NEW.tarifa_para_empaquetar is distinct from OLD.tarifa_para_empaquetar
          or NEW.fee_infante is distinct from OLD.fee_infante) then
    raise exception using errcode = '22023',
      message = 'MONEDA_BLOQUEO: elige la moneda de las tarifas (COP o USD) del Bloqueo.';
  end if;

  -- Regla del dueño: en COP, un valor positivo menor a 1.000 es casi seguro USD.
  if NEW.moneda = 'COP'
     and (TG_OP = 'INSERT' or v_cambia
          or NEW.tarifa_neta is distinct from OLD.tarifa_neta
          or NEW.tarifa_para_empaquetar is distinct from OLD.tarifa_para_empaquetar
          or NEW.fee_infante is distinct from OLD.fee_infante) then
    select array_remove(array[
             case when NEW.tarifa_neta > 0 and NEW.tarifa_neta < 1000 then 'Tarifa neta' end,
             case when NEW.tarifa_para_empaquetar > 0 and NEW.tarifa_para_empaquetar < 1000 then 'Tarifa empaquetar (reventa)' end,
             case when NEW.fee_infante > 0 and NEW.fee_infante < 1000 then 'Fee de infante' end], null)
      into v_sospechoso;
    if coalesce(array_length(v_sospechoso, 1), 0) > 0 then
      raise exception using errcode = '22023',
        message = format('MONEDA_BLOQUEO: ¿Este valor está en USD? %s está en COP con un valor menor a 1.000. Si es USD, cambia la moneda a USD; si de verdad es en pesos, corrige el valor.',
                         array_to_string(v_sospechoso, ', '));
    end if;
  end if;

  return NEW;
end;
$$;
revoke all on function public.trg_bloqueos_moneda_90() from public, anon, authenticated;
comment on function public.trg_bloqueos_moneda_90() is
  '231 (#90): constancia de la moneda del Bloqueo escrita por el servidor, moneda acreditada no reversible a NULL, interruptor estricto y regla "COP menor a 1.000 = ¿USD?". Migración 231.';

create trigger trg_bloqueos_moneda_90
  before insert or update of moneda, moneda_acreditada_en, moneda_acreditada_por, moneda_acreditada_ref, tarifa_neta, tarifa_para_empaquetar, fee_infante
  on public.bloqueos_vuelo
  for each row execute function public.trg_bloqueos_moneda_90();

-- ═══ 4. Invalidación del tarifario: la moneda de la fuente cambia lo publicado ═══
create or replace function public.tarifario_trg_bump_por_bloqueo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  -- 231: acreditar por primera vez NULL -> COP, sin tocar ningún otro dato que alimente el tarifario, no cambia ningún precio publicado
  -- (NULL siempre se leyó como COP): no se invalida. Cualquier otro cambio de moneda sí.
  if TG_OP = 'UPDATE'
     and OLD.moneda is null and NEW.moneda = 'COP'
     and NEW.tarifa_para_empaquetar is not distinct from OLD.tarifa_para_empaquetar
     and NEW.fee_infante is not distinct from OLD.fee_infante
     and NEW.fecha_ida is not distinct from OLD.fecha_ida
     and NEW.fecha_regreso is not distinct from OLD.fecha_regreso
     and NEW.ruta is not distinct from OLD.ruta then
    return NEW;
  end if;
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_vuelos
    where bloqueo_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_bloqueo() from public, anon, authenticated;
comment on function public.tarifario_trg_bump_por_bloqueo() is
  '181/226/231: invalida el tarifario de los paquetes que usan el Bloqueo cuando cambia tarifa, fee de infante, fechas, ruta o moneda (excepto acreditar NULL -> COP sin otro cambio).';

drop trigger if exists tarifario_trg_bloqueos_vuelo on public.bloqueos_vuelo;
create trigger tarifario_trg_bloqueos_vuelo
  after insert or delete or update of tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta, moneda
  on public.bloqueos_vuelo
  for each row execute function public.tarifario_trg_bump_por_bloqueo();

-- ═══ 5. crear_bloqueo (195/226): recibe la moneda ═════════════════════════
create or replace function public.crear_bloqueo(p_datos jsonb, p_cupos integer)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record;
  v_id bigint;
  v_record text;
  v_modalidad text;
  v_emision text;
  v_pago text;
  v_moneda text;
  v_creadas integer;
  t text;
  v_rangos bigint[];
begin
  select * into v_actor from public._vuelos_actor();   -- AUT-1: rol de vuelos + Mayorista o superadmin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos del bloqueo inválidos.';
  end if;
  if p_cupos is null or p_cupos < 0 or p_cupos > 1000 then
    raise exception using errcode = '22023', message = 'Los cupos deben estar entre 0 y 1000.';
  end if;
  v_record := upper(btrim(coalesce(p_datos ->> 'record', '')));
  if v_record = '' then
    raise exception using errcode = '22023', message = 'Falta el record (PNR).';
  end if;
  v_modalidad := lower(btrim(coalesce(p_datos ->> 'modalidad_emision', '')));
  if v_modalidad not in ('serie', 'grupo') then
    raise exception using errcode = '22023', message = 'Selecciona la modalidad de emisión (serie o grupo).';
  end if;
  v_emision := coalesce(nullif(lower(btrim(coalesce(p_datos ->> 'estado_emision', ''))), ''), 'pendiente');
  if v_emision not in ('pendiente', 'emitido') then
    raise exception using errcode = '22023', message = 'El estado de emisión debe ser pendiente o emitido.';
  end if;
  v_pago := coalesce(nullif(lower(btrim(coalesce(p_datos ->> 'estado_pago', ''))), ''), 'pendiente');
  if v_pago not in ('pendiente', 'pagado') then
    raise exception using errcode = '22023', message = 'El estado de pago debe ser pendiente o pagado.';
  end if;
  -- 231: la moneda se acredita al crear. Vacía = sin acreditar (NUNCA se supone COP); el interruptor estricto la vuelve obligatoria.
  v_moneda := nullif(upper(btrim(coalesce(p_datos ->> 'moneda', ''))), '');
  if v_moneda is not null and v_moneda not in ('COP', 'USD') then
    raise exception using errcode = '22023', message = 'MONEDA_BLOQUEO: la moneda de las tarifas debe ser COP o USD.';
  end if;
  if exists (select 1 from public.bloqueos_vuelo where record = v_record) then
    raise exception using errcode = '23505', message = format('Ya existe un bloqueo con el record %s.', v_record);
  end if;
  if jsonb_typeof(p_datos -> 'rangos_edad') = 'array' then
    select array_agg(x::bigint) into v_rangos from jsonb_array_elements_text(p_datos -> 'rangos_edad') x;
  end if;

  insert into public.bloqueos_vuelo (
    record, aerolinea, ruta, origen, proveedor_id, destino_id, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda,
    vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida,
    vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg,
    fecha_devolucion, fecha_emision, notas, rangos_edad,
    cupos_total, modalidad_emision, estado_emision, estado_pago)
  values (
    v_record,
    nullif(btrim(p_datos ->> 'aerolinea'), ''),
    nullif(btrim(p_datos ->> 'ruta'), ''),
    nullif(btrim(p_datos ->> 'origen'), ''),
    nullif(btrim(p_datos ->> 'proveedor_id'), '')::bigint,
    nullif(btrim(p_datos ->> 'destino_id'), '')::bigint,
    nullif(nullif(btrim(p_datos ->> 'tarifa_neta'), ''), '0')::numeric,
    coalesce(nullif(btrim(p_datos ->> 'tarifa_para_empaquetar'), '')::numeric, 0),
    coalesce(nullif(btrim(p_datos ->> 'fee_infante'), '')::numeric, 0),   -- migración 226
    v_moneda,                                                              -- migración 231
    nullif(btrim(p_datos ->> 'vuelo_ida'), ''),
    nullif(btrim(p_datos ->> 'fecha_ida'), '')::date,
    nullif(btrim(p_datos ->> 'hora_salida_ida'), '')::time,
    nullif(btrim(p_datos ->> 'hora_llegada_ida'), '')::time,
    nullif(btrim(p_datos ->> 'vuelo_regreso'), ''),
    nullif(btrim(p_datos ->> 'fecha_regreso'), '')::date,
    nullif(btrim(p_datos ->> 'hora_salida_reg'), '')::time,
    nullif(btrim(p_datos ->> 'hora_llegada_reg'), '')::time,
    nullif(btrim(p_datos ->> 'fecha_devolucion'), '')::date,
    nullif(btrim(p_datos ->> 'fecha_emision'), '')::date,
    nullif(btrim(p_datos ->> 'notas'), ''),
    v_rangos,
    p_cupos, v_modalidad, v_emision, v_pago)
  returning id into v_id;

  insert into public.sillas (bloqueo_id, numero_silla, estado)
  select v_id, g, 'disponible' from generate_series(1, p_cupos) g;
  get diagnostics v_creadas = row_count;
  if v_creadas <> p_cupos or public._sillas_activas(v_id) <> p_cupos then
    raise exception using errcode = 'P0001', message = 'No se crearon todas las sillas del bloqueo; no se guardó nada.';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'record', v_record, 'cupos', p_cupos);
exception
  -- Mensajes legibles para los errores de forma más comunes (la transacción
  -- se revierte igual: re-lanzar dentro del handler aborta toda la función).
  when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22007', message = 'Hay una fecha u hora inválida en el bloqueo.';
  when invalid_text_representation then
    raise exception using errcode = '22P02', message = 'Hay un número inválido en el bloqueo (tarifa, proveedor, destino o rangos de edad).';
  when unique_violation then
    raise exception using errcode = '23505', message = format('Ya existe un bloqueo con el record %s.', v_record);
end $$;
comment on function public.crear_bloqueo(jsonb, integer) is
  '195/226/231: crea un record y sus sillas en UNA transacción. Desde la 231 acepta p_datos.moneda (COP/USD; vacía = sin acreditar, salvo interruptor estricto).';

revoke all on function public.crear_bloqueo(jsonb, integer) from public, anon;
grant execute on function public.crear_bloqueo(jsonb, integer) to authenticated;

commit;
