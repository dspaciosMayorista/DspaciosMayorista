// B2-11 / B2-12a — Titular de una cotización, visible en la pantalla de trabajo ANTES de aceptar, descartar o convertir. Módulo PURO (sin I/O, sin React).
//
// Lee SOLO lo ya guardado (columnas de `cotizaciones` + `payload`/`detalle`) y nunca infiere: un dato ausente es `null` (la interfaz dice «No registrado»), el tipo de
// documento vacío NO se sustituye por «CC» (#42) y el titular de relleno del motor (`"Cliente"` sin documento) no es una persona. Los permisos son los de la lectura:
// la ficha se arma con la fila que la sesión ya pudo leer por RLS (los mismos cinco roles internos de la propia cotización y de su documento imprimible).
import { esCotizacionAnonima, esRellenoCliente, filaPasajeroIdentificada, participantesDesdeCotizacion, personasPendientes, type FilaCotizacionPersonas, type PuestoRegistrado } from "@/lib/personas/cotizacion";

export type FilaFichaTitular = FilaCotizacionPersonas & {
  modo?: string | null;
  estado?: string | null;
  cliente?: string | null;
  asesor?: string | null;
  pax?: number | null;
  detalle?: unknown;
};

export type PersonaFicha = { nombre: string; documento: string | null; nacimiento: string | null };
export type PasajeroAliadoEntrada = { nombres?: string; apellidos?: string; tipoDoc?: string; numeroDoc?: string; fechaNacimiento?: string };

export type RegistroPersonas = "registrado" | "pendiente" | "sin_titular" | "sin_puesto" | "desconocido";

export type FichaTitular = {
  nombre: string | null;
  documento: string | null; // «CC 123» o «123 (tipo no registrado)»
  nacimiento: string | null;
  telefono: string | null;
  email: string | null;
  /** Hay un titular identificado (nombres, apellidos o documento no vacíos). Sin él no hay persona que registrar. */
  identificado: boolean;
  aliado: { tipo: "agencia" | "freelance"; nombre: string | null } | null;
  origen: string;
  composicion: { etiqueta: string; valor: string }[];
  pasajeros: (PersonaFicha & { fuente: "cotizacion" | "aliado" })[];
  registro: RegistroPersonas;
};

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function documentoTexto(tipo: unknown, numero: unknown): string | null {
  const n = txt(numero);
  if (!n) return null;
  const t = txt(tipo);
  return t ? `${t} ${n}` : `${n} (tipo no registrado)`;
}

function nombreCompleto(nombres: unknown, apellidos: unknown): string | null {
  return [txt(nombres), txt(apellidos)].filter(Boolean).join(" ") || null;
}

/** Documento para listas: solo los últimos 4 dígitos/caracteres (el detalle sí lo muestra completo). */
export function enmascararDocumento(numero: string | null | undefined): string | null {
  const n = txt(numero);
  if (!n) return null;
  return n.length <= 4 ? "••••" : `••••${n.slice(-4)}`;
}

function origenDe(f: FilaFichaTitular, payload: Obj): { origen: string; aliado: FichaTitular["aliado"] } {
  const detalle = esObj(f.detalle) ? f.detalle : {};
  const tipo =
    f.modo === "comparativa" ? "Comparativa de opciones"
    : f.tipo === "comparativa_carrito" ? "Comparativa desde el tarifario"
    : f.tipo === "carrito" ? "Carrito del tarifario"
    : f.tipo === "manual" ? ((f.paquete_din_id ?? null) != null ? "Paquete dinámico" : "Cotización dinámica")
    : esObj(detalle.solicitudHotel) ? "Solicitud de hotel bajo solicitud"
    : "Cotización desde el tarifario";
  const tipoAsesor = payload.tipoAsesor === "agencia" || payload.tipoAsesor === "freelance" ? payload.tipoAsesor : null;
  const aliado = tipoAsesor ? { tipo: tipoAsesor, nombre: txt(tipoAsesor === "agencia" ? payload.agenciaNombre : payload.freelanceNombre) } as const : null;
  let quien: string;
  if (esCotizacionAnonima(f)) quien = "visitante del tarifario público (sin sesión)";
  else if (aliado) quien = `aliado B2B (${aliado.tipo === "agencia" ? "agencia" : "freelance"}${aliado.nombre ? `: ${aliado.nombre}` : ""})`;
  else quien = `personal interno${txt(f.asesor) ? ` · asesor ${txt(f.asesor)}` : ""}`;
  return { origen: `${tipo} · ${quien}`, aliado };
}

function composicionDe(f: FilaFichaTitular, payload: Obj): FichaTitular["composicion"] {
  const out: FichaTitular["composicion"] = [];
  const detalle = esObj(f.detalle) ? f.detalle : {};
  const sol = esObj(detalle.solicitudHotel) ? detalle.solicitudHotel : null;
  const pax = num(f.pax);
  if (f.tipo === "manual") {
    if (pax != null) out.push({ etiqueta: "Adultos", valor: String(pax) });
  } else if (sol) {
    const ad = num(sol.adultos);
    if (ad != null) out.push({ etiqueta: "Adultos", valor: String(ad) });
    const men = num(sol.menores);
    if (men != null) out.push({ etiqueta: "Menores", valor: String(men) });
  } else if (pax != null) {
    out.push({ etiqueta: "Pasajeros (total)", valor: String(pax) });
  }
  const n1 = num(payload.ninos);
  const n2 = num(payload.ninos2);
  if (n1 != null || n2 != null) out.push({ etiqueta: "Niños", valor: String((n1 ?? 0) + (n2 ?? 0)) });
  const inf = num(payload.infantes);
  if (inf != null) out.push({ etiqueta: "Infantes", valor: String(inf) });
  const edades = Array.isArray(payload.edadesMenores) ? payload.edadesMenores.filter((e) => typeof e === "number") : [];
  if (edades.length) out.push({ etiqueta: "Edades de los menores", valor: edades.join(", ") });
  return out;
}

export function fichaTitularCotizacion(
  f: FilaFichaTitular,
  opts: { pasajerosAliado?: readonly PasajeroAliadoEntrada[]; puestos?: readonly PuestoRegistrado[] | null } = {},
): FichaTitular {
  const payload = esObj(f.payload) ? f.payload : {};
  const cli = esObj(payload.cliente) && !esRellenoCliente(payload.cliente) ? payload.cliente : null;
  const nombreP = cli ? nombreCompleto(cli.nombres, cli.apellidos) : null;
  // Sin `payload.cliente` solo queda el texto de la columna `cliente` (lo guardado, sin documento ni contacto).
  const nombre = nombreP ?? (esObj(payload.cliente) ? null : txt(f.cliente));
  const documento = cli ? documentoTexto(cli.tipoDoc, cli.numeroDoc) : null;
  const identificado = !!(cli && (nombreP || txt(cli.numeroDoc)));
  const { origen, aliado } = origenDe(f, payload);

  const pasajeros: FichaTitular["pasajeros"] = [];
  const delPayload = Array.isArray(payload.pasajeros) ? payload.pasajeros : [];
  for (const p of delPayload) {
    if (!esObj(p) || !filaPasajeroIdentificada(p)) continue;
    pasajeros.push({ nombre: nombreCompleto(p.nombres, p.apellidos) ?? "Sin nombre", documento: documentoTexto(p.tipoDoc, p.numeroDoc), nacimiento: txt(p.fechaNacimiento), fuente: "cotizacion" });
  }
  for (const p of opts.pasajerosAliado ?? []) {
    if (!filaPasajeroIdentificada(p)) continue;
    pasajeros.push({ nombre: nombreCompleto(p.nombres, p.apellidos) ?? "Sin nombre", documento: documentoTexto(p.tipoDoc, p.numeroDoc), nacimiento: txt(p.fechaNacimiento), fuente: "aliado" });
  }

  let registro: RegistroPersonas = "desconocido";
  const titulares = participantesDesdeCotizacion(f).filter((p) => p.rol === "titular");
  if (!titulares.length) registro = "sin_titular";
  else if (opts.puestos) {
    const abierta = f.estado === "abierta" || f.estado === "pendiente_tarifa";
    const tieneTitular = opts.puestos.some((p) => p.rol === "titular" && p.activo);
    registro = tieneTitular ? "registrado" : abierta && personasPendientes(titulares, opts.puestos) > 0 ? "pendiente" : "sin_puesto";
  }

  return {
    nombre, documento, nacimiento: cli ? txt(cli.nacimiento) : null, telefono: cli ? txt(cli.telefono) : null, email: cli ? txt(cli.email) : null,
    identificado, aliado, origen, composicion: composicionDe(f, payload), pasajeros, registro,
  };
}
