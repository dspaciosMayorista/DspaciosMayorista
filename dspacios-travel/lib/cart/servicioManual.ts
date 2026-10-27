// ─────────────────────────────────────────────────────────────────────────
// #64 — Servicio MANUAL del carrito (vuelo libre u otro servicio).
//
// Lo agrega personal interno a un carrito del Tarifario y viaja con el resto
// (hotel, add-ons) hasta la cotización y el contrato. NO es un vuelo de
// Sistema: no referencia ningún `bloqueos_vuelo`/`empaquetados`, no reserva
// sillas ni inventa disponibilidad. Es un precio de venta DECLARADO por el
// asesor; la cotización lo muestra como "sujeto a confirmación" y no guarda
// costo ni proveedor (se exigen recién al convertir, antes de numerar).
//
// Módulo PURO (sin React ni Supabase): lo comparten el carrito (cliente) y
// el servidor, que SIEMPRE vuelve a validar lo que llega del navegador.
// ─────────────────────────────────────────────────────────────────────────

export type ClaseServicioManual = "vuelo" | "otro";
export type MonedaManual = "COP" | "USD";

/** Lo que el asesor captura (y lo que se vuelve a validar en el servidor). */
export type ServicioManual = {
  clase: ClaseServicioManual;
  nombre: string;
  /** Solo vuelo: ciudades/aeropuertos de origen y destino (texto, p. ej. «BOG»). */
  origen: string | null;
  destino: string | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  pax: number;
  /** Precio de VENTA total (todos los pax) en `moneda`. */
  precio: number;
  moneda: MonedaManual;
  /** Parte del precio que NO es comisionable (p. ej. impuestos del vuelo). 0 ≤ valor ≤ precio; solo lo captura personal interno. Base de comisión B2B = precio − esto. */
  impuestoNoComisionable: number;
};

export const MAX_MANUALES = 10;
const MAX_PRECIO = 1_000_000_000_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t && t.length <= max ? t : null;
};
const fechaValida = (v: unknown): string | null => {
  if (typeof v !== "string" || !FECHA.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};

export type ResultadoManual = { ok: true; valor: ServicioManual } | { ok: false; error: string };

/**
 * Valida un servicio manual crudo. `monedaCotizacion` = moneda ya fijada por el
 * resto del carrito (null si no hay): el manual NUNCA se convierte ni se
 * excluye en silencio — si no coincide, se rechaza.
 */
export function validarServicioManual(raw: unknown, monedaCotizacion: string | null = null): ResultadoManual {
  if (!esObjeto(raw)) return { ok: false, error: "El servicio manual no es válido." };
  const clase = raw.clase;
  if (clase !== "vuelo" && clase !== "otro") return { ok: false, error: "Elige si el servicio es un vuelo u otro servicio." };
  const nombre = texto(raw.nombre, 120);
  if (!nombre || nombre.length < 3) return { ok: false, error: "Escribe la descripción del servicio (3 a 120 caracteres)." };
  const moneda = raw.moneda;
  if (moneda !== "COP" && moneda !== "USD") return { ok: false, error: "Elige la moneda del servicio (COP o USD)." };
  if (monedaCotizacion && moneda !== monedaCotizacion) {
    return { ok: false, error: `El servicio debe estar en ${monedaCotizacion}, la moneda de esta cotización. Cotízalo en otra solicitud o captura el precio en ${monedaCotizacion}.` };
  }
  const pax = raw.pax;
  if (typeof pax !== "number" || !Number.isInteger(pax) || pax < 1 || pax > 99) return { ok: false, error: "Los pasajeros deben ser un entero entre 1 y 99." };
  const precio = raw.precio;
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0 || precio > MAX_PRECIO) return { ok: false, error: "El precio de venta debe ser mayor que cero." };
  if (moneda === "COP" && !Number.isInteger(precio)) return { ok: false, error: "En COP el precio va en pesos enteros." };
  if (moneda === "USD" && Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-6) return { ok: false, error: "En USD el precio admite máximo 2 decimales." };

  const imp = raw.impuestoNoComisionable;
  if (typeof imp !== "number" || !Number.isFinite(imp) || imp < 0) return { ok: false, error: "Indica el impuesto no comisionable (0 si el servicio no tiene)." };
  if (imp > precio) return { ok: false, error: "El impuesto no comisionable no puede superar el precio de venta." };
  if (moneda === "COP" && !Number.isInteger(imp)) return { ok: false, error: "En COP el impuesto no comisionable va en pesos enteros." };
  if (moneda === "USD" && Math.abs(imp * 100 - Math.round(imp * 100)) > 1e-6) return { ok: false, error: "En USD el impuesto no comisionable admite máximo 2 decimales." };

  const origen = raw.origen == null || raw.origen === "" ? null : texto(raw.origen, 60);
  const destino = raw.destino == null || raw.destino === "" ? null : texto(raw.destino, 60);
  if ((raw.origen ?? "") !== "" && !origen) return { ok: false, error: "El origen no es válido." };
  if ((raw.destino ?? "") !== "" && !destino) return { ok: false, error: "El destino no es válido." };
  const fechaIda = raw.fechaIda == null || raw.fechaIda === "" ? null : fechaValida(raw.fechaIda);
  const fechaRegreso = raw.fechaRegreso == null || raw.fechaRegreso === "" ? null : fechaValida(raw.fechaRegreso);
  if ((raw.fechaIda ?? "") !== "" && !fechaIda) return { ok: false, error: "La fecha de ida no es válida." };
  if ((raw.fechaRegreso ?? "") !== "" && !fechaRegreso) return { ok: false, error: "La fecha de regreso no es válida." };
  if (fechaRegreso && !fechaIda) return { ok: false, error: "Indica la fecha de ida para usar una de regreso." };
  if (fechaIda && fechaRegreso && fechaRegreso < fechaIda) return { ok: false, error: "El regreso no puede ser anterior a la ida." };
  if (clase === "vuelo" && (!origen || !destino || !fechaIda)) {
    return { ok: false, error: "Un vuelo necesita origen, destino y fecha de ida." };
  }
  return {
    ok: true,
    valor: {
      clase, nombre, moneda, pax, precio: Math.round(precio * 100) / 100, impuestoNoComisionable: Math.round(imp * 100) / 100,
      origen: clase === "vuelo" ? origen : null, destino, fechaIda, fechaRegreso,
    },
  };
}

/** Lee `manuales` de la entrada cruda de la solicitud (ausente = ninguno). */
export function leerManualesEntrada(inputRaw: unknown, monedaCotizacion: string | null = null): { ok: true; manuales: ServicioManual[] } | { ok: false; error: string } {
  const crudo = esObjeto(inputRaw) ? inputRaw.manuales : undefined;
  if (crudo === undefined || crudo === null) return { ok: true, manuales: [] };
  if (!Array.isArray(crudo)) return { ok: false, error: "Los servicios manuales no son válidos." };
  if (crudo.length > MAX_MANUALES) return { ok: false, error: `Máximo ${MAX_MANUALES} servicios manuales por cotización.` };
  const manuales: ServicioManual[] = [];
  for (let i = 0; i < crudo.length; i++) {
    const r = validarServicioManual(crudo[i], monedaCotizacion);
    if (!r.ok) return { ok: false, error: `Servicio manual ${i + 1}: ${r.error}` };
    manuales.push(r.valor);
  }
  return { ok: true, manuales };
}

/** Línea que ve el cliente en la cotización: nunca afirma proveedor ni reserva. */
export function descripcionCotizacionManual(m: ServicioManual): string {
  const ruta = m.clase === "vuelo" && m.origen && m.destino ? ` ${m.origen} → ${m.destino}` : "";
  const fechas = m.fechaIda ? ` · ${m.fechaIda}${m.fechaRegreso ? ` → ${m.fechaRegreso}` : ""}` : "";
  const etiqueta = m.clase === "vuelo" ? "Vuelo" : "Servicio";
  return `${etiqueta} · ${m.nombre}${ruta}${fechas} · ${m.pax} pax — sujeto a confirmación de disponibilidad y tarifa`;
}

type ConId = { id: string; tipo: string };

/** Reemplaza SOLO el servicio manual `id`; cualquier otro ítem queda idéntico (misma referencia). */
export function reemplazarManual<T extends ConId>(items: readonly T[], id: string, cambio: Record<string, unknown>): T[] {
  return items.map((i) => (i.id === id && i.tipo === "manual" ? ({ ...i, ...cambio, id: i.id, tipo: "manual" } as T) : i));
}

/** Línea del contrato ya convertido: igual que la de la cotización, sin la salvedad (costo y proveedor ya quedaron registrados). */
export function descripcionContratoManual(m: ServicioManual): string {
  return descripcionCotizacionManual(m).replace(/ — sujeto a confirmación de disponibilidad y tarifa$/, "");
}

/** Costo NETO y proveedor que el personal captura al CONVERTIR (la cotización no los guarda). */
export type CostoManual = { costo: number; proveedor: string };

export function validarCostoManual(raw: unknown, moneda: MonedaManual): { ok: true; valor: CostoManual } | { ok: false; error: string } {
  if (!esObjeto(raw)) return { ok: false, error: "Falta el costo y el proveedor." };
  const proveedor = texto(raw.proveedor, 120);
  if (!proveedor || proveedor.length < 2) return { ok: false, error: "El proveedor es obligatorio (2 a 120 caracteres)." };
  const costo = raw.costo;
  if (typeof costo !== "number" || !Number.isFinite(costo) || costo <= 0 || costo > MAX_PRECIO) return { ok: false, error: "El costo debe ser mayor que cero." };
  if (moneda === "COP" && !Number.isInteger(costo)) return { ok: false, error: "En COP el costo va en pesos enteros." };
  if (moneda === "USD" && Math.abs(costo * 100 - Math.round(costo * 100)) > 1e-6) return { ok: false, error: "En USD el costo admite máximo 2 decimales." };
  return { ok: true, valor: { costo, proveedor } };
}

/** Línea del plan B2B de #102 para el manual `i` (misma estructura que hoteles y tours: la comisión sale de PVP − impuesto). */
export function lineaB2BManual(m: ServicioManual, i: number): { clave: string; pvp: number; impuesto: number } {
  return { clave: `manual-${i}`, pvp: m.precio, impuesto: m.impuestoNoComisionable };
}

/** ¿El primer contrato (el que lleva los manuales) sigue sin crearse? Solo entonces se piden costo y proveedor. Misma clave de grupo que la conversión. */
export function primerGrupoPendiente(contratosPorGrupo: Record<string, string> | null | undefined, destinoPrimerGrupo: string | null): boolean {
  return !(contratosPorGrupo ?? {})[destinoPrimerGrupo ?? "__sin_destino__"];
}

const SUFIJO_COTIZACION = " — sujeto a confirmación de disponibilidad y tarifa";

/**
 * Los servicios manuales que la cotización DECLARÓ, comprobados contra tres fuentes independientes: `payload.manuales`, las líneas del documento
 * (`detalle.items`, que llevan la salvedad «sujeto a confirmación») y las líneas `manual-N` del plan B2B. Si cualquiera dice que hay manuales,
 * el bloque debe existir, estar bien formado y coincidir con las otras fuentes: nunca se convierte en [] en silencio.
 */
export function verificarManualesCotizados(a: {
  payload: unknown; detalleItems: unknown; plan: { lineas: readonly { clave: string }[] } | null; moneda: string | null;
}): { ok: true; manuales: ServicioManual[] } | { ok: false; error: string } {
  const malo = (e: string) => ({ ok: false as const, error: `Los servicios manuales de la cotización no son consistentes (${e}). No se creó ningún contrato.` });
  const payload = esObjeto(a.payload) ? a.payload : {};
  const lineasDoc = (Array.isArray(a.detalleItems) ? a.detalleItems : []).filter(
    (x): x is { descripcion: string; valor_total?: unknown } => esObjeto(x) && typeof x.descripcion === "string" && x.descripcion.endsWith(SUFIJO_COTIZACION));
  const lineasPlan = (a.plan?.lineas ?? []).filter((l) => l.clave.startsWith("manual-"));
  if (!Object.hasOwn(payload, "manuales") && !lineasDoc.length && !lineasPlan.length) return { ok: true, manuales: [] };

  const crudo = payload.manuales;
  if (!Array.isArray(crudo) || crudo.length < 1 || crudo.length > MAX_MANUALES) return malo("el bloque falta o está mal formado");
  const manuales: ServicioManual[] = [];
  for (const [i, c] of crudo.entries()) {
    const r = validarServicioManual(c, a.moneda);
    if (!r.ok) return { ok: false, error: `Servicio manual ${i + 1} de la cotización: ${r.error}` };
    manuales.push(r.valor);
  }
  if (lineasDoc.length !== manuales.length) return malo("el documento cotizado trae otra cantidad");
  for (const [i, m] of manuales.entries()) {
    if (lineasDoc[i].descripcion !== descripcionCotizacionManual(m) || Number(lineasDoc[i].valor_total) !== m.precio) return malo(`el servicio ${i + 1} no coincide con lo cotizado`);
  }
  if (a.plan && lineasPlan.length !== manuales.length) return malo("las líneas del plan B2B no coinciden");
  return { ok: true, manuales };
}
