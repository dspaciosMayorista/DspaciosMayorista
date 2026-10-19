// Personas de cotizaciones (#42, migración 219) — módulo PURO (sin I/O).
//
// Arma la entrada `p_participantes` de `registrar_personas_cotizacion` desde el MISMO objeto que
// la acción persistió (el payload de la cotización), para el alta y para "Reintentar". Reglas del
// contrato (docs/coordinacion/auditorias-identidad-crm.md, C1-C7):
//   · Una persona nace solo de una fila IDENTIFICADA (documento, nombres o apellidos no vacíos
//     tras quitar espacios ASCII); una cantidad de viajeros nunca crea personas.
//   · Documento CRUDO: "" = ausente; nunca un tipo por defecto ("CC") ni el CC forzado del
//     checkout. En una cotización anónima del checkout el tipo no se registra (D-6: provisional).
//   · La identidad del puesto es un `ref` estable (UUID asignado en servidor ANTES del insert),
//     nunca el índice, el orden ni el documento.
// Lo que SQL vuelve a validar (gramática 214, tenant, estado, propiedad) no se decide aquí.
import { recortarAscii } from "@/lib/personas/identidad";
import type { RolParticipante } from "@/lib/personas/fuentes";

export type ObservacionParticipante = { campo: string; valor: string };

/** Un puesto tal como lo recibe la fachada `registrar_personas_cotizacion`. */
export type ParticipanteEntrada = {
  rol: RolParticipante;
  /** Solo pasajeros: el `ref` de su fila en `payload.pasajeros`. El titular nunca lleva ref. */
  ref?: string;
  orden?: number;
  tipo_doc: string | null;
  numero_doc: string | null;
  observaciones: ObservacionParticipante[];
};

/** Lo que la cotización guardada aporta para reconstruir sus puestos. */
export type FilaCotizacionPersonas = {
  id: number;
  tenant: string | null;
  tipo: string | null;
  payload: unknown;
  /** Autor estable (211/216/219). Ausente = sin sello todavía. */
  creado_por_id?: string | null;
  propietario_id?: string | null;
  aliado_id?: number | null;
};

/** Puesto ya registrado (de `cotizacion_participantes`, leído con service_role). */
export type PuestoRegistrado = { id: string; rol: string; activo: boolean; version?: number };

const RE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Texto crudo de un documento: solo "" (o lo que no es texto) cuenta como ausente. */
function documentoCrudo(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Valor de una observación: sin espacios ASCII de los bordes; vacío = se omite. */
function valorObservacion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = recortarAscii(v);
  return r === "" ? null : r;
}

function observaciones(pares: [string, unknown][]): ObservacionParticipante[] {
  const out: ObservacionParticipante[] = [];
  for (const [campo, v] of pares) {
    const valor = valorObservacion(v);
    if (valor != null) out.push({ campo, valor });
  }
  return out;
}

/** Misma regla que `p214_priv.participante_identificado`. */
export function participanteIdentificado(p: Pick<ParticipanteEntrada, "numero_doc" | "observaciones">): boolean {
  if (p.numero_doc != null && recortarAscii(p.numero_doc) !== "") return true;
  return p.observaciones.some((o) => (o.campo === "nombres" || o.campo === "apellidos") && recortarAscii(o.valor) !== "");
}

/** Fila de pasajero identificada (documento, nombres o apellidos con contenido). */
export function filaPasajeroIdentificada(p: { numeroDoc?: unknown; nombres?: unknown; apellidos?: unknown }): boolean {
  return [p.numeroDoc, p.nombres, p.apellidos].some((v) => typeof v === "string" && recortarAscii(v) !== "");
}

/**
 * Asigna en SERVIDOR un `ref` nuevo a cada fila identificada, ANTES del insert (el ref nace en la
 * misma escritura que la cotización). Cualquier `ref` que llegue del navegador se descarta: el
 * cliente nunca elige la identidad del puesto. Las filas vacías quedan sin ref (no crean puesto).
 */
export function asignarRefsPasajeros<T extends object>(pasajeros: readonly T[], nuevoRef: () => string): (T & { ref?: string })[] {
  return pasajeros.map((p) => {
    const { ref: _descartado, ...resto } = p as T & { ref?: unknown };
    void _descartado;
    const base = resto as T;
    return filaPasajeroIdentificada(base as { numeroDoc?: unknown; nombres?: unknown; apellidos?: unknown })
      ? { ...base, ref: nuevoRef() }
      : base;
  });
}

/** Misma regla que `p214_priv.cotizacion_anonima`: checkout público sin creador, propietario ni aliado. */
export function esCotizacionAnonima(f: Pick<FilaCotizacionPersonas, "tenant" | "tipo" | "creado_por_id" | "propietario_id" | "aliado_id">): boolean {
  return f.creado_por_id == null && (f.propietario_id ?? null) == null && (f.aliado_id ?? null) == null
    && f.tenant === "mayorista" && (f.tipo === "carrito" || f.tipo === "comparativa_carrito");
}

/** Titular de relleno que usa el motor al reliquidar una opción (`"Cliente"` sin documento): no es una persona. */
export function esRellenoCliente(c: unknown): boolean {
  if (!esObjeto(c)) return false;
  const nombres = typeof c.nombres === "string" ? recortarAscii(c.nombres) : "";
  const apellidos = typeof c.apellidos === "string" ? recortarAscii(c.apellidos) : "";
  const numero = typeof c.numeroDoc === "string" ? recortarAscii(c.numeroDoc) : "";
  return nombres === "Cliente" && apellidos === "" && numero === "";
}

/** Titular desde `payload.cliente` (Reservar, manual, carrito, comparativas e hijas). */
export function titularDesdeCliente(cliente: unknown, opts: { anonima: boolean }): ParticipanteEntrada | null {
  if (!esObjeto(cliente) || esRellenoCliente(cliente)) return null;
  const p: ParticipanteEntrada = {
    rol: "titular",
    tipo_doc: opts.anonima ? null : documentoCrudo(cliente.tipoDoc),
    numero_doc: documentoCrudo(cliente.numeroDoc),
    observaciones: observaciones([
      ["nombres", cliente.nombres],
      ["apellidos", cliente.apellidos],
      ["telefono", cliente.telefono],
      ["email", cliente.email],
      ["fecha_nacimiento", cliente.nacimiento],
    ]),
  };
  return participanteIdentificado(p) ? p : null;
}

/** Pasajero desde una fila de `payload.pasajeros` (solo Reservar en V1). Sin ref no hay puesto. */
export function pasajeroDesdeFila(fila: unknown, orden: number, opts: { anonima: boolean }): ParticipanteEntrada | null {
  if (!esObjeto(fila) || typeof fila.ref !== "string" || !RE_UUID.test(fila.ref)) return null;
  const p: ParticipanteEntrada = {
    rol: "pasajero",
    ref: fila.ref,
    orden,
    tipo_doc: opts.anonima ? null : documentoCrudo(fila.tipoDoc),
    numero_doc: documentoCrudo(fila.numeroDoc),
    observaciones: observaciones([
      ["nombres", fila.nombres],
      ["apellidos", fila.apellidos],
      ["fecha_nacimiento", fila.fechaNacimiento],
      ["nacionalidad", fila.nacionalidad],
    ]),
  };
  return participanteIdentificado(p) ? p : null;
}

/** Todos los puestos identificados de una cotización guardada (alta y reintento usan esto). */
export function participantesDesdeCotizacion(f: FilaCotizacionPersonas): ParticipanteEntrada[] {
  const payload = esObjeto(f.payload) ? f.payload : {};
  const anonima = esCotizacionAnonima(f);
  const out: ParticipanteEntrada[] = [];
  const titular = titularDesdeCliente(payload.cliente, { anonima });
  if (titular) out.push(titular);
  const pasajeros = Array.isArray(payload.pasajeros) ? payload.pasajeros : [];
  pasajeros.forEach((fila, i) => {
    const p = pasajeroDesdeFila(fila, i, { anonima });
    if (p) out.push(p);
  });
  return out;
}

/**
 * Aviso persistente de la ficha (C7): calculado, nunca una marca manual. Hay personas pendientes
 * si el titular identificado no tiene puesto activo o algún pasajero con ref no tiene puesto.
 */
export function personasPendientes(participantes: readonly ParticipanteEntrada[], puestos: readonly PuestoRegistrado[]): number {
  let pendientes = 0;
  for (const p of participantes) {
    if (p.rol === "titular") {
      if (!puestos.some((x) => x.rol === "titular" && x.activo)) pendientes++;
    } else if (!puestos.some((x) => x.id === p.ref)) {
      pendientes++;
    }
  }
  return pendientes;
}

/** Versión del puesto titular activo para el CAS del editor (0 = todavía no hay puesto). */
export function versionTitular(puestos: readonly PuestoRegistrado[]): number {
  const t = puestos.find((x) => x.rol === "titular" && x.activo);
  return t && Number.isInteger(t.version) ? (t.version as number) : 0;
}

// ── Editor del titular ──────────────────────────────────────────────────────

export type TitularEditorEntrada = {
  nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; nacimiento: string; telefono: string; email: string;
};

/** `p_titular` de `actualizar_titular_cotizacion`: el tipo tal como se eligió (vacío = ausente, nunca "CC"). */
export function titularParaFachada(t: TitularEditorEntrada): Record<string, string | null> {
  const txt = (v: unknown) => (typeof v === "string" ? recortarAscii(v) : "");
  const o = (v: unknown) => { const r = txt(v); return r === "" ? null : r; };
  return {
    nombres: o(t.nombres),
    apellidos: o(t.apellidos),
    tipo_doc: o(t.tipoDoc),
    numero_doc: o(t.numeroDoc),
    fecha_nacimiento: o(t.nacimiento),
    telefono: o(t.telefono),
    email: o(t.email),
  };
}

/** Clave de idempotencia por envío: un UUID que el editor repite si reenvía los MISMOS datos. */
export function validarClaveEnvio(v: unknown): string | null {
  return typeof v === "string" && RE_UUID.test(v) ? v.toLowerCase() : null;
}

/** Versión esperada del puesto: entero >= 0 (0 = aún no hay puesto). */
export function validarVersionEsperada(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

// ── Checkout: tipo documental (D-6) ────────────────────────────────────────────

/**
 * Tipo de documento del checkout, leído de la entrada CRUDA (el validador compartido del carrito
 * no lo conserva). Ausente o "" = sin tipo; uno fuera del catálogo se rechaza con un mensaje.
 */
export function tipoDocCheckout(raw: unknown, catalogo: readonly string[]): { ok: true; tipo: string | null } | { ok: false; error: string } {
  const cliente = esObjeto(raw) && esObjeto(raw.cliente) ? raw.cliente : null;
  const v = cliente ? cliente.tipoDoc : undefined;
  if (v === undefined || v === null || v === "") return { ok: true, tipo: null };
  if (typeof v !== "string" || !catalogo.includes(v)) return { ok: false, error: "Elige un tipo de documento válido." };
  return { ok: true, tipo: v };
}

// ── Errores (C7): mensajes en español, nunca el texto crudo de Postgres ───────

const MENSAJES: Record<string, string> = {
  version_obsoleta: "El titular cambió mientras lo editabas; recarga la página y vuelve a intentarlo.",
  cotizacion_no_abierta: "La cotización ya no está abierta; recarga la página.",
  cotizacion_no_editable: "Solo se puede editar el titular de una cotización dinámica abierta.",
  cotizacion_inexistente: "Cotización no encontrada.",
  original_demasiado_largo: "El tipo o el número de documento es demasiado largo (máximo 64 caracteres).",
  nit_dv_invalido: "El dígito de verificación del NIT no es válido.",
  nit_dv_sin_nit: "Solo un NIT lleva dígito de verificación.",
  observaciones_invalidas: "Algún dato del titular es demasiado largo (máximo 200 caracteres por dato).",
  titular_sin_nombre: "El nombre del titular es obligatorio.",
  no_autorizado: "No tienes permiso para modificar esta cotización.",
  captura_inconsistente: "Este envío ya se registró con otros datos; recarga la página y vuelve a intentarlo.",
  clave_obligatoria: "Recarga la página e inténtalo de nuevo.",
  participante_vacio: "Hay una persona sin nombre ni documento.",
};

/** Código propio de las funciones de la 214/219 (primer identificador del mensaje), o null. */
export function codigoErrorPersonas(msg: unknown): string | null {
  const m = /^([a-z][a-z0-9_]*)\b/.exec(String(msg ?? "").replace(/^ +/, ""));
  return m ? m[1] : null;
}

export function mensajePersonas(codigo: string | null, porDefecto = "No se pudo guardar el titular. Inténtalo de nuevo."): string {
  return (codigo && MENSAJES[codigo]) || porDefecto;
}

export const AVISO_PERSONAS_PENDIENTES =
  "La cotización se guardó, pero sus personas quedaron pendientes de registrar en el CRM. Usa «Reintentar» en la ficha de la cotización.";
