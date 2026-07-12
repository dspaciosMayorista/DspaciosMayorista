-- ───────────────────────────────────────────────────────────────────────────
-- 126 · CONTABILIDAD — Plan de cuentas (PUC), Libro diario y Libro auxiliar
--
--  Hasta ahora los "estados financieros" se calculaban en caliente a partir de
--  ventas/abonos/cxp/movimientos — útil, pero no es contabilidad real de
--  partida doble. Esto agrega la base formal:
--    · puc_cuentas       — plan de cuentas jerárquico (clase/grupo/cuenta/
--      subcuenta/auxiliar), estilo PUC colombiano. Se siembra una base de
--      cuentas típicas de una agencia de viajes (editable/ampliable desde la
--      UI — el dueño puede crear más cuentas, subcuentas y auxiliares).
--    · asientos_contables — encabezado del libro diario (fecha, descripción,
--      origen: manual o automático desde otro módulo, ej. conciliaciones).
--    · asiento_lineas     — el detalle (debe/haber por cuenta) — es a la vez
--      el libro diario (por asiento) y la fuente del libro auxiliar (por
--      cuenta, con saldo corrido).
--  Cada cuenta y cada asiento llevan `tenant` (mayorista/minorista), mismo
--  patrón multitenant del resto del sistema (migración 107).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.puc_cuentas (
  id                  bigserial primary key,
  tenant              text not null default 'mayorista',
  codigo              text not null,
  nombre              text not null,
  nivel               smallint not null,       -- 1 clase · 2 grupo · 3 cuenta · 4 subcuenta · 5+ auxiliar
  padre_id            bigint references public.puc_cuentas(id),
  naturaleza          text not null,           -- 'debito' | 'credito'
  permite_movimiento  boolean not null default true,  -- false = cuenta "de agrupación" (clase/grupo/cuenta), no recibe asientos directos
  activa              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (tenant, codigo)
);

create index if not exists idx_puc_cuentas_tenant on public.puc_cuentas(tenant);
create index if not exists idx_puc_cuentas_padre on public.puc_cuentas(padre_id);

alter table public.puc_cuentas enable row level security;
drop policy if exists "puc_cuentas: acceso contable" on public.puc_cuentas;
create policy "puc_cuentas: acceso contable"
  on public.puc_cuentas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion') and public.puede_ver_tenant(tenant));

create table if not exists public.asientos_contables (
  id             bigserial primary key,
  tenant         text not null default 'mayorista',
  numero         bigint not null,
  fecha          date not null default current_date,
  descripcion    text not null,
  origen         text not null default 'manual',   -- 'manual' | 'conciliacion' | ...
  referencia     text,                              -- ej. numero_contrato, id de conciliación
  usuario_email  text,
  created_at     timestamptz not null default now(),
  unique (tenant, numero)
);

create index if not exists idx_asientos_tenant_fecha on public.asientos_contables(tenant, fecha);

alter table public.asientos_contables enable row level security;
drop policy if exists "asientos_contables: acceso contable" on public.asientos_contables;
create policy "asientos_contables: acceso contable"
  on public.asientos_contables for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion') and public.puede_ver_tenant(tenant));

create table if not exists public.asiento_lineas (
  id           bigserial primary key,
  tenant       text not null default 'mayorista',
  asiento_id   bigint not null references public.asientos_contables(id) on delete cascade,
  cuenta_id    bigint not null references public.puc_cuentas(id),
  tercero      text,           -- ej. número de contrato, proveedor, cliente
  descripcion  text,
  debe         numeric(15,2) not null default 0,
  haber        numeric(15,2) not null default 0
);

create index if not exists idx_asiento_lineas_asiento on public.asiento_lineas(asiento_id);
create index if not exists idx_asiento_lineas_cuenta on public.asiento_lineas(cuenta_id, tenant);

alter table public.asiento_lineas enable row level security;
drop policy if exists "asiento_lineas: acceso contable" on public.asiento_lineas;
create policy "asiento_lineas: acceso contable"
  on public.asiento_lineas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion') and public.puede_ver_tenant(tenant));

-- ── Semilla: base de cuentas típicas de una agencia de viajes (PUC Colombia) ─
-- Se siembra para mayorista y minorista. Idempotente (on conflict do nothing)
-- — re-correr esta migración no duplica ni pisa cuentas ya creadas/editadas.
do $$
declare
  t text;
  r record;
begin
  foreach t in array array['mayorista','minorista'] loop
    for r in
      select * from (values
        -- ── CLASE 1 · ACTIVO ──────────────────────────────────────────────
        ('1','ACTIVO','debito',false,null::text),
        ('11','DISPONIBLE','debito',false,'1'),
        ('13','DEUDORES','debito',false,'1'),
        ('15','PROPIEDADES PLANTA Y EQUIPO','debito',false,'1'),
        ('1105','Caja','debito',false,'11'),
        ('1110','Bancos','debito',false,'11'),
        ('1305','Clientes','debito',false,'13'),
        ('1355','Anticipos y avances','debito',false,'13'),
        ('1365','Cuentas por cobrar a trabajadores y asesores','debito',false,'13'),
        ('1380','Deudores varios','debito',false,'13'),
        ('1524','Equipo de oficina','debito',false,'15'),
        ('1528','Equipo de computación y comunicación','debito',false,'15'),
        ('1592','Depreciación acumulada','credito',false,'15'),
        ('110505','Caja general','debito',true,'1105'),
        ('111005','Bancos moneda nacional','debito',true,'1110'),
        ('111010','Bancos moneda extranjera (USD)','debito',true,'1110'),
        ('130505','Clientes nacionales','debito',true,'1305'),
        ('135505','Anticipos a proveedores','debito',true,'1355'),
        ('136505','Préstamos a asesores','debito',true,'1365'),
        ('138005','Deudores varios','debito',true,'1380'),
        ('152405','Muebles y equipo de oficina','debito',true,'1524'),
        ('152805','Equipos de cómputo','debito',true,'1528'),
        ('159205','Depreciación acum. equipo oficina y cómputo','credito',true,'1592'),

        -- ── CLASE 2 · PASIVO ──────────────────────────────────────────────
        ('2','PASIVO','credito',false,null),
        ('22','PROVEEDORES','credito',false,'2'),
        ('23','CUENTAS POR PAGAR','credito',false,'2'),
        ('24','IMPUESTOS GRAVÁMENES Y TASAS','credito',false,'2'),
        ('25','OBLIGACIONES LABORALES','credito',false,'2'),
        ('28','OTROS PASIVOS','credito',false,'2'),
        ('2205','Proveedores nacionales','credito',false,'22'),
        ('2335','Costos y gastos por pagar','credito',false,'23'),
        ('2365','Retención en la fuente por pagar','credito',false,'23'),
        ('2367','Impuesto a las ventas retenido (ReteIVA)','credito',false,'23'),
        ('2404','Impuesto de renta y complementarios por pagar','credito',false,'24'),
        ('2408','Impuesto sobre las ventas por pagar (IVA)','credito',false,'24'),
        ('2412','Impuesto de industria y comercio (ICA)','credito',false,'24'),
        ('2505','Salarios por pagar','credito',false,'25'),
        ('2510','Cesantías consolidadas','credito',false,'25'),
        ('2515','Intereses sobre cesantías','credito',false,'25'),
        ('2520','Prima de servicios','credito',false,'25'),
        ('2525','Vacaciones consolidadas','credito',false,'25'),
        ('2805','Anticipos y avances recibidos de clientes','credito',false,'28'),
        ('2815','Ingresos recibidos para terceros','credito',false,'28'),
        ('220505','Hoteles','credito',true,'2205'),
        ('220510','Aerolíneas / operadores aéreos','credito',true,'2205'),
        ('220515','Receptivos y operadores terrestres','credito',true,'2205'),
        ('220520','Asistencias médicas y seguros de viaje','credito',true,'2205'),
        ('220595','Otros proveedores','credito',true,'2205'),
        ('236540','Retefuente servicios','credito',true,'2365'),
        ('236570','Retefuente honorarios','credito',true,'2365'),
        ('240802','IVA generado','credito',true,'2408'),
        ('250505','Sueldos por pagar','credito',true,'2505'),
        ('280505','Anticipos de clientes','credito',true,'2805'),
        ('281505','Comisiones y recobros por pagar a aliados B2B','credito',true,'2815'),

        -- ── CLASE 3 · PATRIMONIO ──────────────────────────────────────────
        ('3','PATRIMONIO','credito',false,null),
        ('31','CAPITAL SOCIAL','credito',false,'3'),
        ('36','RESULTADOS DEL EJERCICIO','credito',false,'3'),
        ('37','RESULTADOS DE EJERCICIOS ANTERIORES','credito',false,'3'),
        ('3105','Capital suscrito y pagado','credito',false,'31'),
        ('3605','Utilidad del ejercicio','credito',false,'36'),
        ('3610','Pérdida del ejercicio','debito',false,'36'),
        ('3705','Utilidades acumuladas','credito',false,'37'),
        ('310505','Capital suscrito y pagado','credito',true,'3105'),
        ('360505','Utilidad del ejercicio','credito',true,'3605'),
        ('370505','Utilidades acumuladas','credito',true,'3705'),

        -- ── CLASE 4 · INGRESOS ────────────────────────────────────────────
        ('4','INGRESOS','credito',false,null),
        ('41','OPERACIONALES','credito',false,'4'),
        ('42','NO OPERACIONALES','credito',false,'4'),
        ('4110','Venta de paquetes y tiquetes','credito',false,'41'),
        ('4135','Servicios','credito',false,'41'),
        ('4210','Financieros','credito',false,'42'),
        ('4295','Diversos','credito',false,'42'),
        ('411005','Venta de paquetes turísticos','credito',true,'4110'),
        ('411010','Venta de tiquetes aéreos','credito',true,'4110'),
        ('413505','Comisiones','credito',true,'4135'),
        ('413510','Servicios turísticos (traslados, tours, asistencias)','credito',true,'4135'),
        ('421005','Rendimientos financieros','credito',true,'4210'),
        ('429505','Ingresos diversos','credito',true,'4295'),

        -- ── CLASE 5 · GASTOS ──────────────────────────────────────────────
        ('5','GASTOS','debito',false,null),
        ('51','OPERACIONALES DE ADMINISTRACIÓN','debito',false,'5'),
        ('52','OPERACIONALES DE VENTAS','debito',false,'5'),
        ('53','NO OPERACIONALES','debito',false,'5'),
        ('5105','Gastos de personal','debito',false,'51'),
        ('5110','Honorarios','debito',false,'51'),
        ('5115','Impuestos','debito',false,'51'),
        ('5120','Arrendamientos','debito',false,'51'),
        ('5135','Servicios','debito',false,'51'),
        ('5140','Gastos legales','debito',false,'51'),
        ('5145','Mantenimiento y reparaciones','debito',false,'51'),
        ('5195','Diversos','debito',false,'51'),
        ('5199','Provisiones','debito',false,'51'),
        ('5205','Comisiones a asesores','debito',false,'52'),
        ('5240','Gastos de viaje y representación','debito',false,'52'),
        ('5305','Gastos financieros','debito',false,'53'),
        ('510506','Sueldos','debito',true,'5105'),
        ('511005','Honorarios contables/legales','debito',true,'5110'),
        ('511505','Industria y comercio (ICA)','debito',true,'5115'),
        ('511510','4x1000 (GMF)','debito',true,'5115'),
        ('512005','Arrendamiento oficina','debito',true,'5120'),
        ('513505','Servicios públicos','debito',true,'5135'),
        ('513510','Aseo y vigilancia','debito',true,'5135'),
        ('514005','Gastos legales','debito',true,'5140'),
        ('514505','Mantenimiento equipos','debito',true,'5145'),
        ('519505','Gastos diversos','debito',true,'5195'),
        ('519905','Provisión ICA/Fontur/Bomberil','debito',true,'5199'),
        ('519910','Provisión impuesto de renta','debito',true,'5199'),
        ('520506','Comisiones a asesores','debito',true,'5205'),
        ('524005','Gastos de viaje','debito',true,'5240'),
        ('530525','Comisiones bancarias','debito',true,'5305'),
        ('530530','Gravamen a los movimientos financieros (4x1000)','debito',true,'5305'),

        -- ── CLASE 6 · COSTO DE VENTAS ─────────────────────────────────────
        ('6','COSTO DE VENTAS','debito',false,null),
        ('61','COSTO DE VENTAS Y DE PRESTACIÓN DE SERVICIOS','debito',false,'6'),
        ('6135','Costo de paquetes turísticos','debito',false,'61'),
        ('613505','Costo hoteles','debito',true,'6135'),
        ('613510','Costo aéreo','debito',true,'6135'),
        ('613515','Costo receptivo/traslados','debito',true,'6135'),
        ('613520','Costo asistencias','debito',true,'6135'),
        ('613595','Otros costos','debito',true,'6135')
      ) as x(codigo, nombre, naturaleza, permite_movimiento, padre_codigo)
    loop
      insert into public.puc_cuentas (tenant, codigo, nombre, nivel, padre_id, naturaleza, permite_movimiento)
      values (
        t, r.codigo, r.nombre,
        case length(r.codigo) when 1 then 1 when 2 then 2 when 4 then 3 when 6 then 4 else 5 end,
        (select id from public.puc_cuentas where tenant = t and codigo = r.padre_codigo),
        r.naturaleza, r.permite_movimiento
      )
      on conflict (tenant, codigo) do nothing;
    end loop;
  end loop;
end $$;
