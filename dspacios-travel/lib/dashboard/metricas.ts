// Funciones puras y testeables detrás de los KPI del Dashboard administrativo
// (app/(dashboard)/dashboard/page.tsx) — mismo criterio que
// lib/finanzas/pagosCxp.ts/retenciones.ts: la lógica de negocio vive aparte
// de la consulta/render, para poder probarla con datos de mentira sin tocar
// Supabase ni React.

// Denominador real requerido para publicar una barra de progreso: sin
// numerador/denominador semánticamente relacionados no hay barra (evita
// dividir por cero y evita convertir conteos incompatibles en %). SIEMPRE
// acotado a [0,100] — es el que se usa como % PRINCIPAL y como ancho de
// cualquier barra del Dashboard, incluida "ventas vs. meta general": superar
// la meta nunca se muestra como "134%" en el número principal ni desborda la
// barra (ver `pctRawOrNull` para cuantificar el excedente aparte).
export function pctOrNull(num: number, den: number): number | null {
  if (!den || den <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((num / den) * 100)));
}

// Variante SIN acotar a 100 — únicamente para DETECTAR y cuantificar que una
// comparación superó su referencia (ej. ventas > meta general). Nunca se usa
// como el % principal ni como ancho de barra — ver el uso en dashboard/page.tsx.
export function pctRawOrNull(num: number, den: number): number | null {
  if (!den || den <= 0) return null;
  return Math.max(0, Math.round((num / den) * 100));
}

export type EstadoVenta = string | null;

// Semántica real de `ventas.estado` (confirmada en el flujo de creación):
// 'pendiente'  → nace así en Reservar (tarifario/bloqueo/porción/dinámico),
//                se auto-confirma con el abono mínimo o con "Confirmar venta".
// 'confirmado' → ese mismo flujo tras confirmarse, y el importador de
//                histórico minorista (que nunca pasa por 'pendiente').
// 'activo'     → el generador de contrato MANUAL (único camino en minorista)
//                nace directo así, SIN pasar por 'pendiente' — CLAUDE.md
//                documenta que se trata igual que 'confirmado' en el
//                badge/documento (misma idea de "ya no es borrador", por un
//                camino de creación distinto).
// 'cancelado'  → terminal, excluido de todo lo demás.
//
// Denominador = TODOS los contratos vigentes no cancelados (pendiente +
// confirmado + activo). Numerador = confirmado o activo — un FILTRO
// explícito sobre ese mismo conjunto (nunca una resta), así que nunca puede
// superar el denominador, ni siquiera si apareciera un 5º estado no
// contemplado aquí (ese caso simplemente no contaría en ningún lado).
export function clasificarContratos(ventas: { estado: EstadoVenta }[]): {
  nVigentes: number;
  nPendientes: number;
  nConfirmadosOActivos: number;
} {
  const vigentes = ventas.filter((v) => v.estado !== "cancelado");
  const nPendientes = ventas.filter((v) => v.estado === "pendiente").length;
  const ESTADOS_CONFIRMADO_O_ACTIVO = new Set(["confirmado", "activo"]);
  const nConfirmadosOActivos = vigentes.filter((v) => ESTADOS_CONFIRMADO_O_ACTIVO.has(v.estado ?? "")).length;
  return { nVigentes: vigentes.length, nPendientes, nConfirmadosOActivos };
}

// Misma fórmula que `clasificarContratos`, pero a partir de conteos YA
// agrupados por estado en base (RPC `fn_dashboard_contratos_por_estado`) en
// vez de las filas individuales de `ventas` — el Dashboard ya no descarga un
// contrato por fila solo para contarlos en JS. La semántica de qué cuenta
// como "vigente"/"pendiente"/"confirmado o activo" sigue viviendo ACÁ (un
// solo lugar), no se duplicó en SQL — la función SQL solo agrupa y cuenta
// por `estado` tal cual viene, sin interpretar nada.
export function clasificarContratosDesdeConteos(porEstado: { estado: string; n: number }[]): {
  nVigentes: number;
  nPendientes: number;
  nConfirmadosOActivos: number;
} {
  const ESTADOS_CONFIRMADO_O_ACTIVO = new Set(["confirmado", "activo"]);
  let nVigentes = 0;
  let nPendientes = 0;
  let nConfirmadosOActivos = 0;
  for (const { estado, n } of porEstado) {
    const cantidad = Number(n) || 0;
    if (estado === "cancelado") continue;
    nVigentes += cantidad;
    if (estado === "pendiente") nPendientes += cantidad;
    if (ESTADOS_CONFIRMADO_O_ACTIVO.has(estado)) nConfirmadosOActivos += cantidad;
  }
  return { nVigentes, nPendientes, nConfirmadosOActivos };
}

// Estados que representan una venta EFECTIVA para "ventas del mes vs. meta
// general" — misma evidencia de flujo que `clasificarContratos` arriba:
// 'pendiente' es un borrador (Reservar, aún sin confirmar ni alcanzar el
// abono mínimo) — NO es una venta consolidada todavía, así que NO cuenta
// contra la meta aunque sí cuente como "contrato vigente" en la tarjeta de
// Contratos (son dos preguntas distintas: "¿existe el contrato?" vs. "¿ya es
// una venta real?"). 'cancelado' es terminal. 'confirmado'/'activo' son las
// dos formas de "ya es una venta real" — mismo set que
// `ESTADOS_CONFIRMADO_O_ACTIVO`, coincide porque ambas preguntas ("ya no es
// borrador" y "cuenta como venta") resultan tener la misma respuesta en este
// modelo, no por casualidad forzada.
const ESTADOS_VENTA_EFECTIVA = new Set(["confirmado", "activo"]);

// Únicas monedas reales del sistema (`ventas.moneda` es NOT NULL default
// 'COP' — ver migración 031; USD es la otra moneda soportada de punta a
// punta). Cualquier otro valor (defensivo: dato corrupto, o una moneda que
// el sistema aún no soporta en el Dashboard) cae en el balde `OTRA` — nunca
// se mezcla con COP ni con USD, y NUNCA se compara contra ninguna meta
// (una meta solo existe para una moneda conocida y explícita).
const MONEDAS_VENTAS_CONOCIDAS = new Set(["COP", "USD"]);
export const BALDE_MONEDA_DESCONOCIDA = "OTRA";

export type VentaMesRow = { estado: EstadoVenta; moneda: string | null; fecha_venta: string | null; precio_venta: number | null };

// Oráculo (filas individuales) — periodo en formato 'YYYY-MM', comparado por
// prefijo de `fecha_venta` (la fecha comercial: se estampa en el momento en
// que nace la venta — `ventas.fecha_venta date not null default
// current_date`, migración 002 — nunca la fecha de viaje). Agrupa
// ESTRICTAMENTE por moneda: nunca suma COP con USD en la misma cifra.
export function ventasMesPorMoneda(ventas: VentaMesRow[], periodo: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of ventas) {
    if (!ESTADOS_VENTA_EFECTIVA.has(v.estado ?? "")) continue;
    if (!(v.fecha_venta ?? "").startsWith(periodo)) continue;
    const moneda = MONEDAS_VENTAS_CONOCIDAS.has(v.moneda ?? "") ? (v.moneda as string) : BALDE_MONEDA_DESCONOCIDA;
    out[moneda] = (out[moneda] ?? 0) + (v.precio_venta ?? 0);
  }
  return out;
}

// Misma fórmula que `ventasMesPorMoneda`, pero a partir de filas YA
// agregadas en base (RPC `fn_dashboard_ventas_mes`, que filtra estado y
// periodo y agrupa por moneda en SQL) — el Dashboard no vuelve a filtrar por
// estado/periodo/moneda acá; solo reclasifica una moneda no reconocida al
// balde `OTRA` (defensivo, no debería ocurrir dado el NOT NULL de la
// columna) y nunca deja que ese balde se mezcle con COP/USD.
export function ventasMesPorMonedaDesdeAgregado(filas: { moneda: string; total: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filas) {
    const moneda = MONEDAS_VENTAS_CONOCIDAS.has(f.moneda) ? f.moneda : BALDE_MONEDA_DESCONOCIDA;
    out[moneda] = (out[moneda] ?? 0) + (Number(f.total) || 0);
  }
  return out;
}

export type CuposActivos = {
  cuposCapacidad: number; cuposOcupados: number;
  sillasDisponibles: number; recordsConSillas: number;
  proximasSillas: number; proximosRecords: number;
};

// Reempaqueta la fila única de `fn_dashboard_cupos_activos` (migración 243).
export function cuposActivosDesdeAgregado(fila: {
  capacidad: number; ocupados: number; disponibles: number; records_disponibles: number;
  proximos_disponibles: number; proximos_records: number;
} | null): CuposActivos {
  const n = (v: number | undefined) => Number(v ?? 0) || 0;
  return {
    cuposCapacidad: n(fila?.capacidad), cuposOcupados: n(fila?.ocupados),
    sillasDisponibles: n(fila?.disponibles), recordsConSillas: n(fila?.records_disponibles),
    proximasSillas: n(fila?.proximos_disponibles), proximosRecords: n(fila?.proximos_records),
  };
}

// Suma `n` días a una fecha ISO (YYYY-MM-DD) sin depender de la zona horaria del proceso.
export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Espejo en JS de la regla de `fn_dashboard_cupos_activos` (paridad en pruebas).
// `hoy` = fecha de Bogotá (YYYY-MM-DD). Activo = sin fecha o fecha >= hoy;
// próximo = activo con fecha entre hoy y hoy+14 inclusive (el día 15 no entra).
export function cuposActivosDesdeFilas(
  filas: { fecha_ida: string | null; cupos_total: number; cupos_ocupados: number; cupos_disponibles: number }[],
  hoy: string,
): CuposActivos {
  const tope = sumarDias(hoy, 14);
  const r: CuposActivos = { cuposCapacidad: 0, cuposOcupados: 0, sillasDisponibles: 0, recordsConSillas: 0, proximasSillas: 0, proximosRecords: 0 };
  for (const f of filas) {
    if (f.fecha_ida && f.fecha_ida < hoy) continue;
    const d = Math.max(0, f.cupos_disponibles);
    r.cuposCapacidad += f.cupos_total; r.cuposOcupados += f.cupos_ocupados; r.sillasDisponibles += d;
    if (d > 0) r.recordsConSillas++;
    if (f.fecha_ida && f.fecha_ida <= tope) { r.proximasSillas += d; if (d > 0) r.proximosRecords++; }
  }
  return r;
}

// Regla de negocio exacta: fecha límite de pago = fecha inicial del viaje −
// 30 días calendario. `fechaSalida` es la fecha ISO (YYYY-MM-DD) que
// `ventas.fecha_salida` ya guarda como la fecha de viaje canónica de la
// venta (se llena al crear el contrato desde la fecha de ida elegida —
// bloqueo, porción por fechas o dinámico). Se ancla a mediodía UTC antes de
// restar para que el cambio de mes/año no dependa de la hora local del
// proceso que corre esta función.
export function fechaLimitePago(fechaSalida: string): string {
  const d = new Date(`${fechaSalida}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

export type CarteraBucket = { alDia: number; vencida: number; sinFecha: number; sinFechaCount: number };

export type VentaCartera = {
  numero_contrato: string;
  precio_venta: number | null;
  fecha_salida: string | null;
  estado: EstadoVenta;
  moneda: string | null;
};

// Clasifica el saldo pendiente de cada venta EFECTIVA (mismo criterio que
// `ESTADOS_VENTA_EFECTIVA` — 'confirmado'/'activo', ver más abajo) en al
// día/vencida/sin-fecha, agrupado POR MONEDA (nunca se suma COP con USD en
// un mismo balde — ver dashboard/page.tsx para cómo se presenta cada moneda
// por separado). `hoyBogota` debe ser la fecha ISO (YYYY-MM-DD) del día
// actual en zona horaria de Bogotá — la comparación es estrictamente
// textual (funciona porque ambos lados son siempre 'YYYY-MM-DD').
//
// ⚠️ El caller es responsable de filtrar a solo 'confirmado'/'activo' ANTES
// de llamar esta función (mismo criterio que `fn_dashboard_cartera_por_moneda`
// en SQL) — un 'pendiente' (borrador de Reservar, aún sin confirmar ni
// alcanzar el abono mínimo) no genera cartera por cobrar todavía, no es una
// venta consolidada. 'cancelado' tampoco. Esta función NO vuelve a filtrar
// por estado internamente (recibe las filas ya filtradas), igual que antes
// solo recibía "no canceladas" — el filtro se endureció (ahora exige
// EFECTIVA, no solo "no cancelada") porque 'pendiente' se colaba.
//
// Reglas:
//  - saldo = precio_venta − abonos del contrato; saldo ≤ 0 (pagado por
//    completo) se EXCLUYE por completo de la cartera pendiente.
//  - sin `fecha_salida`: NUNCA se asume "al día" — va al balde `sinFecha`,
//    fuera de la clasificación vencida/al día.
//  - vencida: hoyBogota > fechaLimitePago(fecha_salida) (estrictamente
//    posterior — el día exacto del límite TODAVÍA cuenta como al día).
//  - al día: lo contrario (incluye el día exacto del límite).
export function clasificarCartera(
  ventasEfectivas: VentaCartera[],
  abonosPorContrato: Record<string, number>,
  hoyBogota: string
): Record<string, CarteraBucket> {
  const porMoneda: Record<string, CarteraBucket> = {};
  for (const v of ventasEfectivas) {
    const saldo = (v.precio_venta ?? 0) - (abonosPorContrato[v.numero_contrato] ?? 0);
    if (saldo <= 0) continue;
    const moneda = v.moneda || "COP";
    const bucket = porMoneda[moneda] ?? (porMoneda[moneda] = { alDia: 0, vencida: 0, sinFecha: 0, sinFechaCount: 0 });
    if (!v.fecha_salida) {
      bucket.sinFecha += saldo;
      bucket.sinFechaCount += 1;
      continue;
    }
    if (hoyBogota > fechaLimitePago(v.fecha_salida)) bucket.vencida += saldo;
    else bucket.alDia += saldo;
  }
  return porMoneda;
}

// Reempaqueta las filas que devuelve `fn_dashboard_cartera_por_moneda` (una
// por moneda, ya agregadas en base) a la MISMA forma que producía
// `clasificarCartera` a partir de filas individuales — el Dashboard deja de
// descargar ventas/abonos completos para este cálculo, pero el resto del
// código (bar, colores, sub-textos) no cambia ni una línea porque consume
// exactamente la misma forma `Record<moneda, CarteraBucket>`.
export function carteraPorMonedaDesdeAgregado(
  filas: { moneda: string; al_dia: number; vencida: number; sin_fecha: number; sin_fecha_count: number }[]
): Record<string, CarteraBucket> {
  const out: Record<string, CarteraBucket> = {};
  for (const f of filas) {
    out[f.moneda] = {
      alDia: Number(f.al_dia) || 0,
      vencida: Number(f.vencida) || 0,
      sinFecha: Number(f.sin_fecha) || 0,
      sinFechaCount: Number(f.sin_fecha_count) || 0,
    };
  }
  return out;
}
