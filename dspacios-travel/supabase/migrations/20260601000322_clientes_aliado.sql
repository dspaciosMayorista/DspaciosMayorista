-- 322 · #76/#77: libreta de clientes finales de cada aliado B2B (`aliado_clientes`).
-- Decisión del dueño (ADL-039): los clientes finales se asocian al aliado, los aliados quedan aislados entre sí, el acceso interno autorizado se conserva
-- y el CRM central se REUTILIZA sin duplicarlo. Por eso esta tabla es solo la libreta de CONTACTO que el propio aliado escribe (teléfono, correo, documento,
-- notas); lo que ya existe en contratos y cotizaciones se deriva en lectura por el id del aliado y NO se copia aquí. No toca `crm_contactos` (campañas, índices
-- únicos globales de la 047) ni `personas` (identidad append-only de la 214): un cliente de un aliado nunca entra a una campaña ni se fusiona con otro aliado.
-- Sin backfill ni reasignación: nace vacía. Solo service_role (código de servidor que ya resolvió el aliado desde la sesión): sin políticas RLS y sin permisos para anon/authenticated.
-- Aditiva e idempotente.
begin;

do $$
begin
  if to_regclass('public.aliados') is null then
    raise exception '322 ABORTADA: falta public.aliados.';
  end if;
end $$;

create table if not exists public.aliado_clientes (
  id bigserial primary key,
  aliado_id bigint not null references public.aliados(id) on delete restrict,
  tenant text not null default 'mayorista' check (tenant in ('mayorista', 'minorista')),
  nombre text not null check (char_length(btrim(nombre)) between 3 and 120),
  -- Clave del nombre (sin tildes ni mayúsculas, la calcula la app con la MISMA función que agrupa lo derivado): un nombre por aliado.
  clave text not null check (char_length(clave) between 3 and 120),
  tipo_documento text check (tipo_documento is null or tipo_documento in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT')),
  documento text check (documento is null or char_length(documento) between 3 and 30),
  email text check (email is null or char_length(email) <= 120),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  notas text check (notas is null or char_length(notas) <= 500),
  -- El aliado declara que el cliente autorizó guardar sus datos de contacto: solo se admite `true`.
  autorizacion_datos boolean not null check (autorizacion_datos),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_por uuid,
  actualizado_en timestamptz not null default now(),
  constraint aliado_clientes_nombre_unico unique (aliado_id, clave),
  constraint aliado_clientes_documento_completo check ((documento is null) = (tipo_documento is null))
);
comment on table public.aliado_clientes is '#76/#77: libreta de contacto de los clientes finales de un aliado B2B. Solo service_role; el aliado se resuelve siempre desde la sesión.';

create index if not exists aliado_clientes_aliado_idx on public.aliado_clientes (aliado_id, actualizado_en desc);

alter table public.aliado_clientes enable row level security;
revoke all on table public.aliado_clientes from public, anon, authenticated;
revoke all on sequence public.aliado_clientes_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.aliado_clientes to service_role;
grant usage, select on sequence public.aliado_clientes_id_seq to service_role;

-- Auditoría de la tabla nueva (el bloque DO de la 087 solo adjunta a las tablas que ya existían).
do $$
begin
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.aliado_clientes';
    execute 'create trigger trg_auditoria after insert or update or delete on public.aliado_clientes for each row execute function public.fn_auditoria()';
  end if;
end $$;

commit;
