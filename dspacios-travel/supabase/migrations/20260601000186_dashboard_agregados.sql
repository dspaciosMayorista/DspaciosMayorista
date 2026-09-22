-- ───────────────────────────────────────────────────────────────────────────
-- 186 · Dashboard administrativo — agregados en base (evita descargar filas)
--
--  Auditoría de costo (ronda anterior, migración 185 + fetchAllPaginado):
--  el Dashboard protegía contra el truncamiento silencioso de "Max Rows"
--  paginando `.select()` completos — pero eso significa DESCARGAR TODAS las
--  filas de ventas/abonos/cupos_por_bloqueo/cuentas_por_pagar/
--  retenciones_cxp/cxp_pagos en cada carga de la página, solo para sumarlas
--  o contarlas en JavaScript. Para una agencia con miles de contratos
--  históricos, eso es tráfico y trabajo de red innecesario en una pantalla
--  que se abre constantemente.
--
--  Esta migración agrega 6 funciones SQL de solo agregación (una por
--  necesidad real del Dashboard), todas:
--    · SECURITY INVOKER — corren con los permisos de quien llama, así que la
--      RLS de las tablas de origen se sigue aplicando exactamente igual que
--      si el cliente hiciera el `select` directo (nunca se salta RLS; no
--      hace falta SECURITY DEFINER porque no hay nada que estas consultas
--      necesiten que el rol autorizado no pueda ya leer por su cuenta).
--    · `set search_path = public` (fija el search_path aunque sea INVOKER —
--      buena práctica, evita que un search_path manipulado por el caller
--      resuelva `public.ventas` a otra cosa).
--    · reciben `p_tenant` como parámetro EXPLÍCITO y lo filtran en el
--      `where` — no delegan el aislamiento por tenant solo a la RLS (mismo
--      criterio de defensa en profundidad que ya usaba el código en JS con
--      `.eq("tenant", tenant)`).
--    · devuelven un resultado PEQUEÑO y tipado (un puñado de filas como
--      máximo — nunca las filas individuales de ventas/abonos/CxP), y NUNCA
--      mezclan monedas en una sola cifra (agrupan por moneda cuando aplica).
--    · execute revocado de `public`/`anon`, otorgado a `authenticated` y
--      `service_role` (la RLS de las tablas de origen igual bloquearía
--      datos ajenos para `authenticated`, pero no hace falta que un cliente
--      sin sesión pueda siquiera invocarlas; `service_role` se agrega para
--      que Server Actions con el cliente admin también puedan usarlas).
--
--  Las FÓRMULAS de contratos/cupos/retenciones/CxP no cambian — cada función
--  replica exactamente el cálculo que ya hacían las funciones puras de
--  `lib/dashboard/metricas.ts` (que se mantienen intactas, con sus pruebas,
--  como el "oráculo" contra el que se probó la paridad de estas consultas —
--  ver pruebas/dashboardMetricasAgregadas.test.ts).
--  ⚠️ EXCEPCIÓN: las fórmulas de "ventas del mes" (función 6) y "cartera al
--  día/vencida" (función 5) SÍ se corrigieron antes de dejar esta migración
--  lista para aplicar — ver el comentario de cada una — porque la versión
--  original mezclaba estados que no son ventas efectivas ('pendiente',
--  'cancelado') en el avance contra la meta general y en el saldo de
--  cartera. Ambas quedaron alineadas al mismo criterio: solo
--  'confirmado'/'activo' cuentan.
--  `fetchAllPaginado` (lib/supabase/fetchAllPaginado.ts) también se
--  mantiene intacta como utilidad reutilizable — el Dashboard simplemente
--  deja de necesitarla para estos 6 casos, que ahora se resuelven en base.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Contratos por estado — reemplaza descargar TODAS las filas de `ventas`
--    solo para agrupar y contar. Resultado: como máximo 4 filas (una por
--    estado real: pendiente/confirmado/activo/cancelado).
create or replace function public.fn_dashboard_contratos_por_estado(p_tenant text)
returns table(estado text, n bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select coalesce(v.estado, '') as estado, count(*) as n
  from public.ventas v
  where v.tenant = p_tenant
  group by v.estado;
$$;

revoke all on function public.fn_dashboard_contratos_por_estado(text) from public, anon;
grant execute on function public.fn_dashboard_contratos_por_estado(text) to authenticated, service_role;

-- 2) Cupos — capacidad/ocupados/disponibles totales + críticos (≤3
--    disponibles). `cupos_por_bloqueo` ya es una vista agregada por bloqueo;
--    esta función agrega esa vista una vez más, a UNA sola fila, en vez de
--    traer una fila por bloqueo al cliente para sumarlas ahí. Sin tenant:
--    la vista no tiene columna tenant (bloqueos_vuelo es exclusivo de
--    mayorista) — mismo criterio que ya usaba el código en JS (gateado por
--    `esMinorista`, no por un filtro de tenant en esta consulta).
create or replace function public.fn_dashboard_cupos_resumen()
returns table(capacidad bigint, ocupados bigint, disponibles bigint, criticos bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select
    coalesce(sum(cupos_total), 0)::bigint,
    coalesce(sum(cupos_ocupados), 0)::bigint,
    coalesce(sum(cupos_disponibles), 0)::bigint,
    coalesce(count(*) filter (where cupos_disponibles > 0 and cupos_disponibles <= 3), 0)::bigint
  from public.cupos_por_bloqueo;
$$;

revoke all on function public.fn_dashboard_cupos_resumen() from public, anon;
grant execute on function public.fn_dashboard_cupos_resumen() to authenticated, service_role;

-- 3) Retenciones del mes — un solo escalar (suma), en vez de traer cada fila
--    de retenciones_cxp del mes para sumarlas en JS.
create or replace function public.fn_dashboard_retenciones_mes(p_tenant text, p_periodo text)
returns numeric
language sql
security invoker
stable
set search_path = public
as $$
  select coalesce(sum(valor), 0)
  from public.retenciones_cxp
  where tenant = p_tenant and mes_declaracion = p_periodo;
$$;

revoke all on function public.fn_dashboard_retenciones_mes(text, text) from public, anon;
grant execute on function public.fn_dashboard_retenciones_mes(text, text) to authenticated, service_role;

-- 4) Cuentas por pagar por vencer — total del universo (todas las que
--    vencen en la ventana) y cuántas ya están pagadas POR COMPLETO (cruce
--    con cxp_pagos, hecho en base con un JOIN + agregación en vez de traer
--    las cuentas Y sus pagos al cliente para cruzarlas ahí). Nunca suma $:
--    sigue siendo un CONTEO (una cuenta en USD y otra en COP no se mezclan
--    en una cifra de dinero — mismo criterio ya validado).
create or replace function public.fn_dashboard_cxp_resumen(p_tenant text, p_desde date, p_hasta date)
returns table(total bigint, pagadas bigint)
language sql
security invoker
stable
set search_path = public
as $$
  with cxp as (
    select c.id, c.valor_total
    from public.cuentas_por_pagar c
    where c.tenant = p_tenant
      and c.fecha_vencimiento >= p_desde
      and c.fecha_vencimiento <= p_hasta
  ),
  pagos as (
    select p.cuenta_por_pagar_id, sum(p.valor) as suma
    from public.cxp_pagos p
    where p.cuenta_por_pagar_id in (select id from cxp)
    group by p.cuenta_por_pagar_id
  )
  select
    count(*)::bigint as total,
    count(*) filter (
      where coalesce(c.valor_total, 0) > 0 and coalesce(pg.suma, 0) >= c.valor_total
    )::bigint as pagadas
  from cxp c
  left join pagos pg on pg.cuenta_por_pagar_id = c.id;
$$;

revoke all on function public.fn_dashboard_cxp_resumen(text, date, date) from public, anon;
grant execute on function public.fn_dashboard_cxp_resumen(text, date, date) to authenticated, service_role;

-- 5) Cartera al día/vencida por moneda — el cálculo más pesado que
--    reemplaza: antes se traían TODAS las ventas + TODOS los abonos del
--    tenant para calcular el saldo por contrato y clasificarlo en JS. Ahora
--    el saldo (precio_venta − abonos del contrato), la fecha límite
--    (fecha_salida − 30 días) y la clasificación al-día/vencida/sin-fecha se
--    calculan en un solo `with` + `group by moneda` — resultado: 1-2 filas
--    (una por moneda con cartera pendiente), nunca las ventas individuales.
--    `p_hoy` es la fecha de Bogotá YA resuelta en el servidor Next (mismo
--    valor que antes alimentaba `clasificarCartera` en JS) — la función no
--    decide zona horaria, solo recibe el día ya resuelto, para que la regla
--    de negocio (hoy en Bogotá) siga viviendo en un solo lugar.
--    ⚠️ FÓRMULA CORREGIDA (sincronización posterior a la primera versión
--    aplicada): el filtro era `v.estado <> 'cancelado'`, que dejaba entrar
--    'pendiente' — un borrador de Reservar (aún sin confirmar ni alcanzar
--    el abono mínimo) no genera cartera por cobrar todavía, porque no es
--    una venta consolidada. Mismo criterio de "venta efectiva" ya aplicado
--    a `fn_dashboard_ventas_mes`: solo 'confirmado'/'activo' generan
--    cartera. 'pendiente' y 'cancelado' quedan fuera.
create or replace function public.fn_dashboard_cartera_por_moneda(p_tenant text, p_hoy date)
returns table(moneda text, al_dia numeric, vencida numeric, sin_fecha numeric, sin_fecha_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  with abonos_por_contrato as (
    select a.numero_contrato, sum(a.valor_abono) as suma
    from public.abonos a
    where a.tenant = p_tenant
    group by a.numero_contrato
  ),
  saldo as (
    select
      coalesce(v.moneda, 'COP') as moneda,
      (coalesce(v.precio_venta, 0) - coalesce(ap.suma, 0)) as saldo,
      v.fecha_salida
    from public.ventas v
    left join abonos_por_contrato ap on ap.numero_contrato = v.numero_contrato
    where v.tenant = p_tenant and v.estado in ('confirmado', 'activo')
  )
  select
    moneda,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy <= (fecha_salida - 30)), 0) as al_dia,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy > (fecha_salida - 30)), 0) as vencida,
    coalesce(sum(saldo) filter (where fecha_salida is null), 0) as sin_fecha,
    coalesce(count(*) filter (where fecha_salida is null), 0)::bigint as sin_fecha_count
  from saldo
  where saldo > 0
  group by moneda;
$$;

revoke all on function public.fn_dashboard_cartera_por_moneda(text, date) from public, anon;
grant execute on function public.fn_dashboard_cartera_por_moneda(text, date) to authenticated, service_role;

-- 6) Ventas del mes por moneda — FÓRMULA CORREGIDA (revisión posterior a la
--    creación de esta migración, antes de ejecutarla): la versión anterior
--    sumaba TODAS las ventas del periodo sin filtrar por estado — incluía
--    'cancelado' y 'pendiente' como si fueran ventas efectivas, lo cual
--    infla el avance contra la meta general con dinero que nunca se
--    concretó (una venta cancelada no es una venta; una pendiente todavía
--    es un borrador de Reservar, sin confirmar ni alcanzar el abono
--    mínimo). Estados que SÍ cuentan como venta efectiva, con evidencia del
--    flujo real (mismo análisis que ya sustenta `clasificarContratos` en
--    lib/dashboard/metricas.ts): 'confirmado' (Reservar tras confirmarse, o
--    el importador de histórico minorista) y 'activo' (generador de
--    contrato manual, nace directo así). 'pendiente' y 'cancelado' quedan
--    fuera.
--    Se agrupa por `moneda` SIN `coalesce` a 'COP' (a diferencia de la
--    cartera): `ventas.moneda` es NOT NULL con default 'COP' desde la
--    migración 031, así que un valor realmente ausente no puede ocurrir;
--    agrupar por el valor real evita mezclar por accidente una moneda no
--    reconocida con COP. La clasificación COP/USD/"moneda no reconocida" (y
--    la garantía de que esta última NUNCA se compara contra ninguna meta)
--    vive en `ventasMesPorMonedaDesdeAgregado` (lib/dashboard/metricas.ts).
create or replace function public.fn_dashboard_ventas_mes(p_tenant text, p_periodo text)
returns table(moneda text, total numeric)
language sql
security invoker
stable
set search_path = public
as $$
  select moneda, coalesce(sum(precio_venta), 0) as total
  from public.ventas
  where tenant = p_tenant
    and estado in ('confirmado', 'activo')
    and to_char(fecha_venta, 'YYYY-MM') = p_periodo
  group by moneda;
$$;

revoke all on function public.fn_dashboard_ventas_mes(text, text) from public, anon;
grant execute on function public.fn_dashboard_ventas_mes(text, text) to authenticated, service_role;

-- 7) `cupos_por_bloqueo` — seguridad de la VISTA subyacente de la función 2.
--    Aunque `fn_dashboard_cupos_resumen` es SECURITY INVOKER, eso solo
--    garantiza que LA FUNCIÓN corre con los permisos de quien llama — una
--    VISTA que NO declara `security_invoker = true` (opción de PostgreSQL
--    15+) sigue el comportamiento pre-15 por defecto: sus tablas base se
--    evalúan con los privilegios del DUEÑO de la vista, no de quien
--    consulta. En Supabase las migraciones corren como un rol con
--    privilegios amplios — si ese es el dueño de `cupos_por_bloqueo` (creada
--    en la migración 003, sin esta opción, porque la migración es anterior
--    y no se puede editar una migración ya aplicada), consultarla podría
--    devolver TODAS las filas de `bloqueos_vuelo`/`sillas` sin que la RLS de
--    esas tablas ("bloqueos: lectura operativa"/"sillas: lectura operativa",
--    migración 005 — roles superadmin/gerencia/administracion/operaciones/
--    venta/control_vuelo) se aplique de verdad. Esto es una CORRECCIÓN
--    aditiva y no destructiva: `security_invoker = true` no cambia una sola
--    fila del resultado de la vista para un usuario YA autorizado por esa
--    RLS — solo hace que la vista dejar de comportarse como si fuera
--    SECURITY DEFINER. Requiere PostgreSQL 15+ (confirmar en el preflight).
alter view public.cupos_por_bloqueo set (security_invoker = true);

-- ───────────────────────────────────────────────────────────────────────────
-- Preflight/postcheck: scripts SQL ejecutables aparte (mismo patrón que la
-- 185), NO se ejecutan desde esta migración ni de forma remota:
--   supabase/scripts/preflight_186_dashboard_agregados.sql
--   supabase/scripts/postcheck_186_dashboard_agregados.sql
-- El preflight confirma la versión de PostgreSQL (≥15, requerida por el
-- punto 7) y el postcheck confirma que `cupos_por_bloqueo` quedó con
-- `security_invoker = true` y que la RLS de sus tablas base se respeta.
-- ───────────────────────────────────────────────────────────────────────────
