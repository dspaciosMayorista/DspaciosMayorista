// Cabecera + componentes de una cotización de paquete dinámico (#82). PURO.
// Reutiliza el documento/ítem de la cotización manual; no la ramifica: la RPC
// `crear_cotizacion_din` envuelve `crear_cotizacion_manual`.
import { nombrePaqueteItem, type ItemDocumento } from "@/lib/cotizacion/liquidacionManual";
import { sugerirIncluye } from "@/lib/cotizacion/incluye";
import { agruparPorComponente, liquidarPaquete, type Composicion, type LineaDin, type PaqueteDin } from "@/lib/paqueteDinamico/calculo";

export type FilaComponente = {
  orden: number; tipo_servicio: "aereo" | "hotel" | "otro"; plataforma: string | null; nombre_servicio: string; proveedor: string | null;
  costo_neto: number; modo: "mk"; pct_markup: number; ta: 0; valor: number; componente: string; exige_costo: boolean;
};

export type ClienteDin = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string; nacimiento?: string };

export type EntradaCotizacionDin = {
  paqueteId: number; paqueteNombre: string; destino: string; hotelId: number | null; vueloId: number | null;
  calc: PaqueteDin; composicion: Composicion;
  cliente: ClienteDin; fechaIda: string; fechaRegreso: string; vigenciaHasta: string;
  tipoAsesor: "interno" | "agencia" | "freelance"; asesorInterno: string; agenciaNombre: string; freelanceNombre: string;
  plazo?: string; observaciones?: string; incluye?: string; noIncluye?: string;
  /** Día de emisión (Bogotá) para el documento público por token (que no lee `created_at`). */
  fechaEmision?: string;
};

const TIPO: Record<LineaDin["componente"], FilaComponente["tipo_servicio"]> = { vuelo: "aereo", hotel: "hotel", servicio: "otro", paquete: "otro" };

export function resumenPax(adultos: number, ninos: number, infantes: number): string {
  const p = (n: number, s: string, pl: string) => `${n} ${n === 1 ? s : pl}`;
  return [p(adultos, "adulto", "adultos"), ninos ? p(ninos, "niño", "niños") : "", infantes ? p(infantes, "infante", "infantes") : ""].filter(Boolean).join(", ");
}

export function itemsDocumento(total: number, destino: string, ida: string, regreso: string, resumen: string): ItemDocumento[] {
  return [{ descripcion: `${nombrePaqueteItem(destino, ida, regreso)} — ${resumen}`, cantidad: 1, tarifa_unit: total, valor: total, orden: 0 }];
}

export function filasComponente(lineas: LineaDin[], pctMk: number, esNeta: boolean): FilaComponente[] {
  return agruparPorComponente(lineas).map((l, i) => ({
    orden: i, tipo_servicio: TIPO[l.componente], plataforma: null, nombre_servicio: l.descripcion, proveedor: l.proveedor.trim() || null,
    costo_neto: l.costoNeto, modo: "mk", pct_markup: esNeta ? pctMk : 0, ta: 0, valor: l.valor, componente: l.ref, exige_costo: l.exigeCosto,
  }));
}

export function construirCotizacionDin(e: EntradaCotizacionDin):
  { ok: true; cabecera: Record<string, unknown>; servicios: FilaComponente[] } | { ok: false; error: string } {
  if (!`${e.cliente.nombres}${e.cliente.apellidos}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };
  let liq;
  try { liq = liquidarPaquete(e.calc, e.composicion); } catch (x) { return { ok: false, error: (x as Error).message }; }
  if (!(liq.total > 0)) return { ok: false, error: "El total de la cotización debe ser mayor que 0." };
  const servicios = filasComponente(liq.lineas, e.calc.pctMk, e.calc.esquema === "neta_markup");
  const resumen = resumenPax(liq.adultos, liq.ninos, liq.infantes);
  const moneda = e.calc.moneda;
  const asesor = e.tipoAsesor === "interno" ? e.asesorInterno : e.tipoAsesor === "agencia" ? e.agenciaNombre : e.freelanceNombre;
  const clienteNombre = `${e.cliente.nombres} ${e.cliente.apellidos}`.trim();
  const hotel = e.calc.hotel?.nombre ?? null;
  // payload con la forma de la manual (la conversión y el CRM lo leen); niños/recobro en 0 porque el cobro de menores
  // ya va dentro de los componentes: la RPC exige Σ componentes + recobro + niños×tarifa = total.
  const payload = {
    cliente: e.cliente, destino: e.destino, fechaIda: e.fechaIda, fechaRegreso: e.fechaRegreso, pax: liq.adultos, ninos: 0, tarifaNino: 0, recobro: 0,
    recobroAliado: 0, moneda, tipoAsesor: e.tipoAsesor, asesorInterno: e.asesorInterno, agenciaNombre: e.agenciaNombre, freelanceNombre: e.freelanceNombre,
    plazo: e.plazo ?? "", vigenciaHasta: e.vigenciaHasta, observaciones: e.observaciones ?? "", incluye: e.incluye ?? "", noIncluye: e.noIncluye ?? "", servicios: [],
    dinamico: { paqueteId: e.paqueteId, hotelId: e.hotelId, vueloId: e.vueloId, composicion: e.composicion, adultos: liq.adultos, ninos: liq.ninos, infantes: liq.infantes, resumenPax: resumen },
  };
  const detalle = {
    venta: { numero_contrato: "", fecha_emision: e.fechaEmision ?? null, cliente: clienteNombre, destino: e.destino || null, fecha_salida: e.fechaIda || null, fecha_regreso: e.fechaRegreso || null,
      pax: liq.adultos, ninos: liq.ninos, precio_venta: liq.total, moneda, asesor: asesor || null, canal: e.tipoAsesor === "interno" ? "B2C" : "B2B",
      tipo_cliente: e.tipoAsesor, hotel, aerolinea: e.calc.vuelo ? "Vuelo incluido" : null, observaciones: e.observaciones || null, estado: "cotizacion" },
    pasajeros: [], hoteles: [], vuelos: [],
    incluye: (e.incluye || "").trim() || sugerirIncluye(servicios.map((s) => ({ tipo: s.tipo_servicio, nombre: s.nombre_servicio }))),
    noIncluye: (e.noIncluye || "").trim(),
    recobro: { total: 0, empresa: 0, aliado: 0 },
    items: itemsDocumento(liq.total, e.destino, e.fechaIda, e.fechaRegreso, resumen),
  };
  return {
    ok: true, servicios,
    cabecera: {
      payload, detalle, cliente: clienteNombre, cliente_documento: e.cliente.numeroDoc || null, destino: e.destino || null, hotel,
      plan_nombre: e.paqueteNombre, pax: liq.adultos, precio_venta: liq.total, moneda, fecha_salida: e.fechaIda || null,
      fecha_regreso: e.fechaRegreso || null, vigencia_hasta: e.vigenciaHasta, asesor: asesor || null,
    },
  };
}

/** Tras editar valores a mano: total y documento nuevos desde los componentes (misma fórmula que crear). */
export function reliquidarComponentes(args: {
  componentes: Pick<FilaComponente, "valor">[]; destino: string; fechaIda: string; fechaRegreso: string; resumenPax: string;
}): { total: number; items: ItemDocumento[] } | { error: string } {
  if (!args.componentes.length) return { error: "La cotización debe conservar al menos un componente." };
  if (args.componentes.some((c) => !Number.isFinite(c.valor) || c.valor < 0)) return { error: "Hay un componente con un valor inválido." };
  const total = args.componentes.reduce((s, c) => s + c.valor, 0);
  if (!(total > 0)) return { error: "El total debe ser mayor que 0." };
  return { total, items: itemsDocumento(total, args.destino, args.fechaIda, args.fechaRegreso, args.resumenPax) };
}
