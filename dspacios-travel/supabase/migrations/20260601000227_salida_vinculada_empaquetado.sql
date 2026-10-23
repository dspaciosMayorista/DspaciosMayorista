-- ───────────────────────────────────────────────────────────────────────────
-- 227 · SALIDA DE DINÁMICO VINCULADA A UN VUELO DE EMPAQUETADOS SIN RECORD (#63)
--       + MODO DE OFERTA `cop_trm_63` (tarifario en COP con la TRM del paquete)
--
-- REGLAS DEL DUEÑO (contrato #63, re-base 2 sobre 3cfe731c)
--   · Una "salida vinculada" es una fila de `salidas_dinamicas` con `empaquetado_id`: toma de un vuelo de Empaquetados SIN
--     record (PNR ausente) sus fechas, ruta y tarifas. El origen de la reserva sigue siendo `salidaId`. Una vinculada se
--     cotiza y se reserva SIN consultar cupos de Bloqueo (un Empaquetado no tiene sillas).
--   · R = `empaquetados.tarifa_para_empaquetar` es el PRECIO FINAL del aéreo por pasajero con silla (sin markup ni TA: una
--     vinculada no admite ninguno de los dos). N = `tarifa_proveedor` es solo COSTO (CxP). F = `fee_infante`, precio = costo.
--   · Modo `cop_trm_63` (solo Dinámico): el tarifario se publica en COP; todo neto en USD de hotel y servicios se convierte
--     × la TRM positiva del paquete ANTES del markup. Las CxP conservan su moneda de origen y llevan su equivalente en COP
--     congelado a esa TRM.
--   · Las guardas de destinos aéreos de la 220 (#67) se extienden a las salidas vinculadas, sin tocar el archivo de la 220.
--
-- QUÉ HACE (ADITIVA — no quita acceso a nadie ni toca datos existentes)
--   1. armado_paquetes.modo_oferta ('legacy' | 'cop_trm_63', default 'legacy') y trm_oferta, con sus CHECK; un cambio de
--      modo/TRM INVALIDA el tarifario (bloqueante) y no se puede cambiar el modo/tipo con salidas vinculadas.
--   2. salidas_dinamicas.empaquetado_id (FK RESTRICT, único por paquete), .moneda (moneda acreditada de una salida MANUAL
--      en modo 63) y el CHECK de vinculada (sin markup, sin TA, COP). Guardas: paquete Dinámico en modo 63, fuente sin
--      record, y destino aéreo permitido (reutiliza validar_vinculo_aereo_67 de la 220, diferida).
--   3. empaquetados.moneda (solo COP por ahora; el CHECK se amplía el día que se active USD).
--   4. cuentas_por_pagar.valor_cop_63 / trm_63: equivalente en COP congelado de una obligación del modo 63.
--   5. tarifario_oferta_63 (PRIVADA): TRM, modo, generación, revisión y fuentes de la publicación vigente.
--   6. publicar_tarifario_resultado_63: ENVUELVE al publicador vigente (el de la 226, sin copiar su cuerpo) y guarda la
--      TRM/fuentes de esa publicación en la misma transacción.
--   7. Trigger PROPIO (no reemplaza el de la 226) que invalida el tarifario de los paquetes con salidas vinculadas cuando
--      cambia la fuente (incluido el record: un PNR agregado después invalida y exige revisar; no borra el vínculo).
--   8. validar_config_destinos_aereos_67 (220) se reemplaza (mismo cuerpo + las salidas vinculadas); y
--      registrar_financiero_contrato (210) se reemplaza (mismo cuerpo + valor_cop_63/trm_63 en la misma transacción).
--
-- QUÉ NO HACE
--   No regenera tarifarios, no toca contratos, pagos ni cotizaciones existentes, no cambia policies de tablas existentes,
--   no toca el publicador de la 226, ni `bloqueos_vuelo`, ni `trasladar_cupos`.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código nuevo (el código lee columnas y una RPC nuevas); el código
--   anterior sigue funcionando con ella aplicada. Rollback (solo ANTES de usarla): supabase/scripts/rollback_227_*.sql.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═══ 0. Prerrequisitos (fallan cerrado con un mensaje claro) ═══════════════
do $$
begin
  if to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is null then
    raise exception '227 ABORTADA: falta public.publicar_tarifario_resultado (181/226).';
  end if;
  if to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is null then
    raise exception '227 ABORTADA: falta public.registrar_financiero_contrato (171/210).';
  end if;
  if to_regprocedure('public.validar_vinculo_aereo_67(bigint, text, bigint)') is null
     or to_regprocedure('public.validar_config_destinos_aereos_67(bigint)') is null
     or to_regprocedure('public.destinos_aereos_efectivos_67(bigint, boolean, bigint[])') is null then
    raise exception '227 ABORTADA: faltan las guardas de destinos aéreos de la 220 (#67).';
  end if;
  if to_regprocedure('public.tarifario_invalidar(bigint[], boolean)') is null then
    raise exception '227 ABORTADA: falta public.tarifario_invalidar (181).';
  end if;
  if to_regclass('public.empaquetados') is null or to_regclass('public.salidas_dinamicas') is null
     or to_regclass('public.cuentas_por_pagar') is null or to_regclass('public.armado_paquetes') is null then
    raise exception '227 ABORTADA: faltan tablas base (empaquetados, salidas_dinamicas, cuentas_por_pagar o armado_paquetes).';
  end if;
  -- La 226 (publicador con precio_pvp_menor2) debe estar aplicada: solo tablas BASE (las vistas también salen en information_schema.columns).
  if not exists (
    select 1
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.table_name = 'tarifario_resultado' and c.column_name = 'precio_pvp_menor2'
  ) then
    raise exception '227 ABORTADA: falta la migración 226 (tarifario_resultado.precio_pvp_menor2).';
  end if;
  if exists (
    select 1
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.table_name = 'salidas_dinamicas' and c.column_name = 'empaquetado_id'
  ) then
    raise exception '227 ya aplicada (existe salidas_dinamicas.empaquetado_id). No se re-aplica.';
  end if;
end $$;

-- ═══ 1. armado_paquetes: modo de oferta y TRM ═════════════════════════════
alter table public.armado_paquetes
  add column modo_oferta text not null default 'legacy',
  add column trm_oferta  numeric(15,4);

alter table public.armado_paquetes
  add constraint armado_paquetes_modo_oferta_chk check (modo_oferta in ('legacy', 'cop_trm_63')),
  add constraint armado_paquetes_trm_oferta_chk  check (trm_oferta is null or trm_oferta > 0),
  add constraint armado_paquetes_modo63_chk      check (modo_oferta = 'legacy' or (tipo::text = 'dinamico' and trm_oferta is not null));

comment on column public.armado_paquetes.modo_oferta is
  'Modo de oferta del paquete. legacy = el de siempre; cop_trm_63 = tarifario en COP con la TRM del paquete (solo Dinámico). Migración 227.';
comment on column public.armado_paquetes.trm_oferta is
  'TRM (COP por USD) del paquete en modo cop_trm_63. Obligatoria y > 0 en ese modo; sin valor por defecto (nunca 1). Migración 227.';

-- No se puede dejar el modo 63 (ni cambiar el tipo) con salidas vinculadas: hay que desvincularlas antes, a propósito.
create or replace function public.trg_modo_oferta_vinculadas_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.modo_oferta = 'cop_trm_63'
     and (NEW.modo_oferta is distinct from OLD.modo_oferta or NEW.tipo is distinct from OLD.tipo)
     and exists (select 1 from public.salidas_dinamicas s where s.paquete_id = NEW.id and s.empaquetado_id is not null) then
    raise exception 'modo_oferta_vinculadas: el paquete % tiene salidas vinculadas a Empaquetados; desvincúlalas antes de cambiar el modo de oferta o el tipo', NEW.id;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_modo_oferta_vinculadas_63() from public, anon, authenticated;

drop trigger if exists tr_modo_oferta_vinculadas_63 on public.armado_paquetes;
create trigger tr_modo_oferta_vinculadas_63
  before update of tipo, modo_oferta on public.armado_paquetes
  for each row execute function public.trg_modo_oferta_vinculadas_63();

-- Cambiar el modo o la TRM invalida el tarifario publicado (BLOQUEANTE: los precios viejos dejan de ser publicables).
create or replace function public.trg_invalidar_modo_oferta_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.tarifario_invalidar(array[NEW.id], true);
  return null;
end;
$$;
revoke all on function public.trg_invalidar_modo_oferta_63() from public, anon, authenticated;

drop trigger if exists tr_inv_modo_oferta_63 on public.armado_paquetes;
create trigger tr_inv_modo_oferta_63
  after update of modo_oferta, trm_oferta on public.armado_paquetes
  for each row
  when (OLD.modo_oferta is distinct from NEW.modo_oferta or OLD.trm_oferta is distinct from NEW.trm_oferta)
  execute function public.trg_invalidar_modo_oferta_63();

-- ═══ 2. empaquetados.moneda (solo COP por ahora) ══════════════════════════
alter table public.empaquetados
  add column moneda text not null default 'COP';
alter table public.empaquetados
  add constraint empaquetados_moneda_cop_chk check (moneda = 'COP');
comment on column public.empaquetados.moneda is
  'Moneda de tarifa_proveedor / tarifa_para_empaquetar / fee_infante. Hoy solo COP; ampliar el CHECK el día que se active USD. Migración 227.';

-- ═══ 3. salidas_dinamicas: vínculo a Empaquetados y moneda de la salida manual ═
alter table public.salidas_dinamicas
  add column empaquetado_id bigint references public.empaquetados(id) on delete restrict,
  add column moneda text not null default 'COP';

alter table public.salidas_dinamicas
  add constraint salidas_dinamicas_moneda_chk check (moneda in ('COP', 'USD')),
  -- Una vinculada: precio final R sin markup ni TA (doble margen) y siempre COP.
  add constraint salidas_dinamicas_vinculada_chk check (empaquetado_id is null or (aplica_mk = false and ta = 0 and moneda = 'COP'));

create unique index salidas_dinamicas_paquete_empaquetado_uk
  on public.salidas_dinamicas (paquete_id, empaquetado_id) where empaquetado_id is not null;
create index idx_salidas_dinamicas_empaquetado
  on public.salidas_dinamicas (empaquetado_id) where empaquetado_id is not null;

comment on column public.salidas_dinamicas.empaquetado_id is
  'Vuelo de Empaquetados SIN record del que esta salida copia fechas, ruta y tarifas (R = valor_tiquete, F = fee_infante). NULL = salida manual. FK RESTRICT. Migración 227.';
comment on column public.salidas_dinamicas.moneda is
  'Moneda acreditada de valor_tiquete/ta/fee_infante de una salida MANUAL en modo cop_trm_63 (se convierte × la TRM del paquete). Una vinculada es siempre COP. Migración 227.';

-- Guarda inmediata de una vinculada: paquete Dinámico en modo 63 y fuente SIN record.
create or replace function public.trg_salida_vinculada_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo   text;
  v_modo   text;
  v_existe boolean;
  v_record text;
begin
  if NEW.empaquetado_id is null then
    return NEW;
  end if;
  select p.tipo::text, p.modo_oferta into v_tipo, v_modo from public.armado_paquetes p where p.id = NEW.paquete_id;
  if v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'salida_vinculada_modo: una salida vinculada a Empaquetados solo existe en un paquete Dinámico en modo cop_trm_63 (paquete %)', NEW.paquete_id;
  end if;
  select true, e.record into v_existe, v_record from public.empaquetados e where e.id = NEW.empaquetado_id;
  if not coalesce(v_existe, false) then
    raise exception 'salida_vinculada_fuente: el vuelo de Empaquetados % no existe', NEW.empaquetado_id;
  end if;
  if nullif(btrim(coalesce(v_record, '')), '') is not null then
    raise exception 'salida_vinculada_record: el vuelo de Empaquetados % ya tiene record (PNR); solo se vinculan vuelos de sistema sin record', NEW.empaquetado_id;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_salida_vinculada_63() from public, anon, authenticated;

drop trigger if exists tr_salida_vinculada_63 on public.salidas_dinamicas;
create trigger tr_salida_vinculada_63
  before insert or update of empaquetado_id, paquete_id on public.salidas_dinamicas
  for each row execute function public.trg_salida_vinculada_63();

-- Destino aéreo permitido (220): mismo vínculo que un vuelo de Sistema, DIFERIDO al commit (igual que la 220) para que
-- cambiar la configuración y vincular en una misma transacción sea coherente.
create or replace function public.trg_vinculo_aereo_67_salida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Si la salida ya no existe o ya no está vinculada al confirmar, no hay nada que validar.
  if exists (select 1 from public.salidas_dinamicas s where s.id = NEW.id and s.empaquetado_id is not null) then
    perform public.validar_vinculo_aereo_67(NEW.paquete_id, 'empaquetado', NEW.empaquetado_id);
  end if;
  return null;
end;
$$;
revoke all on function public.trg_vinculo_aereo_67_salida() from public, anon, authenticated;

drop trigger if exists tr_vinculo_aereo_67_salida on public.salidas_dinamicas;
create constraint trigger tr_vinculo_aereo_67_salida
  after insert or update of paquete_id, empaquetado_id on public.salidas_dinamicas
  deferrable initially deferred
  for each row when (NEW.empaquetado_id is not null)
  execute function public.trg_vinculo_aereo_67_salida();

-- ═══ 4. Invalidación PROPIA por cambio de la fuente (no reemplaza el trigger de la 226) ═
create or replace function public.tarifario_trg_empaquetado_vinculadas_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct s.paquete_id) into v_ids from public.salidas_dinamicas s where s.empaquetado_id = NEW.id;
  perform public.tarifario_invalidar(v_ids, true);
  return null;
end;
$$;
revoke all on function public.tarifario_trg_empaquetado_vinculadas_63() from public, anon, authenticated;

drop trigger if exists tarifario_trg_empaquetado_vinculadas_63 on public.empaquetados;
create trigger tarifario_trg_empaquetado_vinculadas_63
  after update on public.empaquetados
  for each row
  when (
    OLD.activo is distinct from NEW.activo
    or OLD.record is distinct from NEW.record
    or OLD.compra_inicio is distinct from NEW.compra_inicio
    or OLD.compra_fin is distinct from NEW.compra_fin
    or OLD.fecha_ida is distinct from NEW.fecha_ida
    or OLD.fecha_regreso is distinct from NEW.fecha_regreso
    or OLD.ruta is distinct from NEW.ruta
    or OLD.aerolinea is distinct from NEW.aerolinea
    or OLD.vuelo_ida is distinct from NEW.vuelo_ida
    or OLD.vuelo_regreso is distinct from NEW.vuelo_regreso
    or OLD.hora_salida_ida is distinct from NEW.hora_salida_ida
    or OLD.hora_llegada_ida is distinct from NEW.hora_llegada_ida
    or OLD.hora_salida_reg is distinct from NEW.hora_salida_reg
    or OLD.hora_llegada_reg is distinct from NEW.hora_llegada_reg
    or OLD.destino_id is distinct from NEW.destino_id
    or OLD.proveedor_id is distinct from NEW.proveedor_id
    or OLD.moneda is distinct from NEW.moneda
    or OLD.tarifa_proveedor is distinct from NEW.tarifa_proveedor
    or OLD.tarifa_para_empaquetar is distinct from NEW.tarifa_para_empaquetar
    or OLD.fee_infante is distinct from NEW.fee_infante
  )
  execute function public.tarifario_trg_empaquetado_vinculadas_63();

-- ═══ 5. cuentas_por_pagar: equivalente en COP congelado (modo 63) ═════════
alter table public.cuentas_por_pagar
  add column valor_cop_63 numeric(15,2),
  add column trm_63       numeric(15,4);
alter table public.cuentas_por_pagar
  add constraint cuentas_por_pagar_cop63_chk check (
    (valor_cop_63 is null) = (trm_63 is null)
    and (valor_cop_63 is null or valor_cop_63 >= 0)
    and (trm_63 is null or trm_63 > 0)
  );
comment on column public.cuentas_por_pagar.valor_cop_63 is
  'Equivalente en COP de la obligación, congelado a trm_63. Solo en el modo cop_trm_63 (la CxP conserva su moneda de origen y su valor_total). NULL en toda obligación de siempre. El asiento contable se devenga por este importe. Migración 227.';
comment on column public.cuentas_por_pagar.trm_63 is
  'TRM (COP por USD) con la que se congeló valor_cop_63. Migración 227.';

-- ═══ 6. Publicación 63: metadata PRIVADA + envoltorio del publicador vigente ═
create table public.tarifario_oferta_63 (
  paquete_id      bigint primary key references public.armado_paquetes(id) on delete cascade,
  modo            text not null check (modo = 'cop_trm_63'),
  trm             numeric(15,4) not null check (trm > 0),
  generacion      bigint not null,
  revision_fuente bigint,
  fuentes         jsonb not null default '[]'::jsonb,
  publicado_en    timestamptz not null default now()
);
comment on table public.tarifario_oferta_63 is
  'PRIVADA. TRM, modo, generación, revisión y fuentes (salidas vinculadas con su R y F) de la publicación vigente de un paquete en modo cop_trm_63. La escribe publicar_tarifario_resultado_63 en la misma transacción que el snapshot. Sin policies: solo definer/service_role. Migración 227.';
alter table public.tarifario_oferta_63 enable row level security;
revoke all on table public.tarifario_oferta_63 from public, anon, authenticated;

create or replace function public.publicar_tarifario_resultado_63(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb,
  p_modo text,
  p_trm numeric
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modo      text;
  v_trm       numeric;
  v_publicado boolean;
  v_revision  bigint;
  v_fuentes   jsonb;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado_63: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado_63: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  if p_modo is distinct from 'cop_trm_63' then
    raise exception 'publicar_tarifario_resultado_63: p_modo debe ser cop_trm_63, recibido: %', p_modo;
  end if;
  if p_moneda is distinct from 'COP' then
    raise exception 'publicar_tarifario_resultado_63: el modo cop_trm_63 publica en COP, recibido: %', p_moneda;
  end if;
  if p_trm is null or p_trm <= 0 then
    raise exception 'publicar_tarifario_resultado_63: la TRM debe ser positiva, recibida: %', p_trm;
  end if;

  -- Candado del paquete (el mismo que toma el publicador vigente) y coherencia con lo que se calculó: si el modo o la TRM
  -- cambiaron mientras se generaba, esta publicación se descarta (igual que una revisión de fuente superada).
  select p.modo_oferta, p.trm_oferta into v_modo, v_trm from public.armado_paquetes p where p.id = p_paquete_id for update;
  if not found then
    raise exception 'publicar_tarifario_resultado_63: el paquete % no existe', p_paquete_id;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_trm is distinct from p_trm then
    return false;
  end if;

  -- El publicador VIGENTE (226) hace todo lo demás: token de generación, revisión, snapshot y moneda. No se copia su cuerpo.
  v_publicado := public.publicar_tarifario_resultado(p_paquete_id, p_generacion, p_revision_capturada, p_moneda, p_filas);

  if v_publicado then
    select p.tarifario_revision_publicada into v_revision from public.armado_paquetes p where p.id = p_paquete_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'salida_id', s.id, 'empaquetado_id', s.empaquetado_id, 'valor_tiquete', s.valor_tiquete, 'fee_infante', s.fee_infante
           ) order by s.id), '[]'::jsonb)
      into v_fuentes
      from public.salidas_dinamicas s
     where s.paquete_id = p_paquete_id and s.empaquetado_id is not null;
    insert into public.tarifario_oferta_63 as o (paquete_id, modo, trm, generacion, revision_fuente, fuentes, publicado_en)
    values (p_paquete_id, p_modo, p_trm, p_generacion, v_revision, v_fuentes, now())
    on conflict (paquete_id) do update
      set modo = excluded.modo, trm = excluded.trm, generacion = excluded.generacion,
          revision_fuente = excluded.revision_fuente, fuentes = excluded.fuentes, publicado_en = excluded.publicado_en;
  end if;
  return v_publicado;
end;
$$;

comment on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) is
  '227 (#63): envuelve a publicar_tarifario_resultado (el vigente) para un paquete en modo cop_trm_63: valida modo/TRM contra el paquete bajo candado, publica por el publicador vigente y guarda la TRM/fuentes de esa publicación en la misma transacción.';
revoke all on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) from public, anon;
grant execute on function public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric) to authenticated;

-- ═══ 7. Guarda de configuración de la 220: ahora cuenta también las salidas vinculadas ═
create or replace function public.validar_config_destinos_aereos_67(p_paquete_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destino  bigint;
  v_check    boolean;
  v_alts     bigint[];
  v_pais     text;
  v_malas    text;
  v_ef       bigint[];
  v_lista    text;
  v_n        int;
begin
  select p.destino_id, p.destinos_aereos_alternativos into v_destino, v_check
    from public.armado_paquetes p where p.id = p_paquete_id for no key update;
  if not found then
    return;                                   -- el paquete se eliminó en esta transacción
  end if;
  select array_agg(a.destino_id order by a.destino_id) into v_alts
    from public.armado_paquete_destinos_aereos a where a.paquete_id = p_paquete_id;

  -- 1. Las alternativas guardadas deben ser válidas (estricto, aunque el check esté apagado).
  if v_alts is not null then
    if v_destino is null then
      raise exception 'destino_aereo_config: hay destinos alternativos pero el paquete no tiene destino comercial';
    end if;
    select public.pais_comparable_67(d.pais) into v_pais from public.destinos d where d.id = v_destino;
    if v_pais is null then
      raise exception 'destino_aereo_config: el destino comercial no tiene país registrado; sin país comparable no se admiten destinos alternativos';
    end if;
    select string_agg(coalesce(d.nombre, 'destino #' || a.id::text), ', ' order by a.id) into v_malas
      from unnest(v_alts) as a(id)
      left join public.destinos d on d.id = a.id
     where d.id is null
        or a.id = v_destino
        or not coalesce(d.activo, false)
        or public.pais_comparable_67(d.pais) is distinct from v_pais;
    if v_malas is not null then
      raise exception 'destino_aereo_config: alternativas no válidas (deben ser destinos activos del mismo país que el comercial): %', v_malas;
    end if;
  end if;

  -- 2. Encendido exige destino comercial y al menos una alternativa.
  if v_check then
    if v_destino is null then
      raise exception 'destino_aereo_config: no se puede activar destinos alternativos sin destino comercial';
    end if;
    if coalesce(cardinality(v_alts), 0) = 0 then
      raise exception 'destino_aereo_config: para activar los destinos alternativos elige al menos uno distinto del comercial';
    end if;
  end if;

  -- 3. Ningún vuelo YA vinculado puede quedar fuera de los destinos efectivos.
  v_ef := public.destinos_aereos_efectivos_67(v_destino, v_check, coalesce(v_alts, '{}'::bigint[]));
  with incompatibles as (
    select 'vuelo ' || coalesce(b.record, 'sin record') || coalesce(' ' || b.ruta, '') || ' (#' || b.id || ')' as d
      from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id
     where av.paquete_id = p_paquete_id and (b.destino_id is null or not (b.destino_id = any (v_ef)))
    union all
    select 'vuelo Sistema ' || coalesce(e.record, 'sin record') || coalesce(' ' || e.ruta, '') || ' (#' || e.id || ')'
      from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id
     where ae.paquete_id = p_paquete_id and (e.destino_id is null or not (e.destino_id = any (v_ef)))
    union all
    -- 227 (#63): las salidas de Dinámico vinculadas a un vuelo de Empaquetados cuentan igual que un vínculo de Sistema.
    select 'salida vinculada ' || coalesce(e.record, 'sin record') || coalesce(' ' || e.ruta, '') || ' (#' || e.id || ')'
      from public.salidas_dinamicas sd join public.empaquetados e on e.id = sd.empaquetado_id
     where sd.paquete_id = p_paquete_id and (e.destino_id is null or not (e.destino_id = any (v_ef)))
  )
  select count(*), string_agg(d, '; ') into v_n, v_lista from (select d from incompatibles limit 8) x;
  if coalesce(v_n, 0) > 0 then
    raise exception 'destino_aereo_vinculos: hay vuelos vinculados que dejarían de cumplir los destinos aéreos del paquete (desvincúlalos explícitamente): %', v_lista;
  end if;
end;
$$;

-- ═══ 8. E/F/G — MARCADORES, CONTADOR DE COSTOS Y TABLAS PRIVADAS ═══════════
--
-- Contrato (chat-4-hotfixes.md, H/T/R/F): la oferta en COP con TRM se ACEPTA de forma atómica contra un snapshot PRIVADO
-- completo (precio, BNC, netos y monedas, TRM, acreedores y retenciones, tramos, ítems, costos y obligaciones de origen).
-- Lo aceptado es inmutable y es lo ÚNICO que alimenta la cabecera, los hijos y la escritura financiera: ninguna lectura viva
-- posterior de costos/proveedores cambia ni el precio ni la deuda acordados. Las tablas son PRIVADAS (RLS sin policies,
-- sin grants a anon/authenticated): solo las funciones SECURITY DEFINER de esta migración y service_role las tocan.

-- 8.1 Contador de cambios de costo/proveedor/retención: se incrementa en la MISMA transacción del cambio (triggers de 8.4).
alter table public.armado_paquetes
  add column p63_rev_costos bigint not null default 0;
comment on column public.armado_paquetes.p63_rev_costos is
  'Contador monotónico de cambios de proveedor/retención/reglas de hotel que NO mueven el PVP pero sí el costo o la deuda de una oferta en modo cop_trm_63. Lo compara aceptar_oferta_63 contra el de la cotización. Migración 227.';

-- 8.2 Marcadores de aceptación en la venta y en la obligación.
alter table public.ventas
  add column aceptacion_63_id bigint;
alter table public.cuentas_por_pagar
  add column aceptacion_63_id bigint,
  add column obligacion_63    text;
alter table public.cuentas_por_pagar
  add constraint cuentas_por_pagar_marca63_chk check (
    (aceptacion_63_id is null) = (obligacion_63 is null)
    and (aceptacion_63_id is null or valor_cop_63 is not null)
  );

-- 8.3 Tablas privadas: la oferta cotizada y la aceptación (intento + snapshot inmutable).
create table public.p63_oferta (
  id              bigint generated always as identity primary key,
  cotizacion_id   bigint not null unique references public.cotizaciones(id) on delete restrict,
  tenant          text   not null,
  paquete_id      bigint not null,
  salida_id       bigint,
  trm             numeric(15,4) not null check (trm > 0),
  rev_fuente      bigint not null,
  rev_publicada   bigint,
  gen_publicada   bigint,
  rev_costos      bigint not null,
  huella          text   not null,
  huella_financiera text not null,
  snapshot        jsonb  not null,
  estado          text   not null default 'abierta' check (estado in ('abierta', 'aceptada')),
  creada_en       timestamptz not null default now(),
  actualizada_en  timestamptz not null default now()
);
create table public.p63_aceptacion (
  id              bigint generated always as identity primary key,
  oferta_id       bigint not null references public.p63_oferta(id) on delete restrict,
  cotizacion_id   bigint not null,
  tenant          text   not null,
  numero_contrato text   not null unique,
  usuario_id      uuid,
  fecha_negocio   date   not null,
  snapshot        jsonb  not null,
  estado          text   not null default 'preparada' check (estado in ('preparada', 'materializando', 'completa', 'descartada')),
  error           text,
  creada_en       timestamptz not null default now(),
  actualizada_en  timestamptz not null default now()
);
-- Un solo intento VIGENTE por oferta (los descartados quedan como historia: el número descartado no se reutiliza).
create unique index p63_aceptacion_vigente_uk on public.p63_aceptacion (oferta_id) where estado <> 'descartada';

alter table public.ventas
  add constraint ventas_aceptacion_63_fk foreign key (aceptacion_63_id) references public.p63_aceptacion(id) on delete restrict;
alter table public.cuentas_por_pagar
  add constraint cuentas_por_pagar_aceptacion_63_fk foreign key (aceptacion_63_id) references public.p63_aceptacion(id) on delete restrict;
create unique index ventas_aceptacion_63_uk on public.ventas (aceptacion_63_id) where aceptacion_63_id is not null;
create unique index cuentas_por_pagar_obligacion_63_uk on public.cuentas_por_pagar (aceptacion_63_id, obligacion_63) where aceptacion_63_id is not null;

comment on table public.p63_oferta is
  'PRIVADA. Oferta cotizada en modo cop_trm_63: snapshot completo (con costos y proveedores), revisiones de T0 y huellas. La crea crear_cotizacion_oferta_63 en la MISMA transacción que la cotización. Sin policies. Migración 227.';
comment on table public.p63_aceptacion is
  'PRIVADA. Aceptación de una oferta: número de contrato reservado, snapshot inmutable y estado del intento (preparada → materializando → completa | descartada). La crea aceptar_oferta_63. Sin policies. Migración 227.';
alter table public.p63_oferta     enable row level security;
alter table public.p63_aceptacion enable row level security;
revoke all on table public.p63_oferta     from public, anon, authenticated;
revoke all on table public.p63_aceptacion from public, anon, authenticated;

-- Inmutabilidad: el snapshot, la identidad y las huellas no cambian nunca; los estados solo avanzan por las rutas permitidas.
create or replace function public.trg_p63_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'p63_historico: % es historia de lo aceptado y no se borra', tg_table_name;
  end if;
  if tg_table_name = 'p63_oferta' then
    if new.cotizacion_id is distinct from old.cotizacion_id or new.tenant is distinct from old.tenant
       or new.paquete_id is distinct from old.paquete_id or new.salida_id is distinct from old.salida_id
       or new.trm is distinct from old.trm or new.rev_fuente is distinct from old.rev_fuente
       or new.rev_publicada is distinct from old.rev_publicada or new.gen_publicada is distinct from old.gen_publicada
       or new.rev_costos is distinct from old.rev_costos or new.huella is distinct from old.huella
       or new.huella_financiera is distinct from old.huella_financiera or new.snapshot is distinct from old.snapshot
       or new.creada_en is distinct from old.creada_en then
      raise exception 'p63_inmutable: el snapshot y la identidad de una oferta cotizada no se modifican';
    end if;
  else
    if new.oferta_id is distinct from old.oferta_id or new.cotizacion_id is distinct from old.cotizacion_id
       or new.tenant is distinct from old.tenant or new.numero_contrato is distinct from old.numero_contrato
       or new.usuario_id is distinct from old.usuario_id or new.fecha_negocio is distinct from old.fecha_negocio
       or new.snapshot is distinct from old.snapshot or new.creada_en is distinct from old.creada_en then
      raise exception 'p63_inmutable: el snapshot y la identidad de una aceptación no se modifican';
    end if;
    if (old.estado = 'completa' and new.estado <> 'completa') or (old.estado = 'descartada' and new.estado <> 'descartada') then
      raise exception 'p63_inmutable: una aceptación % no vuelve a otro estado', old.estado;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.trg_p63_inmutable() from public, anon, authenticated;
create trigger trg_p63_oferta_inmutable
  before update or delete on public.p63_oferta
  for each row execute function public.trg_p63_inmutable();
create trigger trg_p63_aceptacion_inmutable
  before update or delete on public.p63_aceptacion
  for each row execute function public.trg_p63_inmutable();

-- Auditoría (087): mismo trigger genérico que el resto de tablas base. La tabla `auditoria` solo la leen superadmin/gerencia.
create trigger trg_auditoria after insert or delete or update on public.p63_oferta
  for each row execute function public.fn_auditoria();
create trigger trg_auditoria after insert or delete or update on public.p63_aceptacion
  for each row execute function public.fn_auditoria();

-- 8.4 Cobertura de revisión: cambios de proveedor/retención/reglas de hotel que NO mueven el PVP (los de precio ya suben
-- `tarifario_revision_fuente` por los triggers de la 181/226). Cada uno incrementa el contador en la MISMA transacción.
create or replace function public.p63_bump_costos(p_ids bigint[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.armado_paquetes
     set p63_rev_costos = p63_rev_costos + 1
   where id = any (coalesce(p_ids, '{}'::bigint[])) and modo_oferta = 'cop_trm_63';
$$;
revoke all on function public.p63_bump_costos(bigint[]) from public, anon, authenticated;

create or replace function public.trg_p63_costos_hoteles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.p63_bump_costos(array(select ah.paquete_id from public.armado_hoteles ah where ah.hotel_id = new.id));
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_hoteles() from public, anon, authenticated;
create trigger trg_p63_costos_hoteles
  after update of proveedor_id, activo, adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, edad_infante_min, edad_infante_max,
                  edad_nino_min, edad_nino_max, rangos_edad, pax_min, pax_max, infante_cargo_neto
  on public.hoteles
  for each row execute function public.trg_p63_costos_hoteles();

create or replace function public.trg_p63_costos_acomodaciones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old bigint := case when tg_op = 'INSERT' then null else old.hotel_id end;
  v_new bigint := case when tg_op = 'DELETE' then null else new.hotel_id end;
begin
  perform public.p63_bump_costos(array(
    select ah.paquete_id from public.armado_hoteles ah where ah.hotel_id = v_old or ah.hotel_id = v_new));
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_acomodaciones() from public, anon, authenticated;
create trigger trg_p63_costos_acomodaciones
  after insert or update or delete on public.hotel_acomodaciones
  for each row execute function public.trg_p63_costos_acomodaciones();

create or replace function public.trg_p63_costos_servicios()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.p63_bump_costos(array(select asv.paquete_id from public.armado_servicios asv where asv.servicio_id = new.id));
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_servicios() from public, anon, authenticated;
create trigger trg_p63_costos_servicios
  after update of proveedor_id, categoria, nombre, activo on public.servicios_adicionales
  for each row execute function public.trg_p63_costos_servicios();

create or replace function public.trg_p63_costos_proveedores()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.p63_bump_costos(array(
    select ah.paquete_id from public.armado_hoteles ah join public.hoteles h on h.id = ah.hotel_id where h.proveedor_id = new.id
    union
    select asv.paquete_id from public.armado_servicios asv join public.servicios_adicionales s on s.id = asv.servicio_id where s.proveedor_id = new.id
    union
    select sd.paquete_id from public.salidas_dinamicas sd join public.empaquetados e on e.id = sd.empaquetado_id where e.proveedor_id = new.id));
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_proveedores() from public, anon, authenticated;
create trigger trg_p63_costos_proveedores
  after update of nombre, aplica_retencion, pct_retencion on public.proveedores
  for each row execute function public.trg_p63_costos_proveedores();

-- Plan B2B (comisión y precio NETO): el porcentaje sale del aliado (pct_comision) o, si no lo tiene, del parámetro general de su tipo
-- (COMISION_AGENCIA / COMISION_FREELANCE). Un cambio de cualquiera de los dos cambia la comisión y el precio neto sin mover el PVP, así que
-- sube el contador de TODOS los paquetes en modo 63 (el aliado no pertenece a un paquete) y las ofertas abiertas se recotizan.
create or replace function public.p63_bump_costos_todos()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.armado_paquetes set p63_rev_costos = p63_rev_costos + 1 where modo_oferta = 'cop_trm_63';
$$;
revoke all on function public.p63_bump_costos_todos() from public, anon, authenticated;

create or replace function public.trg_p63_costos_b2b()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.p63_bump_costos_todos();
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_b2b() from public, anon, authenticated;
create trigger trg_p63_costos_aliados
  after update of pct_comision, tipo on public.aliados
  for each row
  when (old.pct_comision is distinct from new.pct_comision or old.tipo is distinct from new.tipo)
  execute function public.trg_p63_costos_b2b();
create trigger trg_p63_costos_parametros_upd
  after update of valor on public.parametros_tributarios
  for each row
  when (new.parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE') and old.valor is distinct from new.valor)
  execute function public.trg_p63_costos_b2b();
create trigger trg_p63_costos_parametros_ins
  after insert on public.parametros_tributarios
  for each row
  when (new.parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE'))
  execute function public.trg_p63_costos_b2b();

-- Un cambio de PROVEEDOR del vuelo fuente también mueve el contador (el neto/tarifa ya sube la revisión del tarifario).
create or replace function public.trg_p63_costos_empaquetados()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.p63_bump_costos(array(select sd.paquete_id from public.salidas_dinamicas sd where sd.empaquetado_id = new.id));
  return null;
end;
$$;
revoke all on function public.trg_p63_costos_empaquetados() from public, anon, authenticated;
create trigger trg_p63_costos_empaquetados
  after update of proveedor_id, tarifa_proveedor on public.empaquetados
  for each row execute function public.trg_p63_costos_empaquetados();

-- 8.5 Utilidades internas.
create or replace function public.p63_hoy_bogota()
returns date
language sql
stable
as $$ select (clock_timestamp() at time zone 'America/Bogota')::date $$;
revoke all on function public.p63_hoy_bogota() from public, anon, authenticated;

-- Payload financiero que se DERIVA de lo aceptado: costos + obligaciones del snapshot, con la fecha de obligación del día de
-- negocio (Bogotá) en que se aceptó. Es lo único que puede escribir la RPC financiera y lo único que puede guardar el pendiente.
create or replace function public.p63_financiero_derivado(p_aceptacion bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'costos', coalesce(a.snapshot -> 'financiero' -> 'costos', '{}'::jsonb),
           'cxp', coalesce((
             select jsonb_agg(e.v || jsonb_build_object('fecha_obligacion', a.fecha_negocio::text) order by e.ord)
               from jsonb_array_elements(coalesce(a.snapshot -> 'financiero' -> 'cxp', '[]'::jsonb)) with ordinality as e(v, ord)
           ), '[]'::jsonb))
    from public.p63_aceptacion a
   where a.id = p_aceptacion
$$;
revoke all on function public.p63_financiero_derivado(bigint) from public, anon, authenticated;

-- ¿Los hijos del contrato (vuelos, ítems, hotel) están completos según el snapshot? NULL = sí; texto = qué falta.
create or replace function public.p63_hijos_pendientes(p_aceptacion bigint)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_a        public.p63_aceptacion;
  v_cab      jsonb;
  v_vuelos   int;
  v_items    int;
  v_hoteles  int;
begin
  select * into v_a from public.p63_aceptacion where id = p_aceptacion;
  if not found then
    return 'aceptación inexistente';
  end if;
  v_cab := v_a.snapshot -> 'cabecera';
  select count(*) into v_vuelos  from public.contrato_vuelos  where numero_contrato = v_a.numero_contrato;
  select count(*) into v_items   from public.contrato_items   where numero_contrato = v_a.numero_contrato;
  select count(*) into v_hoteles from public.contrato_hoteles where numero_contrato = v_a.numero_contrato;
  if v_vuelos is distinct from coalesce((v_cab ->> 'n_tramos')::int, 0) then
    return format('tramos de vuelo: esperados %s, hay %s', coalesce((v_cab ->> 'n_tramos')::int, 0), v_vuelos);
  end if;
  if v_items is distinct from coalesce((v_cab ->> 'n_items')::int, 0) then
    return format('ítems de valores: esperados %s, hay %s', coalesce((v_cab ->> 'n_items')::int, 0), v_items);
  end if;
  if v_hoteles is distinct from coalesce((v_cab ->> 'n_hoteles')::int, 0) then
    return format('hotel del contrato: esperados %s, hay %s', coalesce((v_cab ->> 'n_hoteles')::int, 0), v_hoteles);
  end if;
  return null;
end;
$$;
revoke all on function public.p63_hijos_pendientes(bigint) from public, anon, authenticated;

-- Comparación de un payload financiero contra el derivado de la aceptación: vacío = "usa el derivado"; distinto = rechazo.
create or replace function public.p63_payload_alterno(p_aceptacion bigint, p_costos jsonb, p_cxp jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_der jsonb := public.p63_financiero_derivado(p_aceptacion);
begin
  if v_der is null then
    return true;
  end if;
  if p_costos is not null and p_costos <> '{}'::jsonb and p_costos is distinct from (v_der -> 'costos') then
    return true;
  end if;
  if p_cxp is not null and p_cxp <> '[]'::jsonb and p_cxp is distinct from (v_der -> 'cxp') then
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.p63_payload_alterno(bigint, jsonb, jsonb) from public, anon, authenticated;

-- ═══ 9. COTIZAR: cotización + oferta + snapshot privado en UNA transacción ══
--
-- La llama el SERVIDOR (service_role) después de autorizar sesión/rol/tenant; nunca el navegador. Recibe el snapshot ya
-- calculado por el servidor, verifica bajo candado que la configuración del paquete sigue siendo la que se leyó en T0 (no hay
-- "cotización rasgada") y crea la fila de `cotizaciones` junto con su oferta privada. La autoría estable y el alta de personas
-- de la 219 siguen siendo un paso posterior de la app (con su aviso persistente), como hasta hoy.
create or replace function public.crear_cotizacion_oferta_63(
  p_usuario           uuid,
  p_tenant            text,
  p_cotizacion        jsonb,
  p_snapshot          jsonb,
  p_huella            text,
  p_huella_financiera text,
  p_t0                jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paquete   bigint := nullif(p_snapshot ->> 'paquete_id', '')::bigint;
  v_salida    bigint := nullif(p_snapshot ->> 'salida_id', '')::bigint;
  v_trm       numeric := nullif(p_snapshot ->> 'trm', '')::numeric;
  v_modo      text;
  v_tipo      text;
  v_trm_pq    numeric;
  v_rev_f     bigint;
  v_rev_p     bigint;
  v_gen_p     bigint;
  v_rev_c     bigint;
  v_cot       public.cotizaciones;
  v_id        bigint;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  if p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta en COP con TRM solo existe en el tarifario de mayorista';
  end if;
  if v_paquete is null or v_trm is null or v_trm <= 0 or coalesce(btrim(p_huella), '') = '' or coalesce(btrim(p_huella_financiera), '') = ''
     or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'financiero' is null or p_snapshot -> 'cabecera' is null
     or p_t0 is null then
    raise exception 'p63_invalida: snapshot, huellas o revisiones de la oferta incompletos';
  end if;

  -- FOR SHARE: espera a un cambio de fuente en curso y no deja que uno nuevo se cuele hasta que esta cotización quede escrita.
  select p.modo_oferta, p.tipo::text, p.trm_oferta, p.tarifario_revision_fuente, p.tarifario_revision_publicada,
         p.tarifario_generacion_publicada, p.p63_rev_costos
    into v_modo, v_tipo, v_trm_pq, v_rev_f, v_rev_p, v_gen_p, v_rev_c
    from public.armado_paquetes p where p.id = v_paquete for share;
  if not found then
    raise exception 'p63_oferta_cambio: el paquete % ya no existe', v_paquete;
  end if;
  if v_modo is distinct from 'cop_trm_63' or v_tipo is distinct from 'dinamico' or v_trm_pq is distinct from v_trm then
    raise exception 'p63_oferta_cambio: el modo o la TRM del paquete cambiaron mientras se cotizaba';
  end if;
  if v_rev_f is distinct from (p_t0 ->> 'rev_fuente')::bigint
     or v_rev_p is distinct from nullif(p_t0 ->> 'rev_publicada', '')::bigint
     or v_gen_p is distinct from nullif(p_t0 ->> 'gen_publicada', '')::bigint
     or v_rev_c is distinct from (p_t0 ->> 'rev_costos')::bigint then
    raise exception 'p63_oferta_cambio: la configuración del paquete cambió mientras se cotizaba';
  end if;
  if v_salida is not null and not exists (select 1 from public.salidas_dinamicas s where s.id = v_salida and s.paquete_id = v_paquete) then
    raise exception 'p63_oferta_cambio: la salida % ya no pertenece al paquete', v_salida;
  end if;

  v_cot := jsonb_populate_record(null::public.cotizaciones, p_cotizacion);
  if v_cot.tenant is distinct from p_tenant or v_cot.paquete_armado_id is distinct from v_paquete then
    raise exception 'p63_invalida: la cotización no coincide con el paquete o la agencia de la oferta';
  end if;

  insert into public.cotizaciones (
    tenant, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre, pax, precio_venta, moneda,
    fecha_salida, fecha_regreso, vigencia_hasta, paquete_armado_id, asesor, creado_por
  ) values (
    v_cot.tenant, v_cot.payload, v_cot.detalle, v_cot.cliente, v_cot.cliente_documento, v_cot.destino, v_cot.hotel, v_cot.modulo,
    v_cot.plan_nombre, v_cot.pax, v_cot.precio_venta, v_cot.moneda, v_cot.fecha_salida, v_cot.fecha_regreso, v_cot.vigencia_hasta,
    v_cot.paquete_armado_id, v_cot.asesor, v_cot.creado_por
  ) returning id into v_id;

  insert into public.p63_oferta (
    cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos,
    huella, huella_financiera, snapshot
  ) values (
    v_id, p_tenant, v_paquete, v_salida, v_trm, v_rev_f, v_rev_p, v_gen_p, v_rev_c, p_huella, p_huella_financiera, p_snapshot
  );
  return v_id;
end;
$$;
comment on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) is
  '227 (#63): crea en UNA transacción la cotización y su oferta privada (snapshot completo), verificando bajo candado que las revisiones de T0 siguen vigentes. Solo service_role, tras autorizar el servidor.';
revoke all on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;

-- ═══ 10. ACEPTAR: revalida AHORA bajo candado, reserva el número y congela el snapshot ═══
--
-- ORDEN DE CANDADOS (el mismo que usan los triggers de escritura, hoja → paquete, para no cerrar un ciclo con ellos):
--   fuente (empaquetados, FOR SHARE) → salida (FOR SHARE) → paquete (FOR NO KEY UPDATE) → oferta (FOR UPDATE) → aceptación.
-- La finalización y la reversión toman venta → (oferta) → aceptación; esta función NUNCA toma la venta, así que no hay ciclo.
-- RELOJ: la fecha de negocio sale de clock_timestamp() (hora de Bogotá) tomada DESPUÉS de los candados: una oferta cotizada
-- ayer cuya compra venció a medianoche se rechaza aunque ningún UPDATE haya movido la revisión. Una oferta YA ACEPTADA antes
-- del vencimiento se materializa después sin revalidar (es lo aceptado, ver 'preparada').
create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o        public.p63_oferta;
  v_a        public.p63_aceptacion;
  v_s        public.salidas_dinamicas;
  v_e        public.empaquetados;
  v_snap     jsonb;
  v_paquete  bigint;
  v_salida   bigint;
  v_emp      bigint;
  v_hoy      date;
  v_activo   boolean;
  v_tipo     text;
  v_modo     text;
  v_trm      numeric;
  v_publica  boolean;
  v_rev_f    bigint;
  v_rev_p    bigint;
  v_gen_p    bigint;
  v_rev_c    bigint;
  v_numero   text;
  v_id       bigint;
  v_vig      jsonb;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  select * into v_o from public.p63_oferta where cotizacion_id = p_cotizacion;
  if not found then
    raise exception 'p63_sin_oferta: la cotización % no tiene una oferta en COP con TRM', p_cotizacion;
  end if;
  if v_o.tenant is distinct from p_tenant or p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta no pertenece a la agencia indicada';
  end if;
  v_snap := v_o.snapshot;
  v_paquete := v_o.paquete_id;
  v_salida := v_o.salida_id;
  v_emp := nullif(v_snap ->> 'empaquetado_id', '')::bigint;

  -- Candados en orden fijo.
  if v_emp is not null then
    perform 1 from public.empaquetados e where e.id = v_emp for share;
  end if;
  if v_salida is not null then
    perform 1 from public.salidas_dinamicas s where s.id = v_salida for share;
  end if;
  perform 1 from public.armado_paquetes p where p.id = v_paquete for no key update;
  select * into v_o from public.p63_oferta where id = v_o.id for update;

  -- Idempotencia: el mismo reintento recibe el MISMO intento (mismo número y mismo snapshot), nunca uno nuevo.
  select * into v_a from public.p63_aceptacion where oferta_id = v_o.id and estado <> 'descartada';
  if found then
    if v_a.estado = 'preparada' then
      return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato,
                                'fecha_negocio', v_a.fecha_negocio, 'snapshot', v_a.snapshot,
                                'financiero', public.p63_financiero_derivado(v_a.id));
    end if;
    return jsonb_build_object('estado', v_a.estado, 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato);
  end if;
  if v_o.estado <> 'abierta' then
    raise exception 'p63_oferta_cerrada: la oferta de la cotización % ya fue convertida y no se reabre; genera una cotización nueva', p_cotizacion;
  end if;

  -- Revalidación en ESTE instante (hora de Bogotá).
  v_hoy := public.p63_hoy_bogota();
  select p.activo, p.tipo::text, p.modo_oferta, p.trm_oferta, p.tarifario_snapshot_publicable, p.tarifario_revision_fuente,
         p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos
    into v_activo, v_tipo, v_modo, v_trm, v_publica, v_rev_f, v_rev_p, v_gen_p, v_rev_c
    from public.armado_paquetes p where p.id = v_paquete;
  if not found or v_activo is not true or v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM';
  end if;
  if v_trm is distinct from v_o.trm then
    raise exception 'p63_oferta_cambio: la TRM del paquete cambió desde la cotización';
  end if;
  if v_publica is not true or v_rev_p is distinct from v_o.rev_publicada or v_gen_p is distinct from v_o.gen_publicada then
    raise exception 'p63_oferta_cambio: el tarifario publicado del paquete cambió desde la cotización';
  end if;
  if v_rev_f is distinct from v_o.rev_fuente or v_rev_c is distinct from v_o.rev_costos then
    raise exception 'p63_oferta_cambio: una fuente, un costo, un proveedor o una retención del paquete cambió desde la cotización';
  end if;
  if p_huella is distinct from v_o.huella or p_huella_financiera is distinct from v_o.huella_financiera then
    raise exception 'p63_oferta_cambio: el precio, el vuelo o los costos recalculados ya no coinciden con lo cotizado';
  end if;

  if v_salida is not null then
    select * into v_s from public.salidas_dinamicas where id = v_salida;
    if not found or v_s.paquete_id is distinct from v_paquete or v_s.activo is not true then
      raise exception 'p63_oferta_cambio: la salida ya no existe o fue desactivada';
    end if;
    if v_s.empaquetado_id is distinct from v_emp then
      raise exception 'p63_oferta_cambio: el vínculo de la salida con Empaquetados cambió';
    end if;
    if (v_s.compra_inicio is not null and v_hoy < v_s.compra_inicio) or (v_s.compra_fin is not null and v_hoy > v_s.compra_fin) then
      raise exception 'p63_oferta_cambio: la salida está fuera de su vigencia de compra';
    end if;
    if v_s.fecha_ida is null or v_s.fecha_ida < v_hoy then
      raise exception 'p63_oferta_cambio: la fecha de la salida ya pasó';
    end if;
    if v_emp is not null then
      select * into v_e from public.empaquetados where id = v_emp;
      if not found or v_e.activo is not true then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya no existe o fue desactivado';
      end if;
      if nullif(btrim(coalesce(v_e.record, '')), '') is not null then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya tiene record (PNR)';
      end if;
      if (v_e.compra_inicio is not null and v_hoy < v_e.compra_inicio) or (v_e.compra_fin is not null and v_hoy > v_e.compra_fin)
         or v_e.fecha_ida is null or v_e.fecha_ida < v_hoy then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado está fuera de vigencia';
      end if;
      if v_e.moneda is distinct from 'COP' or coalesce(v_e.tarifa_para_empaquetar, 0) <= 0 then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado no está en COP o no tiene tarifa';
      end if;
      if round(coalesce(v_s.valor_tiquete, 0), 2) is distinct from round(v_e.tarifa_para_empaquetar, 2)
         or round(coalesce(v_s.fee_infante, 0), 2) is distinct from round(coalesce(v_e.fee_infante, 0), 2)
         or v_s.fecha_ida is distinct from v_e.fecha_ida or v_s.fecha_regreso is distinct from v_e.fecha_regreso
         or coalesce(v_s.ruta, '') is distinct from coalesce(v_e.ruta, '')
         or coalesce(v_s.aerolinea, '') is distinct from coalesce(v_e.aerolinea, '') then
        raise exception 'p63_oferta_cambio: la salida ya no coincide con su vuelo de Empaquetados';
      end if;
      -- Destino aéreo permitido (220/#67): misma guarda que al vincular. Re-entra en el candado del paquete que ya tenemos.
      perform public.validar_vinculo_aereo_67(v_paquete, 'empaquetado', v_emp);
    end if;
  end if;

  -- Vigencia de COMPRA de las tarifas de hotel y servicios que respaldan el precio (snapshot.vigencias: la temporada/promoción que ganó cada noche
  -- o cada servicio, con sus límites de compra, tal como se leyeron al cotizar). Con la fecha de negocio de Bogotá de ESTA transacción: una tarifa
  -- cuya compra cerró (o aún no abre) se rechaza aunque ningún UPDATE haya movido una revisión (cruce de medianoche).
  for v_vig in select e from jsonb_array_elements(coalesce(v_snap -> 'vigencias', '[]'::jsonb)) as e loop
    if (nullif(v_vig ->> 'compra_inicio', '') is not null and v_hoy < (v_vig ->> 'compra_inicio')::date)
       or (nullif(v_vig ->> 'compra_fin', '') is not null and v_hoy > (v_vig ->> 'compra_fin')::date) then
      raise exception 'p63_oferta_cambio: la tarifa "%" de % ya no está en su vigencia de compra', v_vig ->> 'ref', v_vig ->> 'origen';
    end if;
  end loop;

  -- Número reservado en la MISMA transacción (mayorista: secuencia dedicada, nunca se reutiliza) y snapshot congelado.
  v_numero := public.siguiente_numero_contrato_para_tenant(p_tenant);
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot)
  values (v_o.id, v_o.cotizacion_id, p_tenant, v_numero, p_usuario, v_hoy, v_o.snapshot)
  returning id into v_id;
  update public.p63_oferta set estado = 'aceptada', actualizada_en = now() where id = v_o.id;

  return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_id, 'numero_contrato', v_numero, 'fecha_negocio', v_hoy,
                            'snapshot', v_o.snapshot, 'financiero', public.p63_financiero_derivado(v_id));
end;
$$;
comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text) is
  '227 (#63): acepta de forma atómica una oferta cotizada: toma los candados en orden fijo, revalida AHORA (fecha de Bogotá, compra, activo, TRM, revisiones, huellas, destino aéreo), reserva el número y congela el snapshot. Reintento = mismo intento. Solo service_role, tras autorizar el servidor.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text) to service_role;

-- ═══ 11. FENCING DE LA CABECERA ═══════════════════════════════════════════
-- BEFORE INSERT en ventas: un número reservado por una aceptación solo lo crea EL intento vigente, con la cabecera que se
-- aceptó, y la marca 'materializando' en la MISMA transacción del insert. Un worker viejo (intento descartado) no crea cabecera;
-- un número descartado queda como tombstone. Después de la cabecera no hay "takeover" por reloj: la recuperación es la RPC
-- financiera (con el payload aceptado) o la reversión completa.
create or replace function public.trg_ventas_aceptacion_63_ins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a      public.p63_aceptacion;
  v_c      jsonb;
  v_precio numeric;
  v_b2b    jsonb;
  v_dif    text := '';
begin
  select * into v_a from public.p63_aceptacion a where a.numero_contrato = new.numero_contrato for update;
  if not found then
    if new.aceptacion_63_id is not null then
      raise exception 'p63_cabecera: la aceptación % no existe', new.aceptacion_63_id;
    end if;
    return new;
  end if;
  if new.aceptacion_63_id is distinct from v_a.id then
    raise exception 'p63_cabecera: el número % está reservado por una aceptación #63; solo ese intento puede crear su cabecera', new.numero_contrato;
  end if;
  if v_a.estado <> 'preparada' then
    raise exception 'p63_cabecera: el intento de % no está vigente (estado %); no se crea otra cabecera', new.numero_contrato, v_a.estado;
  end if;
  if v_a.tenant is distinct from new.tenant then
    raise exception 'p63_cabecera: la agencia de la cabecera no es la de la aceptación';
  end if;

  v_c := v_a.snapshot -> 'cabecera';
  v_precio := (v_c ->> 'precio_venta')::numeric;
  v_b2b := v_a.snapshot -> 'b2b';
  if new.estado is distinct from 'pendiente' or new.financiero_estado is distinct from 'pendiente' then v_dif := v_dif || 'estado '; end if;
  if new.tipo_paquete is distinct from (v_c ->> 'tipo_paquete') then v_dif := v_dif || 'tipo_paquete '; end if;
  if new.moneda is distinct from (v_c ->> 'moneda') then v_dif := v_dif || 'moneda '; end if;
  if new.fecha_salida is distinct from nullif(v_c ->> 'fecha_salida', '')::date then v_dif := v_dif || 'fecha_salida '; end if;
  if new.fecha_regreso is distinct from nullif(v_c ->> 'fecha_regreso', '')::date then v_dif := v_dif || 'fecha_regreso '; end if;
  if new.pax is distinct from (v_c ->> 'pax')::int then v_dif := v_dif || 'pax '; end if;
  if new.destino is distinct from (v_c ->> 'destino') then v_dif := v_dif || 'destino '; end if;
  if new.hotel is distinct from (v_c ->> 'hotel') then v_dif := v_dif || 'hotel '; end if;
  if new.plan_nombre is distinct from (v_c ->> 'plan_nombre') then v_dif := v_dif || 'plan '; end if;
  if new.aerolinea is distinct from (v_c ->> 'aerolinea') then v_dif := v_dif || 'aerolinea '; end if;
  if new.paquete_armado_id is distinct from nullif(v_c ->> 'paquete_armado_id', '')::bigint then v_dif := v_dif || 'paquete '; end if;
  if coalesce(new.impuesto, 0) is distinct from coalesce((v_c ->> 'impuesto')::numeric, 0) then v_dif := v_dif || 'impuesto '; end if;
  if coalesce(new.costo_aereo, 0) is distinct from coalesce((v_c ->> 'costo_aereo')::numeric, 0) then v_dif := v_dif || 'costo_aereo '; end if;
  -- Plan B2B ACEPTADO (snapshot.b2b: aliado, % , modo de compra, comisión, estado y precio final). La cabecera se contrasta contra ESE valor, no se
  -- recalcula: si el % del aliado cambió después de aceptar, la cabecera aceptada ya no coincide con lo vivo y la comisión de la base se niega.
  if new.tipo_asesor is distinct from (v_c ->> 'tipo_asesor') then v_dif := v_dif || 'tipo_asesor '; end if;
  if new.canal is distinct from (v_c ->> 'canal') then v_dif := v_dif || 'canal '; end if;
  if jsonb_typeof(v_b2b) = 'object' then
    if new.aliado_id is distinct from (v_b2b ->> 'aliado_id')::bigint then v_dif := v_dif || 'aliado '; end if;
    if new.modo_compra is distinct from nullif(v_b2b ->> 'modo_compra', '') then v_dif := v_dif || 'modo_compra '; end if;
    if new.comision_b2b is distinct from nullif(v_b2b ->> 'comision', '')::numeric then v_dif := v_dif || 'comision_b2b '; end if;
    if new.comision_estado is distinct from nullif(v_b2b ->> 'comision_estado', '') then v_dif := v_dif || 'comision_estado '; end if;
    if new.precio_venta is distinct from (v_b2b ->> 'precio_final')::numeric then v_dif := v_dif || 'precio_venta '; end if;
  else
    if new.aliado_id is not null or new.modo_compra is not null or new.comision_b2b is not null or new.comision_estado is not null then
      v_dif := v_dif || 'b2b ';
    end if;
    if new.precio_venta is distinct from v_precio then v_dif := v_dif || 'precio_venta '; end if;
  end if;
  if v_dif <> '' then
    raise exception 'p63_cabecera: la cabecera no coincide con lo aceptado (%)', btrim(v_dif);
  end if;

  update public.p63_aceptacion set estado = 'materializando', actualizada_en = now() where id = v_a.id;
  return new;
end;
$$;
revoke all on function public.trg_ventas_aceptacion_63_ins() from public, anon, authenticated;
create trigger trg_ventas_aceptacion_63_ins
  before insert on public.ventas
  for each row execute function public.trg_ventas_aceptacion_63_ins();

-- La cabecera revertida (compensación o recuperación sin payload) descarta el intento: el número queda como tombstone y la
-- oferta vuelve a estar abierta SOLO si el intento no llegó a 'completa'. Orden: oferta → aceptación (el mismo de aceptar).
create or replace function public.trg_ventas_borrada_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oferta bigint;
begin
  select a.oferta_id into v_oferta from public.p63_aceptacion a where a.id = old.aceptacion_63_id;
  if v_oferta is null then
    return null;
  end if;
  perform 1 from public.p63_oferta o where o.id = v_oferta for update;
  update public.p63_aceptacion
     set estado = 'descartada', error = coalesce(error, 'contrato revertido antes de completarse'), actualizada_en = now()
   where id = old.aceptacion_63_id and estado <> 'completa';
  if found then
    update public.p63_oferta set estado = 'abierta', actualizada_en = now() where id = v_oferta and estado = 'aceptada';
  end if;
  return null;
end;
$$;
revoke all on function public.trg_ventas_borrada_63() from public, anon, authenticated;
create trigger trg_ventas_borrada_63
  after delete on public.ventas
  for each row when (old.aceptacion_63_id is not null)
  execute function public.trg_ventas_borrada_63();

-- Costos de un contrato aceptado: solo los escribe la RPC financiera (bandera de transacción app.p63_h).
create or replace function public.trg_ventas_costos_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.p63_h', true), '') = 'on' then
    return new;
  end if;
  if old.aceptacion_63_id is not null then
    if new.aceptacion_63_id is distinct from old.aceptacion_63_id then
      raise exception 'p63_protegido: la aceptación de un contrato no se cambia';
    end if;
    if new.costo_hotel is distinct from old.costo_hotel or new.costo_aereo is distinct from old.costo_aereo
       or new.costo_receptivo is distinct from old.costo_receptivo or new.costo_asistencia is distinct from old.costo_asistencia
       or new.otros_costos is distinct from old.otros_costos then
      raise exception 'p63_protegido: los costos de un contrato de oferta COP con TRM salen de lo aceptado y no se editan; anula el contrato y reserva de nuevo';
    end if;
  elsif new.aceptacion_63_id is not null then
    raise exception 'p63_protegido: un contrato no se marca como oferta aceptada después de creado';
  end if;
  return new;
end;
$$;
revoke all on function public.trg_ventas_costos_63() from public, anon, authenticated;
create trigger trg_ventas_costos_63
  before update of costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, aceptacion_63_id on public.ventas
  for each row execute function public.trg_ventas_costos_63();

-- ═══ 12. PENDIENTE FINANCIERO: solo el payload aceptado, solo tras los hijos ═
create or replace function public.p63_validar_pendiente(p_numero text, p_costos jsonb, p_cxp jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_acep   bigint;
  v_estado text;
  v_der    jsonb;
  v_msg    text;
begin
  select v.aceptacion_63_id into v_acep from public.ventas v where v.numero_contrato = p_numero;
  if v_acep is null then
    return;
  end if;
  select a.estado into v_estado from public.p63_aceptacion a where a.id = v_acep;
  if v_estado is distinct from 'materializando' then
    raise exception 'p63_pendiente: la aceptación del contrato % no está vigente (estado %)', p_numero, coalesce(v_estado, 'inexistente');
  end if;
  v_der := public.p63_financiero_derivado(v_acep);
  if p_costos is distinct from (v_der -> 'costos') or p_cxp is distinct from (v_der -> 'cxp') then
    raise exception 'p63_payload_alterno: el payload financiero del contrato % no es el de la oferta aceptada', p_numero;
  end if;
  v_msg := public.p63_hijos_pendientes(v_acep);
  if v_msg is not null then
    raise exception 'p63_pendiente: los pasos previos del contrato % no están completos (%)', p_numero, v_msg;
  end if;
end;
$$;
revoke all on function public.p63_validar_pendiente(text, jsonb, jsonb) from public, anon, authenticated;

-- SECURITY INVOKER (igual que la guarda de la 210): anon/authenticated reciben el 42501 de RLS exactamente como antes.
create or replace function public.trg_p63_pendiente()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    return new;
  end if;
  perform public.p63_validar_pendiente(new.numero_contrato, new.costos, new.cxp);
  return new;
end;
$$;
revoke all on function public.trg_p63_pendiente() from public, anon, authenticated;
create trigger trg_p63_pendiente
  before insert or update on public.contrato_financiero_pendiente
  for each row execute function public.trg_p63_pendiente();

-- ═══ 13. OBLIGACIONES ACEPTADAS: sin mutación del principal, la moneda, el proveedor ni la retención ═══
create or replace function public.trg_cxp_aceptacion_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.p63_h', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.aceptacion_63_id is not null then
      raise exception 'p63_cxp_protegida: una obligación de oferta aceptada solo la crea la escritura financiera del contrato';
    end if;
    return new;
  end if;
  if old.aceptacion_63_id is not null then
    if new.aceptacion_63_id is distinct from old.aceptacion_63_id or new.obligacion_63 is distinct from old.obligacion_63
       or new.numero_contrato is distinct from old.numero_contrato or new.tenant is distinct from old.tenant
       or new.valor_total is distinct from old.valor_total or new.moneda is distinct from old.moneda
       or new.proveedor is distinct from old.proveedor or new.tipo_proveedor is distinct from old.tipo_proveedor
       or new.servicio is distinct from old.servicio or new.servicio_id is distinct from old.servicio_id
       or new.aplica_retencion is distinct from old.aplica_retencion or new.pct_retencion is distinct from old.pct_retencion
       or new.valor_cop_63 is distinct from old.valor_cop_63 or new.trm_63 is distinct from old.trm_63 then
      raise exception 'p63_cxp_protegida: la obligación aceptada (principal, moneda, proveedor, retención) no se edita; anula el contrato y reserva de nuevo';
    end if;
  elsif new.aceptacion_63_id is not null then
    raise exception 'p63_cxp_protegida: una obligación no se marca como aceptada después de creada';
  end if;
  return new;
end;
$$;
revoke all on function public.trg_cxp_aceptacion_63() from public, anon, authenticated;
create trigger trg_cxp_aceptacion_63
  before insert or update on public.cuentas_por_pagar
  for each row execute function public.trg_cxp_aceptacion_63();

-- Borrado: DIFERIDO al commit. Si en la misma transacción desapareció el contrato (eliminar_contrato borra las CxP y luego la
-- venta), el borrado es legítimo; si la venta sigue ahí, no se puede quitar una obligación aceptada.
create or replace function public.trg_cxp_borrada_63()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato and v.aceptacion_63_id = old.aceptacion_63_id) then
    raise exception 'p63_cxp_protegida: la obligación aceptada % del contrato % no se elimina mientras el contrato exista', old.obligacion_63, old.numero_contrato;
  end if;
  return null;
end;
$$;
revoke all on function public.trg_cxp_borrada_63() from public, anon, authenticated;
create constraint trigger trg_cxp_borrada_63
  after delete on public.cuentas_por_pagar
  deferrable initially deferred
  for each row when (old.aceptacion_63_id is not null)
  execute function public.trg_cxp_borrada_63();

-- ═══ 14. H — ESCRITURA FINANCIERA DERIVADA DE LO ACEPTADO ═════════════════
--
-- Para un contrato ligado a una aceptación #63 (ventas.aceptacion_63_id) la RPC SOLO procesa la aceptación vigente: deriva
-- costos, obligaciones, monedas y equivalentes en COP del snapshot y RECHAZA cualquier payload distinto (también una llamada
-- directa con costos/CxP adulterados, con el pendiente adulterado o sin pendiente). La salida `ya_completo` y la protección K15
-- son las de la 210 y van PRIMERO. Un contrato sin aceptación #63 ejecuta EXACTAMENTE el texto de la 210 (la única diferencia
-- es la lectura del marcador y el desvío para contratos #63; ver pruebas/salidaVinculada63Sql.test.ts que lo compara).
create or replace function public.p63_registrar_financiero(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb,
  p_aceptacion      bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a        public.p63_aceptacion;
  v_der      jsonb;
  v_item     jsonb;
  v_ids      jsonb := '[]'::jsonb;
  v_id       bigint;
  v_valor    numeric;
  v_cop      numeric;
  v_trm      numeric;
  v_trm_snap numeric;
  v_moneda   text;
  v_msg      text;
begin
  select * into v_a from public.p63_aceptacion where id = p_aceptacion for update;
  if not found or v_a.numero_contrato is distinct from p_numero_contrato or v_a.tenant is distinct from p_tenant then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no existe o no coincide', p_numero_contrato;
  end if;
  if v_a.estado <> 'materializando' then
    raise exception 'registrar_financiero_contrato: la aceptación #63 del contrato % no está vigente (estado %)', p_numero_contrato, v_a.estado;
  end if;

  v_der := public.p63_financiero_derivado(v_a.id);
  if public.p63_payload_alterno(v_a.id, p_costos, p_cxp) then
    raise exception 'p63_payload_alterno: el payload financiero recibido no es el de la oferta aceptada del contrato %', p_numero_contrato;
  end if;
  if not exists (
    select 1 from public.contrato_financiero_pendiente cp
     where cp.numero_contrato = p_numero_contrato and cp.costos = (v_der -> 'costos') and cp.cxp = (v_der -> 'cxp')
  ) then
    raise exception 'p63_sin_pendiente: el contrato % no tiene el payload aceptado guardado como pendiente; no se completa por llamada directa', p_numero_contrato;
  end if;
  v_msg := public.p63_hijos_pendientes(v_a.id);
  if v_msg is not null then
    raise exception 'p63_pendiente: los pasos previos del contrato % no están completos (%)', p_numero_contrato, v_msg;
  end if;

  v_trm_snap := (v_a.snapshot ->> 'trm')::numeric;
  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    if coalesce(btrim(v_item ->> 'tipo_proveedor'), '') = '' or coalesce(btrim(v_item ->> 'obligacion'), '') = '' then
      raise exception 'registrar_financiero_contrato: una obligación aceptada no declara tipo_proveedor u obligacion';
    end if;
    begin
      v_valor := (v_item ->> 'valor_total')::numeric;
      v_cop   := (v_item ->> 'valor_cop')::numeric;
      v_trm   := (v_item ->> 'trm')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: importes no numéricos en la obligación "%"', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end;
    v_moneda := coalesce(nullif(v_item ->> 'moneda', ''), 'COP');
    if v_valor is null or v_valor < 0 or v_cop is null or v_cop < 0 or v_trm is distinct from v_trm_snap or v_moneda not in ('COP', 'USD') then
      raise exception 'registrar_financiero_contrato: obligación aceptada inválida (valor %, equivalente COP %, TRM %, moneda %) en "%"',
        v_valor, v_cop, v_trm, v_moneda, coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
    if (v_moneda = 'COP' and v_cop <> v_valor) or (v_moneda = 'USD' and abs(v_cop - round(v_valor * v_trm_snap, 2)) > 0.01) then
      raise exception 'registrar_financiero_contrato: el equivalente en COP de la obligación "%" no corresponde a su valor y a la TRM aceptada', coalesce(v_item ->> 'servicio', '(sin nombre)');
    end if;
  end loop;

  perform set_config('app.p63_h', 'on', true);

  update public.ventas v set
    costo_hotel      = coalesce((v_der -> 'costos' ->> 'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((v_der -> 'costos' ->> 'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((v_der -> 'costos' ->> 'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((v_der -> 'costos' ->> 'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((v_der -> 'costos' ->> 'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(v_der -> 'cxp') loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones, valor_cop_63, trm_63, aceptacion_63_id, obligacion_63
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item ->> 'proveedor', '')), ''),
      v_item ->> 'tipo_proveedor',
      nullif(btrim(coalesce(v_item ->> 'servicio', '')), ''),
      nullif(v_item ->> 'servicio_id', '')::bigint,
      (v_item ->> 'valor_total')::numeric,
      coalesce(nullif(v_item ->> 'moneda', ''), 'COP'),
      nullif(v_item ->> 'fecha_obligacion', '')::date,
      nullif(v_item ->> 'fecha_vencimiento', '')::date,
      coalesce((v_item ->> 'aplica_retencion')::boolean, false),
      coalesce((v_item ->> 'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item ->> 'observaciones', ''), public.marca_cxp_automatica()),
      (v_item ->> 'valor_cop')::numeric,
      (v_item ->> 'trm')::numeric,
      v_a.id,
      v_item ->> 'obligacion'
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item ->> 'tipo_proveedor',
      'proveedor', v_item ->> 'proveedor',
      'servicio', v_item ->> 'servicio',
      'servicio_id', v_item ->> 'servicio_id',
      'valor_total', (v_item ->> 'valor_total')::numeric
    );
  end loop;

  -- 'completo' nace en la MISMA transacción que escribe costos y obligaciones y marca la aceptación como convertida.
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  update public.p63_aceptacion set estado = 'completa', actualizada_en = now() where id = v_a.id;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  perform set_config('app.p63_h', 'off', true);
  return jsonb_build_object('creadas', v_ids, 'eliminadas', '[]'::jsonb);
end;
$$;
revoke all on function public.p63_registrar_financiero(text, text, jsonb, jsonb, bigint) from public, anon, authenticated;

-- ═══ 15. registrar_financiero_contrato (210): texto de la 210 + desvío para contratos de oferta aceptada (#63) ═
create or replace function public.registrar_financiero_contrato(
  p_numero_contrato text,
  p_tenant          text,
  p_costos          jsonb,
  p_cxp             jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado     text;
  v_item       jsonb;
  v_ids        jsonb := '[]'::jsonb;
  v_eliminadas jsonb := '[]'::jsonb;
  v_id         bigint;
  v_valor      numeric;
  v_acep       bigint;
begin
  if p_numero_contrato is null or btrim(p_numero_contrato) = '' then
    raise exception 'registrar_financiero_contrato: numero_contrato vacío';
  end if;
  if p_tenant is null or btrim(p_tenant) = '' then
    raise exception 'registrar_financiero_contrato: tenant vacío';
  end if;

  select v.financiero_estado into v_estado
  from public.ventas v
  where v.numero_contrato = p_numero_contrato and v.tenant = p_tenant
  for update;
  if not found then
    raise exception 'registrar_financiero_contrato: el contrato % no existe en la agencia %', p_numero_contrato, p_tenant;
  end if;

  -- K15: la escritura financiera se hace UNA vez. Un contrato que ya no está
  -- pendiente (otra sesión lo completó mientras esta esperaba el candado, un
  -- reintento tras una respuesta perdida, o nunca fue pendiente) NO se toca:
  -- ni se borran sus CxP, ni se tocan los costos, ni se devuelven ids para que
  -- la app mueva asientos. Se limpia, eso sí, un payload residual.
  if v_estado is distinct from 'pendiente' then
    delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;
    return jsonb_build_object('creadas', '[]'::jsonb, 'eliminadas', '[]'::jsonb, 'ya_completo', true, 'estado', v_estado);
  end if;

  -- 227 (#63): un contrato ligado a una aceptación de oferta COP con TRM NO usa el payload del llamador: se deriva de lo
  -- aceptado y se rechaza todo lo demás (llamadas directas incluidas). Un contrato sin aceptación sigue EXACTAMENTE la 210.
  select v.aceptacion_63_id into v_acep from public.ventas v where v.numero_contrato = p_numero_contrato;
  if v_acep is not null then
    return public.p63_registrar_financiero(p_numero_contrato, p_tenant, p_costos, p_cxp, v_acep);
  end if;

  if p_cxp is not null and jsonb_typeof(p_cxp) <> 'array' then
    raise exception 'registrar_financiero_contrato: p_cxp debe ser un arreglo';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    if coalesce(btrim(v_item->>'tipo_proveedor'), '') = '' then
      raise exception 'registrar_financiero_contrato: una CxP no declara tipo_proveedor';
    end if;
    begin
      v_valor := (v_item->>'valor_total')::numeric;
    exception when others then
      raise exception 'registrar_financiero_contrato: valor_total no numérico en la CxP "%"', coalesce(v_item->>'servicio', '(sin nombre)');
    end;
    if v_valor is null or v_valor < 0 then
      raise exception 'registrar_financiero_contrato: valor_total inválido (%) en la CxP "%"', v_valor, coalesce(v_item->>'servicio', '(sin nombre)');
    end if;
  end loop;

  -- (Contrato pendiente: normalmente sin CxP; si quedaron CxP automáticas de un
  -- intento anterior sin pagos ni retenciones, se reemplazan como en la 172.)
  with borradas as (
    delete from public.cuentas_por_pagar c
    where c.numero_contrato = p_numero_contrato
      and c.observaciones like public.marca_cxp_automatica() || '%'
      and not exists (select 1 from public.cxp_pagos p where p.cuenta_por_pagar_id = c.id)
      and not exists (select 1 from public.retenciones_cxp r where r.cuenta_por_pagar_id = c.id)
    returning c.id
  )
  select coalesce(jsonb_agg(borradas.id), '[]'::jsonb) into v_eliminadas from borradas;

  update public.ventas v set
    costo_hotel      = coalesce((p_costos->>'costo_hotel')::numeric,      v.costo_hotel),
    costo_aereo      = coalesce((p_costos->>'costo_aereo')::numeric,      v.costo_aereo),
    costo_receptivo  = coalesce((p_costos->>'costo_receptivo')::numeric,  v.costo_receptivo),
    costo_asistencia = coalesce((p_costos->>'costo_asistencia')::numeric, v.costo_asistencia),
    otros_costos     = coalesce((p_costos->>'otros_costos')::numeric,     v.otros_costos)
  where v.numero_contrato = p_numero_contrato;

  for v_item in select * from jsonb_array_elements(coalesce(p_cxp, '[]'::jsonb)) loop
    insert into public.cuentas_por_pagar (
      numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id,
      valor_total, moneda, fecha_obligacion, fecha_vencimiento,
      aplica_retencion, pct_retencion, observaciones
    ) values (
      p_numero_contrato,
      p_tenant,
      nullif(btrim(coalesce(v_item->>'proveedor', '')), ''),
      v_item->>'tipo_proveedor',
      nullif(btrim(coalesce(v_item->>'servicio', '')), ''),
      nullif(v_item->>'servicio_id', '')::bigint,
      (v_item->>'valor_total')::numeric,
      coalesce(nullif(v_item->>'moneda', ''), 'COP'),
      nullif(v_item->>'fecha_obligacion', '')::date,
      nullif(v_item->>'fecha_vencimiento', '')::date,
      coalesce((v_item->>'aplica_retencion')::boolean, false),
      coalesce((v_item->>'pct_retencion')::numeric, 0),
      coalesce(nullif(v_item->>'observaciones', ''), public.marca_cxp_automatica())
    )
    returning id into v_id;

    v_ids := v_ids || jsonb_build_object(
      'id', v_id,
      'tipo_proveedor', v_item->>'tipo_proveedor',
      'proveedor', v_item->>'proveedor',
      'servicio', v_item->>'servicio',
      'servicio_id', v_item->>'servicio_id',
      'valor_total', (v_item->>'valor_total')::numeric
    );
  end loop;

  -- 'completo' nace en la MISMA transacción que escribe costos y CxP, y deja la
  -- marca durable que impide a la compensación borrar este contrato (210).
  update public.ventas
     set financiero_estado = 'completo', financiero_actualizado_en = now(), financiero_registrado_en = now()
   where numero_contrato = p_numero_contrato;
  delete from public.contrato_financiero_pendiente where numero_contrato = p_numero_contrato;

  return jsonb_build_object('creadas', v_ids, 'eliminadas', v_eliminadas);
end;
$$;

comment on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) is
  '227 (sobre 210): escribe costos + CxP + estado completo EN UNA TRANSACCIÓN, solo sobre un contrato en financiero_estado=pendiente; en otro estado es un no-op {ya_completo:true}. Un contrato de oferta COP con TRM (aceptacion_63_id) deriva todo de lo aceptado y rechaza payload alterno. Solo service_role.';

revoke all on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to service_role;

commit;
