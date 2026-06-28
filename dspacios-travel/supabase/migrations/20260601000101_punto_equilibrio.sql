-- ───────────────────────────────────────────────────────────────────────────
-- 101 · PUNTO DE EQUILIBRIO — empleados y otros costos/gastos (persistentes)
--
--  El módulo deja de ser un calculador efímero: nómina y costos fijos/variables
--  se guardan. Cada empleado puede tener su contrato (físico escaneado o digital)
--  en el bucket privado 'contratos' (carpeta pe-empleados/).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.pe_empleados (
  id               bigserial primary key,
  nombre           text not null,
  tipo             text not null default 'empleado',  -- 'empleado' | 'servicios'
  salario          numeric(15,2) not null default 0,  -- empleado: salario base; servicios: honorario
  auxilio          boolean not null default false,
  riesgo           text not null default 'I',         -- clase de riesgo ARL (I..V)
  declarante       boolean not null default true,     -- empresa declarante → exoneración de aportes
  contrato_path    text,                              -- archivo en bucket 'contratos'
  contrato_nombre  text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.pe_costos (
  id            bigserial primary key,
  concepto      text not null,
  categoria     text,
  clasificacion text not null default 'fijo',          -- 'fijo' | 'variable'
  valor         numeric(15,2) not null default 0,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.pe_empleados enable row level security;
alter table public.pe_costos    enable row level security;

drop policy if exists "pe_empleados: acceso contable" on public.pe_empleados;
create policy "pe_empleados: acceso contable"
  on public.pe_empleados for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));

drop policy if exists "pe_costos: acceso contable" on public.pe_costos;
create policy "pe_costos: acceso contable"
  on public.pe_costos for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
