// #41 — duplicar un vuelo (Bloqueo o Empaquetado «Promoción») para guardarlo como una identidad NUEVA con otras fechas. PURO (sin I/O).
// Se copia SOLO la configuración del producto. Nunca se copia lo operativo: sillas, cupos ocupados, reservas, contratos, vínculos con paquetes, historial de cambios, ni
// el record/PNR (un record es único por bloqueo y copiarlo fingiría una compra ya emitida). Los estados de emisión/pago nacen «pendiente» como en cualquier alta.
// Las fechas y las ventanas (devolución/emisión, vigencia de compra) se precargan solo como PUNTO DE PARTIDA para revisarlas antes de guardar.

type DestinoRef = { id: number; nombre: string; codigo_iata: string | null };

const t = (v: unknown): string => (v == null ? "" : String(v));
const d = (v: unknown): string => (v == null ? "" : String(v).slice(0, 10));
const n = (v: unknown): string => (v == null || v === "" ? "" : String(v));

function origenIdDe(origen: unknown, destinos: DestinoRef[]): number | "" {
  const o = t(origen).toUpperCase().trim();
  if (!o) return "";
  return destinos.find((x) => (x.codigo_iata ?? "").toUpperCase().trim() === o)?.id ?? destinos.find((x) => x.nombre.toUpperCase().trim() === o)?.id ?? "";
}

export type InicialBloqueo = {
  proveedorId: number | ""; destinoId: number | ""; origenId: number | ""; rangosSel: number[];
  modalidadEmision: string; moneda: string;
  f: {
    record: string; aerolinea: string; vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
    vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
    cuposTotal: string; tarifaNeta: string; tarifaParaEmpaquetar: string; feeInfante: string; fechaDevolucion: string; fechaEmision: string; notas: string;
  };
};

/** Fila de `bloqueos_vuelo` → valores iniciales del formulario «Nuevo bloqueo». Record en blanco (debe ser uno nuevo). */
export function inicialBloqueoDesdeFila(r: Record<string, unknown>, destinos: DestinoRef[]): InicialBloqueo {
  return {
    proveedorId: typeof r.proveedor_id === "number" ? r.proveedor_id : "",
    destinoId: typeof r.destino_id === "number" ? r.destino_id : "",
    origenId: origenIdDe(r.origen, destinos),
    rangosSel: Array.isArray(r.rangos_edad) ? (r.rangos_edad as unknown[]).filter((x): x is number => typeof x === "number") : [],
    modalidadEmision: t(r.modalidad_emision),
    moneda: t(r.moneda),
    f: {
      record: "", aerolinea: t(r.aerolinea),
      vueloIda: t(r.vuelo_ida), fechaIda: d(r.fecha_ida), horaSalidaIda: t(r.hora_salida_ida), horaLlegadaIda: t(r.hora_llegada_ida),
      vueloRegreso: t(r.vuelo_regreso), fechaRegreso: d(r.fecha_regreso), horaSalidaReg: t(r.hora_salida_reg), horaLlegadaReg: t(r.hora_llegada_reg),
      cuposTotal: n(r.cupos_total) || "10", tarifaNeta: n(r.tarifa_neta), tarifaParaEmpaquetar: n(r.tarifa_para_empaquetar), feeInfante: n(r.fee_infante) || "0",
      fechaDevolucion: d(r.fecha_devolucion), fechaEmision: d(r.fecha_emision), notas: t(r.notas),
    },
  };
}

export type InicialEmpaquetado = {
  proveedorId: number | ""; destinoId: number | ""; origenId: number | ""; moneda: string;
  f: {
    record: string; aerolinea: string; vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
    vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
    tarifaProveedor: string; tarifaParaEmpaquetar: string; feeInfante: string; compraInicio: string; compraFin: string; notas: string;
  };
};

/** Fila de `empaquetados` → valores iniciales del formulario «Nuevo empaquetado». Record en blanco; estados nuevos «pendiente» (los fija el formulario). */
export function inicialEmpaquetadoDesdeFila(r: Record<string, unknown>, destinos: DestinoRef[]): InicialEmpaquetado {
  return {
    proveedorId: typeof r.proveedor_id === "number" ? r.proveedor_id : "",
    destinoId: typeof r.destino_id === "number" ? r.destino_id : "",
    origenId: origenIdDe(r.origen, destinos),
    moneda: t(r.moneda) || "COP",
    f: {
      record: "", aerolinea: t(r.aerolinea),
      vueloIda: t(r.vuelo_ida), fechaIda: d(r.fecha_ida), horaSalidaIda: t(r.hora_salida_ida), horaLlegadaIda: t(r.hora_llegada_ida),
      vueloRegreso: t(r.vuelo_regreso), fechaRegreso: d(r.fecha_regreso), horaSalidaReg: t(r.hora_salida_reg), horaLlegadaReg: t(r.hora_llegada_reg),
      tarifaProveedor: n(r.tarifa_proveedor), tarifaParaEmpaquetar: n(r.tarifa_para_empaquetar), feeInfante: n(r.fee_infante) || "0",
      compraInicio: d(r.compra_inicio), compraFin: d(r.compra_fin), notas: t(r.notas),
    },
  };
}

/** Orden de fechas de un vuelo: el regreso no puede ser anterior a la ida (los Bloqueos no lo comprobaban; los Empaquetados ya lo tienen en la base). */
export function validarOrdenFechasVuelo(ida: string | null | undefined, regreso: string | null | undefined): { ok: true } | { ok: false; error: string } {
  const a = (ida ?? "").slice(0, 10), b = (regreso ?? "").slice(0, 10);
  return a && b && b < a ? { ok: false, error: "La fecha de regreso no puede ser anterior a la fecha de ida." } : { ok: true };
}

/** El identificador de la fuente a duplicar viene de la URL: solo un entero positivo es válido. */
export function idCopiaValido(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{1,12}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}
