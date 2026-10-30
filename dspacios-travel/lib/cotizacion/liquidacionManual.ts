// ─────────────────────────────────────────────────────────────────────────
// Liquidación PURA de la cotización dinámica (manual) — #39.
//
// Antes vivía dentro de `manual-actions.ts` (creación) y se repetía en el editor
// de niños/recobro. Ahora la usan la creación, la edición de servicios y la de
// niños/recobro, para que las tres produzcan EXACTAMENTE la misma cabecera,
// documento (detalle.items) y total. La base de datos vuelve a exigir que el
// total cuadre (Σ servicios + recobro + niños × tarifa = precio_venta), así
// que este módulo no es la frontera: es la única fórmula.
//
// Sin I/O: se prueba con `node --test` (pruebas/cotizacionEdicion39*.test.ts).
// ─────────────────────────────────────────────────────────────────────────
import { marcar } from "@/lib/calc/paquetes";
import { sugerirIncluye } from "@/lib/cotizacion/incluye";

export type ServicioManual = {
  tipo: string;          // aereo / hotel / traslado / asistencia / otro
  plataforma: string;    // por dónde se cotizó
  nombre: string;        // nombre del servicio
  proveedor: string;     // proveedor (texto libre)
  costoNeto: number;     // costo neto
  modo: "mk" | "ta";     // mk = markup (margen) · ta = valor fijo (solo aéreo)
  pctMarkup: number;     // markup en % (25 = 25%); margen: costo/(1-mk)
  ta: number;            // valor fijo a sumar (TA) cuando modo='ta'
};

export type TipoAsesor = "interno" | "agencia" | "freelance";

export type CotizacionManualInput = {
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string; nacimiento?: string };
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  pax: number;           // adultos
  ninos?: number;        // cantidad de niños
  tarifaNino?: number;   // valor por niño (suma al total)
  recobro?: number;      // mayor valor cobrado, oculto al cliente
  recobroAliado?: number;// parte del recobro para el aliado (B2B)
  moneda: string;        // COP / USD
  tipoAsesor: TipoAsesor;
  asesorInterno: string;
  agenciaNombre: string;
  freelanceNombre: string;
  plazo: string;
  vigenciaHasta: string;
  observaciones: string;
  incluye?: string;      // qué incluye (texto libre, una línea por ítem)
  noIncluye?: string;    // qué no incluye (texto libre)
  servicios: ServicioManual[];
};

/** Fila de `cotizacion_servicios` tal como se guarda (pct_markup en fracción). */
export type FilaServicioManual = {
  orden: number;
  tipo_servicio: string;
  plataforma: string | null;
  nombre_servicio: string | null;
  proveedor: string | null;
  costo_neto: number;
  modo: "mk" | "ta";
  pct_markup: number;
  ta: number;
  valor: number;
};

/** Línea visible del documento del cliente (detalle.items). */
export type ItemDocumento = { descripcion: string; cantidad: number; tarifa_unit: number; valor: number; orden: number };

// Fecha YYYY-MM-DD → DD/MM/YYYY (para el nombre del ítem de paquete).
export function fmtDMY(iso?: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—");
}

// Nombre del ÍTEM ÚNICO agrupado que ve el cliente (cotización dinámica).
// No revela hoteles ni proveedores: ese detalle va a los vouchers.
export function nombrePaqueteItem(destino?: string | null, ida?: string | null, regreso?: string | null): string {
  const d = (destino || "").trim().toUpperCase() || "DESTINO";
  return `PAQUETE TURÍSTICO A ${d} DEL ${fmtDMY(ida)} AL ${fmtDMY(regreso)}`;
}

// Niños + recobro de la cotización dinámica.
//  · Niños: cantidad × tarifa por niño (suma al total).
//  · Recobro: cliente final (interno) → 100% empresa; agencia/freelance → se
//    reparte (lo que va al aliado se acota a [0, recobro]).
export function calcularRecobroNinos(input: {
  pax: number; ninos?: number; tarifaNino?: number; recobro?: number; recobroAliado?: number;
  tipoAsesor: TipoAsesor;
}) {
  const nNinos = Math.max(Math.trunc(Number(input.ninos) || 0), 0);
  const valorNino = Math.max(Number(input.tarifaNino) || 0, 0);
  const totalNinos = nNinos * valorNino;
  const recobroN = Math.max(Number(input.recobro) || 0, 0);
  const esB2B = input.tipoAsesor !== "interno";
  const recobroAliadoN = esB2B ? Math.min(Math.max(Number(input.recobroAliado) || 0, 0), recobroN) : 0;
  const recobroEmpresaN = recobroN - recobroAliadoN;
  return { nNinos, valorNino, totalNinos, recobroN, recobroAliadoN, recobroEmpresaN, esB2B };
}

// Valor de venta de un servicio:
//   modo 'mk' → costo / (1 − markup)   (margen)
//   modo 'ta' → costo + TA             (valor fijo, p. ej. aéreo)
export function valorServicio(costo: number, modo: "mk" | "ta", pctMarkup: number, ta: number): number {
  const c = Number(costo) || 0;
  if (modo === "ta") return Math.round(Math.max(0, c) + (Number(ta) || 0));
  const mk = (Number(pctMarkup) || 0) / 100;
  if (c <= 0 || mk >= 1) return 0;
  return Math.round(marcar(c, mk));
}

/** Un servicio "existe" si tiene costo, nombre o plataforma (mismo criterio de siempre). */
export function serviciosConContenido(servicios: ServicioManual[] | null | undefined): ServicioManual[] {
  return (servicios ?? []).filter((s) => (Number(s.costoNeto) || 0) > 0 || (s.nombre ?? "").trim() || (s.plataforma ?? "").trim());
}

/** Liquida cada servicio a su fila de `cotizacion_servicios`. Solo el aéreo admite TA. */
export function liquidarServicios(servicios: ServicioManual[]): FilaServicioManual[] {
  return servicios.map((s, i) => {
    const modo: "mk" | "ta" = s.tipo === "aereo" && s.modo === "ta" ? "ta" : "mk";
    const valor = valorServicio(s.costoNeto, modo, s.pctMarkup, s.ta);
    return {
      orden: i,
      tipo_servicio: s.tipo || "otro",
      plataforma: (s.plataforma || "").trim() || null,
      nombre_servicio: (s.nombre || "").trim() || null,
      proveedor: (s.proveedor || "").trim() || null,
      costo_neto: Number(s.costoNeto) || 0,
      modo,
      pct_markup: modo === "mk" ? (Number(s.pctMarkup) || 0) / 100 : 0,
      ta: modo === "ta" ? (Number(s.ta) || 0) : 0,
      valor,
    };
  });
}

/** Una fila guardada de vuelta al formato del formulario (para precargar el editor). */
export function servicioDesdeFila(f: {
  tipo_servicio: string; plataforma: string | null; nombre_servicio: string | null; proveedor: string | null;
  costo_neto: number | null; modo: string | null; pct_markup: number | null; ta: number | null;
}): ServicioManual {
  const modo: "mk" | "ta" = f.tipo_servicio === "aereo" && f.modo === "ta" ? "ta" : "mk";
  return {
    tipo: f.tipo_servicio || "otro",
    plataforma: f.plataforma ?? "",
    nombre: f.nombre_servicio ?? "",
    proveedor: f.proveedor ?? "",
    costoNeto: Number(f.costo_neto) || 0,
    modo,
    // Fracción guardada → % del formulario, sin ruido de coma flotante.
    pctMarkup: modo === "mk" ? Math.round((Number(f.pct_markup) || 0) * 100 * 1e6) / 1e6 : 0,
    ta: modo === "ta" ? (Number(f.ta) || 0) : 0,
  };
}

/**
 * Totales y líneas del documento. `adultSubtotal` "esconde" el recobro dentro de
 * la tarifa de adulto: el cliente nunca ve el recobro como línea aparte.
 */
export function totalesYDocumento(args: {
  totalServicios: number;
  pax: number | null | undefined;
  destino?: string | null; fechaIda?: string | null; fechaRegreso?: string | null;
  rec: ReturnType<typeof calcularRecobroNinos>;
}): { adultos: number; adultSubtotal: number; precioVenta: number; items: ItemDocumento[] } {
  const adultos = Math.max(Number(args.pax) || 1, 1);
  const adultSubtotal = args.totalServicios + args.rec.recobroN;
  const tarifaAdultoUnit = Math.round(adultSubtotal / adultos);
  const precioVenta = adultSubtotal + args.rec.totalNinos;
  const items: ItemDocumento[] = [
    { descripcion: nombrePaqueteItem(args.destino, args.fechaIda, args.fechaRegreso), cantidad: adultos, tarifa_unit: tarifaAdultoUnit, valor: adultSubtotal, orden: 0 },
  ];
  if (args.rec.nNinos > 0) {
    items.push({ descripcion: "Tarifa por niño", cantidad: args.rec.nNinos, tarifa_unit: args.rec.valorNino, valor: args.rec.totalNinos, orden: 1 });
  }
  return { adultos, adultSubtotal, precioVenta, items };
}

/** Hotel y aerolínea del snapshot: el primer servicio de cada tipo. */
export function hotelYAerolinea(filas: FilaServicioManual[]): { hotel: string | null; aerolinea: string | null } {
  return {
    hotel: filas.find((f) => f.tipo_servicio === "hotel")?.nombre_servicio ?? null,
    aerolinea: filas.find((f) => f.tipo_servicio === "aereo")?.nombre_servicio ?? null,
  };
}

export type CabeceraCotizacionManual = {
  payload: CotizacionManualInput;
  detalle: Record<string, unknown>;
  cliente: string;
  cliente_documento: string | null;
  destino: string | null;
  hotel: string | null;
  plan_nombre: string;
  pax: number;
  precio_venta: number;
  moneda: string;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  vigencia_hasta: string;
  asesor: string | null;
};

/**
 * Cabecera + filas de servicios de una cotización dinámica NUEVA, listas para la
 * RPC `crear_cotizacion_manual`. Misma forma que el INSERT de siempre (la
 * paridad con la plantilla de la comparativa lo vigila una prueba).
 */
export function construirCotizacionManual(
  input: CotizacionManualInput,
  opts: { vigencia: string },
): { ok: true; cabecera: CabeceraCotizacionManual; servicios: FilaServicioManual[] } | { ok: false; error: string } {
  if (!`${input.cliente?.nombres ?? ""}${input.cliente?.apellidos ?? ""}`.trim()) {
    return { ok: false, error: "El nombre del cliente es obligatorio." };
  }
  const servicios = serviciosConContenido(input.servicios);
  if (!servicios.length) return { ok: false, error: "Agrega al menos un servicio con su costo." };

  const moneda = (input.moneda || "COP").toUpperCase();
  const asesor =
    input.tipoAsesor === "interno" ? input.asesorInterno
      : input.tipoAsesor === "agencia" ? input.agenciaNombre
        : input.freelanceNombre;
  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  const clienteNombre = `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim();

  const filas = liquidarServicios(servicios);
  const totalServicios = filas.reduce((acc, f) => acc + f.valor, 0);
  const rec = calcularRecobroNinos(input);
  const t = totalesYDocumento({ totalServicios, pax: input.pax, destino: input.destino, fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso, rec });
  const { hotel, aerolinea } = hotelYAerolinea(filas);

  // Snapshot para el documento/PDF (venta + items).
  const detalle = {
    venta: {
      numero_contrato: "",
      cliente: clienteNombre,
      destino: input.destino || null,
      fecha_salida: input.fechaIda || null,
      fecha_regreso: input.fechaRegreso || null,
      pax: t.adultos,
      ninos: rec.nNinos,
      precio_venta: t.precioVenta,
      moneda,
      asesor: asesor || null,
      canal,
      tipo_cliente: input.tipoAsesor,
      hotel,
      aerolinea,
      observaciones: input.observaciones || null,
      estado: "cotizacion",
    },
    pasajeros: [],
    hoteles: [],
    vuelos: [],
    // Qué incluye / no incluye (texto libre editable). Si el asesor no escribió
    // el "incluye", se sugiere a partir de los servicios elegidos.
    incluye: (input.incluye || "").trim() || sugerirIncluye(input.servicios.map((s) => ({ tipo: s.tipo, nombre: s.nombre }))),
    noIncluye: (input.noIncluye || "").trim(),
    // Recobro (INTERNO, nunca se muestra al cliente).
    recobro: { total: rec.recobroN, empresa: rec.recobroEmpresaN, aliado: rec.recobroAliadoN },
    items: t.items,
  };

  return {
    ok: true,
    cabecera: {
      payload: JSON.parse(JSON.stringify(input)),
      detalle: JSON.parse(JSON.stringify(detalle)),
      cliente: clienteNombre,
      cliente_documento: input.cliente.numeroDoc || null,
      destino: input.destino || null,
      hotel,
      plan_nombre: "Cotización dinámica",
      pax: Number(input.pax) || 0,
      precio_venta: t.precioVenta,
      moneda,
      fecha_salida: input.fechaIda || null,
      fecha_regreso: input.fechaRegreso || null,
      vigencia_hasta: opts.vigencia,
      asesor: asesor || null,
    },
    servicios: filas,
  };
}

/** Lo que una cotización guardada aporta para re-liquidarla. */
export type CotizacionGuardada = {
  payload: unknown;
  pax: number | null;
  destino: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
};

function payloadDe(c: CotizacionGuardada): Partial<CotizacionManualInput> {
  return (c.payload && typeof c.payload === "object" ? c.payload : {}) as Partial<CotizacionManualInput>;
}

function recobroGuardado(c: CotizacionGuardada) {
  const p = payloadDe(c);
  return calcularRecobroNinos({
    pax: Math.max(Number(p.pax ?? c.pax) || 1, 1),
    ninos: p.ninos, tarifaNino: p.tarifaNino, recobro: p.recobro, recobroAliado: p.recobroAliado,
    tipoAsesor: (p.tipoAsesor ?? "interno") as TipoAsesor,
  });
}

/**
 * Nuevos servicios de una cotización ya creada: filas, total y los cambios del
 * documento (`p_cambios` de `editar_servicios_cotizacion_manual`). Conserva el
 * recobro y los niños que la cotización ya tenía.
 */
export function reliquidarServicios(
  c: CotizacionGuardada,
  nuevos: ServicioManual[],
): { ok: true; servicios: FilaServicioManual[]; precioVenta: number; cambios: { precio_venta: number; hotel: string | null; aerolinea: string | null; items: ItemDocumento[]; payload_servicios: ServicioManual[] } } | { ok: false; error: string } {
  const servicios = serviciosConContenido(nuevos);
  if (!servicios.length) return { ok: false, error: "La cotización debe conservar al menos un servicio." };
  for (const s of servicios) {
    if (!Number.isFinite(Number(s.costoNeto)) || Number(s.costoNeto) < 0) {
      return { ok: false, error: "El costo de un servicio no puede ser negativo." };
    }
  }
  const filas = liquidarServicios(servicios);
  if (filas.some((f) => !Number.isFinite(f.valor) || f.valor < 0)) {
    return { ok: false, error: "Hay un servicio con un valor inválido." };
  }
  const totalServicios = filas.reduce((a, f) => a + f.valor, 0);
  const p = payloadDe(c);
  const rec = recobroGuardado(c);
  const t = totalesYDocumento({
    totalServicios, pax: p.pax ?? c.pax, destino: c.destino, fechaIda: c.fecha_salida, fechaRegreso: c.fecha_regreso, rec,
  });
  const { hotel, aerolinea } = hotelYAerolinea(filas);
  return {
    ok: true,
    servicios: filas,
    precioVenta: t.precioVenta,
    cambios: {
      precio_venta: t.precioVenta, hotel, aerolinea, items: t.items,
      payload_servicios: JSON.parse(JSON.stringify(servicios)),
    },
  };
}

export type RecobroNinosInput = { ninos: number; tarifaNino: number; recobro: number; recobroAliado: number };

/**
 * Niños y recobro nuevos sobre los servicios YA liquidados (no se re-liquidan):
 * `p_cambios` de `actualizar_recobro_ninos_manual`.
 */
export function reliquidarRecobroNinos(
  c: CotizacionGuardada,
  totalServicios: number,
  input: RecobroNinosInput,
): { precioVenta: number; cambios: { ninos: number; tarifaNino: number; recobro: number; recobroAliado: number; precio_venta: number; items: ItemDocumento[] } } {
  const p = payloadDe(c);
  const tipoAsesor = (p.tipoAsesor ?? "interno") as TipoAsesor;
  const adultos = Math.max(Number(p.pax ?? c.pax) || 1, 1);
  const rec = calcularRecobroNinos({
    pax: adultos, ninos: input.ninos, tarifaNino: input.tarifaNino,
    recobro: input.recobro, recobroAliado: input.recobroAliado, tipoAsesor,
  });
  const t = totalesYDocumento({ totalServicios, pax: adultos, destino: c.destino, fechaIda: c.fecha_salida, fechaRegreso: c.fecha_regreso, rec });
  return {
    precioVenta: t.precioVenta,
    cambios: {
      ninos: rec.nNinos, tarifaNino: rec.valorNino, recobro: rec.recobroN, recobroAliado: rec.recobroAliadoN,
      precio_venta: t.precioVenta, items: t.items,
    },
  };
}
