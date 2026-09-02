-- =============================================================================
-- Pruebas REALES en PostgreSQL de la corrección A1/A2/A3 de la migración 164
-- (condiciones de pago por componente). CORRECCIÓN del Commit 4 (auditoría).
--
-- Este script levanta un esquema MÍNIMO pero FIEL al que necesita la 164, y
-- redefine VERBATIM (espejo 1:1) las funciones de dinero de la migración
-- corregida (registrar_pago_previo atómico + idempotente, anular_pago_previo,
-- helpers, trigger de descarte). No aplica las 163 migraciones previas: basta
-- el subconjunto de tablas que tocan estas funciones.
--
-- ⚠️ Si se edita la 164, hay que mantener en espejo estas definiciones; el
-- objeto de la prueba es el COMPORTAMIENTO transaccional (idempotencia,
-- atomicidad, concurrencia, candado de descarte), que aquí se ejercita en un
-- PostgreSQL REAL (docker: postgres:16), no un simulacro.
-- =============================================================================
begin;

-- Roles típicos de Supabase (para el test ACL #9).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- ── Tablas base mínimas (columnas que usan las funciones 164) ─────────────
create table if not exists public.usuarios (
  id uuid primary key, email text, rol text, activo boolean default true, tenant text default 'mayorista'
);
create table if not exists public.puc_cuentas (
  id bigserial primary key, tenant text default 'mayorista', codigo text
);
create table if not exists public.asientos_contables (
  id bigserial primary key, tenant text, numero bigint, fecha date,
  descripcion text, origen text, referencia text, usuario_email text
);
create table if not exists public.asiento_lineas (
  id bigserial primary key, tenant text default 'mayorista', asiento_id bigint, cuenta_id bigint,
  tercero text, descripcion text, debe numeric, haber numeric
);
create table if not exists public.cotizaciones (
  id bigint primary key,
  tenant text default 'mayorista',
  moneda text default 'COP',
  precio_venta numeric(15,2),
  estado text default 'abierta',
  vigencia_hasta date,
  condicion_pago_congelada_en timestamptz,
  moneda_congelada text,
  trm_autoritativa numeric(15,4) default 1,
  precio_total_congelado numeric(15,2),
  monto_exigido_total numeric(15,2),
  monto_exigido_total_cop numeric(15,2),
  pct_efectivo_informativo numeric(6,2),
  tipo text default 'manual'
);
create table if not exists public.cotizacion_condiciones (
  id bigserial primary key,
  cotizacion_id bigint not null,
  orden integer not null default 0,
  tipo_componente text not null,
  referencia_externa text,
  valor_componente numeric(15,2) not null default 0,
  condicion_pago_tipo text not null default 'sin_condicion',
  condicion_pago_pct_aplicable numeric(5,4),
  condicion_pago_dias_saldo integer,
  condicion_pago_fecha_limite date,
  monto_exigido numeric(15,2) not null default 0,
  restriccion_comercial text not null default 'normal',
  hotel_temporada_id bigint,
  paquete_id bigint,
  programa_id bigint,
  congelado boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.cotizacion_pagos_previos (
  id bigserial primary key,
  cotizacion_id bigint not null,
  tenant text not null default 'mayorista',
  monto_cop numeric(15,2) not null,
  monto_moneda numeric(15,2) not null,
  moneda text not null default 'COP',
  trm numeric(15,4) not null default 1,
  forma_pago text not null,
  referencia text,
  fecha_pago date not null default current_date,
  registrado_por_id uuid not null,
  registrado_por_email text,
  estado text not null default 'activo',
  abono_id bigint,
  idempotency_key text,
  motivo_anulacion text,
  created_at timestamptz not null default now()
);
create table if not exists public.ventas (numero_contrato text primary key, cotizacion_id bigint, tenant text);
create table if not exists public.abonos (id bigserial primary key, numero_contrato text, cliente text, fecha_abono date, valor_abono numeric, forma_pago text, referencia text, recibido_por text, trm numeric, monto_cop numeric, tenant text);

-- Semilla mínima: PUC 110505/111005/111010/280510 y el usuario autorizado.
delete from public.puc_cuentas; insert into public.puc_cuentas (tenant, codigo) values
  ('mayorista','110505'),('mayorista','111005'),('mayorista','111010'),('mayorista','280510');
delete from public.usuarios;
insert into public.usuarios (id, email, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000000001','admin@x','administracion',true,'mayorista'),
  ('00000000-0000-0000-0000-000000000002','venta@x','venta',true,'mayorista'),
  ('00000000-0000-0000-0000-000000000003','desactivado@x','administracion',false,'mayorista');

-- ── Funciones espejo de la migración 164 (corregida) ──────────────────────
create or replace function public._autorizado_pago_previo(p_usuario_id uuid)
returns text language plpgsql as $$
declare v_rol text; v_activo boolean;
begin
  if p_usuario_id is null then raise exception 'Se requiere un usuario interno autorizado.'; end if;
  select rol, activo into v_rol, v_activo from public.usuarios where id = p_usuario_id;
  if v_rol is null then raise exception 'El usuario % no existe en el sistema.', p_usuario_id; end if;
  if not coalesce(v_activo, false) then raise exception 'El usuario está desactivado.'; end if;
  if v_rol not in ('superadmin','administracion','gerencia','operaciones') then
    raise exception 'Rol % no autorizado para registrar pagos previos.', v_rol;
  end if;
  return v_rol;
end;
$$;

create or replace function public._siguiente_numero_asiento(p_tenant text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('asiento_tenant_' || coalesce(p_tenant,'mayorista'), 0));
  select coalesce(max(numero), 0) + 1 into v from public.asientos_contables where tenant = coalesce(p_tenant,'mayorista');
  return v;
end;
$$;

create or replace function public._cuenta_disponible(p_forma_pago text, p_moneda text)
returns text language plpgsql as $$
begin
  if coalesce(lower(p_forma_pago),'') like '%efectivo%' then return '110505'; end if;
  return case when upper(coalesce(p_moneda,'COP')) = 'USD' then '111010' else '111005' end;
end;
$$;

create or replace function public._puc_id(p_tenant text, p_codigo text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  select id into v from public.puc_cuentas where tenant = p_tenant and codigo = p_codigo;
  if v is null then raise exception 'Falta la cuenta % en el Plan de cuentas de %.', p_codigo, p_tenant; end if;
  return v;
end;
$$;

-- Trigger de congelado sobre cotizacion_condiciones (espejo de la sección C).
create or replace function public.cotizacion_condiciones_bloquear_congeladas()
returns trigger language plpgsql as $$
declare v_congelada timestamptz;
begin
  select condicion_pago_congelada_en into v_congelada
  from public.cotizaciones where id = coalesce(new.cotizacion_id, old.cotizacion_id);
  if v_congelada is not null then
    raise exception 'Cotización % congelada: no se pueden alterar sus condiciones de pago.', coalesce(new.cotizacion_id, old.cotizacion_id);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_cotizacion_condiciones_bloquear_congeladas on public.cotizacion_condiciones;
create trigger trg_cotizacion_condiciones_bloquear_congeladas
  before insert or update or delete on public.cotizacion_condiciones
  for each row execute function public.cotizacion_condiciones_bloquear_congeladas();

-- Unicidad estructural del snapshot (A2): (cotizacion_id, orden) único.
create unique index if not exists uq_cotizacion_condiciones_cotizacion_orden
  on public.cotizacion_condiciones(cotizacion_id, orden);
-- Idempotencia (A1).
create unique index if not exists uq_pagos_previos_idempotencia
  on public.cotizacion_pagos_previos(idempotency_key) where idempotency_key is not null;

-- Candado de descarte con dinero activo (A3) — espejo sección E.2.
create or replace function public.cotizaciones_no_descartar_con_pagos()
returns trigger language plpgsql as $$
declare v_con_pagos boolean;
begin
  select exists(
    select 1 from public.cotizacion_pagos_previos
    where cotizacion_id = new.id and estado in ('activo','aplicado')
  ) into v_con_pagos;
  if v_con_pagos then
    raise exception 'No se puede descartar la cotización %: tiene pagos previos activos/aplicados. Debe anular cada pago previo (reversa contable formal) antes de descartarla.', new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cotizaciones_no_descartar_con_pagos on public.cotizaciones;
create trigger trg_cotizaciones_no_descartar_con_pagos
  before update on public.cotizaciones
  for each row when (new.estado = 'descartada' and old.estado is distinct from 'descartada')
  execute function public.cotizaciones_no_descartar_con_pagos();

-- registrar_pago_previo CORREGIDA (A1+A2) — espejo 1:1 de la migración 164.
create or replace function public.registrar_pago_previo(
  p_cotizacion_id bigint,
  p_valor numeric,
  p_moneda text,
  p_trm numeric,
  p_forma_pago text,
  p_referencia text,
  p_fecha_pago date,
  p_usuario_id uuid,
  p_idempotency_key text,
  p_snapshot jsonb default null,
  p_exigido_total_moneda numeric default null,
  p_pct_efectivo numeric default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_moneda_cot text;
  v_precio_venta numeric;
  v_congelada timestamptz;
  v_trm_congelada numeric;
  v_moneda_congelada text;
  v_precio_congelado numeric;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_ex_id bigint;
  v_ex_cot bigint;
  v_ex_moneda text;
  v_ex_monto numeric;
  v_ex_forma text;
  v_suma numeric;
  v_tot_cop numeric;
  v_monto_cop numeric;
  v_email text;
  v_pago_id bigint;
  v_numero bigint;
  v_caja text := public._cuenta_disponible(p_forma_pago, p_moneda);
  v_anticipo bigint;
begin
  if v_key is null then
    raise exception 'Se requiere una clave de idempotencia para registrar un pago previo.';
  end if;
  if not (coalesce(p_valor,0) > 0) then
    raise exception 'El valor del pago debe ser mayor a cero.';
  end if;
  if nullif(trim(coalesce(p_forma_pago,'')),'') is null then
    raise exception 'Indica la forma de pago.';
  end if;

  select tenant, moneda, precio_venta, condicion_pago_congelada_en
    into v_tenant, v_moneda_cot, v_precio_venta, v_congelada
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if exists (select 1 from public.cotizaciones where id = p_cotizacion_id and estado <> 'abierta') then
    raise exception 'La cotización % no está abierta (no se puede registrar un pago previo).', p_cotizacion_id;
  end if;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_cot,'COP')) then
    raise exception 'La moneda del pago (%) no coincide con la de la cotización (%).', p_moneda, v_moneda_cot;
  end if;

  select id, cotizacion_id, moneda, monto_moneda, lower(coalesce(forma_pago,''))
    into v_ex_id, v_ex_cot, v_ex_moneda, v_ex_monto, v_ex_forma
  from public.cotizacion_pagos_previos where idempotency_key = v_key for update;
  if v_ex_id is not null then
    if v_ex_cot <> p_cotizacion_id
       or upper(coalesce(v_ex_moneda,'')) <> upper(coalesce(p_moneda,''))
       or v_ex_monto <> p_valor
       or v_ex_forma <> lower(coalesce(p_forma_pago,'')) then
      raise exception 'La clave de idempotencia ya se usó para otro pago: no se reutiliza.';
    end if;
    return 'OK|' || v_ex_id;
  end if;

  if v_congelada is null then
    v_trm_congelada := case when upper(coalesce(p_moneda,'')) = 'COP' then 1 else coalesce(nullif(p_trm,0),1) end;
    if p_snapshot is null or p_exigido_total_moneda is null then
      raise exception 'Primer pago: falta el snapshot de condiciones para congelar la cotización.';
    end if;
    delete from public.cotizacion_condiciones where cotizacion_id = p_cotizacion_id;
    insert into public.cotizacion_condiciones
      (cotizacion_id, orden, tipo_componente, referencia_externa, valor_componente,
       condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
       condicion_pago_fecha_limite, monto_exigido, restriccion_comercial,
       hotel_temporada_id, paquete_id, programa_id, congelado)
    select p_cotizacion_id,
           coalesce((r->>'orden')::int, 0),
           r->>'tipo_componente',
           nullif(r->>'referencia_externa',''),
           coalesce((r->>'valor_componente')::numeric, 0),
           coalesce(r->>'condicion_pago_tipo','sin_condicion'),
           nullif(r->>'condicion_pago_pct_aplicable','')::numeric,
           nullif(r->>'condicion_pago_dias_saldo','')::int,
           nullif(r->>'condicion_pago_fecha_limite','')::date,
           coalesce((r->>'monto_exigido')::numeric, 0),
           coalesce(r->>'restriccion_comercial','normal'),
           nullif(r->>'hotel_temporada_id','')::bigint,
           nullif(r->>'paquete_id','')::bigint,
           nullif(r->>'programa_id','')::bigint,
           true
    from jsonb_array_elements(p_snapshot) r;
    update public.cotizaciones set
      condicion_pago_congelada_en = now(),
      moneda_congelada = upper(p_moneda),
      trm_autoritativa = v_trm_congelada,
      precio_total_congelado = v_precio_venta,
      monto_exigido_total = p_exigido_total_moneda,
      monto_exigido_total_cop = round(p_exigido_total_moneda * v_trm_congelada, 2),
      pct_efectivo_informativo = p_pct_efectivo
    where id = p_cotizacion_id;
  end if;

  select trm_autoritativa, moneda_congelada, precio_total_congelado
    into v_trm_congelada, v_moneda_congelada, v_precio_congelado
  from public.cotizaciones where id = p_cotizacion_id;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_congelada,'')) then
    raise exception 'Moneda del pago % no coincide con la congelada % de la cotización.', p_moneda, v_moneda_congelada;
  end if;
  v_monto_cop := round(p_valor * v_trm_congelada, 2);

  select coalesce(sum(monto_cop),0) into v_suma
  from public.cotizacion_pagos_previos
  where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado');
  v_tot_cop := round(coalesce(v_precio_congelado,0) * v_trm_congelada, 2);
  if v_suma + v_monto_cop > v_tot_cop + 0.005 then
    raise exception 'Sobrepago rechazado: ya hay % pagados y % excede el total % de la cotización.', v_suma, v_monto_cop, v_tot_cop;
  end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  insert into public.cotizacion_pagos_previos
    (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago,
     referencia, fecha_pago, registrado_por_id, registrado_por_email, idempotency_key)
  values
    (p_cotizacion_id, v_tenant, v_monto_cop, p_valor, upper(p_moneda), v_trm_congelada,
     p_forma_pago, nullif(trim(coalesce(p_referencia,'')),''),
     coalesce(p_fecha_pago, current_date), p_usuario_id, v_email, v_key)
  returning id into v_pago_id;

  v_numero := public._siguiente_numero_asiento(v_tenant);
  v_anticipo := public._puc_id(v_tenant, '280510');
  insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
  values (v_tenant, v_numero, coalesce(p_fecha_pago, current_date),
    'Pago previo a cotización ' || p_cotizacion_id || ' (' || p_moneda || ')',
    'pago_previo', 'pago_previo:' || v_pago_id, v_email);
  insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
  values
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     public._puc_id(v_tenant, v_caja), 'cotizacion:' || p_cotizacion_id, 'Pago previo recibido', v_monto_cop, 0),
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     v_anticipo, 'cotizacion:' || p_cotizacion_id, 'Anticipo sin identificar', 0, v_monto_cop);

  return 'OK|' || v_pago_id;
exception when unique_violation then
  raise exception 'Clave de idempotencia ya registrada (intento duplicado o colisión): no se duplicó el pago. Reintenta o verifica si ya se confirmó.' using errcode = '23505';
end;
$$;

-- anular_pago_previo (espejo de la 164).
create or replace function public.anular_pago_previo(
  p_pago_id bigint, p_usuario_id uuid, p_motivo text default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text; v_email text; v_estado text; v_monto numeric; v_moneda text;
  v_forma text; v_cotizacion bigint; v_numero bigint; v_caja text; v_anticipo bigint; v_activo_id bigint;
begin
  select tenant, estado, monto_cop, moneda, forma_pago, cotizacion_id
    into v_tenant, v_estado, v_monto, v_moneda, v_forma, v_cotizacion
  from public.cotizacion_pagos_previos where id = p_pago_id for update;
  if v_tenant is null then raise exception 'El pago previo % no existe.', p_pago_id; end if;
  if v_estado <> 'activo' then raise exception 'Solo se puede anular un pago previo ACTIVO (estado actual: %).', v_estado; end if;
  select email into v_email from public.usuarios where id = p_usuario_id;
  select id into v_activo_id from public.asientos_contables
  where tenant = v_tenant and origen = 'pago_previo' and referencia = 'pago_previo:' || p_pago_id
  order by numero desc limit 1;
  if v_activo_id is not null then
    v_numero := public._siguiente_numero_asiento(v_tenant);
    v_caja := public._cuenta_disponible(v_forma, v_moneda);
    v_anticipo := public._puc_id(v_tenant, '280510');
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, current_date,
      'Reversión pago previo ' || p_pago_id || ' — ' || coalesce(nullif(trim(coalesce(p_motivo,'')),''), 'anulación'),
      'pago_previo_reversion', 'pago_previo:' || p_pago_id, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo, 'pago_previo:' || p_pago_id, 'Reversión de anticipo sin identificar', coalesce(v_monto,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       public._puc_id(v_tenant, v_caja), 'pago_previo:' || p_pago_id, 'Reversión de pago previo', 0, coalesce(v_monto,0));
  end if;
  update public.cotizacion_pagos_previos set estado = 'anulado', motivo_anulacion = p_motivo where id = p_pago_id;
  return 'OK';
end;
$$;

-- ACL (espejo): solo service_role ejecuta los RPC de dinero.
revoke all on function public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric) from public, anon, authenticated;
grant execute on function public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric) to service_role;
revoke all on function public.anular_pago_previo(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.anular_pago_previo(bigint, uuid, text) to service_role;

commit;
