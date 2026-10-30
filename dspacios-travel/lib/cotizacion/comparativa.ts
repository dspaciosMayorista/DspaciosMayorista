import type { ResumenHotelUI } from "./comparativaAcciones";
// ─────────────────────────────────────────────────────────────────────────
// Cotizaciones COMPARATIVAS (#35) — lógica PURA (sin I/O, sin Supabase).
//
// Una comparativa sirve para ESCOGER UN hotel entre hasta tres del mismo viaje;
// NUNCA para comprar alternativas juntas: ningún total suma opciones entre sí.
//
//   · MADRE  : cotización con modo='comparativa' (tipo comparativa_manual /
//              comparativa_carrito). precio_venta = NULL. No se cobra, no se
//              convierte y es económicamente inmutable (migración 211).
//   · OPCIÓN : (opcion_ref A|B|C, acomodacion_ref) con su total y su snapshot.
//   · HIJA   : cotización SIMPLE con lo común + la opción elegida.
//
// Este módulo:
//   - arma los argumentos de `crear_cotizacion_comparativa` para el origen
//     MANUAL/dinámico, replicando 1:1 la liquidación de `crearCotizacionManual`
//     (así la hija es idéntica a la cotización dinámica de hoy; hay una prueba
//     de ejecución real que lo demuestra);
//   - traduce errores de la base a mensajes neutros (nunca se filtra SQL ni se
//     distingue «sin permiso» de «no existe»);
//   - normaliza contacto igual que la base (para que cliente y servidor coincidan);
//   - calcula las composiciones uniformes de acomodación del origen tarifario;
//   - resume importes por opción para listados y documentos (sin $0 ficticio).
// ─────────────────────────────────────────────────────────────────────────
import { marcar } from "@/lib/calc/paquetes";
import { sugerirIncluye } from "@/lib/cotizacion/incluye";
import { repartoPorPersona, type RepartoTarifa } from "@/lib/contrato/repartoTarifa";
import { etiquetaIata } from "@/lib/iata";
import { notaVueloManual, tramosVueloManual, validarServicioManual } from "@/lib/cart/servicioManual";
import { hoyBogota, resolverVigenciaCotizacion } from "@/lib/cotizacion/vigencia";
import type { CotizacionManualInput, ServicioManual } from "@/app/(dashboard)/dashboard/cotizaciones/manual-actions";

export const MAX_OPCIONES = 3;
export const OPCIONES_REF = ["A", "B", "C"] as const;
export type OpcionRef = (typeof OPCIONES_REF)[number];
export const ACOMODACION_UNICA = "unica";
export const TIPOS_MADRE = ["comparativa_manual", "comparativa_carrito"] as const;
export type TipoMadre = (typeof TIPOS_MADRE)[number];
export type CanalEleccion = "interno" | "b2b" | "publico";

export function esOpcionRef(v: unknown): v is OpcionRef {
  return typeof v === "string" && (OPCIONES_REF as readonly string[]).includes(v);
}
export function esTipoMadre(tipo: string | null | undefined): tipo is TipoMadre {
  return tipo === "comparativa_manual" || tipo === "comparativa_carrito";
}
/** ¿La cotización es una MADRE comparativa? (modo es la fuente de verdad; el tipo lo refuerza). */
export function esMadre(c: { modo?: string | null; tipo?: string | null }): boolean {
  return c.modo === "comparativa" || esTipoMadre(c.tipo);
}

// ── Errores ──────────────────────────────────────────────────────────────
// La base lanza `COMPARATIVA_<CODIGO>: texto`. El navegador recibe SOLO un
// mensaje neutro: sin SQL, sin nombres de tabla y sin diferenciar «no tienes
// permiso» de «no existe» (evita enumerar cotizaciones o personas).
export const MENSAJES_COMPARATIVA: Record<string, string> = {
  NO_AUTORIZADO: "No tienes permiso para esta cotización.",
  NO_DISPONIBLE: "Esta comparativa ya no está disponible.",
  VERSION: "La comparativa cambió. Recárgala para ver los valores vigentes.",
  VENCIDA: "Esta comparativa venció.",
  OPCION: "La opción o la acomodación elegida ya no existe.",
  PRECIO_CAMBIO: "El precio de esta opción cambió. Esta comparativa no se modifica: genera una comparativa nueva desde el tarifario.",
  HIJA_ACTIVA: "Ya hay una opción elegida para esta comparativa. Descártala (si no tiene pagos) para elegir otra.",
  RECIBO: "La validación venció o ya se usó. Vuelve a intentarlo.",
  CLAVE: "Esta solicitud ya se registró con otros datos. Vuelve a intentarlo.",
  MADRE_ALTERADA: "No pudimos verificar la integridad de esta comparativa. Contacta a tu asesor.",
  INCOHERENTE: "No pudimos verificar el valor de esta opción. Contacta a tu asesor.",
  NO_COBRABLE: "Una comparativa no admite pagos ni contrato: primero elige una opción.",
  INMUTABLE: "Una comparativa no se modifica. Crea una nueva si necesitas cambiar algo.",
  SOLO_RPC: "Operación no permitida.",
  VIGENCIA: "La vigencia no puede superar la de la comparativa.",
  LIMITE: "No pudimos registrar tu solicitud ahora. Inténtalo más tarde o contacta a tu asesor.",
  DATOS: "Revisa los datos ingresados.",
};
const MENSAJE_GENERICO = "No se pudo completar la operación. Inténtalo de nuevo.";

/** Código `COMPARATIVA_<X>` del mensaje de la base, o null si no es de la comparativa. */
export function codigoErrorComparativa(raw: string | null | undefined): string | null {
  const m = /COMPARATIVA_([A-Z_]+):/.exec(String(raw ?? ""));
  return m ? m[1] : null;
}

/**
 * Mensaje seguro para el navegador. Los errores `DATOS` conservan el texto de la
 * base (son frases en español sin SQL) para que el usuario sepa qué corregir; el
 * resto sale de la tabla de arriba y cualquier otra cosa es genérico.
 */
export function mensajeErrorComparativa(raw: string | null | undefined): string {
  const codigo = codigoErrorComparativa(raw);
  if (!codigo) return MENSAJE_GENERICO;
  if (codigo === "DATOS") {
    const t = String(raw).replace(/^[\s\S]*COMPARATIVA_DATOS:\s*/, "").split(/\r?\n/)[0].trim();
    return t && !/(relation|constraint|violates|sqlstate|pg_)/i.test(t) ? t : MENSAJES_COMPARATIVA.DATOS;
  }
  return MENSAJES_COMPARATIVA[codigo] ?? MENSAJE_GENERICO;
}

/** Códigos que el usuario puede resolver reintentando (la UI ofrece «Recargar»). */
export function esErrorReintentable(codigo: string | null): boolean {
  // PRECIO_CAMBIO no es reintentable: la comparativa es inmutable, hay que generar una nueva.
  return codigo === "VERSION" || codigo === "RECIBO" || codigo === "LIMITE";
}

// ── Contacto (mismo criterio que la base) ─────────────────────────────────
/** Solo dígitos, como `regexp_replace(tel, '\D', '', 'g')` en la base. */
export function normalizarTelefono(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}
export function normalizarCorreo(v: string | null | undefined): string | null {
  const c = String(v ?? "").trim().toLowerCase();
  return c.length ? c : null;
}
export function telefonoValido(v: string | null): boolean {
  return v === null || (v.length >= 7 && v.length <= 15);
}
export function correoValido(v: string | null): boolean {
  return v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}
export type ContactoSolicitud = { nombre: string; telefono: string; email: string; nota: string };
export function validarContactoSolicitud(c: ContactoSolicitud): { ok: true } | { ok: false; error: string } {
  const nombre = c.nombre.trim();
  if (nombre.length < 2 || nombre.length > 120) return { ok: false, error: "Indica tu nombre." };
  const tel = normalizarTelefono(c.telefono);
  const mail = normalizarCorreo(c.email);
  if (tel === null && mail === null) return { ok: false, error: "Indica un teléfono o un correo de contacto." };
  if (!telefonoValido(tel)) return { ok: false, error: "El teléfono no es válido." };
  if (!correoValido(mail)) return { ok: false, error: "El correo no es válido." };
  if (c.nota.length > 500) return { ok: false, error: "La nota es demasiado larga (máximo 500 caracteres)." };
  return { ok: true };
}

// ── IP de origen CONFIABLE (solo para limitar tasa) ───────────────────────
// El valor sale únicamente de cabeceras que la PLATAFORMA fija (Vercel las
// sobrescribe y el cliente no puede enviarlas). Fuera de Vercel no hay
// proxy confiable: se devuelve null y el servidor usa un cupo más estricto.
// Jamás se toma el primer valor de un `x-forwarded-for` arbitrario (lo escribe
// el cliente) ni se confía en la IP de un `Host` cualquiera.
const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;
export function ipValida(ip: string): boolean {
  if (IPV4.test(ip)) return ip.split(".").every((o) => Number(o) <= 255);
  return ip.includes(":") && IPV6.test(ip);
}
export function ipOrigenConfiable(
  leer: (cabecera: string) => string | null | undefined,
  entorno: { enVercel: boolean }
): string | null {
  if (!entorno.enVercel) return null;
  for (const nombre of ["x-vercel-forwarded-for", "x-real-ip"]) {
    const bruto = leer(nombre);
    if (!bruto) continue;
    const primero = bruto.split(",")[0].trim();
    if (primero && ipValida(primero)) return primero.toLowerCase();
  }
  return null;
}

// ── Acomodaciones uniformes del origen tarifario ──────────────────────────
// Para el mismo grupo de ADULTOS, qué habitaciones uniformes lo alojan: 2
// adultos ⇒ 2 sencillas o 1 doble; 4 ⇒ 4 sencillas, 2 dobles o 1 múltiple.
// Solo se ofrecen alternativas cuando NO hay menores (con niños/infantes la
// distribución cambia las tarifas y se conserva la composición del carrito).
export type CapacidadAcomodacion = Record<string, number>;
export type ComposicionUniforme = { acomodacionRef: string; habitaciones: Record<string, number> };

export function composicionesUniformes(
  adultos: number,
  capacidades: CapacidadAcomodacion,
  opciones: { conMenores: boolean; composicionActual: Record<string, number> }
): ComposicionUniforme[] {
  const actual = Object.entries(opciones.composicionActual).filter(([, n]) => n > 0);
  const refActual = actual.length === 1 ? actual[0][0] : "mixta";
  if (opciones.conMenores || !Number.isInteger(adultos) || adultos < 1) {
    return [{ acomodacionRef: refActual, habitaciones: { ...opciones.composicionActual } }];
  }
  const out: ComposicionUniforme[] = [];
  for (const [acom, cap] of Object.entries(capacidades)) {
    if (!/^[a-z0-9_]{1,30}$/.test(acom) || !Number.isInteger(cap) || cap < 1) continue;
    if (adultos % cap !== 0) continue;
    out.push({ acomodacionRef: acom, habitaciones: { [acom]: adultos / cap } });
  }
  if (!out.length) return [{ acomodacionRef: refActual, habitaciones: { ...opciones.composicionActual } }];
  // La composición del carrito siempre figura (aunque sea mixta) y va primero.
  if (!out.some((c) => c.acomodacionRef === refActual)) {
    out.unshift({ acomodacionRef: refActual, habitaciones: { ...opciones.composicionActual } });
  }
  out.sort((a, b) => (a.acomodacionRef === refActual ? -1 : b.acomodacionRef === refActual ? 1 : 0));
  return out;
}

// ── Vista de opciones (documentos, listados) ──────────────────────────────
export type OpcionVista = {
  opcionRef: string;
  acomodacionRef: string;
  etiqueta: string;
  moneda: string;
  tarifaPersona: number | null;
  total: number;
  orden: number;
};
export type GrupoHotel = { opcionRef: string; etiqueta: string; moneda: string; acomodaciones: OpcionVista[] };

/** Agrupa por hotel (opcion_ref), con sus acomodaciones ordenadas por total ascendente. */
export function agruparPorHotel(opciones: OpcionVista[]): GrupoHotel[] {
  const mapa = new Map<string, GrupoHotel>();
  for (const o of [...opciones].sort((a, b) => a.orden - b.orden)) {
    const g = mapa.get(o.opcionRef) ?? { opcionRef: o.opcionRef, etiqueta: o.etiqueta, moneda: o.moneda, acomodaciones: [] };
    g.acomodaciones.push(o);
    mapa.set(o.opcionRef, g);
  }
  return [...mapa.values()].map((g) => ({ ...g, acomodaciones: [...g.acomodaciones].sort((a, b) => a.total - b.total) }));
}

/**
 * Importe mínimo de una comparativa para listados («desde X»). NUNCA 0 ni suma
 * de opciones: sin opciones válidas devuelve null y el listado muestra «—».
 */
export function desdeComparativa(opciones: Array<{ total: number; moneda: string }>): { total: number; moneda: string } | null {
  const validas = opciones.filter((o) => Number.isFinite(o.total) && o.total > 0);
  if (!validas.length) return null;
  const min = validas.reduce((a, b) => (b.total < a.total ? b : a));
  return { total: min.total, moneda: min.moneda };
}

// ── Origen MANUAL / dinámico ──────────────────────────────────────────────
export type ServicioComparativa = ServicioManual & { opcionRef?: OpcionRef | null };
export type EntradaComparativaManual = Omit<CotizacionManualInput, "servicios"> & {
  servicios: ServicioComparativa[];
  /** Id del catálogo `aliados`; solo para venta B2B (agencia/freelance). Nunca texto libre. */
  aliadoId?: number | null;
  /** Solo lo respeta la base para superadmin; los demás usan el de su perfil. */
  tenant?: string;
  /** Incluye / No incluye y descripción visible del ítem POR OPCIÓN (clave `A/unica`), tal como los dejó el asesor antes de generar. Sin él: lo sugerido. */
  presentacion?: PresentacionComparativa | null;
};

export type ServicioRpc = {
  orden: number; tipo_servicio: string; plataforma: string | null; nombre_servicio: string | null;
  proveedor: string | null; costo_neto: number; modo: "mk" | "ta"; pct_markup: number; ta: number; valor: number;
  opcion_ref: OpcionRef | null;
};
export type OpcionRpc = {
  opcion_ref: OpcionRef; acomodacion_ref: string; orden: number; etiqueta: string; moneda: string;
  tarifa_persona: number | null; total: number; resumen_publico: Record<string, unknown>; plantilla_hija: Record<string, unknown>;
};
export type ArgsCrearComparativa = {
  cabecera: Record<string, unknown>; servicios: ServicioRpc[]; opciones: OpcionRpc[]; aliadoId: number | null;
};

// MISMA fórmula que `valorServicio` de manual-actions.ts.
function valorServicio(costo: number, modo: "mk" | "ta", pctMarkup: number, ta: number): number {
  const c = Number(costo) || 0;
  if (modo === "ta") return Math.round(Math.max(0, c) + (Number(ta) || 0));
  const mk = (Number(pctMarkup) || 0) / 100;
  if (c <= 0 || mk >= 1) return 0;
  return Math.round(marcar(c, mk));
}

// MISMA lógica que `calcularRecobroNinos` de manual-actions.ts.
function calcularRecobroNinos(input: {
  pax: number; ninos?: number; tarifaNino?: number; recobro?: number; recobroAliado?: number;
  tipoAsesor: "interno" | "agencia" | "freelance";
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

function fmtDMY(iso?: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—");
}
// MISMO nombre de ítem agrupado que ve el cliente en la cotización dinámica.
export function nombrePaqueteItem(destino?: string | null, ida?: string | null, regreso?: string | null): string {
  const d = (destino || "").trim().toUpperCase() || "DESTINO";
  return `PAQUETE TURÍSTICO A ${d} DEL ${fmtDMY(ida)} AL ${fmtDMY(regreso)}`;
}

export type ResultadoConstruccion<T> = { ok: true; datos: T } | { ok: false; error: string };

/**
 * Arma la comparativa manual: servicios comunes (aéreo, traslados, asistencia,
 * otros) contados UNA sola vez en cada hotel + el hotel de cada opción.
 * Reglas v1: 2 a 3 hoteles (A, B, C), todo servicio que no sea hotel es COMÚN
 * (un vuelo o servicio exclusivo de una opción queda fuera), una moneda.
 */
export function construirComparativaManual(
  input: EntradaComparativaManual,
  ctx: { hoy?: string; creadoPorEmail?: string | null } = {}
): ResultadoConstruccion<ArgsCrearComparativa> {
  if (!`${input.cliente?.nombres ?? ""}${input.cliente?.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };

  const servicios = (input.servicios ?? []).filter(
    (s) => (Number(s.costoNeto) || 0) > 0 || (s.nombre ?? "").trim() || (s.plataforma ?? "").trim()
  );
  if (!servicios.length) return { ok: false, error: "Agrega al menos un servicio con su costo." };

  for (const s of servicios) {
    if (s.tipo !== "hotel" && s.opcionRef) {
      return { ok: false, error: "Los vuelos y servicios exclusivos de una opción no se admiten: déjalos comunes a todos los hoteles." };
    }
    if (s.opcionRef != null && !esOpcionRef(s.opcionRef)) return { ok: false, error: "La opción de un hotel debe ser A, B o C." };
  }
  const hoteles = servicios.filter((s) => s.tipo === "hotel");
  if (hoteles.some((h) => !h.opcionRef)) return { ok: false, error: "Asigna cada hotel a una opción (A, B o C)." };
  const refs = OPCIONES_REF.filter((r) => hoteles.some((h) => h.opcionRef === r));
  if (refs.length < 2) return { ok: false, error: "Una comparativa necesita al menos dos hoteles en opciones distintas." };
  if (refs.length > MAX_OPCIONES) return { ok: false, error: `Máximo ${MAX_OPCIONES} hoteles por comparativa.` };

  const moneda = (input.moneda || "COP").toUpperCase();
  if (moneda !== "COP" && moneda !== "USD") return { ok: false, error: "La moneda debe ser COP o USD." };

  const hoy = ctx.hoy ?? hoyBogota();
  const vigenciaRes = resolverVigenciaCotizacion({
    hoy, fechaSalida: input.fechaIda || null, vigenciaSolicitada: input.vigenciaHasta, diasPorDefecto: 3,
  });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };

  const tipoAsesor = input.tipoAsesor;
  if (input.aliadoId != null && (tipoAsesor === "interno" || !Number.isInteger(input.aliadoId) || input.aliadoId <= 0)) {
    return { ok: false, error: "El aliado solo aplica a una venta de agencia o freelance." };
  }
  const asesor = tipoAsesor === "interno" ? input.asesorInterno : tipoAsesor === "agencia" ? input.agenciaNombre : input.freelanceNombre;
  const canal = tipoAsesor === "interno" ? "B2C" : "B2B";
  const clienteNombre = `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim();

  // Liquidación de cada servicio (igual que la cotización dinámica); `orden` = posición original.
  const filas = servicios.map((s, i) => {
    const modo: "mk" | "ta" = s.tipo === "aereo" && s.modo === "ta" ? "ta" : "mk";
    return {
      orden: i,
      tipo_servicio: s.tipo || "otro",
      plataforma: (s.plataforma || "").trim() || null,
      nombre_servicio: (s.nombre || "").trim() || null,
      proveedor: (s.proveedor || "").trim() || null,
      costo_neto: Number(s.costoNeto) || 0,
      modo,
      pct_markup: modo === "mk" ? (Number(s.pctMarkup) || 0) / 100 : 0,
      ta: modo === "ta" ? Number(s.ta) || 0 : 0,
      valor: valorServicio(s.costoNeto, modo, s.pctMarkup, s.ta),
      opcion_ref: (s.opcionRef ?? null) as OpcionRef | null,
    } satisfies ServicioRpc;
  });
  if (filas.some((f) => f.tipo_servicio === "hotel" && !(f.valor > 0))) {
    return { ok: false, error: "Cada hotel necesita un costo mayor a cero." };
  }

  const rec = calcularRecobroNinos(input);
  const adultos = Math.max(Number(input.pax) || 1, 1);
  const incluyeBase = (input.incluye || "").trim();
  const pres = leerPresentacionComparativa(input.presentacion);
  if (!pres.ok) return { ok: false, error: pres.error };
  if (pres.datos && Object.keys(pres.datos).some((k) => !refs.some((r) => k === `${r}/${ACOMODACION_UNICA}`))) {
    return { ok: false, error: "La presentación nombra una opción que no existe en esta comparativa." };
  }
  let errorPresentacion: string | null = null;

  const opciones: OpcionRpc[] = refs.map((ref, idx) => {
    // Filas de ESTA opción en su orden original: comunes + hoteles de la opción.
    const propias = filas.filter((f) => f.opcion_ref === null || f.opcion_ref === ref);
    const totalServicios = propias.reduce((acc, f) => acc + f.valor, 0);
    const adultSubtotal = totalServicios + rec.recobroN;
    const tarifaAdultoUnit = Math.round(adultSubtotal / adultos);
    const precioVenta = adultSubtotal + rec.totalNinos;
    const hotelPropio = propias.find((f) => f.tipo_servicio === "hotel" && f.opcion_ref === ref);
    const etiqueta = hotelPropio?.nombre_servicio || `Hotel ${ref}`;

    const itemsSugeridos: { descripcion: string; cantidad: number; tarifa_unit: number; valor: number; orden: number }[] = [
      { descripcion: nombrePaqueteItem(input.destino, input.fechaIda, input.fechaRegreso), cantidad: adultos, tarifa_unit: tarifaAdultoUnit, valor: adultSubtotal, orden: 0 },
    ];
    if (rec.nNinos > 0) {
      itemsSugeridos.push({ descripcion: "Tarifa por niño", cantidad: rec.nNinos, tarifa_unit: rec.valorNino, valor: rec.totalNinos, orden: 1 });
    }
    // Solo cambia el TEXTO de una línea editable (nunca cantidad, tarifa, valor ni orden).
    const p = pres.datos?.[`${ref}/${ACOMODACION_UNICA}`];
    const conTexto = aplicarDescripciones(itemsSugeridos, p?.descripciones ?? []);
    if (!conTexto.ok) errorPresentacion ??= conTexto.error;
    const itemsDoc = conTexto.ok ? conTexto.items : itemsSugeridos;

    // Payload de la HIJA = la entrada de una cotización dinámica común, con SOLO sus servicios.
    // (Sin las claves propias de la comparativa: aliadoId, tenant, opcionRef, presentacion.)
    const { aliadoId: _a, tenant: _t, presentacion: _p, ...base } = input;
    void _a; void _t; void _p;
    const serviciosHija: ServicioManual[] = servicios
      .filter((s) => !s.opcionRef || s.opcionRef === ref)
      .map(({ opcionRef: _o, ...resto }) => { void _o; return resto; });
    const incluyeOpcion = p?.incluye !== undefined ? p.incluye : (incluyeBase || sugerirIncluye(serviciosHija.map((s) => ({ tipo: s.tipo, nombre: s.nombre }))));
    const noIncluyeOpcion = p?.noIncluye !== undefined ? p.noIncluye : (input.noIncluye || "").trim();
    // Con presentación editada, la hija lleva en su payload el MISMO Incluye / No incluye que su documento; sin ella, la entrada tal cual (igual que una dinámica común).
    const payloadHija = JSON.parse(JSON.stringify({ ...base, servicios: serviciosHija, ...(p ? { incluye: incluyeOpcion, noIncluye: noIncluyeOpcion } : {}) }));

    const detalleHija = {
      venta: {
        numero_contrato: "",
        cliente: clienteNombre,
        destino: input.destino || null,
        fecha_salida: input.fechaIda || null,
        fecha_regreso: input.fechaRegreso || null,
        pax: adultos,
        ninos: rec.nNinos,
        precio_venta: precioVenta,
        moneda,
        asesor: asesor || null,
        canal,
        tipo_cliente: tipoAsesor,
        hotel: propias.find((f) => f.tipo_servicio === "hotel")?.nombre_servicio ?? null,
        aerolinea: propias.find((f) => f.tipo_servicio === "aereo")?.nombre_servicio ?? null,
        observaciones: input.observaciones || null,
        estado: "cotizacion",
      },
      pasajeros: [],
      hoteles: [],
      vuelos: [],
      incluye: incluyeOpcion,
      noIncluye: noIncluyeOpcion,
      recobro: { total: rec.recobroN, empresa: rec.recobroEmpresaN, aliado: rec.recobroAliadoN },
      items: itemsDoc,
    };

    return {
      opcion_ref: ref,
      acomodacion_ref: ACOMODACION_UNICA,
      orden: idx,
      etiqueta,
      moneda,
      tarifa_persona: tarifaAdultoUnit > 0 ? tarifaAdultoUnit : null,
      total: precioVenta,
      // Público: lo que ya ve el cliente en la cotización dinámica; sin netos,
      // sin proveedores y SIN el recobro (interno).
      resumen_publico: {
        hotel: etiqueta, etiqueta, pax: adultos, ninos: rec.nNinos, moneda, tarifa_persona: tarifaAdultoUnit,
        total: precioVenta, items: itemsDoc, incluye: detalleHija.incluye, noIncluye: detalleHija.noIncluye,
      },
      plantilla_hija: {
        hotel: detalleHija.venta.hotel,
        destino: input.destino || null,
        plan_nombre: "Cotización dinámica",
        pax: Number(input.pax) || 0,
        cliente: clienteNombre,
        cliente_documento: input.cliente.numeroDoc || null,
        fecha_salida: input.fechaIda || null,
        fecha_regreso: input.fechaRegreso || null,
        payload: payloadHija,
        detalle: detalleHija,
      },
    } satisfies OpcionRpc;
  });

  if (errorPresentacion) return { ok: false, error: errorPresentacion };
  if (opciones.some((o) => !(o.total > 0))) return { ok: false, error: "Cada opción necesita un total mayor a cero." };

  const cabecera = {
    tipo: "comparativa_manual",
    tenant: input.tenant ?? "mayorista",
    moneda,
    vigencia_hasta: vigenciaRes.vigencia,
    cliente: clienteNombre,
    cliente_documento: input.cliente.numeroDoc || null,
    destino: input.destino || null,
    plan_nombre: "Cotización comparativa",
    pax: Number(input.pax) || 0,
    asesor: asesor || null,
    creado_por: ctx.creadoPorEmail ?? null,
    fecha_salida: input.fechaIda || null,
    fecha_regreso: input.fechaRegreso || null,
    payload: JSON.parse(JSON.stringify({ ...input, tenant: undefined })),
    detalle: {
      comparativa: true,
      venta: { cliente: clienteNombre, destino: input.destino || null, fecha_salida: input.fechaIda || null,
               fecha_regreso: input.fechaRegreso || null, pax: adultos, moneda, estado: "cotizacion" },
    },
  };

  return { ok: true, datos: { cabecera, servicios: filas, opciones, aliadoId: input.aliadoId ?? null } };
}

/** Instante (ms) a partir del cual una solicitud pendiente se considera vencida (72 h, igual que la base). */
export function limiteSolicitudVencida(ahora: number = Date.now()): number {
  return ahora - 72 * 3600 * 1000;
}

// ── Actores ──────────────────────────────────────────────────────────────
/** Mismos roles internos que las policies de `cotizaciones` y las RPC de la 211. */
export const ROLES_INTERNOS_COMPARATIVA = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;
export function esRolInternoComparativa(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_INTERNOS_COMPARATIVA as readonly string[]).includes(rol);
}
export function canalDeRol(rol: string | null | undefined, activo: boolean | null | undefined): CanalEleccion {
  if (activo !== true) return "publico";
  if (esRolInternoComparativa(rol)) return "interno";
  if (rol === "agencia" || rol === "freelance") return "b2b";
  return "publico"; // p. ej. cliente_final: navega como visitante
}

// ── Entradas de las acciones (llegan como `unknown` desde el navegador) ───
// La comparativa se identifica SOLO por el token de su enlace: un id numérico adivinado no sirve.
export const TOKEN_ENLACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type EntradaEleccion = {
  token: string; opcionRef: string; acomodacionRef: string; version: number; clave: string;
  cliente: { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string } | null;
};
function textoCorto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
export function validarClaveIdempotencia(v: unknown): string | null {
  return typeof v === "string" && v.trim().length >= 8 && v.trim().length <= 80 && /^[A-Za-z0-9_\-:.]+$/.test(v.trim()) ? v.trim() : null;
}
export function validarRefsOpcion(opcionRef: unknown, acomodacionRef: unknown): { opcionRef: OpcionRef; acomodacionRef: string } | null {
  if (!esOpcionRef(opcionRef)) return null;
  if (typeof acomodacionRef !== "string" || !/^[a-z0-9_]{1,30}$/.test(acomodacionRef)) return null;
  return { opcionRef, acomodacionRef };
}
export function validarEntradaEleccion(raw: unknown): { ok: true; datos: EntradaEleccion } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "La solicitud no tiene una forma válida." };
  const r = raw as Record<string, unknown>;
  const version = Number(r.version);
  const token = typeof r.token === "string" && TOKEN_ENLACE.test(r.token.trim()) ? r.token.trim().toLowerCase() : null;
  if (!token) return { ok: false, error: "Enlace de la comparativa inválido." };
  if (!Number.isInteger(version) || version <= 0) return { ok: false, error: "Versión inválida." };
  const refs = validarRefsOpcion(r.opcionRef, r.acomodacionRef);
  if (!refs) return { ok: false, error: "Opción o acomodación inválida." };
  const clave = validarClaveIdempotencia(r.clave);
  if (!clave) return { ok: false, error: "Falta la clave de la solicitud. Recarga la página e inténtalo de nuevo." };
  let cliente: EntradaEleccion["cliente"] = null;
  if (r.cliente != null) {
    if (typeof r.cliente !== "object" || Array.isArray(r.cliente)) return { ok: false, error: "Datos del cliente inválidos." };
    const c = r.cliente as Record<string, unknown>;
    cliente = {
      nombres: textoCorto(c.nombres, 120), apellidos: textoCorto(c.apellidos, 120), numeroDoc: textoCorto(c.numeroDoc, 40),
      telefono: textoCorto(c.telefono, 40), email: textoCorto(c.email, 160).toLowerCase(),
    };
  }
  return { ok: true, datos: { token, opcionRef: refs.opcionRef, acomodacionRef: refs.acomodacionRef, version, clave, cliente } };
}
/** Datos mínimos del checkout público: los mismos que exige la base en el recibo. */
export function validarClienteCheckoutPublico(c: EntradaEleccion["cliente"]): { ok: true } | { ok: false; error: string } {
  if (!c || !c.nombres) return { ok: false, error: "Ingresa tus nombres." };
  if (!c.numeroDoc) return { ok: false, error: "Ingresa tu número de documento." };
  if (!normalizarTelefono(c.telefono) || !telefonoValido(normalizarTelefono(c.telefono))) return { ok: false, error: "Ingresa un teléfono válido." };
  if (c.email && !correoValido(normalizarCorreo(c.email))) return { ok: false, error: "El correo no es válido." };
  return { ok: true };
}

export type EntradaSolicitud = {
  token: string; opcionRef: string; acomodacionRef: string; version: number; clave: string; contacto: ContactoSolicitud;
};
export function validarEntradaSolicitud(raw: unknown): { ok: true; datos: EntradaSolicitud } | { ok: false; error: string } {
  const base = validarEntradaEleccion(raw);
  if (!base.ok) return base;
  const r = raw as Record<string, unknown>;
  const c = typeof r.contacto === "object" && r.contacto !== null ? (r.contacto as Record<string, unknown>) : {};
  const contacto: ContactoSolicitud = {
    nombre: textoCorto(c.nombre, 120), telefono: textoCorto(c.telefono, 40), email: textoCorto(c.email, 160), nota: textoCorto(c.nota, 500),
  };
  const v = validarContactoSolicitud(contacto);
  if (!v.ok) return v;
  const { token, opcionRef, acomodacionRef, version, clave } = base.datos;
  return { ok: true, datos: { token, opcionRef, acomodacionRef, version, clave, contacto } };
}

/**
 * #64: ¿la comparativa admite la elección por el canal PÚBLICO (visitante con el enlace)? Dos casos, y solo estos: (1) anónima (la creó el propio visitante), o
 * (2) una comparativa del CARRITO del mayorista que el personal interno marcó EXPRESAMENTE para compartir (`payload.compartirPublico === true`) y que no es de un aliado.
 * Es la misma regla que `f211_priv.madre_anonima` en la base (que sigue siendo la autoridad); aquí solo decide el camino y el mensaje.
 */
export function madreAdmiteEleccionPublica(m: {
  tipo: string; tenant: string | null; creado_por_id: string | null; propietario_id: string | null; aliado_id: number | null; payload: unknown;
}): boolean {
  if (m.creado_por_id == null && m.propietario_id == null && m.aliado_id == null) return true;
  const p = m.payload;
  const compartida = typeof p === "object" && p !== null && !Array.isArray(p) && (p as Record<string, unknown>).compartirPublico === true;
  return compartida && m.tipo === "comparativa_carrito" && m.tenant === "mayorista" && m.creado_por_id != null && m.propietario_id == null && m.aliado_id == null;
}

/** Lo que se muestra de una opción (de `resumen_publico`, que ya viene sin netos, proveedores ni recobro). Incluye los vuelos manuales comunes (ruta, tramo, fecha y pasajeros; sin precio). */
export function resumenDeOpcion(raw: unknown): ResumenHotelUI {
  const r = (raw ?? {}) as Record<string, unknown>;
  const servicios = Array.isArray(r.servicios) ? (r.servicios as Array<Record<string, unknown>>).map((s) => ({ nombre: String(s.nombre ?? ""), precio: s.precio == null ? null : Number(s.precio) })).filter((s) => s.nombre) : undefined;
  const items = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>).map((i) => ({ descripcion: String(i.descripcion ?? ""), valor: Number(i.valor) || 0 })).filter((i) => i.descripcion) : undefined;
  const vuelos = Array.isArray(r.vuelos)
    ? (r.vuelos as Array<Record<string, unknown>>).map((v) => ({ tramo: String(v.tramo ?? ""), origen: v.origen == null ? null : String(v.origen), destino: v.destino == null ? null : String(v.destino), fecha: v.fecha == null ? null : String(v.fecha), hora: typeof v.hora === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.hora) ? v.hora : null, nota: String(v.nota ?? "") })).filter((v) => v.tramo)
    : undefined;
  return { plan: typeof r.plan_nombre === "string" ? r.plan_nombre : null, servicios, vuelos, items, incluye: typeof r.incluye === "string" ? r.incluye : null, noIncluye: typeof r.noIncluye === "string" ? r.noIncluye : null };
}

/** Un «otro servicio» manual de una opción, tal como se muestra: nunca precio, costo ni proveedor (su valor ya está en el total de la opción, una sola vez). */
export type OtroServicioOpcion = { nombre: string; pax: number; fechaIda: string | null; fechaRegreso: string | null };

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los «otros servicios» manuales de UNA opción, leídos de su SNAPSHOT congelado (`cotizacion_opciones.plantilla_hija`), no de lo que haya quedado escrito en el resumen público:
 * así lo ven igual una comparativa recién creada y una creada antes de que el resumen los listara. Solo se muestran si el snapshot es verificable: hoteles + servicios + manuales
 * del snapshot deben sumar EXACTAMENTE el total de la opción; si no cuadra (o el bloque está mal formado) devuelve `ok: false` y la pantalla pide generar la comparativa de nuevo,
 * en vez de aparentar que contiene —o no contiene— el servicio. Una comparativa manual (sin ítems de carrito) no lleva manuales.
 */
export function otrosServiciosDeOpcion(plantilla: unknown, total: unknown): { ok: true; otros: OtroServicioOpcion[] } | { ok: false } {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const payload = obj(plantilla) ? plantilla.payload : undefined;
  if (!obj(payload) || !Array.isArray(payload.items)) return { ok: true, otros: [] };
  const manuales = payload.manuales === undefined ? [] : payload.manuales;
  const tours = payload.tours === undefined ? [] : payload.tours;
  if (!Array.isArray(manuales) || !Array.isArray(tours)) return { ok: false };
  let suma = 0;
  for (const x of [...payload.items, ...tours, ...manuales]) {
    const p = obj(x) ? x.precio : undefined;
    if (typeof p !== "number" || !Number.isFinite(p)) return { ok: false };
    suma += p;
  }
  const t = Number(total);
  if (!Number.isFinite(t) || Math.abs(suma - t) > 0.5) return { ok: false };
  const otros: OtroServicioOpcion[] = [];
  for (const m of manuales) {
    if (!obj(m) || m.clase !== "otro") continue;
    const nombre = typeof m.nombre === "string" ? m.nombre.trim() : "";
    const fecha = (v: unknown) => (typeof v === "string" && FECHA_ISO.test(v) ? v : null);
    if (!nombre || nombre.length > 120 || typeof m.pax !== "number" || !Number.isInteger(m.pax) || m.pax < 1) return { ok: false };
    otros.push({ nombre, pax: m.pax, fechaIda: fecha(m.fechaIda), fechaRegreso: fecha(m.fechaRegreso) });
  }
  return { ok: true, otros };
}

/** Tarifa de un menor (Niño 1/2, infante) de UNA opción, tal como la liquidó el snapshot de esa opción: nunca la de adulto. */
export type MenorOpcion = { descripcion: string; cantidad: number; tarifa: number };

/**
 * Tarifa de los menores REALMENTE cotizados en una opción (se muestra en el documento; no se calcula ni se infiere).
 *  · Comparativa manual: la línea «Tarifa por niño» de `resumen_publico.items` (cantidad × tarifa_unit).
 *  · Comparativa de carrito: las líneas de menores de `plantilla_hija.detalle.items` (adultos = 0, ninos = cantidad, tarifa_nino).
 * Sin menores cotizados → []. Una opción NETO (`total_exigible`) también → []: sus líneas están a PVP y no cuadran con el total exigible.
 * `etiqueta` (hotel) se recorta del inicio de la descripción para que no se repita bajo el nombre del hotel.
 */
function leerMenores(resumen: unknown, plantilla: unknown, etiqueta: string): MenorOpcion[] {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const cant = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  const r = obj(resumen) ? resumen : {};
  const out: MenorOpcion[] = [];
  if (Array.isArray(r.items)) {
    for (const i of r.items) {
      if (!obj(i) || i.descripcion !== "Tarifa por niño") continue;
      const cantidad = cant(i.cantidad), tarifa = num(i.tarifa_unit);
      if (cantidad && tarifa != null) out.push({ descripcion: "Niño", cantidad, tarifa });
    }
  }
  const detalle = obj(plantilla) && obj(plantilla.detalle) ? plantilla.detalle : null;
  if (detalle && Array.isArray(detalle.items)) {
    for (const i of detalle.items) {
      if (!obj(i) || i.adultos !== 0) continue;
      const cantidad = cant(i.ninos), tarifa = num(i.tarifa_nino);
      if (!cantidad || tarifa == null || typeof i.descripcion !== "string") continue;
      const d = i.descripcion.startsWith(etiqueta) ? i.descripcion.slice(etiqueta.length) : i.descripcion;
      out.push({ descripcion: d.replace(/^(\s*—\s*[^·]*)?\s*·\s*/, "").trim() || "Menor", cantidad, tarifa });
    }
  }
  return out;
}

const esNeto = (resumen: unknown) => typeof (resumen as { total_exigible?: unknown } | null)?.total_exigible === "number";

/** Tarifa de menores que se puede MOSTRAR: la liquidada en el snapshot. En una opción NETO → [] (ver `menoresNoDesglosables`). */
export function menoresDeOpcion(resumen: unknown, plantilla: unknown, etiqueta: string): MenorOpcion[] {
  return esNeto(resumen) ? [] : leerMenores(resumen, plantilla, etiqueta);
}

/** Opción NETO cuyo snapshot SÍ trae líneas de menores (a PVP): no se muestran como NETO ni se mezclan con el total exigible; la pantalla explica el límite. */
export function menoresNoDesglosables(resumen: unknown, plantilla: unknown, etiqueta: string): boolean {
  return esNeto(resumen) && leerMenores(resumen, plantilla, etiqueta).length > 0;
}

/** Texto libre (una línea por ítem, o separado por «·» / «;») → lista de viñetas. */
export function lineasTexto(texto?: string | null): string[] {
  return (texto || "").split(/\r?\n|·|;/).map((t) => t.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
}

/**
 * Incluye / No incluye por opción. `comun` = idéntico en TODAS las opciones y no vacío (se muestra una sola vez); si difiere, cada opción lleva el suyo (`porOpcion`).
 * Una opción sin texto no muestra nada (nunca se le presta el de otra).
 */
export function condicionesPorOpcion(grupos: readonly GrupoHotel[], resumenes: Record<string, ResumenHotelUI>): {
  comun: TextoCondiciones | null; porAcomodacion: Record<string, TextoCondiciones>;
} {
  const porAcomodacion: Record<string, TextoCondiciones> = {};
  for (const g of grupos) {
    for (const a of g.acomodaciones) {
      const r = resumenDeAcomodacion(resumenes, g.opcionRef, a.acomodacionRef);
      porAcomodacion[`${g.opcionRef}/${a.acomodacionRef}`] = { inc: lineasTexto(r.incluye), no: lineasTexto(r.noIncluye) };
    }
  }
  const todas = Object.values(porAcomodacion);
  const clave = (t: TextoCondiciones) => JSON.stringify([t.inc, t.no]);
  const comun = todas.length > 0 && todas.every((t) => clave(t) === clave(todas[0])) && (todas[0].inc.length > 0 || todas[0].no.length > 0) ? todas[0] : null;
  return { comun, porAcomodacion };
}

/** Bloques de condiciones de una opción para imprimir: uno solo si todas sus acomodaciones coinciden (`acomodacionRef: null`); si no, uno por acomodación. Sin texto → []. */
export function bloquesCondiciones(g: GrupoHotel, porAcomodacion: Record<string, TextoCondiciones>): ({ acomodacionRef: string | null } & TextoCondiciones)[] {
  const clave = (t: TextoCondiciones) => JSON.stringify([t.inc, t.no]);
  const todas = g.acomodaciones.map((a) => ({ acomodacionRef: a.acomodacionRef as string | null, ...(porAcomodacion[`${g.opcionRef}/${a.acomodacionRef}`] ?? { inc: [], no: [] }) }));
  const bloques = todas.every((t) => clave(t) === clave(todas[0])) ? [{ ...todas[0], acomodacionRef: null }] : todas;
  return bloques.filter((t) => t.inc.length > 0 || t.no.length > 0);
}

/** Resumen de una opción/acomodación: el de SU acomodación; el de la opción solo si el snapshot no trae uno por acomodación (comparativas anteriores). */
export const resumenDeAcomodacion = (resumenes: Record<string, ResumenHotelUI>, opcionRef: string, acomodacionRef: string): ResumenHotelUI =>
  resumenes[`${opcionRef}/${acomodacionRef}`] ?? resumenes[opcionRef] ?? {};

type TextoCondiciones = { inc: string[]; no: string[] };

/** Rótulo del importe de una opción: «hotel» solo si el total es únicamente el alojamiento; con vuelos o servicios el total es de TODA la opción. */
export const etiquetaTotalOpcion = (r: ResumenHotelUI): string =>
  r.tiquetes?.length || r.vuelos?.length || r.servicios?.length || r.otros?.length || r.otrosNoVerificables ? "Total de esta opción" : "Total de este hotel";

/** Roles internos que pueden dejar una comparativa compartida: los MISMOS de `f211_priv.madre_anonima` (migración 250). */
export const ROLES_CREADOR_COMPARTIDA = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;

/**
 * Regla COMPLETA de `f211_priv.madre_anonima` (la base sigue siendo la autoridad): anónima, o del carrito marcada con `compartirPublico` **y cuyo creador interno sigue
 * activo con un rol interno permitido**. `creador` = fila de `usuarios` del `creado_por_id` (null si no existe). Si el creador deja de cumplirlo, la pantalla pública muestra
 * el camino de solicitud al asesor y la acción se rechaza, igual que la base.
 */
export function madreElegiblePorVisitante(
  m: Parameters<typeof madreAdmiteEleccionPublica>[0],
  creador: { rol: string | null; activo: boolean | null } | null | undefined,
): boolean {
  if (!madreAdmiteEleccionPublica(m)) return false;
  if (m.creado_por_id == null && m.propietario_id == null && m.aliado_id == null) return true; // anónima: sin creador que comprobar
  return creador?.activo === true && (ROLES_CREADOR_COMPARTIDA as readonly string[]).includes(creador.rol ?? "");
}

export type ProblemaAcomodacion = { tipo: "mixta" | "distintas"; hotel: string };

/** Texto ÚNICO de la regla de acomodación de la comparativa; lo usan el servidor y la pantalla. */
export function mensajeAcomodacionComparativa(p: ProblemaAcomodacion): string {
  return p.tipo === "mixta"
    ? `No se puede crear la comparativa: con vuelos manuales y varios destinos todas las alternativas deben usar la misma acomodación, y «${p.hotel}» tiene habitaciones de más de un tipo. Deja un solo tipo de habitación en ese hotel o usa un único destino.`
    : `No se puede crear la comparativa: con vuelos manuales y varios destinos todas las alternativas deben usar la misma acomodación (por ejemplo, todas dobles), y «${p.hotel}» no coincide con las demás. Iguala la acomodación o usa un único destino.`;
}

/** Con vuelos manuales y más de un destino, TODA la comparativa usa una sola acomodación. Un destino con varias fechas sigue siendo unidestino (no aplica). */
export function validarAcomodacionComparativa(
  items: readonly { hotelNombre: string; destino?: string | null; habitaciones: Record<string, number> }[], hayVuelos: boolean,
): ProblemaAcomodacion | null {
  if (!hayVuelos || new Set(items.map((i) => (i.destino ?? "").trim().toUpperCase())).size < 2) return null;
  const tipos = items.map((i) => Object.entries(i.habitaciones).filter(([, n]) => n > 0).map(([a]) => a));
  const mixto = tipos.findIndex((t) => t.length > 1);
  if (mixto >= 0) return { tipo: "mixta", hotel: items[mixto].hotelNombre };
  const distinto = tipos.findIndex((t) => t[0] !== tipos[0][0]);
  return distinto >= 0 ? { tipo: "distintas", hotel: items[distinto].hotelNombre } : null;
}

/** Total que ve quien NO es personal interno: en una opción NETO (#102) es el exigible (PVP − comisión); la columna `total` es el PVP y no sale. */
export function totalPublicoOpcion(total: number, resumen: unknown): number {
  const x = (resumen as { total_exigible?: unknown } | null)?.total_exigible;
  return typeof x === "number" && Number.isFinite(x) ? x : total;
}

// ── #75 · Presentación editable de cada opción (Incluye / No incluye y descripción visible) ──
// Solo TEXTO: nunca cambia cantidades, tarifas, valores, orden ni referencias. Se fija ANTES de generar y queda congelado en el snapshot de la opción
// (resumen_publico + plantilla_hija.detalle), así que lo ven igual el selector, la hoja y la hija elegida.

/** Edición de la descripción de UNA línea del documento: `original` debe seguir siendo el texto de esa línea (si cambió, la presentación ya no aplica). */
export type EdicionDescripcion = { indice: number; original: string; texto: string };
export type PresentacionOpcion = { incluye?: string; noIncluye?: string; descripciones?: EdicionDescripcion[] };
/** Clave `${opcionRef}/${acomodacionRef}` (manual: `A/unica`). */
export type PresentacionComparativa = Record<string, PresentacionOpcion>;

export const MAX_TEXTO_INCLUYE = 3000;
export const MAX_DESCRIPCION_ITEM = 200;
const CLAVE_PRESENTACION = /^[ABC]\/[a-z0-9_]{1,30}$/;
// Caracteres de control (salvo el salto de línea en Incluye / No incluye): no se aceptan en un documento.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;
const CONTROL_LINEA = /[\u0000-\u001F\u007F]/;

/** Lee la presentación que llega del navegador (`unknown`). Ausente ⇒ null (se usa lo sugerido); mal formada ⇒ error (nunca se ignora en silencio). */
export function leerPresentacionComparativa(raw: unknown): { ok: true; datos: PresentacionComparativa | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, datos: null };
  const malo = (e: string) => ({ ok: false as const, error: `La presentación de la comparativa no es válida: ${e}.` });
  if (typeof raw !== "object" || Array.isArray(raw)) return malo("forma inesperada");
  const entradas = Object.entries(raw as Record<string, unknown>);
  if (entradas.length > 18) return malo("demasiadas opciones");
  const datos: PresentacionComparativa = {};
  for (const [clave, v] of entradas) {
    if (!CLAVE_PRESENTACION.test(clave)) return malo("opción desconocida");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return malo(`opción ${clave}`);
    const o = v as Record<string, unknown>;
    const p: PresentacionOpcion = {};
    for (const campo of ["incluye", "noIncluye"] as const) {
      if (o[campo] === undefined) continue;
      if (typeof o[campo] !== "string") return malo(`${campo} de la opción ${clave}`);
      const t = (o[campo] as string).replace(/\r\n?/g, "\n").trim();
      if (t.length > MAX_TEXTO_INCLUYE) return { ok: false, error: `El texto de ${campo === "incluye" ? "Incluye" : "No incluye"} de la opción ${clave[0]} supera ${MAX_TEXTO_INCLUYE} caracteres.` };
      if (CONTROL.test(t)) return malo(`caracteres no permitidos en la opción ${clave}`);
      p[campo] = t;
    }
    if (o.descripciones !== undefined) {
      if (!Array.isArray(o.descripciones) || o.descripciones.length > 30) return malo(`descripciones de la opción ${clave}`);
      const vistos = new Set<number>();
      p.descripciones = [];
      for (const d of o.descripciones as unknown[]) {
        const e = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
        const indice = e.indice;
        if (typeof indice !== "number" || !Number.isInteger(indice) || indice < 0 || indice > 99 || vistos.has(indice)) return malo(`línea de la opción ${clave}`);
        if (typeof e.original !== "string" || typeof e.texto !== "string") return malo(`línea de la opción ${clave}`);
        const texto = e.texto.replace(/\s+/g, " ").trim();
        if (texto.length < 3 || texto.length > MAX_DESCRIPCION_ITEM) return { ok: false, error: `La descripción de una línea de la opción ${clave[0]} debe tener entre 3 y ${MAX_DESCRIPCION_ITEM} caracteres.` };
        if (CONTROL_LINEA.test(texto)) return malo(`caracteres no permitidos en la opción ${clave}`);
        vistos.add(indice);
        if (texto !== e.original) p.descripciones.push({ indice, original: e.original, texto });
      }
    }
    datos[clave] = p;
  }
  return { ok: true, datos };
}

/**
 * ¿La descripción de esta línea del documento se puede editar? NO las que el sistema reconoce por su texto: tours (`Servicio · …`), servicios y vuelos
 * manuales (se verifican contra lo cotizado) y la línea «Tarifa por niño» de la comparativa manual (de ella sale la tarifa de menores que se muestra).
 */
export function lineaEditable(descripcion: unknown): descripcion is string {
  return typeof descripcion === "string" && descripcion.trim().length > 0 && !descripcion.startsWith("Servicio · ") && !descripcion.startsWith("Vuelo · ")
    && !descripcion.endsWith(" — sujeto a confirmación de disponibilidad y tarifa") && descripcion !== "Tarifa por niño";
}

/** Las líneas editables de un documento, con su posición (la que usan las ediciones). */
export function lineasEditables(items: unknown): { indice: number; descripcion: string }[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((it, indice) => {
    const d = (it as { descripcion?: unknown } | null)?.descripcion;
    return lineaEditable(d) ? [{ indice, descripcion: d }] : [];
  });
}

/** Aplica las ediciones de texto a una COPIA de las líneas. Una edición sobre una línea que ya no existe, cambió o no es editable ⇒ error (no se aplica a medias). */
export function aplicarDescripciones<T extends { descripcion?: unknown }>(items: readonly T[], ediciones: readonly EdicionDescripcion[]): { ok: true; items: T[] } | { ok: false; error: string } {
  const out = items.map((it) => ({ ...it }));
  for (const e of ediciones) {
    const it = out[e.indice];
    if (!it || it.descripcion !== e.original || !lineaEditable(it.descripcion)) {
      return { ok: false, error: "La descripción editada ya no corresponde a lo cotizado (el carrito o los valores cambiaron). Vuelve a preparar la presentación." };
    }
    out[e.indice] = { ...it, descripcion: e.texto };
  }
  return { ok: true, items: out };
}

// ── #75 · Vuelos de una opción, agrupados por TIQUETE ──
export type TramoTiquete = { direccion: "ida" | "regreso"; origen: string; destino: string; fecha: string | null; hora: string | null };
/** Un tiquete = un vuelo manual (ida, regreso o ida y regreso): sus tramos, sus pasajeros y el aviso UNA sola vez. Sin precio (va en el total de la opción). */
export type TiqueteVuelo = { pax: number | null; aviso: string | null; tramos: TramoTiquete[] };

const lugarTramo = (codigo: unknown, ciudad: unknown): string =>
  etiquetaIata(typeof codigo === "string" ? codigo : null) || (typeof ciudad === "string" && ciudad.trim() ? ciudad.trim() : "—");

/**
 * Tiquetes de UNA opción. Fuente principal: los vuelos congelados en su snapshot (`plantilla_hija.payload.manuales`, validados igual que al elegir): cada
 * vuelo es un tiquete, así ida y regreso del mismo vuelo van juntos y dos vuelos distintos nunca se mezclan. Si el snapshot no los trae (o no valida), se
 * usan las filas públicas de `resumen_publico.vuelos`, uniendo solo una ida seguida de su regreso inverso con la misma nota.
 */
export function tiquetesDeOpcion(plantilla: unknown, vuelosResumen: ResumenHotelUI["vuelos"], moneda: string | null): TiqueteVuelo[] {
  const payload = (plantilla as { payload?: { manuales?: unknown } } | null)?.payload;
  const manuales = Array.isArray(payload?.manuales) ? payload.manuales : null;
  if (manuales) {
    const out: TiqueteVuelo[] = [];
    let valido = true;
    for (const crudo of manuales) {
      const r = validarServicioManual(crudo, moneda);
      if (!r.ok) { valido = false; break; }
      const filas = tramosVueloManual(r.valor, true);
      if (!filas.length) continue;
      const nota = notaVueloManual(filas[0].servicios);
      out.push({
        pax: nota?.pax ?? r.valor.pax, aviso: nota?.aviso ?? null,
        tramos: filas.map((f) => ({
          direccion: f.direccion === "regreso" ? "regreso" : "ida", origen: lugarTramo(f.origen_codigo, f.origen_ciudad), destino: lugarTramo(f.destino_codigo, f.destino_ciudad),
          fecha: typeof f.fecha_salida === "string" ? f.fecha_salida : null, hora: typeof f.hora_salida === "string" ? f.hora_salida : null,
        })),
      });
    }
    if (valido) return out;
  }
  const filas = vuelosResumen ?? [];
  const out: TiqueteVuelo[] = [];
  const tramo = (x: (typeof filas)[number]): TramoTiquete => ({ direccion: x.tramo === "regreso" ? "regreso" : "ida", origen: x.origen ?? "—", destino: x.destino ?? "—", fecha: x.fecha, hora: x.hora ?? null });
  for (let i = 0; i < filas.length; i++) {
    const v = filas[i];
    const nota = notaVueloManual(v.nota);
    const sig = filas[i + 1];
    const t: TiqueteVuelo = { pax: nota?.pax ?? null, aviso: nota?.aviso ?? null, tramos: [tramo(v)] };
    if (v.tramo === "ida" && sig && sig.tramo === "regreso" && sig.nota === v.nota && sig.origen === v.destino && sig.destino === v.origen) { t.tramos.push(tramo(sig)); i++; }
    out.push(t);
  }
  return out;
}

// ── #75 · Tarifa por persona que se puede mostrar ──
/** `reparto` siempre cuadra con `total`: exacto, o el reparto honesto en centavos. `soloHotel`: la tarifa es del alojamiento (la opción suma además vuelos o servicios). */
export type TarifaVisible = { etiqueta: string; cantidad: number; total: number; reparto: RepartoTarifa; soloHotel: boolean };

/**
 * Tarifa por adulto/persona de UNA opción, tal como la liquidó su snapshot (no la columna `tarifa_persona`, que en el carrito dividía el hotel completo
 * —menores incluidos— entre todos los pasajeros y redondeaba). Nunca se inventa: sin un dato que cuadre, null y solo se muestra el total.
 *  · NETO (`total_exigible`): null; un exigible por persona no está liquidado en la opción.
 *  · Manual: la línea del paquete (orden 0): su valor entre sus adultos (reparto honesto si no divide exacto).
 *  · Carrito: las líneas de habitación con la MISMA tarifa por adulto (el motor la calcula por persona); si difieren (acomodación mixta), null.
 */
export function tarifaVisibleOpcion(resumen: unknown, plantilla: unknown, totalOpcion: number): TarifaVisible | null {
  if (esNeto(resumen)) return null;
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const r = obj(resumen) ? resumen : {};
  const detalle = obj(plantilla) && obj(plantilla.detalle) ? plantilla.detalle : null;
  const esCarrito = obj(plantilla) && obj(plantilla.payload) && Array.isArray(plantilla.payload.items);
  if (!esCarrito) {
    const items = Array.isArray(r.items) ? (r.items as unknown[]).filter(obj) : [];
    const paquete = items.find((i) => i.orden === 0) ?? items[0];
    if (!paquete) return null;
    const cantidad = Number(paquete.cantidad), valor = Number(paquete.valor);
    const reparto = repartoPorPersona(valor, cantidad);
    if (!reparto || !(valor > 0)) return null;
    return { etiqueta: Number(r.ninos) > 0 ? "Tarifa por adulto" : "Tarifa por persona", cantidad, total: valor, reparto, soloHotel: false };
  }
  const lineas = (detalle && Array.isArray(detalle.items) ? (detalle.items as unknown[]) : []).filter(obj);
  const hab = lineas.filter((i) => i.modo_precio !== "total" && Number(i.adultos) > 0 && typeof i.descripcion === "string" && !i.descripcion.startsWith("Servicio · "));
  if (!hab.length) return null;
  const tarifa = Number(hab[0].tarifa_adulto);
  if (!(tarifa > 0) || hab.some((i) => Number(i.tarifa_adulto) !== tarifa)) return null;
  const cantidad = hab.reduce((s, i) => s + Number(i.adultos), 0);
  const menores = lineas.filter((i) => i.modo_precio !== "total" && Number(i.adultos) === 0 && Number(i.ninos) > 0);
  const sumaHotel = tarifa * cantidad + menores.reduce((s, i) => s + Number(i.ninos) * Number(i.tarifa_nino), 0);
  const soloHotel = Math.round(sumaHotel * 100) !== Math.round(Number(totalOpcion) * 100);
  return { etiqueta: menores.length ? "Tarifa por adulto" : "Tarifa por persona", cantidad, total: tarifa * cantidad, reparto: { exacto: true, tarifa }, soloHotel };
}

/** Tarifa por adulto que se GUARDA en `tarifa_persona` de una opción de carrito: la del motor si todas las habitaciones la comparten; si no, null. */
export function tarifaPersonaCarrito(detalleItems: unknown): number | null {
  const t = tarifaVisibleOpcion({}, { payload: { items: [] }, detalle: { items: detalleItems } }, 0);
  return t && t.reparto.exacto ? t.reparto.tarifa : null;
}
