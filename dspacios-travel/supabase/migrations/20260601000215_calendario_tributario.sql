-- ============================================================================
-- 215 — Calendario tributario y obligaciones por agencia (#43-1a)
--       Anexo: docs/futuro/anexo-43-1-modulo-contable.md
-- ============================================================================
--
-- ESTA MIGRACION NO ESTA APLICADA. Probada solo en base local desechable con el
-- esquema de main 8987932e (001-213). Numero 215 reservado para #43-1a con
-- autorizacion del dueno (2026-10-17); el Coordinador debe registrarlo.
--
-- Que hace:
--   1. `obligacion_tributaria`: catalogo POR AGENCIA de lo que hay que presentar
--      o pagar (retencion en la fuente, IVA, ICA, renta, exogena, PILA,
--      nomina electronica...). Nombre, periodicidad, regla de digitos del NIT,
--      dias de aviso y si exige pago. Todo se configura desde la UI: aqui no se
--      siembra ninguna obligacion ni ninguna fecha.
--   2. `obligacion_vencimiento`: fechas limite por ano y periodo, para todos
--      (`*`) o por ultimo/ultimos dos digitos del NIT, como publica la DIAN.
--   3. `obligacion_cumplimiento`: constancia de presentada/pagada por periodo.
--   4. Validacion en base: el periodo no puede exceder los de la periodicidad,
--      los digitos deben coincidir con la regla, y no se puede cambiar la
--      periodicidad ni la regla de una obligacion con fechas que quedarian
--      invalidas.
--   5. RLS propia: ver = area contable y administracion (superadmin y gerencia
--      ambas agencias); configurar = superadmin, o gerencia/administracion/
--      admin_contable de su agencia; registrar cumplimiento = lo anterior mas
--      contador. Los roles contables se comparan como texto: la 215 no depende
--      de que la 204 (que los crea en el enum) este aplicada.
--   6. `trg_auditoria` en las tres tablas.
--
-- Que NO hace: no envia nada a la DIAN, no presenta ni paga, no siembra datos,
-- no toca tablas existentes.
--
-- Idempotente. Rollback: supabase/scripts/rollback_215_calendario_tributario.sql
-- Preflight/postcheck (solo lectura): supabase/scripts/{preflight,postcheck}_215_calendario_tributario.sql
-- Prueba local (ROLLBACK): supabase/scripts/test_215_calendario_tributario.sql
-- ============================================================================

begin;

-- === 1. Tablas =============================================================
create table if not exists public.obligacion_tributaria (
  id              bigserial primary key,
  tenant          text not null check (tenant in ('mayorista', 'minorista')),
  nombre          text not null check (btrim(nombre) <> ''),
  periodicidad    text not null
                    check (periodicidad in ('mensual', 'bimestral', 'cuatrimestral', 'semestral', 'anual')),
  -- 0 = misma fecha para todos; 1 = ultimo digito del NIT; 2 = ultimos dos.
  regla_digitos   smallint not null default 1 check (regla_digitos in (0, 1, 2)),
  dias_aviso      smallint not null default 10 check (dias_aviso between 0 and 90),
  -- false = solo se presenta (p. ej. exogena): cumplida al presentarse.
  requiere_pago   boolean not null default true,
  activa          boolean not null default true,
  notas           text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_obligacion_nombre unique (tenant, nombre),
  -- Soporte de las FK compuestas: una fecha o constancia no puede quedar en
  -- otra agencia distinta a la de su obligacion.
  constraint uq_obligacion_id_tenant unique (id, tenant)
);

create table if not exists public.obligacion_vencimiento (
  id             bigserial primary key,
  tenant         text not null,
  obligacion_id  bigint not null,
  anio           smallint not null check (anio between 2000 and 2100),
  periodo        smallint not null check (periodo between 1 and 12),
  digitos        text not null default '*' check (digitos ~ '^(\*|[0-9]|[0-9]{2})$'),
  fecha          date not null,
  constraint fk_vencimiento_obligacion foreign key (obligacion_id, tenant)
    references public.obligacion_tributaria (id, tenant) on delete cascade,
  constraint uq_vencimiento unique (obligacion_id, anio, periodo, digitos)
);

create table if not exists public.obligacion_cumplimiento (
  id               bigserial primary key,
  tenant           text not null,
  obligacion_id    bigint not null,
  anio             smallint not null check (anio between 2000 and 2100),
  periodo          smallint not null check (periodo between 1 and 12),
  presentada_en    date,
  pagada_en        date,
  nota             text,
  actualizado_por  uuid default auth.uid(),
  actualizado_en   timestamptz not null default now(),
  constraint fk_cumplimiento_obligacion foreign key (obligacion_id, tenant)
    references public.obligacion_tributaria (id, tenant) on delete cascade,
  constraint uq_cumplimiento unique (obligacion_id, anio, periodo)
);

create index if not exists idx_obligacion_tenant on public.obligacion_tributaria (tenant, activa);
create index if not exists idx_vencimiento_fecha on public.obligacion_vencimiento (tenant, fecha);
create index if not exists idx_cumplimiento_obligacion on public.obligacion_cumplimiento (obligacion_id, anio);

comment on table public.obligacion_tributaria is
  'Obligaciones tributarias por agencia (#43-1a). Configuradas desde la UI; sin datos sembrados.';
comment on table public.obligacion_vencimiento is
  'Fecha limite por ano/periodo; digitos = * (todos) o ultimo(s) digito(s) del NIT sin DV.';
comment on table public.obligacion_cumplimiento is
  'Constancia de presentacion/pago por periodo. Cumplida = presentada y, si requiere pago, pagada.';

-- === 2. Validacion ==========================================================
create or replace function public.periodos_por_anio(p_periodicidad text)
  returns smallint language sql immutable set search_path = public, pg_temp as $$
  select (case p_periodicidad
    when 'mensual' then 12 when 'bimestral' then 6 when 'cuatrimestral' then 3
    when 'semestral' then 2 when 'anual' then 1 end)::smallint;
$$;

-- Fechas y constancias: el periodo cabe en la periodicidad y los digitos
-- respetan la regla de su obligacion.
create or replace function public._obligacion_validar_fila()
  returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_periodicidad text;
  v_regla smallint;
begin
  select o.periodicidad, o.regla_digitos into v_periodicidad, v_regla
    from public.obligacion_tributaria o
   where o.id = new.obligacion_id and o.tenant = new.tenant;
  if not found then
    raise exception 'OBLIGACION_INEXISTENTE: la obligacion % no existe en la agencia %', new.obligacion_id, new.tenant
      using errcode = '23503';
  end if;
  if new.periodo > public.periodos_por_anio(v_periodicidad) then
    raise exception 'PERIODO_INVALIDO: una obligacion % tiene % periodo(s) por ano y se pidio el %',
      v_periodicidad, public.periodos_por_anio(v_periodicidad), new.periodo using errcode = '23514';
  end if;
  if tg_table_name = 'obligacion_vencimiento' then
    if (v_regla = 0 and new.digitos <> '*')
       or (v_regla = 1 and new.digitos !~ '^[0-9]$')
       or (v_regla = 2 and new.digitos !~ '^[0-9]{2}$') then
      raise exception 'DIGITOS_INVALIDOS: la regla de la obligacion es % y la fecha trae "%"', v_regla, new.digitos
        using errcode = '23514';
    end if;
  else
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;

-- Obligacion: no cambiar periodicidad ni regla si dejaria fechas o constancias
-- invalidas (hay que borrarlas primero, a la vista).
create or replace function public._obligacion_proteger_cambio()
  returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.tenant is distinct from old.tenant then
    raise exception 'TENANT_INMUTABLE: una obligacion no cambia de agencia' using errcode = '23514';
  end if;
  if new.periodicidad is distinct from old.periodicidad then
    if exists (select 1 from public.obligacion_vencimiento v
                where v.obligacion_id = new.id and v.periodo > public.periodos_por_anio(new.periodicidad))
       or exists (select 1 from public.obligacion_cumplimiento c
                   where c.obligacion_id = new.id and c.periodo > public.periodos_por_anio(new.periodicidad)) then
      raise exception 'CAMBIO_BLOQUEADO: hay fechas o constancias con periodos que no caben en "%"; eliminalas primero',
        new.periodicidad using errcode = '23514';
    end if;
  end if;
  if new.regla_digitos is distinct from old.regla_digitos
     and exists (select 1 from public.obligacion_vencimiento v where v.obligacion_id = new.id) then
    raise exception 'CAMBIO_BLOQUEADO: la obligacion ya tiene fechas cargadas con otra regla de digitos; eliminalas primero'
      using errcode = '23514';
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists obligacion_vencimiento_validar on public.obligacion_vencimiento;
create trigger obligacion_vencimiento_validar before insert or update on public.obligacion_vencimiento
  for each row execute function public._obligacion_validar_fila();
drop trigger if exists obligacion_cumplimiento_validar on public.obligacion_cumplimiento;
create trigger obligacion_cumplimiento_validar before insert or update on public.obligacion_cumplimiento
  for each row execute function public._obligacion_validar_fila();
drop trigger if exists obligacion_tributaria_proteger on public.obligacion_tributaria;
create trigger obligacion_tributaria_proteger before update on public.obligacion_tributaria
  for each row execute function public._obligacion_proteger_cambio();

-- === 3. Helpers de RLS =======================================================
-- Ver: area contable y administracion. superadmin y gerencia, ambas agencias.
create or replace function public.calendario_puede_ver(p_tenant text)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    public.mi_rol()::text in ('superadmin', 'gerencia')
    or (public.mi_rol()::text in ('administracion', 'contador', 'revisor_fiscal', 'admin_contable')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Configurar obligaciones y fechas: superadmin, o gerencia/administracion/
-- admin_contable de SU agencia (gerencia ve las dos, pero opera la suya).
create or replace function public.calendario_puede_configurar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('gerencia', 'administracion', 'admin_contable')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Registrar presentada/pagada: quien configura, mas el contador de su agencia.
create or replace function public.calendario_puede_registrar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    public.calendario_puede_configurar(p_tenant)
    or (public.mi_rol()::text = 'contador' and public.mi_tenant() = p_tenant), false);
$$;

revoke all on function public.calendario_puede_ver(text) from public, anon;
revoke all on function public.calendario_puede_configurar(text) from public, anon;
revoke all on function public.calendario_puede_registrar(text) from public, anon;
grant execute on function public.calendario_puede_ver(text) to authenticated;
grant execute on function public.calendario_puede_configurar(text) to authenticated;
grant execute on function public.calendario_puede_registrar(text) to authenticated;

-- === 4. RLS y privilegios ==================================================
alter table public.obligacion_tributaria   enable row level security;
alter table public.obligacion_vencimiento  enable row level security;
alter table public.obligacion_cumplimiento enable row level security;
alter table public.obligacion_tributaria   force row level security;
alter table public.obligacion_vencimiento  force row level security;
alter table public.obligacion_cumplimiento force row level security;

drop policy if exists "obligacion: ver" on public.obligacion_tributaria;
create policy "obligacion: ver" on public.obligacion_tributaria
  for select to authenticated using (public.calendario_puede_ver(tenant));
drop policy if exists "obligacion: configurar" on public.obligacion_tributaria;
create policy "obligacion: configurar" on public.obligacion_tributaria
  for all to authenticated
  using (public.calendario_puede_configurar(tenant))
  with check (public.calendario_puede_configurar(tenant));

drop policy if exists "vencimiento: ver" on public.obligacion_vencimiento;
create policy "vencimiento: ver" on public.obligacion_vencimiento
  for select to authenticated using (public.calendario_puede_ver(tenant));
drop policy if exists "vencimiento: configurar" on public.obligacion_vencimiento;
create policy "vencimiento: configurar" on public.obligacion_vencimiento
  for all to authenticated
  using (public.calendario_puede_configurar(tenant))
  with check (public.calendario_puede_configurar(tenant));

drop policy if exists "cumplimiento: ver" on public.obligacion_cumplimiento;
create policy "cumplimiento: ver" on public.obligacion_cumplimiento
  for select to authenticated using (public.calendario_puede_ver(tenant));
drop policy if exists "cumplimiento: registrar" on public.obligacion_cumplimiento;
create policy "cumplimiento: registrar" on public.obligacion_cumplimiento
  for all to authenticated
  using (public.calendario_puede_registrar(tenant))
  with check (public.calendario_puede_registrar(tenant));

revoke all on public.obligacion_tributaria, public.obligacion_vencimiento, public.obligacion_cumplimiento
  from public, anon;
grant select, insert, update, delete
  on public.obligacion_tributaria, public.obligacion_vencimiento, public.obligacion_cumplimiento
  to authenticated;
revoke truncate
  on public.obligacion_tributaria, public.obligacion_vencimiento, public.obligacion_cumplimiento
  from authenticated, anon;
revoke all on sequence public.obligacion_tributaria_id_seq, public.obligacion_vencimiento_id_seq,
  public.obligacion_cumplimiento_id_seq from public, anon;
grant usage on sequence public.obligacion_tributaria_id_seq, public.obligacion_vencimiento_id_seq,
  public.obligacion_cumplimiento_id_seq to authenticated;

-- === 5. Auditoria ==========================================================
-- El DO loop de la 087 solo corrio una vez: una tabla nueva nace sin el trigger.
do $$
declare t text;
begin
  foreach t in array array['obligacion_tributaria', 'obligacion_vencimiento', 'obligacion_cumplimiento'] loop
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                      for each row execute function public.fn_auditoria()', t);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
