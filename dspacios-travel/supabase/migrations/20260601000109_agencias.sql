-- ───────────────────────────────────────────────────────────────────────────
-- 109 · MULTITENANT — datos fiscales/legales por agencia (del RUT)
--
--  Cada agencia (tenant) tiene su identidad tributaria: NIT, razón social,
--  responsabilidades DIAN, etc. Se usa en documentos (recibos, estados de cuenta),
--  facturación y estados financieros. Sembrado con los RUT de junio/2026.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.agencias (
  tenant               text primary key,
  razon_social         text,
  nombre_comercial     text,
  nit                  text,
  dv                   text,
  rnt                  text,
  direccion            text,
  ciudad               text,
  correo               text,
  telefono             text,
  actividad_economica  text,
  responsabilidades    text,
  representante_legal   text,
  factura_electronica  boolean not null default false,
  banco                text,
  tipo_cuenta          text,
  numero_cuenta        text,
  updated_at           timestamptz not null default now()
);

alter table public.agencias enable row level security;
-- Lectura pública: la identidad de la empresa (NIT/razón social) sale en
-- documentos públicos (recibos, estados de cuenta por enlace).
drop policy if exists "agencias: lectura interna" on public.agencias;
drop policy if exists "agencias: lectura publica" on public.agencias;
create policy "agencias: lectura publica" on public.agencias for select using (true);
drop policy if exists "agencias: escritura admin" on public.agencias;
create policy "agencias: escritura admin" on public.agencias for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));

insert into public.agencias (tenant, razon_social, nombre_comercial, nit, dv, rnt, direccion, ciudad, correo, telefono, actividad_economica, responsabilidades, representante_legal, factura_electronica)
values
 ('mayorista', 'D''SPACIOS TRAVEL MAYORISTA DE TURISMO SAS', 'D''SPACIOS TRAVEL MAYORISTA DE TURISMO', '902076052', '1', '',
   'CL 30 # 83-50 LC 1043', 'Medellín, Antioquia', 'contacto@dspaciostravel.com', '3212150582', '7911',
   '05 (Renta rég. ordinario), 07 (Retención fuente), 14 (Exógena), 42 (Obligado a llevar contabilidad), 48 (IVA), 55 (Benef. finales)',
   'Otoniel Villada Martínez', false),
 ('minorista', 'D''SPACIOS TRAVEL S.A.S.', 'D''SPACIOS TRAVEL', '901654224', '8', '147090',
   'CL 92 C # C-67-15 IN 301', 'Medellín, Antioquia', 'javap.1204@gmail.com', '3122057635', '7911',
   '05 (Renta rég. ordinario), 07 (Retención fuente), 14 (Exógena), 42 (Obligado a llevar contabilidad), 48 (IVA), 52 (Facturador electrónico), 55 (Benef. finales)',
   'Otoniel Villada Martínez (suplente)', true)
on conflict (tenant) do nothing;
