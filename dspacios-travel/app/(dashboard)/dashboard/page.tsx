import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import Link from "next/link";
import { formatCOP, formatUSD } from "@/lib/utils";
import {
  pctOrNull, pctRawOrNull,
  clasificarContratosDesdeConteos, carteraPorMonedaDesdeAgregado, ventasMesPorMonedaDesdeAgregado, cuposResumenDesdeAgregado,
  BALDE_MONEDA_DESCONOCIDA,
} from "@/lib/dashboard/metricas";
import {
  Tags, FileText, Ticket, FileSignature, Plane, LineChart, ArrowRight,
  Package, Armchair, Wallet, HandCoins, Receipt, Settings, Boxes, ChevronRight,
  PlaneTakeoff, AlertTriangle, FileCheck2, ShieldCheck, Percent, type LucideIcon,
} from "lucide-react";
import styles from "../DashboardShell.module.css";

export const dynamic = "force-dynamic";

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = user
    ? await supabase.from("usuarios").select("nombre, rol").eq("id", user.id).single()
    : { data: null };
  const interno = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");
  // Financiero estricto: subconjunto de `interno` sin "operaciones" — coincide
  // exacto con la RLS real de contrato_facturacion/conciliacion*/retenciones_cxp
  // ("… acceso contable" solo superadmin/gerencia/administracion). Un rol fuera
  // de este conjunto no dispara ninguna de esas consultas (RLS de todas formas
  // las bloquearía, pero no vale la pena ni pedirlas).
  const contable = ["superadmin", "gerencia", "administracion"].includes(perfil?.rol ?? "");

  const hoyStr = new Date().toISOString().slice(0, 10);
  const mesActual = hoyStr.slice(0, 7);
  // Fecha de Bogotá en formato ISO (en-CA da YYYY-MM-DD directo) — la regla de
  // negocio de cartera vencida ("hoy en Bogotá es posterior a fechaViaje-30d")
  // exige la fecha LOCAL, no la fecha UTC del servidor (que puede ir un día
  // adelantada entre 19:00 y 23:59 hora Colombia).
  const hoyBogota = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

  const tenant = await getTenant();
  // La minorista no maneja vuelos ni montaje de producto: esos datos no aplican.
  const esMinorista = tenant === "minorista";

  // Todo lo de abajo son AGREGADOS resueltos en base (migración 186,
  // `fn_dashboard_*`) — ninguno descarga las filas individuales de ventas/
  // abonos/cupos/CxP/retenciones al cliente, solo para sumarlas o contarlas
  // en JS (defecto real auditado en la ronda anterior: el protector de
  // paginación seguía trayendo miles de filas en cada carga, solo evitaba
  // que se truncaran en silencio). Cantidad de consultas FIJA (no crece con
  // el volumen de datos ni con el número de
  // tarjetas): siempre las mismas ~13 llamadas en un único Promise.all,
  // cada una devolviendo un resultado pequeño y tipado.
  const [
    { count: nPaquetes },
    { data: contratosPorEstado },
    { data: cuposFila },
    { count: nSalidas },
    { data: cxpResumen },
    { count: nDianTotal },
    { count: nDianEmitidas },
    { count: nConcTotal },
    { count: nConcHechas },
    { data: retencionMesData },
    { data: metaVentasFilas },
    { data: carteraFilas },
    { data: ventaMesFilas },
  ] = await Promise.all([
    esMinorista ? Promise.resolve({ count: 0 }) : supabase.from("paquetes").select("id", { count: "exact", head: true }),
    // Contratos por estado — antes bajaba TODAS las ventas del tenant.
    supabase.rpc("fn_dashboard_contratos_por_estado", { p_tenant: tenant }),
    esMinorista ? Promise.resolve({ data: null }) : supabase.rpc("fn_dashboard_cupos_resumen").maybeSingle(),
    esMinorista ? Promise.resolve({ count: 0 }) : supabase.from("bloqueos_vuelo").select("id", { count: "exact", head: true }).gte("fecha_ida", hoyStr).lte("fecha_ida", addDays(14)),
    // CxP por vencer (15d) + cuántas ya están pagadas por completo — antes
    // bajaba cada cuenta Y cada pago para cruzarlos en JS.
    interno
      ? supabase.rpc("fn_dashboard_cxp_resumen", { p_tenant: tenant, p_desde: hoyStr, p_hasta: addDays(15) }).maybeSingle()
      : Promise.resolve({ data: null as { total: number; pagadas: number } | null }),
    // Facturación DIAN: el único estado real en el modelo es un booleano
    // emitida/no emitida (contrato_facturacion.dian_emitida) — no existe
    // distinción "aceptada/rechazada" en ninguna tabla del sistema. Conteos
    // por `count: "exact", head: true`: no están sujetos al límite de "Max
    // Rows" (ese límite solo trunca filas devueltas, nunca el conteo agregado).
    contable ? supabase.from("contrato_facturacion").select("numero_contrato", { count: "exact", head: true }) : Promise.resolve({ count: 0 }),
    contable ? supabase.from("contrato_facturacion").select("numero_contrato", { count: "exact", head: true }).eq("dian_emitida", true) : Promise.resolve({ count: 0 }),
    contable ? supabase.from("conciliacion_extracto").select("id", { count: "exact", head: true }).eq("tenant", tenant).eq("periodo", mesActual) : Promise.resolve({ count: 0 }),
    contable
      ? supabase.from("conciliacion_extracto").select("id", { count: "exact", head: true }).eq("tenant", tenant).eq("periodo", mesActual).not("conciliacion_id", "is", null)
      : Promise.resolve({ count: 0 }),
    // Retenciones del mes — antes bajaba cada fila de retenciones_cxp del
    // mes para sumarlas en JS; ahora un único escalar.
    contable
      ? supabase.rpc("fn_dashboard_retenciones_mes", { p_tenant: tenant, p_periodo: mesActual })
      : Promise.resolve({ data: 0 }),
    // Meta general de ventas (mes actual, TODAS las monedas configuradas —
    // ya no se fija a COP: cada moneda con ventas efectivas se compara
    // contra SU PROPIA meta, nunca una contra otra). Resultado ya pequeño
    // por diseño (unicidad tenant+periodo+moneda, como mucho un puñado de filas).
    interno
      ? supabase.from("meta_ventas_mensual").select("moneda, valor").eq("tenant", tenant).eq("periodo", mesActual)
      : Promise.resolve({ data: [] as { moneda: string; valor: number }[] }),
    // Cartera al día/vencida por moneda — antes bajaba TODAS las ventas Y
    // TODOS los abonos del tenant para calcular el saldo por contrato en JS.
    interno
      ? supabase.rpc("fn_dashboard_cartera_por_moneda", { p_tenant: tenant, p_hoy: hoyBogota })
      : Promise.resolve({ data: [] as { moneda: string; al_dia: number; vencida: number; sin_fecha: number; sin_fecha_count: number }[] }),
    // Ventas del mes por moneda — antes bajaba TODO el histórico de ventas
    // del tenant solo para filtrar por mes y sumar en JS.
    interno
      ? supabase.rpc("fn_dashboard_ventas_mes", { p_tenant: tenant, p_periodo: mesActual })
      : Promise.resolve({ data: [] as { moneda: string; total: number }[] }),
  ]);

  // Contratos: denominador = TODOS los vigentes no cancelados (pendiente +
  // confirmado + activo); numerador = confirmado O activo (filtro explícito,
  // nunca resta — ver `clasificarContratosDesdeConteos` en
  // lib/dashboard/metricas.ts para la semántica completa de cada estado y
  // las pruebas que prueban "2 pendientes + 3 confirmados + 1 activo + 1
  // cancelado → 4 de 6"). La fórmula es IDÉNTICA a la ronda anterior — solo
  // cambió de dónde vienen los conteos (agrupados en base, no filas sueltas).
  const { nVigentes, nPendientes, nConfirmadosOActivos } = clasificarContratosDesdeConteos(contratosPorEstado ?? []);
  // Ventas del mes — FÓRMULA CORREGIDA: solo 'confirmado'/'activo' cuentan
  // como venta efectiva (ni 'pendiente' —borrador sin confirmar— ni
  // 'cancelado'). Agrupado ESTRICTAMENTE por moneda — nunca se mezcla COP
  // con USD; una moneda no reconocida cae aparte y no se usa en ninguna
  // comparación contra meta. Ver `ventasMesPorMoneda`/
  // `ventasMesPorMonedaDesdeAgregado` (lib/dashboard/metricas.ts) para la
  // evidencia completa y pruebas/dashboardMetricasAgregadas.test.ts para la
  // paridad RPC↔función pura.
  const ventasPorMoneda = ventasMesPorMonedaDesdeAgregado(ventaMesFilas ?? []);
  const ventaMes = ventasPorMoneda["COP"] ?? 0;

  const { cuposCapacidad, cuposOcupados, cuposDisponibles, cuposCriticos } = cuposResumenDesdeAgregado(cuposFila ?? null);

  // Cartera al día/vencida — regla de negocio exacta: fecha límite de pago =
  // fecha inicial del viaje − 30 días calendario, en zona horaria de Bogotá
  // (`hoyBogota`, calculado arriba y pasado tal cual a la función de base —
  // la regla de negocio de "hoy en Bogotá" sigue resuelta en un solo lugar,
  // el server Next, nunca en SQL). La "fecha inicial real del viaje" se toma
  // de `ventas.fecha_salida`: es el campo que el propio sistema ya trata
  // como fecha de viaje canónica de la venta (se llena al crear el contrato
  // desde la fecha de ida elegida — bloqueo, porción por fechas o dinámico
  // — y YA se reutiliza así en otro lugar del código, ej.
  // `contratos/actions.ts` cae a `fecha_salida` como vencimiento por defecto
  // de una CxP cuando no hay plazo explícito). Fórmula completa (saldo,
  // exclusiones, sin-fecha, moneda) replicada 1:1 en SQL en
  // `fn_dashboard_cartera_por_moneda` — la paridad con las funciones puras
  // ya probadas (`clasificarCartera`/`fechaLimitePago`, que se mantienen
  // intactas como oráculo) está probada en
  // pruebas/dashboardMetricasAgregadas.test.ts.
  const carteraPorMoneda = carteraPorMonedaDesdeAgregado(carteraFilas ?? []);
  const carteraCOP = carteraPorMoneda["COP"] ?? { alDia: 0, vencida: 0, sinFecha: 0, sinFechaCount: 0 };
  const carteraClasificableCOP = carteraCOP.alDia + carteraCOP.vencida;
  const carteraTotalCOP = carteraClasificableCOP + carteraCOP.sinFecha;
  const carteraPctCOP = pctOrNull(carteraCOP.alDia, carteraClasificableCOP);
  // Otras monedas (ej. USD, contratos internacionales) — se listan por
  // separado, nunca convertidas a COP sin una TRM persistida y autorizada
  // para este cálculo (no existe tal TRM "de cartera" en el modelo).
  const carteraOtras = Object.entries(carteraPorMoneda).filter(([m]) => m !== "COP");

  // Meta por moneda — COP se compara SOLO contra meta COP, USD SOLO contra
  // meta USD; nunca se convierte una a la otra. Si hay meta COP pero cero
  // ventas COP el avance es 0% (no "sin meta"); si hay ventas COP pero
  // ninguna meta COP configurada, la cifra se muestra igual pero sin barra.
  const metaPorMoneda: Record<string, number> = {};
  for (const f of metaVentasFilas ?? []) metaPorMoneda[f.moneda] = Number(f.valor) || 0;

  const metaVentas = metaPorMoneda["COP"] ?? null;
  // % principal (texto + ancho de la barra): SIEMPRE acotado 0-100, igual
  // que cualquier otra barra del Dashboard — superar la meta nunca se
  // muestra como "134%" en el número principal.
  const metaVentasPct = metaVentas != null ? pctOrNull(ventaMes, metaVentas) : null;
  // % sin acotar, usado SOLO para detectar y cuantificar el excedente (nunca
  // se pinta como el % principal ni como ancho de barra).
  const metaVentasPctCrudo = metaVentas != null ? pctRawOrNull(ventaMes, metaVentas) : null;
  const metaSuperadaPor = metaVentas != null && metaVentasPctCrudo != null && metaVentasPctCrudo > 100 ? ventaMes - metaVentas : null;

  // Moneda(s) distintas de COP con ventas efectivas y/o meta configurada
  // (ej. USD) — tarjeta aparte, nunca convertida ni sumada a COP. El balde
  // de moneda no reconocida (`ventasMesPorMoneda`/`BALDE_MONEDA_DESCONOCIDA`)
  // se excluye explícitamente: nunca se compara contra ninguna meta.
  const ventaMesOtras = Object.keys({ ...ventasPorMoneda, ...metaPorMoneda })
    .filter((m) => m !== "COP" && m !== BALDE_MONEDA_DESCONOCIDA)
    .map((moneda) => ({
      moneda,
      venta: ventasPorMoneda[moneda] ?? 0,
      meta: metaPorMoneda[moneda] ?? null,
    }));

  // Cuentas por pagar próximas a vencer (15d) ya pagadas POR COMPLETO — el
  // cruce con cxp_pagos (JOIN + agregación) ya se hizo en base
  // (`fn_dashboard_cxp_resumen`); acá solo se leen los 2 números. Sigue
  // siendo un CONTEO, nunca una suma de $ (valor_total puede estar en COP o
  // USD según el contrato de origen, mezclar monedas en una sola cifra daría
  // un número sin sentido). Solo se pide si el rol es `interno` (el mismo
  // que ya gateaba esta tarjeta).
  const cxpTotal = cxpResumen?.total ?? 0;
  const cxpPagadas = cxpResumen?.pagadas ?? 0;

  const dianTotal = nDianTotal ?? 0;
  const dianEmitidas = nDianEmitidas ?? 0;
  const concTotal = nConcTotal ?? 0;
  const concHechas = nConcHechas ?? 0;
  const retencionMes = Number(retencionMesData ?? 0) || 0;

  // Zona horaria Colombia: el server (UTC) no debe adelantar el día en la noche.
  const hoy = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });
  const nombre = (perfil?.nombre ?? user?.email ?? "").split("@")[0];

  const OCULTOS_MINORISTA = new Set(["/dashboard/tarifario", "/dashboard/reservar", "/dashboard/producto", "/dashboard/paquetes", "/dashboard/vuelos"]);
  const modulos = MODULOS.filter((m) => (!m.interno || interno) && !(esMinorista && OCULTOS_MINORISTA.has(m.href)));

  // Barras de progreso: solo se arman cuando el numerador y denominador son
  // reales y están semánticamente relacionados (pctOrNull vuelve null sin
  // denominador válido → esa tarjeta no lleva barra).
  const contratosPct = pctOrNull(nConfirmadosOActivos, nVigentes);
  const cuposPct = pctOrNull(cuposOcupados, cuposCapacidad);
  const cxpPct = pctOrNull(cxpPagadas, cxpTotal);
  const dianPct = pctOrNull(dianEmitidas, dianTotal);
  const concPct = pctOrNull(concHechas, concTotal);
  // Cupos: colores según estados YA calculados arriba (mismo umbral que la
  // alerta "Cupos críticos", no uno nuevo) — sin cupos en todo el inventario
  // = crítico; al menos un bloqueo con ≤3 cupos = advertencia; el resto,
  // acento normal.
  const cuposBarColor =
    cuposCapacidad > 0 && cuposOcupados >= cuposCapacidad ? "var(--dash-danger)"
    : cuposCriticos > 0 ? "var(--dash-warning)"
    : undefined;

  type Bar = { num: number; den: number; pct: number; color?: string };
  // Métricas reales, en el orden pedido (contratos, ventas, cartera, cupos,
  // paquetes, salidas próximas, pagos por vencer, conciliaciones, DIAN,
  // retenciones) — cada una SOLO si ya estaba permitida por rol/tenant en el
  // cálculo de arriba (sin excepciones nuevas salvo las 3 nuevas tarjetas
  // `contable`, que reflejan exactamente la RLS real de sus tablas). El badge
  // de "pendientes de firma" en Contratos reutiliza `nPendientes`, ya
  // calculado (antes solo se mostraba como alerta aparte).
  const metricas: { icon: LucideIcon; label: string; value: string; sub?: string; bar?: Bar }[] = [
    {
      icon: FileSignature, label: "Contratos", value: String(nVigentes),
      sub: nPendientes > 0 ? `${nPendientes} pendiente(s) de firma` : "Sin pendientes de firma",
      // Numerador = confirmados o activos (ambos = "ya no es borrador", ver
      // semántica documentada en `clasificarContratos`); denominador = TODOS
      // los vigentes (pendientes quedan solo ahí, nunca en el numerador).
      // Nunca puede superar 100% — ver lib/dashboard/metricas.ts.
      bar: contratosPct != null ? { num: nConfirmadosOActivos, den: nVigentes, pct: contratosPct } : undefined,
    },
    ...(interno ? [{
      icon: Wallet, label: "Ventas del mes", value: formatCOP(ventaMes),
      // "Meta general del mes" (no "meta" a secas): distingue esta cifra
      // PERSISTIDA y editada a mano de cualquier cálculo dinámico de punto
      // de equilibrio (pe_empleados/pe_costos) — ver nota en MetaVentasConfig.
      sub: metaVentas == null
        ? "Sin meta general configurada"
        : metaSuperadaPor != null
          ? `Meta general superada por ${formatCOP(metaSuperadaPor)}`
          : `Meta general del mes: ${formatCOP(metaVentas)}`,
      // Sin meta general configurada: NUNCA se dibuja barra ni se asume 0 —
      // pctOrNull vuelve null y el bar queda undefined. El % mostrado y el
      // ancho SIEMPRE quedan acotados 0-100 (metaVentasPct usa pctOrNull, no
      // la variante cruda) — superar la meta se comunica aparte, en el sub.
      bar: metaVentas != null && metaVentasPct != null ? { num: ventaMes, den: metaVentas, pct: metaVentasPct } : undefined,
    }] : []),
    // Ventas del mes en otras monedas (ej. USD) — tarjeta aparte, comparada
    // SOLO contra una meta de esa MISMA moneda si existe (nunca contra la
    // meta COP, nunca convertida). Sin meta de esa moneda: cifra visible,
    // sin barra — igual criterio que la tarjeta COP.
    ...(interno ? ventaMesOtras.map(({ moneda, venta, meta }) => {
      const pct = meta != null ? pctOrNull(venta, meta) : null;
      return {
        icon: Wallet, label: `Ventas del mes (${moneda})`, value: moneda === "USD" ? formatUSD(venta) : `${venta.toLocaleString("es-CO")} ${moneda}`,
        sub: meta == null ? "Sin meta general configurada" : `Meta general del mes: ${moneda === "USD" ? formatUSD(meta) : meta.toLocaleString("es-CO")}`,
        bar: meta != null && pct != null ? { num: venta, den: meta, pct } : undefined,
      };
    }) : []),
    ...(interno ? [{
      icon: HandCoins, label: "Cartera por cobrar (COP)", value: formatCOP(carteraTotalCOP),
      sub: carteraCOP.sinFechaCount > 0
        ? `${carteraCOP.sinFechaCount} contrato(s) sin fecha de viaje (${formatCOP(carteraCOP.sinFecha)}, sin clasificar)`
        : (carteraClasificableCOP > 0 ? "Excluye contratos pagados por completo" : "Sin cartera pendiente"),
      // Barra = al día / cartera CLASIFICABLE (al día + vencida) — el saldo
      // sin fecha de viaje queda fuera del %, nunca se asume "al día".
      bar: carteraPctCOP != null ? { num: carteraCOP.alDia, den: carteraClasificableCOP, pct: carteraPctCOP, color: carteraCOP.vencida > 0 ? "var(--dash-danger)" : undefined } : undefined,
    }] : []),
    // Cartera en otras monedas (ej. USD) — tarjeta aparte, nunca sumada a la
    // de COP: evita mezclar monedas o inventar una conversión.
    ...(interno ? carteraOtras.map(([moneda, b]) => {
      const clasificable = b.alDia + b.vencida;
      const total = clasificable + b.sinFecha;
      const p = pctOrNull(b.alDia, clasificable);
      return {
        icon: HandCoins, label: `Cartera por cobrar (${moneda})`, value: moneda === "USD" ? formatUSD(total) : `${total.toLocaleString("es-CO")} ${moneda}`,
        sub: b.sinFechaCount > 0 ? `${b.sinFechaCount} contrato(s) sin fecha de viaje, sin clasificar` : undefined,
        bar: p != null ? { num: b.alDia, den: clasificable, pct: p, color: b.vencida > 0 ? "var(--dash-danger)" : undefined } : undefined,
      };
    }) : []),
    ...(!esMinorista ? [{
      icon: Armchair, label: "Cupos disponibles", value: String(cuposDisponibles),
      bar: cuposPct != null ? { num: cuposOcupados, den: cuposCapacidad, pct: cuposPct, color: cuposBarColor } : undefined,
    }] : []),
    ...(!esMinorista ? [{ icon: Package, label: "Paquetes activos", value: String(nPaquetes ?? 0) }] : []),
    ...(!esMinorista ? [{ icon: PlaneTakeoff, label: "Salidas próximas (14d)", value: String(nSalidas ?? 0) }] : []),
    ...(interno ? [{
      icon: Receipt, label: "Pagos por vencer (15d)", value: String(cxpTotal),
      sub: cxpTotal > 0 ? `${cxpPagadas} de ${cxpTotal} ya saldada(s) por completo` : "Sin cuentas por vencer",
      // Universo: TODAS las cuentas que vencen en 15d (cxpTotal), pagadas o
      // no — las ya pagadas SIGUEN contando en el total, nunca se excluyen.
      bar: cxpPct != null ? { num: cxpPagadas, den: cxpTotal, pct: cxpPct } : undefined,
    }] : []),
    ...(contable ? [{
      icon: FileCheck2, label: "Conciliaciones del mes", value: String(concTotal),
      sub: concTotal > 0 ? `${concHechas} conciliada(s)` : "Sin movimientos importados este mes",
      bar: concPct != null ? { num: concHechas, den: concTotal, pct: concPct } : undefined,
    }] : []),
    ...(contable ? [{
      icon: ShieldCheck, label: "Facturación DIAN", value: String(dianTotal),
      sub: dianTotal > 0 ? `${dianEmitidas} emitida(s)` : "Sin contratos configurados",
      bar: dianPct != null ? { num: dianEmitidas, den: dianTotal, pct: dianPct } : undefined,
    }] : []),
    ...(contable ? [{ icon: Percent, label: "Retención en la fuente (mes)", value: formatCOP(retencionMes), sub: "Practicada a proveedores" }] : []),
  ];

  // Alertas: SOLO cupos críticos y pagos por vencer (sin aerolíneas ni datos
  // inventados) — ambas ya calculadas arriba, mismo gating que sus métricas.
  const alertas: { icon: LucideIcon; label: string; n: number; href: string }[] = [
    ...(!esMinorista ? [{ icon: AlertTriangle, label: "Cupos críticos", n: cuposCriticos, href: "/dashboard/vuelos" }] : []),
    ...(interno ? [{ icon: Receipt, label: "Pagos por vencer (15d)", n: cxpTotal, href: "/dashboard/pagos" }] : []),
  ];

  return (
    <div className="p-4 md:p-7">
      {/* 1. Cabecera operativa — saludo real, fecha, rol, texto factual. */}
      <header className="rounded-lg border p-6" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: "var(--dash-ink-muted)" }}>{hoy}</p>
        <h1 className={`${styles.heading} mt-1.5 text-2xl font-bold capitalize md:text-[28px]`} style={{ color: "var(--dash-ink)" }}>
          Hola, {nombre}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide capitalize" style={{ backgroundColor: "var(--dash-highlight)", color: "var(--dash-primary)" }}>
            {perfil?.rol ?? "—"}
          </span>
          <span className="text-sm" style={{ color: "var(--dash-ink-muted)" }}>
            Resumen de contratos, ventas, cupos y pagos según tu perfil.
          </span>
        </div>
      </header>

      {/* 2. Flujo operativo — mismos pasos de siempre (FLUJO), sin contadores. */}
      <section className="mt-5 rounded-lg border p-4" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Flujo operativo</h2>
        <div className="flex flex-wrap items-stretch gap-y-3">
          {FLUJO.map((m, i) => (
            <div key={m.href} className="flex items-center">
              <Link
                href={m.href}
                prefetch={false}
                className="group flex w-[104px] flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-colors hover:bg-[var(--dash-muted-surface)]"
                style={{ borderColor: "var(--dash-border)" }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-md" style={{ backgroundColor: "var(--dash-muted-surface)", color: "var(--dash-primary)" }}>
                  <m.icon size={17} strokeWidth={2} />
                </span>
                <span className="text-[11px] font-semibold leading-tight" style={{ color: "var(--dash-ink)" }}>{m.label}</span>
              </Link>
              {i < FLUJO.length - 1 && <ArrowRight size={16} className="mx-1 shrink-0" style={{ color: "var(--dash-ink-muted)" }} />}
            </div>
          ))}
        </div>
      </section>

      {/* 3. Métricas reales */}
      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {metricas.map((m) => <MetricCard key={m.label} {...m} />)}
      </section>

      {/* 4. Alertas reales (solo si hay al menos una aplicable) */}
      {alertas.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Alertas</h2>
          <div className="flex flex-wrap gap-2">
            {alertas.map((a) => <AlertChip key={a.label} {...a} />)}
          </div>
        </section>
      )}

      {/* 5. Módulos — mismo catálogo y gating de siempre (MODULOS). */}
      <h2 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Módulos</h2>
      <ModulosGrid modulos={modulos} />
    </div>
  );
}

function ModulosGrid({ modulos }: { modulos: typeof MODULOS }) {
  return (
    <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {modulos.map((m) => (
        <Link
          key={m.href}
          href={m.href}
          prefetch={false}
          className="group flex items-center gap-3 rounded-lg border p-3.5 transition-colors hover:bg-[var(--dash-muted-surface)]"
          style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md" style={{ backgroundColor: "var(--dash-muted-surface)", color: `var(${m.color})` }}>
            <m.icon size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: "var(--dash-ink)" }}>{m.label}</div>
            <div className="truncate text-xs" style={{ color: "var(--dash-ink-muted)" }}>{m.desc}</div>
          </div>
          <ChevronRight size={16} className="shrink-0 transition-colors" style={{ color: "var(--dash-ink-muted)" }} />
        </Link>
      ))}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, sub, bar }: {
  icon: LucideIcon; label: string; value: string; sub?: string;
  bar?: { num: number; den: number; pct: number; color?: string };
}) {
  return (
    <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--dash-kpi-surface)", borderColor: "var(--dash-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: "var(--dash-surface)", color: "var(--dash-primary)" }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--dash-ink-muted)" }}>{label}</span>
      </div>
      <div className={`${styles.heading} mt-3 text-2xl font-semibold tabular-nums`} style={{ color: "var(--dash-ink)" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] capitalize" style={{ color: "var(--dash-ink-muted)" }}>{sub}</div>}
      {bar && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] tabular-nums" style={{ color: "var(--dash-ink-muted)" }}>
            <span>{bar.num} de {bar.den}</span>
            <span className="font-semibold">{bar.pct}%</span>
          </div>
          <div className={styles.barTrack}>
            {/* El ancho se acota a 100% aunque el % mostrado no lo esté (ej.
                ventas que superan la meta) — la barra nunca desborda su pista. */}
            <div className={styles.barFill} style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%`, backgroundColor: bar.color ?? "var(--dash-accent)" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function AlertChip({ icon: Icon, label, n, href }: { icon: LucideIcon; label: string; n: number; href: string }) {
  const apagada = n === 0;
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
      style={
        apagada
          ? { borderColor: "var(--dash-border)", color: "var(--dash-ink-muted)", backgroundColor: "var(--dash-surface)" }
          : { borderColor: "var(--dash-danger)", color: "var(--dash-danger)", backgroundColor: "var(--dash-muted-surface)" }
      }
    >
      <Icon size={15} />
      <span>{label}</span>
      <span
        className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
        style={apagada ? { backgroundColor: "var(--dash-border)", color: "var(--dash-ink-muted)" } : { backgroundColor: "var(--dash-danger)", color: "white" }}
      >
        {n}
      </span>
    </Link>
  );
}

const FLUJO: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/dashboard/tarifario", icon: Tags, label: "Tarifario" },
  { href: "/dashboard/cotizaciones", icon: FileText, label: "Cotización" },
  { href: "/dashboard/reservar", icon: Ticket, label: "Reserva" },
  { href: "/dashboard/contratos", icon: FileSignature, label: "Contrato" },
  { href: "/dashboard/vuelos", icon: Plane, label: "Inventario" },
  { href: "/dashboard/rentabilidad", icon: LineChart, label: "Finanzas" },
];

const MODULOS: { href: string; icon: LucideIcon; label: string; desc: string; color: "--dash-accent" | "--dash-primary" | "--dash-success"; interno: boolean }[] = [
  { href: "/dashboard/tarifario", icon: Tags, label: "Tarifario", desc: "Hoteles y precios", color: "--dash-accent", interno: false },
  { href: "/dashboard/reservar", icon: Ticket, label: "Reservar", desc: "Generar contrato", color: "--dash-primary", interno: false },
  { href: "/dashboard/producto", icon: Boxes, label: "Producto", desc: "Hoteles, vuelos, programas", color: "--dash-success", interno: true },
  { href: "/dashboard/paquetes", icon: Package, label: "Paquetes", desc: "Armado y margen", color: "--dash-accent", interno: true },
  { href: "/dashboard/contratos", icon: FileSignature, label: "Contratos", desc: "Ventas y estados", color: "--dash-primary", interno: false },
  { href: "/dashboard/vuelos", icon: Plane, label: "Vuelos", desc: "Bloqueos y sillas", color: "--dash-accent", interno: true },
  { href: "/dashboard/cartera", icon: HandCoins, label: "Cartera", desc: "Por cobrar / abonos", color: "--dash-success", interno: true },
  { href: "/dashboard/pagos", icon: Receipt, label: "Pagos", desc: "Por pagar a proveedores", color: "--dash-primary", interno: true },
  { href: "/dashboard/finanzas", icon: LineChart, label: "Finanzas", desc: "Relación de utilidades", color: "--dash-accent", interno: true },
  { href: "/dashboard/configuracion", icon: Settings, label: "Configuración", desc: "Asesores y parámetros", color: "--dash-success", interno: true },
];
