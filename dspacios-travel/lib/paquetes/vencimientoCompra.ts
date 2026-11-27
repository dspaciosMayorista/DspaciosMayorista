// #13 — Avisos anticipados de fin de vigencia de COMPRA de paquetes. Módulo PURO (sin I/O, sin React): lo usan el panel de Paquetes, la campana global (avisos en la aplicación; NO hay correo) y las pruebas.
//
// Qué es una «fecha límite de compra» aquí (cuatro fuentes reales, todas con `compra_fin`):
//   · paquete            → armado_paquetes.fecha_compra_fin       (cualquier tipo: bloqueo, porción terrestre, servicios, dinámico)
//   · salida_dinamica    → salidas_dinamicas.compra_fin           (rotación de salidas de un paquete dinámico)
//   · empaquetado        → empaquetados.compra_fin                (oferta aérea «Sistema» vinculada a paquetes)
//   · paquete_total      → paquete_din.compra_fin                 (paquete dinámico total, publicado)
// NO es la regeneración automática del tarifario por inicio/vencimiento de vigencia (#58): aquí solo se AVISA a una persona para que revise o actualice.
//
// Reglas (fechas en America/Bogota; ver `hoyBogota`):
//   · La compra sigue permitida el mismo día de `compra_fin` (la base solo rechaza `compra_fin < hoy`): ese día es «Vence hoy», NO vencida.
//   · Un aviso solo existe para algo VIGENTE y ACTIVO: un paquete/salida/empaquetado/paquete total inactivo no se vende, así que no se avisa.
//   · Ventana de aviso: hoy ≤ compra_fin ≤ hoy + días (inclusive). Lo ya vencido no entra a los avisos (el listado lo marca aparte con `estadoCompra`).
//   · Un empaquetado solo se avisa si está vinculado a al menos UN paquete activo (el aviso nombra a esos paquetes); uno suelto no afecta ninguna venta.
import { fechaISOValida, sumarDiasISO } from "../cotizacion/vigencia.ts";

export type FuenteCompra = "paquete" | "salida_dinamica" | "empaquetado" | "paquete_total" | "hotel_vigencia" | "servicio_vigencia";

export const ETIQUETA_FUENTE: Record<FuenteCompra, string> = {
  paquete: "Vigencia de compra del paquete",
  salida_dinamica: "Salida dinámica",
  empaquetado: "Empaquetado",
  paquete_total: "Paquete dinámico total",
  hotel_vigencia: "Vigencia de hotel",
  servicio_vigencia: "Vigencia de servicio",
};

export type AvisoCompra = {
  fuente: FuenteCompra;
  /** Identidad estable para listas/pruebas: «<fuente>:<id>». */
  clave: string;
  /** Qué se ve primero: el paquete (o el empaquetado). */
  nombre: string;
  /** Qué vigencia concreta vence. */
  detalle: string;
  compraFin: string;
  /** Días desde HOY (Bogotá) hasta `compraFin`; 0 = vence hoy. */
  dias: number;
  /** Ruta relativa a la pantalla donde se corrige esa vigencia. */
  ruta: string;
};

/** Diferencia en días entre dos fechas ISO (YYYY-MM-DD), sin zona horaria. `null` si alguna es inválida. */
export function diasEntre(desde: string, hasta: string): number | null {
  if (!fechaISOValida(desde) || !fechaISOValida(hasta)) return null;
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** Días de anticipación válidos: entero ≥ 0, con tope de 365 (la ventana de lectura sigue acotada por LIMITE_AVISOS_COMPRA); nulo, negativo o no entero cae al valor por defecto (5). */
export function normalizarDias(dias: unknown, porDefecto = 5): number {
  if (dias === null || dias === undefined || dias === "") return porDefecto; // Number(null) sería 0: un valor ausente NO es «0 días»
  const n = typeof dias === "number" ? dias : Number(dias);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 365) : porDefecto;
}

/** Ventana de consulta [hoy, hoy + días] (inclusive) para las lecturas de base. */
export function ventanaAviso(hoy: string, dias: number): { desde: string; hasta: string } {
  return { desde: hoy, hasta: sumarDiasISO(hoy, normalizarDias(dias)) };
}

export function etiquetaDias(dias: number): string {
  if (dias <= 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  return `Vence en ${dias} días`;
}

export type EstadoCompra = "sin_fecha" | "vigente" | "por_vencer" | "vence_hoy" | "vencida";

/** Estado de UNA vigencia de compra frente a hoy (Bogotá). Sin fecha o fecha inválida = `sin_fecha` (nunca se infiere vigente ni vencida). */
export function estadoCompra(hoy: string, compraFin: string | null | undefined, dias: number): EstadoCompra {
  if (!compraFin) return "sin_fecha";
  const d = diasEntre(hoy, compraFin);
  if (d === null) return "sin_fecha";
  if (d < 0) return "vencida";
  if (d === 0) return "vence_hoy";
  return d <= normalizarDias(dias) ? "por_vencer" : "vigente";
}

const enVentana = (hoy: string, compraFin: string | null | undefined, dias: number): number | null => {
  if (!compraFin) return null;
  const d = diasEntre(hoy, compraFin);
  return d !== null && d >= 0 && d <= normalizarDias(dias) ? d : null;
};

const fmt = (f: string | null | undefined) => (f ? f : "sin fecha");

export type FilaPaquete = { id: number; nombre: string; activo: boolean; fecha_compra_fin: string | null };
export type FilaSalida = { id: number; paquete_id: number; activo: boolean; compra_fin: string | null; fecha_ida: string; fecha_regreso: string | null; paquete: { nombre: string; activo: boolean } | null };
export type FilaEmpaquetado = { id: number; activo: boolean; compra_fin: string | null; ruta: string | null; fecha_ida: string; paquetes: { id: number; nombre: string; activo: boolean }[] };
export type FilaPaqueteTotal = { id: number; nombre: string; activo: boolean; publicado: boolean; compra_fin: string | null };

export function avisosPaquetes(filas: readonly FilaPaquete[], hoy: string, dias: number): AvisoCompra[] {
  const out: AvisoCompra[] = [];
  for (const f of filas) {
    if (!f.activo) continue;
    const d = enVentana(hoy, f.fecha_compra_fin, dias);
    if (d === null) continue;
    out.push({ fuente: "paquete", clave: `paquete:${f.id}`, nombre: f.nombre, detalle: `${ETIQUETA_FUENTE.paquete} · hasta ${f.fecha_compra_fin}`, compraFin: f.fecha_compra_fin!, dias: d, ruta: rutaVentana("paquete", f.id) });
  }
  return out;
}

export function avisosSalidas(filas: readonly FilaSalida[], hoy: string, dias: number): AvisoCompra[] {
  const out: AvisoCompra[] = [];
  for (const f of filas) {
    if (!f.activo || !f.paquete?.activo) continue;
    const d = enVentana(hoy, f.compra_fin, dias);
    if (d === null) continue;
    out.push({ fuente: "salida_dinamica", clave: `salida_dinamica:${f.id}`, nombre: f.paquete.nombre, detalle: `${ETIQUETA_FUENTE.salida_dinamica} ${fmt(f.fecha_ida)}${f.fecha_regreso ? ` → ${f.fecha_regreso}` : ""} · compra hasta ${f.compra_fin}`, compraFin: f.compra_fin!, dias: d, ruta: rutaVentana("salida_dinamica", f.paquete_id) });
  }
  return out;
}

export function avisosEmpaquetados(filas: readonly FilaEmpaquetado[], hoy: string, dias: number): AvisoCompra[] {
  const out: AvisoCompra[] = [];
  for (const f of filas) {
    if (!f.activo) continue;
    const activos = f.paquetes.filter((p) => p.activo);
    if (!activos.length) continue; // sin paquete activo vinculado no afecta ninguna venta
    const d = enVentana(hoy, f.compra_fin, dias);
    if (d === null) continue;
    const nombres = [...new Set(activos.map((p) => p.nombre))].sort((a, b) => a.localeCompare(b, "es"));
    out.push({ fuente: "empaquetado", clave: `empaquetado:${f.id}`, nombre: `${f.ruta?.trim() || "Empaquetado"} · ${fmt(f.fecha_ida)}`, detalle: `${ETIQUETA_FUENTE.empaquetado} · compra hasta ${f.compra_fin} · paquetes: ${nombres.join(", ")}`, compraFin: f.compra_fin!, dias: d, ruta: rutaVentana("empaquetado", f.id) });
  }
  return out;
}

export function avisosPaquetesTotales(filas: readonly FilaPaqueteTotal[], hoy: string, dias: number): AvisoCompra[] {
  const out: AvisoCompra[] = [];
  for (const f of filas) {
    if (!f.activo || !f.publicado) continue; // un total sin publicar no se vende: no hay nada que avisar
    const d = enVentana(hoy, f.compra_fin, dias);
    if (d === null) continue;
    out.push({ fuente: "paquete_total", clave: `paquete_total:${f.id}`, nombre: f.nombre, detalle: `${ETIQUETA_FUENTE.paquete_total} · compra hasta ${f.compra_fin}`, compraFin: f.compra_fin!, dias: d, ruta: rutaVentana("paquete_total", f.id) });
  }
  return out;
}

/** Orden: lo que vence primero arriba; a igual fecha, por nombre y clave (determinista). */
export function ordenarAvisos(avisos: readonly AvisoCompra[]): AvisoCompra[] {
  return [...avisos].sort((a, b) => a.dias - b.dias || a.nombre.localeCompare(b.nombre, "es") || a.clave.localeCompare(b.clave));
}

/** Pantalla donde se corrige UNA vigencia. `ref` = id de la pantalla destino: paquete (también para su salida dinámica), empaquetado, paquete total, hotel o servicio; `vigenciaId` = la vigencia concreta del hotel/servicio. Única fuente de las rutas (panel de Paquetes y área de Alertas). */
export function rutaVentana(fuente: FuenteCompra, ref: number, vigenciaId?: number | null): string {
  switch (fuente) {
    case "paquete": return `/dashboard/paquetes/${ref}?tab=config`;
    case "salida_dinamica": return `/dashboard/paquetes/${ref}?tab=vuelos`;
    case "empaquetado": return `/dashboard/vuelos/empaquetados/${ref}`;
    case "paquete_total": return `/dashboard/paquetes/total/${ref}`;
    case "hotel_vigencia": return `/dashboard/producto/hoteles/${ref}?tab=temporadas${vigenciaId ? `&vigencia=${vigenciaId}` : ""}`;
    case "servicio_vigencia": return `/dashboard/producto/servicios?servicio=${ref}${vigenciaId ? `&vigencia=${vigenciaId}` : ""}`;
  }
}

export const esFuenteCompra = (v: unknown): v is FuenteCompra => v === "paquete" || v === "salida_dinamica" || v === "empaquetado" || v === "paquete_total" || v === "hotel_vigencia" || v === "servicio_vigencia";
