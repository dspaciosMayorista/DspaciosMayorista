-- ───────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 214 · Registro central de personas e identidad documental (#32)
--
-- Número reservado por el Coordinador (WORKSTREAMS.md; GO solo local). Contrato de diseño:
-- docs/tecnico/personas-identidad.md (v3 aprobada por Auditorías, con dos ajustes: base NIT de
-- 3 a 20 caracteres y variantes acotadas en la consulta).
-- Scripts: supabase/scripts/{preflight,postcheck,rollback,test}_214_personas_identidad.sql y
--          supabase/scripts/test_214_personas_carreras.sh.
--
-- QUÉ CREA
--   · Esquema privado `p214_priv` (fuera de PostgREST): gramática documental, filtro de
--     visibilidad, disparadores y escritores. USAGE solo para `service_role`.
--   · `public.personas`: UNA identidad documental por (tenant, tipo_doc, numero_norm). Las
--     columnas tipo_doc / numero_norm / estado_doc / motivo_revision son GENERADAS desde los
--     originales y la marca NIT (columnas base), nunca desde otra generada.
--   · `public.persona_capturas`: una captura concreta. Su `id` lo aporta el escritor y se
--     repite en cada reintento del mismo evento; guarda fuente, nivel, origen tipado, el
--     documento que afirmó esa captura, actor y fecha. Append-only.
--   · `public.persona_observaciones`: pares (campo, valor) de UNA captura. Append-only.
--   · `public.buscar_personas_documento(...)`: ÚNICA lectura. SECURITY DEFINER, búsqueda
--     exacta, como máximo 50 observaciones por página y variantes acotadas (10 valores por
--     campo, sin procedencia detallada; la procedencia sale solo en la página).
--
-- QUÉ NO HACE
--   · No toca 042/047/154/187/202/207, cotizaciones, crm_contactos ni crm_leads.
--   · No importa históricos ni hace backfill: las tablas nacen vacías.
--   · No abre las tablas a la app: sin GRANT a anon/authenticated y RLS sin policies.
--   · No implementa #42 (fuente `cotizacion`, vínculos): ver 3.6 del documento técnico.
--   · No usa `mi_rol()`, `mi_tenant()`, `puede_ver_tenant()` ni `soy_asesor_del_contrato()`.
--
-- ORDEN (todo lo remoto lo ejecuta el usuario, con autorización separada)
--   1. preflight_214_personas_identidad.sql — solo lectura; con el MISMO rol que aplicará esto.
--   2. esta migración.
--   3. postcheck_214_personas_identidad.sql — solo lectura.
-- Idempotente: re-ejecutarla no duplica objetos ni cambia datos.
-- Rollback (solo con las tres tablas vacías y sin dependencias ajenas):
--   supabase/scripts/rollback_214_personas_identidad.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 0) Guardas: el esquema y los roles que esta migración asume.
do $$
declare
  v_falta text;
begin
  if to_regclass('public.usuarios') is null or to_regclass('public.ventas') is null
     or to_regclass('public.contrato_pasajeros') is null then
    raise exception '214 ABORTADA: faltan public.usuarios, public.ventas o public.contrato_pasajeros.';
  end if;
  if to_regprocedure('public.soy_ese_asesor(text)') is null or to_regprocedure('auth.uid()') is null then
    raise exception '214 ABORTADA: faltan public.soy_ese_asesor(text) (142) o auth.uid().';
  end if;
  select string_agg(c, ', ') into v_falta
    from unnest(array['usuarios.id', 'usuarios.rol', 'usuarios.activo', 'usuarios.tenant', 'usuarios.nombre',
                      'ventas.numero_contrato', 'ventas.tenant', 'ventas.asesor',
                      'contrato_pasajeros.id', 'contrato_pasajeros.numero_contrato']) c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.' || split_part(c, '.', 1))
                        and a.attname = split_part(c, '.', 2) and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null then
    raise exception '214 ABORTADA: faltan columnas: %', v_falta;
  end if;
  select string_agg(r, ', ') into v_falta
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not exists (select 1 from pg_roles where rolname = r);
  if v_falta is not null then
    raise exception '214 ABORTADA: faltan los roles: %', v_falta;
  end if;
  -- La consulta es SECURITY DEFINER y lee `usuarios` y `ventas` como su dueño (el rol que aplica
  -- esta migración). Si ese rol no puede saltarse la RLS de esas tablas, la consulta devolvería
  -- vacío a todos en silencio: se aborta antes.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))
     and (select pg_get_userbyid(relowner) from pg_class where oid = 'public.usuarios'::regclass) <> current_user
  then
    raise exception '214 ABORTADA: el rol % no puede leer public.usuarios sin RLS (ni BYPASSRLS ni dueño).', current_user;
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))
     and (select pg_get_userbyid(relowner) from pg_class where oid = 'public.ventas'::regclass) <> current_user
  then
    raise exception '214 ABORTADA: el rol % no puede leer public.ventas sin RLS (ni BYPASSRLS ni dueño).', current_user;
  end if;
end $$;

-- 1) Esquema privado.
create schema if not exists p214_priv;
comment on schema p214_priv is
  '214 (#32): gramática documental, visibilidad, disparadores y escritores del registro central de personas. No exponer en PostgREST.';

-- 2) Gramática (documento técnico, sección 2). Misma lógica que lib/personas/identidad.ts;
--    la equivalencia la prueban los vectores de pruebas/fixtures/personasIdentidad.vectores.json.
--    Solo rangos ASCII con COLLATE "C"; ni upper/lower, ni clases POSIX, ni normalización Unicode.
create or replace function p214_priv.norm_documento(
  p_tipo text,
  p_numero text,
  p_nit_dv_estructurado boolean,
  p_modo text,
  out tipo_doc text,
  out numero_norm text,
  out estado text,
  out motivo text)
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_t text;
  v_n text;
  v_c text;
  v_tipo_ausente boolean;
begin
  if p_modo is null or p_modo not in ('alta', 'consulta') then
    raise exception 'norm_documento: modo invalido' using errcode = '22023';
  end if;
  if p_modo = 'alta' and p_nit_dv_estructurado is null then
    raise exception 'norm_documento: en modo alta la marca NIT es obligatoria' using errcode = '22023';
  end if;
  if p_modo = 'consulta' and p_nit_dv_estructurado is not null then
    raise exception 'norm_documento: en modo consulta la marca NIT debe ser nula' using errcode = '22023';
  end if;

  tipo_doc := null;
  numero_norm := null;
  estado := null;
  motivo := null;

  -- R1: solo espacios ASCII U+0020 de los bordes.
  v_t := btrim(p_tipo, ' ');
  v_n := btrim(p_numero, ' ');

  -- R2: tipo ausente, presente inválido o del catálogo (validar ANTES de pasar a mayúsculas).
  v_tipo_ausente := v_t is null or v_t = '';
  if not v_tipo_ausente then
    if not (v_t collate "C" ~ '^[A-Za-z]+$') then
      estado := 'revision';
      motivo := 'tipo_invalido';
      return;
    end if;
    v_t := translate(v_t, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    if v_t not in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then
      estado := 'revision';
      motivo := 'tipo_invalido';
      return;
    end if;
    tipo_doc := v_t;
  end if;

  if v_tipo_ausente or v_n is null or v_n = '' then
    estado := 'provisional';
    return;
  end if;

  -- R3: alfabeto ASCII; espacio y punto solo como separadores entre grupos.
  if not (v_n collate "C" ~ '^[A-Za-z0-9]+([ .][A-Za-z0-9]+)*$') then
    estado := 'revision';
    motivo := 'numero_invalido';
    return;
  end if;
  v_c := translate(v_n, ' .', '');

  -- R4: 3 a 20 caracteres (también la base de un NIT) y solo dígitos en los tipos numéricos.
  if char_length(v_c) < 3 or char_length(v_c) > 20 then
    estado := 'revision';
    motivo := 'numero_invalido';
    return;
  end if;
  if tipo_doc in ('CC', 'CE', 'TI', 'RC', 'NIT') and not (v_c collate "C" ~ '^[0-9]+$') then
    estado := 'revision';
    motivo := 'numero_invalido';
    return;
  end if;

  -- 2.3 regla 4: un NIT de alta sin DV estructurado válido queda en revisión (sin recortar).
  if p_modo = 'alta' and tipo_doc = 'NIT' and not p_nit_dv_estructurado then
    estado := 'revision';
    motivo := 'nit_sin_dv_estructurado';
    return;
  end if;

  -- R5: sin separadores, minúsculas ASCII, ceros iniciales intactos.
  numero_norm := translate(v_c, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  estado := 'documentada';
end;
$$;

comment on function p214_priv.norm_documento(text, text, boolean, text) is
  '214: gramática única (alta/consulta). Entradas: originales y marca NIT. Salidas: tipo_doc, numero_norm, estado, motivo. Equivalente a normalizarDocumento de lib/personas/identidad.ts (vectores compartidos).';

create or replace function p214_priv.dv_nit_valido(p_dv text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_dv is not null and (btrim(p_dv, ' ') collate "C" ~ '^[0-9]$')
$$;

comment on function p214_priv.dv_nit_valido(text) is
  '214: DV de NIT estructurado = un dígito ASCII tras quitar espacios ASCII de los bordes. Sin algoritmo DIAN (diferido).';

-- 3) Tablas.
create table if not exists public.personas (
  id                  uuid primary key default gen_random_uuid(),
  tenant              text not null check (tenant in ('mayorista', 'minorista')),
  tipo_doc_original   text null check (tipo_doc_original is null or char_length(tipo_doc_original) <= 64),
  documento_original  text null check (documento_original is null or char_length(documento_original) <= 64),
  nit_dv_estructurado boolean not null default false,
  tipo_doc        text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).tipo_doc)    stored,
  numero_norm     text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).numero_norm) stored,
  estado_doc      text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).estado)      stored,
  motivo_revision text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).motivo)      stored,
  clave_alta      uuid null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint personas_id_tenant_uk unique (id, tenant),
  constraint personas_nit_dv_estructurado_ck
    check (nit_dv_estructurado = false or (tipo_doc is not null and tipo_doc = 'NIT'))
);

comment on table public.personas is
  '214 (#32): identidad documental central. Una fila documentada por (tenant, tipo_doc, numero_norm); provisionales y en revisión no se deduplican. Sin datos de contacto: esos son observaciones con procedencia. NO adjuntar trg_auditoria (087): copiaría PII a auditoria sin el filtro de la consulta; excluir de cualquier auditoría global.';
comment on column public.personas.clave_alta is
  'Id de la captura que creó una ficha NO documentada (idempotencia del alta). NULL en las que nacieron documentadas.';
comment on column public.personas.nit_dv_estructurado is
  'La captura que fijó los originales trajo base y DV válido por separado. El DV en sí es una observación (campo nit_dv).';

create unique index if not exists uq_personas_clave_documentada
  on public.personas (tenant, tipo_doc, numero_norm)
  where estado_doc = 'documentada';

create unique index if not exists uq_personas_clave_alta
  on public.personas (tenant, clave_alta)
  where clave_alta is not null;

create table if not exists public.persona_capturas (
  id                   uuid primary key,
  persona_id           uuid not null,
  tenant               text not null,
  fuente               text not null check (fuente in ('captura_interna', 'contrato_pasajero')),
  nivel                text not null check (nivel in ('comercial', 'pasajero_contrato')),
  tipo_doc_capturado   text null check (tipo_doc_capturado is null or char_length(tipo_doc_capturado) <= 64),
  documento_capturado  text null check (documento_capturado is null or char_length(documento_capturado) <= 64),
  contrato_numero      text null,
  contrato_pasajero_id bigint null,
  actor_id             uuid null,
  actor_rol            text null,
  created_at           timestamptz not null default now(),
  constraint persona_capturas_persona_fk
    foreign key (persona_id, tenant) references public.personas (id, tenant),
  constraint persona_capturas_id_persona_tenant_uk unique (id, persona_id, tenant),
  constraint persona_capturas_fuente_ck check (
       (fuente = 'captura_interna'   and contrato_numero is null     and contrato_pasajero_id is null)
    or (fuente = 'contrato_pasajero' and contrato_numero is not null and contrato_pasajero_id is not null)),
  constraint persona_capturas_nivel_ck
    check ((fuente = 'contrato_pasajero') = (nivel = 'pasajero_contrato')),
  constraint persona_capturas_contrato_numero_ck
    check (contrato_numero is null or (contrato_numero <> '' and contrato_numero = btrim(contrato_numero, ' ')))
);

comment on table public.persona_capturas is
  '214 (#32): una captura concreta (id estable del escritor) con su procedencia y origen tipado por fuente. Append-only. NO adjuntar trg_auditoria (087): copiaría PII a auditoria sin el filtro de la consulta; excluir de cualquier auditoría global.';

create index if not exists idx_persona_capturas_persona on public.persona_capturas (persona_id);

create table if not exists public.persona_observaciones (
  id          uuid primary key default gen_random_uuid(),
  captura_id  uuid not null,
  persona_id  uuid not null,
  tenant      text not null,
  campo       text not null check (campo in ('nombres', 'apellidos', 'fecha_nacimiento', 'nacionalidad', 'telefono', 'email', 'nit_dv')),
  valor       text not null check (char_length(valor) between 1 and 200),
  created_at  timestamptz not null default now(),
  constraint persona_observaciones_captura_fk
    foreign key (captura_id, persona_id, tenant) references public.persona_capturas (id, persona_id, tenant),
  constraint persona_observaciones_nit_dv_ck check (campo <> 'nit_dv' or valor collate "C" ~ '^[0-9]$'),
  constraint persona_observaciones_idem_uk unique (captura_id, campo, valor)
);

comment on table public.persona_observaciones is
  '214 (#32): pares (campo, valor) aportados por UNA captura. Append-only; dos capturas nunca se fusionan. NO adjuntar trg_auditoria (087): copiaría PII a auditoria sin el filtro de la consulta; excluir de cualquier auditoría global.';

create index if not exists idx_persona_observaciones_persona on public.persona_observaciones (persona_id, tenant);

-- 4) Disparadores.
create or replace function p214_priv.trg_personas_guardas()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id is distinct from old.id or new.tenant is distinct from old.tenant or new.clave_alta is distinct from old.clave_alta then
    raise exception 'personas: id, tenant y clave_alta no se cambian' using errcode = '23514';
  end if;
  if old.estado_doc = 'documentada'
     and (new.tipo_doc_original is distinct from old.tipo_doc_original
          or new.documento_original is distinct from old.documento_original
          or new.nit_dv_estructurado is distinct from old.nit_dv_estructurado) then
    raise exception 'personas: la clave de una ficha documentada es inmutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function p214_priv.trg_solo_insercion()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '%: solo admite inserciones (% bloqueado)', tg_table_name, tg_op using errcode = '23514';
end;
$$;

create or replace function p214_priv.trg_captura_contrato_pasajero()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.fuente = 'contrato_pasajero' and not exists (
       select 1
         from public.contrato_pasajeros cp
         join public.ventas v on v.numero_contrato = cp.numero_contrato
        where cp.id = new.contrato_pasajero_id
          and cp.numero_contrato = new.contrato_numero
          and v.tenant = new.tenant) then
    raise exception 'persona_capturas: el pasajero no pertenece a ese contrato de esa agencia' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function p214_priv.trg_personas_nit_dv_observado()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.nit_dv_estructurado and not exists (
       select 1 from public.persona_observaciones o
        where o.persona_id = new.id and o.campo = 'nit_dv') then
    raise exception 'personas: nit_dv_estructurado sin observación nit_dv' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_personas_guardas on public.personas;
create trigger trg_personas_guardas
  before update on public.personas
  for each row execute function p214_priv.trg_personas_guardas();

drop trigger if exists trg_personas_sin_borrado on public.personas;
create trigger trg_personas_sin_borrado
  before delete on public.personas
  for each row execute function p214_priv.trg_solo_insercion();

drop trigger if exists trg_personas_sin_truncate on public.personas;
create trigger trg_personas_sin_truncate
  before truncate on public.personas
  for each statement execute function p214_priv.trg_solo_insercion();

drop trigger if exists personas_nit_dv_observado on public.personas;
create constraint trigger personas_nit_dv_observado
  after insert or update of nit_dv_estructurado on public.personas
  deferrable initially deferred
  for each row execute function p214_priv.trg_personas_nit_dv_observado();

drop trigger if exists trg_persona_capturas_contrato on public.persona_capturas;
create trigger trg_persona_capturas_contrato
  before insert on public.persona_capturas
  for each row execute function p214_priv.trg_captura_contrato_pasajero();

drop trigger if exists trg_persona_capturas_solo_insercion on public.persona_capturas;
create trigger trg_persona_capturas_solo_insercion
  before update or delete on public.persona_capturas
  for each row execute function p214_priv.trg_solo_insercion();

drop trigger if exists trg_persona_capturas_sin_truncate on public.persona_capturas;
create trigger trg_persona_capturas_sin_truncate
  before truncate on public.persona_capturas
  for each statement execute function p214_priv.trg_solo_insercion();

drop trigger if exists trg_persona_observaciones_solo_insercion on public.persona_observaciones;
create trigger trg_persona_observaciones_solo_insercion
  before update or delete on public.persona_observaciones
  for each row execute function p214_priv.trg_solo_insercion();

drop trigger if exists trg_persona_observaciones_sin_truncate on public.persona_observaciones;
create trigger trg_persona_observaciones_sin_truncate
  before truncate on public.persona_observaciones
  for each statement execute function p214_priv.trg_solo_insercion();

-- 5) Visibilidad de una captura (1.3 y 1.3.1). Número, tenant y asesor sobre la MISMA fila de
--    `ventas`; nunca `soy_asesor_del_contrato`, que busca el número en todas las agencias.
create or replace function p214_priv.captura_visible(
  p_captura_tenant text,
  p_fuente text,
  p_contrato_numero text,
  p_t_aut text,
  p_rol text)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p_captura_tenant = p_t_aut
     and case p_fuente
           when 'captura_interna' then true
           when 'contrato_pasajero' then exists (
             select 1
               from public.ventas v
              where v.numero_contrato = p_contrato_numero
                and v.tenant = p_captura_tenant
                and v.tenant = p_t_aut
                and (p_rol <> 'venta' or public.soy_ese_asesor(v.asesor)))
           else false
         end
$$;

-- 6) Escritores privados (solo `service_role`). Errores: 22023 entrada inválida; 25000
--    aislamiento; P0001 conflicto de idempotencia. Nunca sobrescriben ni fusionan.
create or replace function p214_priv.exigir_read_committed()
returns void
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'aislamiento_no_admitido' using errcode = '25000',
      detail = 'Las escrituras del registro de personas exigen READ COMMITTED.';
  end if;
end;
$$;

create or replace function p214_priv.validar_entrada_captura(
  p_captura_id uuid,
  p_tenant text,
  p_fuente text,
  p_tipo text,
  p_numero text,
  p_contrato_numero text,
  p_contrato_pasajero_id bigint)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_captura_id is null then
    raise exception 'captura_id_obligatorio' using errcode = '22023';
  end if;
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
    raise exception 'tenant_invalido' using errcode = '22023';
  end if;
  if p_fuente is null or p_fuente not in ('captura_interna', 'contrato_pasajero') then
    raise exception 'fuente_invalida' using errcode = '22023';
  end if;
  if (p_tipo is not null and char_length(p_tipo) > 64) or (p_numero is not null and char_length(p_numero) > 64) then
    raise exception 'original_demasiado_largo' using errcode = '22023',
      detail = 'Un original admite hasta 64 puntos de código; no se trunca.';
  end if;
  if (p_fuente = 'captura_interna' and (p_contrato_numero is not null or p_contrato_pasajero_id is not null))
     or (p_fuente = 'contrato_pasajero' and (p_contrato_numero is null or p_contrato_pasajero_id is null)) then
    raise exception 'origen_invalido' using errcode = '22023',
      detail = 'captura_interna no lleva contrato; contrato_pasajero exige contrato y pasajero.';
  end if;
end;
$$;

create or replace function p214_priv.observaciones_de_entrada(p_observaciones jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_elem jsonb;
  v_campo text;
  v_valor text;
  v_salida jsonb;
begin
  if p_observaciones is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_observaciones) <> 'array' then
    raise exception 'observaciones_invalidas' using errcode = '22023',
      detail = 'p_observaciones debe ser un arreglo JSON de objetos {campo, valor}.';
  end if;
  for v_elem in select x.value from jsonb_array_elements(p_observaciones) x loop
    if jsonb_typeof(v_elem) <> 'object'
       or jsonb_typeof(v_elem -> 'campo') is distinct from 'string'
       or jsonb_typeof(v_elem -> 'valor') is distinct from 'string' then
      raise exception 'observaciones_invalidas' using errcode = '22023',
        detail = 'Cada observación es un objeto {campo, valor} con textos.';
    end if;
    v_campo := v_elem ->> 'campo';
    v_valor := v_elem ->> 'valor';
    if v_campo not in ('nombres', 'apellidos', 'fecha_nacimiento', 'nacionalidad', 'telefono', 'email') then
      raise exception 'observaciones_invalidas' using errcode = '22023',
        detail = 'Campo no admitido. El DV del NIT va por p_nit_dv, nunca en p_observaciones.';
    end if;
    if char_length(v_valor) < 1 or char_length(v_valor) > 200 then
      raise exception 'observaciones_invalidas' using errcode = '22023',
        detail = 'Cada valor tiene de 1 a 200 caracteres.';
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_array(d.c, d.v) order by d.c collate "C", d.v collate "C"), '[]'::jsonb)
    into v_salida
    from (select distinct x.value ->> 'campo' as c, x.value ->> 'valor' as v
            from jsonb_array_elements(p_observaciones) x) d;
  return v_salida;
end;
$$;

create or replace function p214_priv.carga_esperada(p_observaciones jsonb, p_dv text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(s.x order by (s.x ->> 0) collate "C", (s.x ->> 1) collate "C"), '[]'::jsonb)
    from (select e.value as x from jsonb_array_elements(coalesce(p_observaciones, '[]'::jsonb)) e
          union all
          select jsonb_build_array('nit_dv', p_dv) where p_dv is not null) s
$$;

-- Valida el DV ANTES de marcar la captura como estructurada (2.3, pasos 1-4).
create or replace function p214_priv.marca_nit(p_tipo text, p_numero text, p_nit_dv text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tipo text;
begin
  if p_nit_dv is null then
    return false;
  end if;
  v_tipo := (p214_priv.norm_documento(p_tipo, p_numero, false, 'alta')).tipo_doc;
  if v_tipo is distinct from 'NIT' then
    raise exception 'nit_dv_sin_nit' using errcode = '22023', detail = 'Solo un NIT lleva DV.';
  end if;
  if not p214_priv.dv_nit_valido(p_nit_dv) then
    raise exception 'nit_dv_invalido' using errcode = '22023', detail = 'El DV es un único dígito.';
  end if;
  return true;
end;
$$;

create or replace function p214_priv.captura_coincide(
  p_captura_id uuid,
  p_persona_id uuid,
  p_tenant text,
  p_fuente text,
  p_nivel text,
  p_tipo text,
  p_numero text,
  p_contrato_numero text,
  p_contrato_pasajero_id bigint,
  p_esperadas jsonb)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((
    select (p_persona_id is null or c.persona_id = p_persona_id)
       and c.tenant = p_tenant
       and c.fuente = p_fuente
       and c.nivel = p_nivel
       and c.tipo_doc_capturado is not distinct from p_tipo
       and c.documento_capturado is not distinct from p_numero
       and c.contrato_numero is not distinct from p_contrato_numero
       and c.contrato_pasajero_id is not distinct from p_contrato_pasajero_id
       and (select coalesce(jsonb_agg(jsonb_build_array(o.campo, o.valor) order by o.campo collate "C", o.valor collate "C"), '[]'::jsonb)
              from public.persona_observaciones o
             where o.captura_id = c.id) = p_esperadas
      from public.persona_capturas c
     where c.id = p_captura_id), false)
$$;

create or replace function p214_priv.upsert_persona(
  p_captura_id uuid,
  p_tenant text,
  p_fuente text,
  p_tipo text,
  p_numero text,
  p_nit_dv text default null,
  p_observaciones jsonb default '[]'::jsonb,
  p_contrato_numero text default null,
  p_contrato_pasajero_id bigint default null,
  p_actor_id uuid default null,
  p_actor_rol text default null,
  out persona_id uuid,
  out resultado text)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_marca boolean;
  v_norm record;
  v_nivel text;
  v_obs jsonb;
  v_dv text;
  v_esperadas jsonb;
  v_cap record;
  v_cap_id uuid;
  v_ficha record;
  v_persona uuid;
  v_resultado text;
  v_intento integer;
begin
  perform p214_priv.exigir_read_committed();
  perform p214_priv.validar_entrada_captura(p_captura_id, p_tenant, p_fuente, p_tipo, p_numero,
                                            p_contrato_numero, p_contrato_pasajero_id);
  v_obs := p214_priv.observaciones_de_entrada(p_observaciones);
  v_marca := p214_priv.marca_nit(p_tipo, p_numero, p_nit_dv);
  v_dv := case when v_marca then btrim(p_nit_dv, ' ') end;
  v_nivel := case when p_fuente = 'contrato_pasajero' then 'pasajero_contrato' else 'comercial' end;
  v_esperadas := p214_priv.carga_esperada(v_obs, v_dv);

  -- Reintento del MISMO evento: la captura ya existe. Misma carga = mismo resultado, sin escribir.
  select c.* into v_cap from public.persona_capturas c where c.id = p_captura_id;
  if found then
    if p214_priv.captura_coincide(p_captura_id, null, p_tenant, p_fuente, v_nivel, p_tipo, p_numero,
                                  p_contrato_numero, p_contrato_pasajero_id, v_esperadas) then
      persona_id := v_cap.persona_id;
      resultado := 'reintento';
      return;
    end if;
    raise exception 'captura_inconsistente' using errcode = 'P0001',
      detail = 'Ese id de captura ya existe con otro contenido; no se sobrescribe ni se mezcla.';
  end if;

  select n.* into v_norm from p214_priv.norm_documento(p_tipo, p_numero, v_marca, 'alta') n;

  v_persona := null;
  for v_intento in 1..2 loop
    if v_norm.estado = 'documentada' then
      insert into public.personas as p (tenant, tipo_doc_original, documento_original, nit_dv_estructurado)
      values (p_tenant, p_tipo, p_numero, v_marca)
      on conflict (tenant, tipo_doc, numero_norm) where estado_doc = 'documentada' do nothing
      returning p.id into v_persona;
      if v_persona is not null then
        v_resultado := 'creada';
        exit;
      end if;
      -- Conflicto contra una fila ya confirmada: relectura en una sentencia nueva (READ COMMITTED).
      select p.id into v_persona
        from public.personas p
       where p.tenant = p_tenant and p.estado_doc = 'documentada'
         and p.tipo_doc = v_norm.tipo_doc and p.numero_norm = v_norm.numero_norm;
      if v_persona is not null then
        v_resultado := 'existente';
        exit;
      end if;
    else
      insert into public.personas as p (tenant, tipo_doc_original, documento_original, nit_dv_estructurado, clave_alta)
      values (p_tenant, p_tipo, p_numero, v_marca, p_captura_id)
      on conflict (tenant, clave_alta) where clave_alta is not null do nothing
      returning p.id into v_persona;
      if v_persona is not null then
        v_resultado := 'creada';
        exit;
      end if;
      select p.id, p.tipo_doc_original, p.documento_original, p.nit_dv_estructurado into v_ficha
        from public.personas p
       where p.tenant = p_tenant and p.clave_alta = p_captura_id;
      if found then
        if v_ficha.tipo_doc_original is not distinct from p_tipo
           and v_ficha.documento_original is not distinct from p_numero
           and v_ficha.nit_dv_estructurado = v_marca then
          v_persona := v_ficha.id;
          v_resultado := 'existente';
          exit;
        end if;
        raise exception 'clave_alta_reutilizada' using errcode = 'P0001',
          detail = 'Esa clave de alta ya creó una ficha con otros originales; no se sobrescribe.';
      end if;
    end if;
  end loop;
  if v_persona is null then
    raise exception 'alta_inconsistente' using errcode = 'P0001',
      detail = 'La relectura no encontró la ficha en conflicto; no se dio nada por creado.';
  end if;

  insert into public.persona_capturas as c (id, persona_id, tenant, fuente, nivel, tipo_doc_capturado,
                                            documento_capturado, contrato_numero, contrato_pasajero_id,
                                            actor_id, actor_rol)
  values (p_captura_id, v_persona, p_tenant, p_fuente, v_nivel, p_tipo, p_numero, p_contrato_numero,
          p_contrato_pasajero_id, p_actor_id, p_actor_rol)
  on conflict (id) do nothing
  returning c.id into v_cap_id;
  if v_cap_id is null then
    -- Otra transacción registró el MISMO evento y ya confirmó (este INSERT la esperó).
    if p214_priv.captura_coincide(p_captura_id, v_persona, p_tenant, p_fuente, v_nivel, p_tipo, p_numero,
                                  p_contrato_numero, p_contrato_pasajero_id, v_esperadas) then
      persona_id := v_persona;
      resultado := 'reintento';
      return;
    end if;
    raise exception 'captura_inconsistente' using errcode = 'P0001',
      detail = 'Ese id de captura se registró a la vez con otro contenido.';
  end if;

  insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor)
  select p_captura_id, v_persona, p_tenant, e.value ->> 0, e.value ->> 1
    from jsonb_array_elements(v_esperadas) e
  on conflict (captura_id, campo, valor) do nothing;

  persona_id := v_persona;
  resultado := v_resultado;
end;
$$;

comment on function p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text) is
  '214: alta idempotente por id de captura (READ COMMITTED). Resultado: creada | existente | reintento. Errores: 22023 entrada, 25000 aislamiento, P0001 captura_inconsistente / clave_alta_reutilizada / alta_inconsistente.';

create or replace function p214_priv.promover_persona(
  p_persona_id uuid,
  p_captura_id uuid,
  p_tipo text,
  p_numero text,
  p_nit_dv text default null,
  p_observaciones jsonb default '[]'::jsonb,
  p_fuente text default 'captura_interna',
  p_contrato_numero text default null,
  p_contrato_pasajero_id bigint default null,
  p_actor_id uuid default null,
  p_actor_rol text default null,
  out persona_id uuid,
  out resultado text)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ficha record;
  v_marca boolean;
  v_norm record;
  v_nivel text;
  v_obs jsonb;
  v_dv text;
  v_esperadas jsonb;
  v_cap_id uuid;
  v_restriccion text;
  v_ganadora uuid;
begin
  perform p214_priv.exigir_read_committed();
  if p_persona_id is null then
    raise exception 'persona_inexistente' using errcode = '22023';
  end if;
  -- Serializa dos promociones de la MISMA ficha: la segunda espera y relee la fila ya cambiada.
  select p.* into v_ficha from public.personas p where p.id = p_persona_id for update;
  if not found then
    raise exception 'persona_inexistente' using errcode = '22023';
  end if;
  perform p214_priv.validar_entrada_captura(p_captura_id, v_ficha.tenant, p_fuente, p_tipo, p_numero,
                                            p_contrato_numero, p_contrato_pasajero_id);
  v_obs := p214_priv.observaciones_de_entrada(p_observaciones);
  v_marca := p214_priv.marca_nit(p_tipo, p_numero, p_nit_dv);
  v_dv := case when v_marca then btrim(p_nit_dv, ' ') end;
  v_nivel := case when p_fuente = 'contrato_pasajero' then 'pasajero_contrato' else 'comercial' end;
  v_esperadas := p214_priv.carga_esperada(v_obs, v_dv);

  select n.* into v_norm from p214_priv.norm_documento(p_tipo, p_numero, v_marca, 'alta') n;
  if v_norm.estado is distinct from 'documentada' then
    raise exception 'destino_no_documentable' using errcode = '22023',
      detail = 'El documento de destino no forma una identidad documentada.';
  end if;

  if exists (select 1 from public.persona_capturas c where c.id = p_captura_id) then
    if p214_priv.captura_coincide(p_captura_id, p_persona_id, v_ficha.tenant, p_fuente, v_nivel, p_tipo, p_numero,
                                  p_contrato_numero, p_contrato_pasajero_id, v_esperadas) then
      persona_id := p_persona_id;
      resultado := 'reintento';
      return;
    end if;
    raise exception 'captura_inconsistente' using errcode = 'P0001',
      detail = 'Ese id de captura ya existe con otro contenido.';
  end if;

  if v_ficha.estado_doc = 'documentada' then
    persona_id := p_persona_id;
    resultado := case when v_ficha.tipo_doc = v_norm.tipo_doc and v_ficha.numero_norm = v_norm.numero_norm
                      then 'ya_documentada' else 'clave_distinta' end;
    return;
  end if;

  begin
    update public.personas p
       set tipo_doc_original = p_tipo,
           documento_original = p_numero,
           nit_dv_estructurado = v_marca
     where p.id = p_persona_id;

    insert into public.persona_capturas as c (id, persona_id, tenant, fuente, nivel, tipo_doc_capturado,
                                              documento_capturado, contrato_numero, contrato_pasajero_id,
                                              actor_id, actor_rol)
    values (p_captura_id, p_persona_id, v_ficha.tenant, p_fuente, v_nivel, p_tipo, p_numero,
            p_contrato_numero, p_contrato_pasajero_id, p_actor_id, p_actor_rol)
    on conflict (id) do nothing
    returning c.id into v_cap_id;
    if v_cap_id is null then
      raise exception 'captura_inconsistente' using errcode = 'P0001',
        detail = 'Ese id de captura se registró a la vez por otro proceso.';
    end if;

    insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor)
    select p_captura_id, p_persona_id, v_ficha.tenant, e.value ->> 0, e.value ->> 1
      from jsonb_array_elements(v_esperadas) e
    on conflict (captura_id, campo, valor) do nothing;

    persona_id := p_persona_id;
    resultado := 'promovida';
  exception when unique_violation then
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion is distinct from 'uq_personas_clave_documentada' then
      raise;
    end if;
    -- Se revirtió solo este sub-bloque: la ficha queda intacta y no se fusiona nada.
    select p.id into v_ganadora
      from public.personas p
     where p.tenant = v_ficha.tenant and p.estado_doc = 'documentada'
       and p.tipo_doc = v_norm.tipo_doc and p.numero_norm = v_norm.numero_norm;
    persona_id := v_ganadora;
    resultado := 'conflicto';
  end;
end;
$$;

comment on function p214_priv.promover_persona(uuid, uuid, text, text, text, jsonb, text, text, bigint, uuid, text) is
  '214: promueve una ficha provisional o en revisión a documentada con una captura nueva. Resultado: promovida | ya_documentada | clave_distinta | conflicto | reintento. Nunca fusiona.';

-- 7) Consulta: ÚNICA superficie de lectura (1.3, 1.3.2 y 1.4 del documento técnico).
create or replace function public.buscar_personas_documento(
  p_tenant text,
  p_tipo_doc text,
  p_numero text,
  p_limite integer default 20,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_vacio constant jsonb := jsonb_build_object(
    'persona', null, 'observaciones', '[]'::jsonb, 'total', 0,
    'has_more', false, 'divergencia', false, 'variantes', '[]'::jsonb);
  v_uid uuid;
  v_rol text;
  v_tenant_usuario text;
  v_t_aut text;
  v_norm record;
  v_persona record;
  v_total integer;
  v_filas integer;
  v_pagina jsonb;
  v_variantes jsonb;
  v_divergencia boolean;
begin
  -- 0. Parámetros: el error depende solo de ellos, no de los datos.
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'limite_invalido' using errcode = '22023', detail = 'p_limite debe estar entre 1 y 50.';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'offset_invalido' using errcode = '22023', detail = 'p_offset debe ser 0 o mayor.';
  end if;

  -- 1. Actor activo, rol y tenant, leídos de `usuarios` dentro de la función.
  v_uid := auth.uid();
  if v_uid is null then
    return c_vacio;
  end if;
  select u.rol::text, u.tenant into v_rol, v_tenant_usuario
    from public.usuarios u
   where u.id = v_uid and u.activo is true;
  if not found
     or v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
     or v_tenant_usuario is null or v_tenant_usuario not in ('mayorista', 'minorista') then
    return c_vacio;
  end if;
  if v_rol in ('superadmin', 'gerencia') then
    if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
      return c_vacio;
    end if;
    v_t_aut := p_tenant;
  else
    if p_tenant is not null and p_tenant <> v_tenant_usuario then
      return c_vacio;
    end if;
    v_t_aut := v_tenant_usuario;
  end if;

  -- 2. Clave de consulta (misma gramática, sin DV).
  if (p_tipo_doc is not null and char_length(p_tipo_doc) > 64)
     or (p_numero is not null and char_length(p_numero) > 64) then
    return c_vacio || jsonb_build_object('error', 'formato_no_admitido');
  end if;
  select n.* into v_norm from p214_priv.norm_documento(p_tipo_doc, p_numero, null, 'consulta') n;
  if v_norm.estado is distinct from 'documentada' then
    return c_vacio || jsonb_build_object('error', 'formato_no_admitido');
  end if;

  -- 3. Candidata: como mucho una documentada con esa clave en el tenant autorizado.
  select p.id, p.tenant, p.tipo_doc, p.numero_norm into v_persona
    from public.personas p
   where p.tenant = v_t_aut and p.estado_doc = 'documentada'
     and p.tipo_doc = v_norm.tipo_doc and p.numero_norm = v_norm.numero_norm;
  if not found then
    return c_vacio;
  end if;

  -- 4-6. Filtro por captura ANTES de contar; total, página y variantes solo sobre lo autorizado.
  with a as (
    select o.id, o.campo, o.valor, o.created_at,
           c.id as captura_id, c.fuente, c.created_at as capturado_en, c.contrato_numero, c.actor_rol
      from public.persona_observaciones o
      join public.persona_capturas c on c.id = o.captura_id
     where o.persona_id = v_persona.id
       and o.tenant = v_t_aut
       and c.persona_id = v_persona.id
       and p214_priv.captura_visible(c.tenant, c.fuente, c.contrato_numero, v_t_aut, v_rol)
  ),
  pagina as (
    select * from a
     order by a.campo collate "C", a.created_at, a.id
    offset p_offset
     limit p_limite
  ),
  por_valor as (
    select a.campo, a.valor, count(distinct a.captura_id)::integer as n_capturas
      from a
     group by a.campo, a.valor
  ),
  muestra as (
    select pv.campo, pv.valor, pv.n_capturas,
           row_number() over (partition by pv.campo order by pv.n_capturas desc, pv.valor collate "C") as rn
      from por_valor pv
  ),
  por_campo as (
    select pv.campo, count(*)::integer as n_valores
      from por_valor pv
     group by pv.campo
  )
  select (select count(*)::integer from a),
         (select count(*)::integer from pagina),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'campo', pg.campo,
                            'valor', pg.valor,
                            'captura_id', pg.captura_id,
                            'fuente', pg.fuente,
                            'capturado_en', pg.capturado_en,
                            'contrato_numero', pg.contrato_numero,
                            'actor_rol', case when v_rol = 'venta' then null else pg.actor_rol end)
                          order by pg.campo collate "C", pg.created_at, pg.id)
                     from pagina pg), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'campo', pc.campo,
                            'n_valores', pc.n_valores,
                            'divergencia', pc.n_valores > 1,
                            'valores', coalesce((select jsonb_agg(jsonb_build_object('valor', m.valor, 'n_capturas', m.n_capturas)
                                                                  order by m.rn)
                                                   from muestra m
                                                  where m.campo = pc.campo and m.rn <= 10), '[]'::jsonb),
                            'valores_omitidos', greatest(pc.n_valores - 10, 0))
                          order by pc.campo collate "C")
                     from por_campo pc), '[]'::jsonb),
         coalesce((select bool_or(pc.n_valores > 1) from por_campo pc), false)
    into v_total, v_filas, v_pagina, v_variantes, v_divergencia;

  if v_total = 0 then
    return c_vacio;
  end if;

  return jsonb_build_object(
    'persona', jsonb_build_object('id', v_persona.id, 'tenant', v_persona.tenant,
                                  'tipo_doc', v_persona.tipo_doc, 'numero_norm', v_persona.numero_norm),
    'observaciones', v_pagina,
    'total', v_total,
    'has_more', (p_offset + v_filas) < v_total,
    'divergencia', v_divergencia,
    'variantes', v_variantes);
end;
$$;

comment on function public.buscar_personas_documento(text, text, text, integer, integer) is
  '214 (#32): búsqueda EXACTA por tenant + tipo + número. Máximo 50 observaciones por página y variantes acotadas (10 valores por campo). Respuesta vacía idéntica para "no existe", "sin permiso" y "nada autorizado".';

-- 8) Dueño, RLS y privilegios (Supabase concede por defecto a anon/authenticated/service_role
--    sobre objetos nuevos: aquí se revoca explícitamente y se concede solo lo necesario).
alter function public.buscar_personas_documento(text, text, text, integer, integer) owner to current_user;

alter table public.personas enable row level security;
alter table public.persona_capturas enable row level security;
alter table public.persona_observaciones enable row level security;

revoke all on table public.personas, public.persona_capturas, public.persona_observaciones
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.personas to service_role;
grant select, insert on table public.persona_capturas, public.persona_observaciones to service_role;

revoke all on schema p214_priv from public, anon, authenticated;
grant usage on schema p214_priv to service_role;

revoke all on all functions in schema p214_priv from public, anon, authenticated, service_role;
grant execute on function
  p214_priv.norm_documento(text, text, boolean, text),
  p214_priv.dv_nit_valido(text),
  p214_priv.exigir_read_committed(),
  p214_priv.validar_entrada_captura(uuid, text, text, text, text, text, bigint),
  p214_priv.observaciones_de_entrada(jsonb),
  p214_priv.carga_esperada(jsonb, text),
  p214_priv.marca_nit(text, text, text),
  p214_priv.captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb),
  p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text),
  p214_priv.promover_persona(uuid, uuid, text, text, text, jsonb, text, text, bigint, uuid, text)
  to service_role;

revoke all on function public.buscar_personas_documento(text, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.buscar_personas_documento(text, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
