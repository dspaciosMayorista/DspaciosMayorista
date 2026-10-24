// Unidades monetarias del montaje de un paquete (#90 · Entrega A). Funciones PURAS, sin I/O.
//
// Separan tres cosas que el editor mostraba mezcladas bajo "formatCOP":
//   1. la moneda REAL de cada componente (hotel, servicio, Bloqueo, Empaquetado), tal como la acreditó su fuente;
//   2. el rol de cada importe (en un Bloqueo, la neta es COSTO/CxP a la aerolínea y la de reventa es lo que arma el precio al cliente);
//   3. la moneda de PUBLICACIÓN del paquete, y si un componente tendría que convertirse para encajar en ella.
//
import { motivoMonedaBloqueoVsPaquete } from "@/lib/vuelos/monedaBloqueo";
import { empaquetadoVigente } from "@/lib/reservar/origen";

// Regla de seguridad: NUNCA se convierte aquí ni se supone una TRM. Un componente cuya moneda no está acreditada no se presenta como
// COP: se marca "sin acreditar". Si exige conversión, se informa y se pide TRM explícita (la captura y el congelado son la fase D).

export type MonedaMontaje = "COP" | "USD";
export type TipoComponente = "bloqueo" | "empaquetado" | "hotel" | "servicio";

export function esMonedaMontaje(m: unknown): m is MonedaMontaje {
  return m === "COP" || m === "USD";
}

/**
 * Moneda de un componente. `acreditada=false` cuando la fuente no la declara (Bloqueo nunca acreditado): el generador la lee como COP
 * por compatibilidad, pero la UI no debe afirmarlo ni usarla para convertir.
 */
export function monedaDeComponente(
  tipo: TipoComponente,
  moneda: string | null | undefined
): { moneda: MonedaMontaje | null; acreditada: boolean } {
  if (esMonedaMontaje(moneda)) return { moneda, acreditada: true };
  // Hoteles, servicios y Empaquetados nacieron con moneda por defecto COP (columna no nula o "ausente = COP", migraciones 092/110/230).
  if (tipo !== "bloqueo") return { moneda: "COP", acreditada: true };
  return { moneda: null, acreditada: false };
}

export type EstadoConversion =
  | "coincide" //            misma moneda que la publicación: no se convierte
  | "requiere_trm" //        otra moneda acreditada: exige TRM explícita (fase D)
  | "sin_acreditar" //      moneda desconocida: no se puede decidir ni convertir
  | "sin_publicacion"; //    la selección no tiene moneda publicable (el generador la rechaza): no se compara

export function estadoConversion(moneda: MonedaMontaje | null, publicacion: MonedaMontaje | null): EstadoConversion {
  if (publicacion === null) return "sin_publicacion";
  if (moneda === null) return "sin_acreditar";
  return moneda === publicacion ? "coincide" : "requiere_trm";
}

export type FilaUnidad = {
  tipo: TipoComponente;
  nombre: string;
  moneda: MonedaMontaje | null;
  acreditada: boolean;
  conversion: EstadoConversion;
  /** Importes del componente con su rol, ya con la unidad. */
  importes: { rol: string; valor: number }[];
};

export type EntradaUnidad = {
  tipo: TipoComponente;
  nombre: string;
  moneda: string | null | undefined;
  importes?: { rol: string; valor: number | null | undefined }[];
};

export function filasUnidades(entradas: readonly EntradaUnidad[], publicacion: MonedaMontaje | null): FilaUnidad[] {
  return entradas.map((e) => {
    const m = monedaDeComponente(e.tipo, e.moneda);
    return {
      tipo: e.tipo,
      nombre: e.nombre,
      moneda: m.moneda,
      acreditada: m.acreditada,
      conversion: estadoConversion(m.moneda, publicacion),
      importes: (e.importes ?? [])
        .filter((i) => i.valor !== null && i.valor !== undefined && Number.isFinite(Number(i.valor)))
        .map((i) => ({ rol: i.rol, valor: Number(i.valor) })),
    };
  });
}

/** Resumen del montaje: cuántos componentes encajan, cuántos pedirían TRM y cuántos no tienen moneda acreditada. */
export function resumenUnidades(filas: readonly FilaUnidad[]): { coinciden: number; requierenTrm: number; sinAcreditar: number; sinPublicacion: number } {
  return {
    sinPublicacion: filas.filter((f) => f.conversion === "sin_publicacion").length,
    coinciden: filas.filter((f) => f.conversion === "coincide").length,
    requierenTrm: filas.filter((f) => f.conversion === "requiere_trm").length,
    sinAcreditar: filas.filter((f) => f.conversion === "sin_acreditar").length,
  };
}

/** Roles de los importes de un Bloqueo (decisión del dueño): la neta es costo y CxP; la de reventa arma el precio al cliente. */
export const ROL_NETA_BLOQUEO = "Neta (costo y CxP a la aerolínea)";
export const ROL_REVENTA_BLOQUEO = "Reventa (precio al cliente)";

// ── Moneda de publicación de la SELECCIÓN actual ───────────────────────────────────────────────────────────────────────────────
// Espejo PURO de la regla vigente de generarTarifario (paquetes/actions.ts, "Consistencia de moneda"): no la cambia ni la decide, solo
// responde "qué moneda tendría y si el generador aceptaría esta selección". Considera únicamente los componentes ELEGIDOS.

export type PublicacionMontaje =
  | { estado: "publicable"; moneda: MonedaMontaje }
  | { estado: "rechazado"; motivo: string };

export type EntradaPublicacion = {
  modo63: boolean;
  /** Moneda elegida del paquete en el modo 63 (COP si no se indica: valor histórico). Fuera del modo 63 se ignora. */
  monedaOferta63?: MonedaMontaje;
  /** Monedas de los hoteles elegidos (un elemento por hotel). */
  hoteles: readonly (string | null | undefined)[];
  /** Monedas de los servicios elegidos (incluidos u opcionales). */
  servicios: readonly (string | null | undefined)[];
  /** Bloqueos elegidos que el generador consideraría (moneda null = sin acreditar). */
  bloqueos: readonly { etiqueta: string; moneda: string | null | undefined }[];
  /** Empaquetados elegidos que el generador consideraría (activos, con fechas y vigentes). */
  empaquetados: readonly { etiqueta: string; moneda: string | null | undefined }[];
};

const aMoneda = (m: string | null | undefined): MonedaMontaje => (m === "USD" ? "USD" : "COP");

export function resolverPublicacionMontaje(e: EntradaPublicacion): PublicacionMontaje {
  const monedasHotel = Array.from(new Set(e.hoteles.map(aMoneda)));
  const monedasServicio = Array.from(new Set(e.servicios.map(aMoneda)));
  let moneda: MonedaMontaje;
  if (e.modo63) {
    moneda = e.monedaOferta63 ?? "COP";
  } else {
    if (monedasHotel.length > 1) {
      return { estado: "rechazado", motivo: "Los hoteles elegidos tienen monedas distintas (COP y USD). Un paquete debe ser de una sola moneda." };
    }
    if (monedasHotel.length === 1) {
      moneda = monedasHotel[0];
      if (monedasServicio.some((m) => m !== moneda)) {
        return { estado: "rechazado", motivo: `El paquete estaría en ${moneda} (por el hotel) pero hay servicios en otra moneda. Todo el paquete debe estar en ${moneda}.` };
      }
    } else {
      if (monedasServicio.length > 1) {
        return { estado: "rechazado", motivo: "Los servicios elegidos tienen monedas distintas (COP y USD). Un paquete debe ser de una sola moneda." };
      }
      moneda = monedasServicio[0] ?? "COP";
    }
    for (const b of e.bloqueos) {
      const motivo = motivoMonedaBloqueoVsPaquete(b.moneda, moneda, b.etiqueta);
      if (motivo) return { estado: "rechazado", motivo };
    }
  }
  const distinto = e.empaquetados.find((x) => aMoneda(x.moneda) !== moneda);
  if (distinto) {
    return {
      estado: "rechazado",
      motivo: `El vuelo de Empaquetados ${distinto.etiqueta} está en ${aMoneda(distinto.moneda)} pero este paquete se publicaría en ${moneda}. Un paquete debe ser de una sola moneda: usa un hotel de la misma moneda o, si es Dinámico, el modo con conversión por TRM.`,
    };
  }
  return { estado: "publicable", moneda };
}

// ── Evaluación de los VÍNCULOS GUARDADOS (lo que realmente lee generarTarifario) ────────────────────────────────────────────────
// generarTarifario no mira las listas «disponibles» del editor: lee armado_vuelos / armado_empaquetados / armado_hoteles /
// armado_servicios del paquete, con sus joins, y filtra los vuelos por fechas, vigencia de compra, activo y destino aéreo permitido.
// Esta función recibe esas mismas filas y aplica esos mismos criterios, de modo que un vínculo que el editor ya no lista (por ejemplo un
// Bloqueo fuera del rango de viaje) cuenta igual que para el generador. Un join nulo se comporta como en el generador: un hotel o
// servicio sin ficha cuenta como COP; un vuelo sin ficha o sin fechas se descarta.

export type VinculosGuardados = {
  modo63: boolean;
  /** Moneda elegida del paquete en el modo 63 (COP si no se indica). */
  monedaOferta63?: MonedaMontaje;
  /** Fecha de negocio de hoy (YYYY-MM-DD, America/Bogota) para la vigencia de compra de Empaquetados. */
  hoy: string;
  vuelos: readonly { bloqueo_id: number; bloqueos_vuelo: { id: number; record: string | null; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; moneda: string | null } | null }[];
  empaquetados: readonly { empaquetado_id: number; empaquetados: { id: number; record: string | null; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; moneda: string | null; activo: boolean; compra_inicio: string | null; compra_fin: string | null } | null }[];
  hoteles: readonly { hoteles: { moneda: string | null } | null }[];
  servicios: readonly { servicios_adicionales: { moneda: string | null } | null }[];
  /** Mismo predicado de destino aéreo permitido que usa el generador (siempre true fuera del tipo Bloqueo). */
  permiteDestinoAereo: (tipo: "bloqueo" | "empaquetado", id: number) => boolean;
};

export function publicacionDeVinculosGuardados(v: VinculosGuardados): PublicacionMontaje {
  return resolverPublicacionMontaje({
    modo63: v.modo63,
    monedaOferta63: v.monedaOferta63,
    hoteles: v.hoteles.map((h) => h.hoteles?.moneda),
    servicios: v.servicios.map((s) => s.servicios_adicionales?.moneda),
    bloqueos: v.vuelos
      .filter((x) => !!x.bloqueos_vuelo && !!x.bloqueos_vuelo.fecha_ida && !!x.bloqueos_vuelo.fecha_regreso && v.permiteDestinoAereo("bloqueo", x.bloqueos_vuelo.id))
      .map((x) => ({ etiqueta: x.bloqueos_vuelo!.record || x.bloqueos_vuelo!.ruta || `#${x.bloqueos_vuelo!.id}`, moneda: x.bloqueos_vuelo!.moneda })),
    empaquetados: v.empaquetados
      .filter((x) => {
        const e = x.empaquetados;
        return !!e && e.activo && !!e.fecha_ida && !!e.fecha_regreso && empaquetadoVigente(e.compra_inicio, e.compra_fin, v.hoy) && v.permiteDestinoAereo("empaquetado", e.id);
      })
      .map((x) => ({ etiqueta: x.empaquetados!.ruta || `#${x.empaquetados!.id}`, moneda: x.empaquetados!.moneda })),
  });
}
