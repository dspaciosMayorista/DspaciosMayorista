// Libro diario legible (#43-1b) — lógica pura: etiquetas de origen, filtros,
// resumen, enlace al contrato y exportación CSV. Sin acceso a datos.

export type LineaVista = {
  cuenta_codigo: string;
  cuenta_nombre: string;
  tercero: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
};
export type AsientoVista = {
  id: number;
  numero: number;
  fecha: string;
  descripcion: string;
  origen: string;
  referencia: string | null;
  lineas: LineaVista[];
};

const ORIGENES: Record<string, string> = {
  manual: "Manual",
  conciliacion: "Conciliación bancaria",
  abono: "Abono de cliente",
  cxp: "Cuenta por pagar",
  pago_proveedor: "Pago a proveedor",
  retencion: "Retención",
  facturacion: "Facturación",
  facturacion_reversion: "Reversión de factura",
  pago_previo: "Pago previo",
  pago_previo_aplicacion: "Aplicación de pago previo",
};

/** Origen en lenguaje claro; uno desconocido se muestra legible en vez de crudo. */
export function etiquetaOrigen(origen: string): string {
  if (ORIGENES[origen]) return ORIGENES[origen];
  const t = origen.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Sin origen";
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function totalesAsiento(a: Pick<AsientoVista, "lineas">): { debe: number; haber: number; cuadra: boolean } {
  const debe = a.lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
  const haber = a.lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
  // Misma tolerancia que el registro manual (un peso por redondeo).
  return { debe, haber, cuadra: Math.abs(debe - haber) <= 1 };
}

export type FiltroLibro = {
  texto?: string;          // número, descripción, referencia o detalle de línea
  cuenta?: string;         // código (prefijo) o nombre de cuenta
  tercero?: string;
  origen?: string;         // valor exacto de `origen`
  soloDescuadrados?: boolean;
};

export function filtrarAsientos<T extends AsientoVista>(asientos: T[], f: FiltroLibro): T[] {
  const texto = norm(f.texto);
  const cuenta = norm(f.cuenta);
  const tercero = norm(f.tercero);
  return asientos.filter((a) => {
    if (f.origen && a.origen !== f.origen) return false;
    if (f.soloDescuadrados && totalesAsiento(a).cuadra) return false;
    if (texto) {
      const enCabecera = [String(a.numero), a.descripcion, a.referencia].some((x) => norm(x).includes(texto));
      if (!enCabecera && !a.lineas.some((l) => norm(l.descripcion).includes(texto))) return false;
    }
    if (cuenta && !a.lineas.some((l) => norm(l.cuenta_codigo).startsWith(cuenta) || norm(l.cuenta_nombre).includes(cuenta))) return false;
    if (tercero && !a.lineas.some((l) => norm(l.tercero).includes(tercero))) return false;
    return true;
  });
}

export function resumenAsientos(asientos: AsientoVista[]) {
  let debitos = 0, creditos = 0, descuadrados = 0;
  for (const a of asientos) {
    const t = totalesAsiento(a);
    debitos += t.debe; creditos += t.haber;
    if (!t.cuadra) descuadrados++;
  }
  return { cantidad: asientos.length, debitos, creditos, descuadrados };
}

/** N.º de contrato (00-0451 o MIN-00-0451) si la referencia lo es; si no, null. */
export function contratoDeReferencia(referencia: string | null | undefined): string | null {
  const r = (referencia ?? "").trim();
  return /^(MIN-)?\d{2}-\d{3,}$/.test(r) ? r : null;
}

/** Rango [desde, hasta] del mes de una fecha ISO, y el del mes anterior/siguiente. */
export function rangoMes(iso: string, desplazamiento = 0): { desde: string; hasta: string } {
  const [y, m] = iso.split("-").map(Number);
  const inicio = new Date(Date.UTC(y, m - 1 + desplazamiento, 1));
  const fin = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: f(inicio), hasta: f(fin) };
}

export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// CSV para Excel en español: separador ";", coma decimal, BOM y `sep=;`.
export const textoCsv = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const montoCsv = (n: number) => (Number(n) || 0).toFixed(2).replace(".", ",");

/** Una fila por línea de asiento, con los datos de su cabecera repetidos. */
export function asientosACsv(asientos: AsientoVista[]): string {
  const filas = [
    "sep=;",
    ["Número", "Fecha", "Descripción", "Origen", "Referencia", "Cuenta", "Nombre de la cuenta", "Tercero", "Detalle", "Débito", "Crédito"].join(";"),
  ];
  for (const a of asientos) {
    for (const l of a.lineas) {
      const texto = [a.numero, a.fecha, a.descripcion, etiquetaOrigen(a.origen), a.referencia, l.cuenta_codigo, l.cuenta_nombre, l.tercero, l.descripcion]
        .map(textoCsv);
      filas.push([...texto, montoCsv(l.debe), montoCsv(l.haber)].join(";"));
    }
  }
  return "﻿" + filas.join("\r\n") + "\r\n";
}
