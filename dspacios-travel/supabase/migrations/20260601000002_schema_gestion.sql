-- Migración 002: Módulo Gestión / Ventas / Finanzas

-- ──────────────────────────────────────────────────────────────────
-- VENTAS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.ventas (
  numero_contrato     text primary key,            -- formato: 00-0451
  fecha_venta         date not null default current_date,
  asesor              text references public.asesores(email),
  canal               text,
  tipo_cliente        text,
  cliente             text not null,
  destino             text,
  tipo_paquete        text,                         -- bloqueo/empaquetado/dinamico/porcion_terrestre
  fecha_salida        date,
  fecha_regreso       date,
  pax                 integer default 1,
  hotel               text,
  aerolinea           text,
  receptivo           text,
  asistencia          text,
  otros_proveedores   text,
  precio_venta        numeric(15,2) default 0,
  costo_hotel         numeric(15,2) default 0,
  costo_aereo         numeric(15,2) default 0,
  costo_receptivo     numeric(15,2) default 0,
  costo_asistencia    numeric(15,2) default 0,
  otros_costos        numeric(15,2) default 0,
  estado              text default 'activo',
  observaciones       text,
  facturado           boolean default false,
  numero_documento    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- ABONOS
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.abonos (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  cliente             text,
  fecha_abono         date not null default current_date,
  valor_abono         numeric(15,2) not null,
  forma_pago          text,
  referencia          text,
  recibido_por        text,
  comprobante         text,
  observacion         text,
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- CUENTAS POR PAGAR
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.cuentas_por_pagar (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  proveedor           text,
  tipo_proveedor      text,
  servicio            text,
  fecha_obligacion    date,
  fecha_vencimiento   date,
  valor_total         numeric(15,2) default 0,
  aplica_retencion    boolean default false,
  pct_retencion       numeric(5,4) default 0,
  abono1              numeric(15,2),
  fecha_abono1        date,
  abono2              numeric(15,2),
  fecha_abono2        date,
  abono3              numeric(15,2),
  fecha_abono3        date,
  observaciones       text,
  tipo_facturacion    text,
  base_gravable       numeric(15,2),
  iva_proveedor       numeric(15,2),
  valor_irt           numeric(15,2),
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- ALIADOS B2B (por contrato)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.aliados_b2b (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  aliado              text,
  nit                 text,
  tipo_aliado         text,
  contacto            text,
  precio_venta        numeric(15,2) default 0,
  base_comision       numeric(15,2) default 0,
  pct_comision        numeric(5,4) default 0,
  recobro_total       numeric(15,2) default 0,
  pct_recobro_aliado  numeric(5,4) default 0,
  aplica_retencion    boolean default false,
  pct_retencion       numeric(5,4) default 0,
  estado              text default 'pendiente',
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- LIQUIDACIÓN COMISIONES
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.liquidacion_comisiones (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  asesor              text,
  mes_liquidacion     text,                         -- formato: 2026-01
  precio_venta        numeric(15,2) default 0,
  costo_total         numeric(15,2) default 0,
  com_b2b_pagada      numeric(15,2) default 0,
  fecha_liquidacion   date,
  fecha_pago          date,
  estado              text default 'pendiente',
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- FACTURACIÓN
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.facturacion (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  numero_factura      text,
  fecha_factura       date,
  cliente             text,
  nit_cliente         text,
  descripcion         text,
  tipo_documento      text,
  naturaleza_ingreso  text,
  base_gravable       numeric(15,2) default 0,
  iva_descontable     numeric(15,2) default 0,
  base_tercero        numeric(15,2) default 0,
  comision_fee        numeric(15,2) default 0,
  factura_todo        numeric(15,2) default 0,
  estado_dian         text,
  obs_tributaria      text,
  created_at          timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- RENTABILIDAD
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.rentabilidad (
  id                  bigserial primary key,
  numero_contrato     text not null references public.ventas(numero_contrato),
  asesor              text,
  destino             text,
  canal               text,
  pax                 integer default 1,
  precio_venta        numeric(15,2) default 0,
  costo_directo       numeric(15,2) default 0,
  iva_generado        numeric(15,2) default 0,
  iva_descontable     numeric(15,2) default 0,
  com_b2b             numeric(15,2) default 0,
  com_asesor          numeric(15,2) default 0,
  util_bruta          numeric(15,2) default 0,
  prov_ica            numeric(15,2) default 0,
  prov_bomberil       numeric(15,2) default 0,
  prov_fontur         numeric(15,2) default 0,
  prov_renta          numeric(15,2) default 0,
  total_provisiones   numeric(15,2) default 0,
  util_neta           numeric(15,2) default 0,
  margen_neto         numeric(8,4) default 0,
  clasificacion       text,
  mes                 text,                         -- formato: 2026-01
  fecha_calculo       timestamptz default now(),
  created_at          timestamptz not null default now()
);
