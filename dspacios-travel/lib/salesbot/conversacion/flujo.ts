// Flujo DETERMINISTA de la conversación guiada (#56, MVP). Sin I/O propio: las
// consultas llegan inyectadas (`ServiciosConversacion`) y son SIEMPRE las ya
// saneadas de SalesBot (Programas, Bloqueos, Porción). Cada turno:
//   1. sanea estado y entrada (el navegador no es fuente de verdad);
//   2. aplica comandos (empezar de nuevo, corregir, asesor, agencia);
//   3. interpreta la respuesta a lo que se preguntó;
//   4. pide el siguiente dato obligatorio, o busca, o revalida la selección
//      contra el servidor y muestra el detalle o la cotización.
// Programas: precio por persona de referencia, nunca un total. Bloqueos y
// Porción: total ORIENTATIVO del motor de venta. B2B: solo el % propio.
import type { AcomRoom } from "@/lib/acomodaciones";
import { formatFechaLarga, formatMoneda } from "@/lib/utils";
import { clavesProhibidasEn, type AgenciaResumen, type DetalleConsulta, type PorcentajeAgencia, type Respuesta, type ResultadoBusqueda } from "@/lib/salesbot/contrato";
import type { CotizacionPaquete, DisponibilidadVuelo, OfertaBloqueo, ResultadoBusquedaBloqueos, ResultadoBusquedaPorcion } from "@/lib/salesbot/paquetes/contrato";
import type { RespuestaCotizacionPorcion } from "@/lib/salesbot/paquetes/lectura";
import {
  estadoInicial,
  sanearEntrada,
  sanearEstado,
  type EstadoConversacion,
  type MensajeBot,
  type Opcion,
  type Pregunta,
  type ProductoConversacion,
  type RespuestaConversacion,
} from "@/lib/salesbot/conversacion/contrato";
import {
  adultosEnFrase,
  destinoEnFrase,
  destinoEnLista,
  esCualquiera,
  extraerFechas,
  habitacionesEnFrase,
  interpretarCantidad,
  interpretarComando,
  interpretarHabitaciones,
  interpretarMenores,
  interpretarPosicion,
  interpretarProducto,
  limpiarDestinoLibre,
  normalizar,
  type CampoCorregible,
} from "@/lib/salesbot/conversacion/interpretar";

type Entrada = Record<string, string | undefined>;

/** Consultas ya saneadas que el flujo puede usar. Cada una revalida sesión, rol y tenant por su cuenta. */
export type ServiciosConversacion = {
  buscarProgramas(e: Entrada): Promise<Respuesta<ResultadoBusqueda>>;
  detallePrograma(id: string): Promise<Respuesta<DetalleConsulta>>;
  buscarBloqueos(e: Entrada): Promise<Respuesta<ResultadoBusquedaBloqueos>>;
  ofertaBloqueo(clave: string): Promise<OfertaBloqueo | null>;
  cotizarBloqueo(e: Entrada): Promise<Respuesta<CotizacionPaquete>>;
  destinosPorcion(): Promise<string[] | null>;
  buscarPorcion(e: Entrada): Promise<Respuesta<ResultadoBusquedaPorcion>>;
  cotizarPorcion(e: Entrada): Promise<RespuestaCotizacionPorcion>;
  listarAgencias(): Promise<Respuesta<AgenciaResumen[]>>;
  porcentajeAgencia(id: string): Promise<Respuesta<PorcentajeAgencia>>;
};

const NOMBRE_PRODUCTO: Record<ProductoConversacion, string> = { programa: "Programas", bloqueo: "Bloqueos", porcion: "Porción terrestre" };
const ACOM: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", cuadruple: "Cuádruple", nino: "Niño", nino2: "Niño 2", infante: "Infante" };
const MAX_OPCIONES = 6;

const OP = {
  reiniciar: { etiqueta: "Empezar de nuevo", valor: "reiniciar" },
  asesor: { etiqueta: "Consultar a un asesor", valor: "asesor" },
  agencia: { etiqueta: "El cliente es una agencia", valor: "agencia" },
  resultados: { etiqueta: "Ver otras opciones", valor: "corregir:seleccion" },
} satisfies Record<string, Opcion>;

const opcionesProducto = (): Opcion[] => [
  { etiqueta: "Programas (circuitos)", valor: "producto:programa" },
  { etiqueta: "Bloqueos (vuelo y hotel)", valor: "producto:bloqueo" },
  { etiqueta: "Porción terrestre (solo hotel)", valor: "producto:porcion" },
];

export function saludo(): MensajeBot {
  return {
    texto:
      "Hola, soy SalesBot. Te ayudo a consultar Programas, Bloqueos y Porción terrestre con los datos vigentes del sistema. ¿Qué buscas? Puedes escribirlo (por ejemplo: «porción terrestre en San Andrés del 10 al 13 de marzo de 2027») o elegir una opción.",
    opciones: opcionesProducto(),
  };
}

const mensajeAsesor = (): MensajeBot => ({
  texto: "Para confirmar disponibilidad o cerrar la venta, consulta con administración u operaciones. Los precios de esta conversación son orientativos y vencen a los 15 minutos.",
  opciones: [OP.reiniciar],
});

const fmtFecha = (f: string | null) => (f ? formatFechaLarga(f) : "-");

function textoHabitaciones(h: Partial<Record<AcomRoom, number>>): string {
  return (Object.entries(h) as [AcomRoom, number][]).map(([a, n]) => `${n} ${ACOM[a].toLowerCase()}${n > 1 ? (a === "multiple" ? "s" : "s") : ""}`).join(", ");
}

function textoPorcentaje(p: PorcentajeAgencia): string {
  switch (p.estado) {
    case "propio":
      return `Comisión de ${p.agencia.nombre}: ${(p.pct * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })}% (porcentaje propio de su ficha). La base y el monto los calcula y confirma el asesor.`;
    case "sin_pct_propio":
      return `${p.agencia.nombre} no tiene un porcentaje propio configurado. La comisión la confirma el asesor.`;
    case "pct_invalido":
      return `El porcentaje de ${p.agencia.nombre} en su ficha no es válido. La comisión la confirma el asesor.`;
    case "no_encontrada":
      return "No se encontró esa agencia.";
  }
}

// ── Datos obligatorios por producto ─────────────────────────────────────

type Dato = Exclude<Pregunta, "producto" | "seleccion" | "combo" | "agencia">;

function datosFaltantesAntesDeBuscar(e: EstadoConversacion): Dato[] {
  const destino = e.destino || e.cualquierDestino;
  if (e.producto === "programa" || e.producto === "bloqueo") return destino ? [] : ["destino"];
  if (e.producto === "porcion") {
    const f: Dato[] = [];
    if (!e.destino) f.push("destino");
    if (!e.fechaIda || !e.fechaRegreso) f.push("fechas");
    if (e.adultos == null) f.push("adultos");
    if (!e.habitaciones) f.push("habitaciones");
    if (!e.edadesMenores) f.push("menores");
    return f;
  }
  return [];
}

/** Al corregir un dato se borra lo que dependía de él (resultados y selección). */
function limpiar(e: EstadoConversacion, campo: CampoCorregible): EstadoConversacion {
  const sinSeleccion = { seleccion: null, combo: null, ultimaLista: [] as string[] };
  switch (campo) {
    case "producto":
      return { ...estadoInicial(), agenciaId: e.agenciaId };
    case "destino":
      return { ...e, destino: null, cualquierDestino: false, ...sinSeleccion };
    case "fechas":
      return { ...e, fechaIda: null, fechaRegreso: null, ...sinSeleccion };
    case "adultos":
      return { ...e, adultos: null, ...(e.producto === "porcion" ? sinSeleccion : {}) };
    case "habitaciones":
      return { ...e, habitaciones: null, ...(e.producto === "porcion" ? sinSeleccion : {}) };
    case "menores":
      return { ...e, edadesMenores: null, ...(e.producto === "porcion" ? sinSeleccion : {}) };
    case "combo":
      return e.producto === "porcion" ? { ...e, ...sinSeleccion } : { ...e, combo: null };
    case "seleccion":
      return { ...e, ...sinSeleccion };
  }
}

function opcionesCorregir(e: EstadoConversacion): Opcion[] {
  const o: Opcion[] = [];
  if (e.destino || e.cualquierDestino) o.push({ etiqueta: "Cambiar destino", valor: "corregir:destino" });
  if (e.fechaIda) o.push({ etiqueta: "Cambiar fechas", valor: "corregir:fechas" });
  if (e.adultos != null) o.push({ etiqueta: "Cambiar adultos", valor: "corregir:adultos" });
  if (e.habitaciones) o.push({ etiqueta: "Cambiar habitaciones", valor: "corregir:habitaciones" });
  if (e.edadesMenores) o.push({ etiqueta: "Cambiar menores", valor: "corregir:menores" });
  if (e.producto) o.push({ etiqueta: "Cambiar producto", valor: "corregir:producto" });
  return o;
}

// ── Preguntas ────────────────────────────────────────────────────────────

async function preguntar(e: EstadoConversacion, dato: Pregunta, sv: ServiciosConversacion, prefijo?: string): Promise<{ estado: EstadoConversacion; mensaje: MensajeBot }> {
  const con = (texto: string, opciones: Opcion[] = []): { estado: EstadoConversacion; mensaje: MensajeBot } => ({
    estado: { ...e, pendiente: dato },
    mensaje: { texto: prefijo ? `${prefijo} ${texto}` : texto, opciones: [...opciones, ...(dato === "producto" ? [] : [OP.reiniciar])] },
  });
  switch (dato) {
    case "producto":
      return con("¿Qué producto quieres consultar?", opcionesProducto());
    case "destino":
      if (e.producto === "porcion") {
        const lista = await sv.destinosPorcion();
        if (lista === null) return con("No pude leer los destinos en este momento. Escribe el destino o inténtalo de nuevo.", [OP.asesor]);
        if (!lista.length) return con("No hay porción terrestre publicada en este momento.", [{ etiqueta: "Cambiar producto", valor: "corregir:producto" }, OP.asesor]);
        return con("¿Para qué destino? Estos tienen porción terrestre publicada:", lista.slice(0, 8).map((d) => ({ etiqueta: d, valor: `destino:${d}` })));
      }
      return con(
        e.producto === "programa" ? "¿Qué destino, ciudad o programa buscas?" : "¿Para qué destino buscas bloqueo?",
        [{ etiqueta: "Cualquier destino", valor: "destino:*" }]
      );
    case "fechas":
      return con("¿Fechas de ida y regreso? Por ejemplo: «del 10 al 13 de marzo de 2027» o «10/03/2027 al 13/03/2027».");
    case "adultos":
      return con("¿Cuántos adultos viajan?", [1, 2, 3, 4].map((n) => ({ etiqueta: String(n), valor: `adultos:${n}` })));
    case "habitaciones":
      return con("¿Cuántas habitaciones y de qué tipo? Por ejemplo: «1 doble» o «2 dobles y 1 sencilla».", [
        { etiqueta: "1 doble", valor: "habitaciones:doble=1" },
        { etiqueta: "1 sencilla", valor: "habitaciones:sencilla=1" },
        { etiqueta: "2 dobles", valor: "habitaciones:doble=2" },
        { etiqueta: "1 triple", valor: "habitaciones:triple=1" },
      ]);
    case "menores":
      return con("¿Viajan menores? Escribe sus edades (por ejemplo: «5 y 9») o elige «Sin menores».", [{ etiqueta: "Sin menores", valor: "menores:no" }]);
    default:
      return con("¿Qué opción prefieres?");
  }
}

// ── Aplicar una respuesta ───────────────────────────────────────────────

type Aplicado = { estado: EstadoConversacion; aclaracion?: MensajeBot; aviso?: string };

/** Aplica fechas: dos exactas válidas, o pide aclarar con candidatos. */
function aplicarFechas(e: EstadoConversacion, texto: string, hoy: string): Aplicado | null {
  const f = extraerFechas(texto, hoy);
  if (!f.menciones.length) return f.mesSinDia ? { estado: e, aclaracion: { texto: "¿Qué días exactos? Indica el día de ida y el de regreso, con mes y año." } } : null;
  if (f.menciones.some((m) => m.tipo === "pasada")) return { estado: e, aclaracion: { texto: "Esa fecha ya pasó. Indica fechas desde hoy en adelante." } };
  if (f.menciones.some((m) => m.tipo === "invalida")) return { estado: e, aclaracion: { texto: "Una de las fechas no existe en el calendario. Revísala, por favor." } };
  const amb = f.menciones.find((m) => m.tipo === "ambigua");
  if (amb && amb.tipo === "ambigua") {
    const otra = f.menciones.find((m) => m !== amb && m.tipo === "ok");
    const opciones = amb.candidatos.map((c) => {
      const par = otra && otra.tipo === "ok" ? [c, otra.fecha].sort() : [c];
      return { etiqueta: par.map(fmtFecha).join(" al "), valor: `fechas:${par.join(",")}` };
    });
    return { estado: e, aclaracion: { texto: "Para no equivocarme, confirma la fecha:", opciones } };
  }
  const fechas = f.menciones.flatMap((m) => (m.tipo === "ok" ? [m.fecha] : []));
  if (fechas.length === 1) return { estado: { ...e, fechaIda: fechas[0], fechaRegreso: null }, aclaracion: { texto: `Ida el ${fmtFecha(fechas[0])}. ¿Y la fecha de regreso?` } };
  const [ida, reg] = [fechas[0], fechas[1]].sort();
  if (ida === reg) return { estado: e, aclaracion: { texto: "La ida y el regreso no pueden ser el mismo día." } };
  return { estado: { ...e, fechaIda: ida, fechaRegreso: reg } };
}

/** Respuesta a lo que se preguntó (`pendiente`). Devuelve null si no se entendió. */
async function aplicarRespuesta(e: EstadoConversacion, texto: string, hoy: string, sv: ServiciosConversacion): Promise<Aplicado | null> {
  switch (e.pendiente) {
    case "producto": {
      const p = interpretarProducto(texto);
      if (p.tipo === "ok") return { estado: { ...e, producto: p.producto } };
      if (p.tipo === "ambigua")
        return { estado: e, aclaracion: { texto: "¿Cuál de estos productos?", opciones: p.candidatos.map((c) => ({ etiqueta: NOMBRE_PRODUCTO[c], valor: `producto:${c}` })) } };
      if (p.tipo === "no_disponible")
        return {
          estado: e,
          aclaracion: {
            texto: p.producto === "servicios" ? "Servicios y tours todavía no se consultan aquí (su precio se está revisando)." : "Las salidas dinámicas todavía no se consultan aquí.",
            opciones: opcionesProducto(),
          },
        };
      return null;
    }
    case "destino": {
      if (e.producto === "porcion") {
        const lista = await sv.destinosPorcion();
        if (!lista) return { estado: e, aclaracion: { texto: "No pude leer los destinos en este momento.", opciones: [OP.asesor] } };
        const d = destinoEnLista(texto, lista);
        if (d.tipo === "ok") return { estado: { ...e, destino: d.destino } };
        if (d.tipo === "ambiguo") return { estado: e, aclaracion: { texto: "¿Cuál de estos destinos?", opciones: d.candidatos.map((c) => ({ etiqueta: c, valor: `destino:${c}` })) } };
        return { estado: e, aclaracion: { texto: "No tengo porción terrestre publicada para ese destino. Elige uno de la lista:", opciones: lista.slice(0, 8).map((c) => ({ etiqueta: c, valor: `destino:${c}` })) } };
      }
      if (esCualquiera(texto)) return { estado: { ...e, destino: null, cualquierDestino: true } };
      const d = limpiarDestinoLibre(texto);
      return d ? { estado: { ...e, destino: d, cualquierDestino: false } } : null;
    }
    case "fechas":
      return aplicarFechas(e, texto, hoy);
    case "adultos": {
      const c = interpretarCantidad(texto);
      if (c.tipo === "ambigua") return { estado: e, aclaracion: { texto: "Necesito un número exacto de adultos." } };
      if (c.tipo === "ok") return c.n >= 1 && c.n <= 40 ? { estado: { ...e, adultos: c.n } } : { estado: e, aclaracion: { texto: "Indica entre 1 y 40 adultos." } };
      return null;
    }
    case "habitaciones": {
      const h = interpretarHabitaciones(texto);
      if (h.tipo === "ok") return { estado: { ...e, habitaciones: h.habitaciones } };
      if (h.tipo === "ambigua") return { estado: e, aclaracion: { texto: "Indica cuántas y de qué tipo: sencilla, doble, triple o múltiple (por ejemplo: «2 dobles»)." } };
      if (h.tipo === "invalida") return { estado: e, aclaracion: { texto: "Son máximo 10 habitaciones por consulta." } };
      return null;
    }
    case "menores": {
      const m = interpretarMenores(texto);
      if (m.tipo === "ok") return { estado: { ...e, edadesMenores: m.edades } };
      if (m.tipo === "ambigua")
        return { estado: e, aclaracion: { texto: m.motivo === "sin_edades" ? "¿Qué edad tiene cada menor? Por ejemplo: «5 y 9»." : "La cantidad de menores no coincide con las edades. Escribe una edad por cada menor." } };
      if (m.tipo === "invalida") return { estado: e, aclaracion: { texto: "Las edades de menores van de 0 a 17 años, máximo 12 menores." } };
      return null;
    }
    case "seleccion": {
      const n = interpretarPosicion(texto, e.ultimaLista.length);
      return n ? { estado: { ...e, seleccion: null, combo: null }, aviso: e.ultimaLista[n - 1] } : null;
    }
    case "combo": {
      const n = interpretarPosicion(texto, e.ultimaLista.length);
      return n ? { estado: e, aviso: e.ultimaLista[n - 1] } : null;
    }
    default:
      return null;
  }
}

/** Datos que vienen en la MISMA frase (solo completa lo que falta; nunca pisa lo ya dado). */
async function completarDesdeFrase(e: EstadoConversacion, texto: string, hoy: string, sv: ServiciosConversacion): Promise<EstadoConversacion> {
  let x = e;
  if (!x.producto) {
    const p = interpretarProducto(texto);
    if (p.tipo === "ok") x = { ...x, producto: p.producto };
  }
  if (!x.producto) return x;
  if (!x.destino && !x.cualquierDestino) {
    if (x.producto === "porcion") {
      const lista = await sv.destinosPorcion();
      const d = lista ? destinoEnLista(texto, lista) : null;
      if (d?.tipo === "ok") x = { ...x, destino: d.destino };
    } else {
      const d = destinoEnFrase(texto);
      if (d) x = { ...x, destino: d };
    }
  }
  if (x.producto === "porcion") {
    if (!x.fechaIda) {
      const f = extraerFechas(texto, hoy);
      const ok = f.menciones.flatMap((m) => (m.tipo === "ok" ? [m.fecha] : []));
      if (ok.length === 2 && f.menciones.length === 2 && ok[0] !== ok[1]) {
        const [ida, reg] = ok.sort();
        x = { ...x, fechaIda: ida, fechaRegreso: reg };
      }
    }
    if (x.adultos == null) {
      const a = adultosEnFrase(texto);
      if (a != null && a >= 1 && a <= 40) x = { ...x, adultos: a };
    }
  }
  if (x.producto !== "programa" && !x.habitaciones) {
    const h = habitacionesEnFrase(texto);
    if (h) x = { ...x, habitaciones: h };
  }
  if (x.producto !== "programa" && !x.edadesMenores) {
    // Solo frases explícitas: los números sueltos de una frase larga pueden ser fechas.
    const t = normalizar(texto);
    if (/\b(sin (menores|ninos|ninas)|solo adultos)\b/.test(t)) x = { ...x, edadesMenores: [] };
    else {
      const seg = t.match(/\b(?:ninos?|ninas?|menores) de ((?:\d{1,2})(?:\s*(?:,|y)\s*\d{1,2})*)(?:\s+anos)?\b/);
      const m = seg ? interpretarMenores(seg[1]) : null;
      if (m?.tipo === "ok") x = { ...x, edadesMenores: m.edades };
    }
  }
  return x;
}

// ── Opciones (comandos) ─────────────────────────────────────────────────

type Comando =
  | { tipo: "reiniciar" }
  | { tipo: "asesor" }
  | { tipo: "ayuda" }
  | { tipo: "agencia"; nombre: string | null }
  | { tipo: "agencia_id"; id: string }
  | { tipo: "corregir"; campo: CampoCorregible }
  | { tipo: "producto"; producto: ProductoConversacion }
  | { tipo: "destino"; valor: string }
  | { tipo: "fechas"; ida: string; regreso: string | null }
  | { tipo: "adultos"; n: number }
  | { tipo: "habitaciones"; h: Partial<Record<AcomRoom, number>> }
  | { tipo: "menores_no" }
  | { tipo: "seleccion"; valor: string }
  | { tipo: "combo"; valor: string }
  | { tipo: "reintentar" };

const CAMPOS_CORREGIBLES: readonly CampoCorregible[] = ["producto", "destino", "fechas", "adultos", "habitaciones", "menores", "combo", "seleccion"];

/** Un valor de opción es solo un comando: lo que trae se revalida igual que un texto. */
export function comandoDeOpcion(valor: string): Comando | null {
  if (valor === "reiniciar" || valor === "asesor" || valor === "ayuda" || valor === "reintentar") return { tipo: valor };
  if (valor === "agencia") return { tipo: "agencia", nombre: null };
  if (valor === "menores:no") return { tipo: "menores_no" };
  const [clave, ...resto] = valor.split(":");
  const v = resto.join(":");
  switch (clave) {
    case "corregir":
      return (CAMPOS_CORREGIBLES as readonly string[]).includes(v) ? { tipo: "corregir", campo: v as CampoCorregible } : null;
    case "producto":
      return v === "programa" || v === "bloqueo" || v === "porcion" ? { tipo: "producto", producto: v } : null;
    case "destino":
      return v ? { tipo: "destino", valor: v } : null;
    case "fechas": {
      const [ida, reg] = v.split(",");
      return /^\d{4}-\d{2}-\d{2}$/.test(ida ?? "") && (reg === undefined || /^\d{4}-\d{2}-\d{2}$/.test(reg)) ? { tipo: "fechas", ida, regreso: reg ?? null } : null;
    }
    case "adultos": {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 40 ? { tipo: "adultos", n } : null;
    }
    case "habitaciones": {
      const h: Partial<Record<AcomRoom, number>> = {};
      for (const par of v.split(",")) {
        const [a, n] = par.split("=");
        const num = Number(n);
        if (!["sencilla", "doble", "triple", "multiple"].includes(a) || !Number.isInteger(num) || num < 1 || num > 10) return null;
        h[a as AcomRoom] = num;
      }
      return Object.keys(h).length ? { tipo: "habitaciones", h } : null;
    }
    case "sel":
      return v ? { tipo: "seleccion", valor: v } : null;
    case "combo":
      return v.includes("|") ? { tipo: "combo", valor: v } : null;
    case "ag":
      return /^\d+$/.test(v) ? { tipo: "agencia_id", id: v } : null;
    default:
      return null;
  }
}

// ── Búsquedas, selección y resultados ───────────────────────────────────

type Turno = { estado: EstadoConversacion; mensajes: MensajeBot[] };

function mensajeFallo(r: { codigo: string; motivo?: string }, e: EstadoConversacion): MensajeBot {
  if (r.codigo === "no_autorizado") return { texto: r.motivo ?? "No tienes acceso a esta consulta.", aviso: true };
  if (r.codigo === "error_tecnico") return { texto: "No fue posible consultar en este momento.", aviso: true, opciones: [{ etiqueta: "Intentar de nuevo", valor: "reintentar" }, OP.asesor, OP.reiniciar] };
  if (r.codigo === "sin_resultados") return { texto: `${r.motivo ?? "No encontré resultados."} Puedes ajustar la búsqueda:`, opciones: [...opcionesCorregir(e), OP.asesor] };
  return { texto: r.motivo ?? "No se pudo consultar con esos datos.", aviso: true, opciones: [...opcionesCorregir(e), OP.asesor] };
}

function entradaComposicion(e: EstadoConversacion): Entrada {
  const out: Entrada = {};
  for (const [a, n] of Object.entries(e.habitaciones ?? {})) out[`hab_${a}`] = String(n);
  if (e.edadesMenores?.length) out.edadesMenores = e.edadesMenores.join(", ");
  return out;
}

const textoVuelo = (estado: DisponibilidadVuelo | null, sillas: number | null) =>
  estado === "sillas_libres" ? `${sillas} silla(s) libre(s) al consultar (no se apartan)`
  : estado === "sin_sillas" ? "sin sillas libres en este momento"
  : estado === "no_verificada" ? "sillas no verificadas: confírmalo con el asesor"
  : estado === "sujeto_a_confirmacion" ? "tiquete de sistema, sujeto a confirmación" : null;

async function buscar(e: EstadoConversacion, sv: ServiciosConversacion): Promise<Turno> {
  const corregir = opcionesCorregir(e);
  if (e.producto === "programa") {
    const r = await sv.buscarProgramas({ destino: e.cualquierDestino ? undefined : (e.destino ?? undefined), limite: String(MAX_OPCIONES) });
    if (!r.ok) return { estado: { ...e, pendiente: null }, mensajes: [mensajeFallo(r, e)] };
    const lista = r.datos.resultados.slice(0, MAX_OPCIONES);
    return {
      estado: { ...e, pendiente: "seleccion", ultimaLista: lista.map((p) => `sel:prog:${p.id}`) },
      mensajes: [{
        texto: `Encontré ${r.datos.total_encontrados} programa(s)${e.destino ? ` para «${e.destino}»` : ""}. Elige uno para ver el detalle:`,
        lineas: lista.map((p, i) => `${i + 1}. ${p.nombre}${p.destino ? ` · ${p.destino}` : ""}${p.dias ? ` · ${p.dias} días` : ""} · ${p.desde_pvp_por_persona != null ? `desde ${formatMoneda(p.desde_pvp_por_persona, p.moneda)} por persona (referencia)` : "sin precio publicado"}${p.precio_en_revision ? " · precio en revisión" : ""}`),
        opciones: [...lista.map((p, i) => ({ etiqueta: `${i + 1}. ${p.nombre}`.slice(0, 60), valor: `sel:prog:${p.id}` })), ...corregir],
      }],
    };
  }
  if (e.producto === "bloqueo") {
    const r = await sv.buscarBloqueos({ destino: e.cualquierDestino ? undefined : (e.destino ?? undefined), limite: String(MAX_OPCIONES) });
    if (!r.ok) return { estado: { ...e, pendiente: null }, mensajes: [mensajeFallo(r, e)] };
    const lista = r.datos.ofertas.slice(0, MAX_OPCIONES);
    return {
      estado: { ...e, pendiente: "seleccion", ultimaLista: lista.map((o) => `sel:blo:${o.clave}`) },
      mensajes: [{
        texto: `Encontré ${r.datos.total_encontradas} salida(s) en bloqueo. Elige una para cotizar:`,
        lineas: lista.map((o, i) => `${i + 1}. ${o.hotel_nombre ?? "Hotel"} · ${o.destino ?? ""} · ${fmtFecha(o.fecha_ida)} al ${fmtFecha(o.fecha_regreso)} · ${o.desde_pvp_por_persona != null ? `desde ${formatMoneda(o.desde_pvp_por_persona, o.moneda)} por persona` : "sin precio publicado"} · ${textoVuelo(o.disponibilidad_vuelo, o.sillas_libres)}`),
        opciones: [...lista.map((o, i) => ({ etiqueta: `${i + 1}. ${o.hotel_nombre ?? "Hotel"} · ${fmtFecha(o.fecha_ida)}`.slice(0, 60), valor: `sel:blo:${o.clave}` })), ...corregir],
      }],
    };
  }
  // Porción: un resultado por hotel y combo, con su total orientativo.
  const r = await sv.buscarPorcion({ destino: e.destino ?? undefined, fechaIda: e.fechaIda ?? undefined, fechaRegreso: e.fechaRegreso ?? undefined, adultos: String(e.adultos ?? ""), ...entradaComposicion(e), limite: String(MAX_OPCIONES) });
  if (!r.ok) return { estado: { ...e, pendiente: null }, mensajes: [mensajeFallo(r, e)] };
  if (!r.datos.resultados.length) {
    return {
      estado: { ...e, pendiente: null },
      mensajes: [{
        texto: "Ningún hotel cotiza esas fechas exactas.",
        lineas: r.datos.sugerencias_fecha.length ? ["Fechas cercanas con tarifa:"] : undefined,
        opciones: [...r.datos.sugerencias_fecha.slice(0, 4).map((s) => ({ etiqueta: s.etiqueta, valor: `fechas:${s.fecha_ida},${s.fecha_regreso}` })), ...corregir, OP.asesor],
      }],
    };
  }
  const items = r.datos.resultados.flatMap((h) => h.combos.slice(0, 2).map((c) => ({ h, c }))).slice(0, MAX_OPCIONES);
  return {
    estado: { ...e, pendiente: "seleccion", ultimaLista: items.map(({ h, c }) => `sel:por:${h.paquete_id}-${h.hotel_id}#${c.categoria}|${c.regimen}`) },
    mensajes: [{
      texto: `Hoteles en ${e.destino} del ${fmtFecha(e.fechaIda)} al ${fmtFecha(e.fechaRegreso)} (totales orientativos para ${items[0]?.c.pax ?? ""} pax, sujetos a disponibilidad):`,
      lineas: items.map(({ h, c }, i) => `${i + 1}. ${h.hotel_nombre ?? "Hotel"} · ${c.categoria} · ${c.regimen} · ${formatMoneda(c.total_orientativo, h.moneda)}`),
      opciones: [...items.map(({ h, c }, i) => ({ etiqueta: `${i + 1}. ${h.hotel_nombre ?? "Hotel"} · ${c.regimen}`.slice(0, 60), valor: `sel:por:${h.paquete_id}-${h.hotel_id}#${c.categoria}|${c.regimen}` })), ...corregir],
    }],
  };
}

const lineasCotizacion = (c: CotizacionPaquete): string[] => {
  const p = (v: number) => formatMoneda(v, c.moneda);
  return [
    ...c.lineas.map((l) => `${l.habitaciones} hab. ${ACOM[l.acomodacion] ?? l.acomodacion} (${l.pax} pax) · ${p(l.pvp_por_persona)} por persona`),
    ...(c.menores.nino ? [`${c.menores.nino} niño(s)${c.pvp_menores_por_persona.nino != null ? ` · ${p(c.pvp_menores_por_persona.nino)} c/u` : ""}`] : []),
    ...(c.menores.nino2 ? [`${c.menores.nino2} niño(s) 2${c.pvp_menores_por_persona.nino2 != null ? ` · ${p(c.pvp_menores_por_persona.nino2)} c/u` : ""}`] : []),
    ...(c.menores.infante ? [`${c.menores.infante} infante(s)${c.pvp_menores_por_persona.infante != null ? ` · ${p(c.pvp_menores_por_persona.infante)} c/u` : " · sin cargo"}`] : []),
    ...c.condiciones_tarifa.map((t) => `Condición: ${t}`),
    ...(c.nota_nino ? [c.nota_nino] : []),
  ];
};

async function lineaAgencia(e: EstadoConversacion, sv: ServiciosConversacion): Promise<string[]> {
  if (e.agenciaId == null) return [];
  const r = await sv.porcentajeAgencia(String(e.agenciaId));
  return r.ok ? [textoPorcentaje(r.datos)] : [];
}

const opcionesTrasResultado = (e: EstadoConversacion): Opcion[] => [OP.resultados, ...opcionesCorregir(e).filter((o) => o.valor !== "corregir:producto"), ...(e.agenciaId == null ? [OP.agencia] : []), OP.asesor, OP.reiniciar];

const caducada = (texto = "Esa opción ya no está disponible o vigente. Te muestro los resultados actuales.") => ({ texto, aviso: true });

/** Con todos los datos: busca o revalida la selección y muestra el detalle o la cotización. */
async function resolver(e: EstadoConversacion, sv: ServiciosConversacion, hoy: string, previos: MensajeBot[] = []): Promise<Turno> {
  const falta = datosFaltantesAntesDeBuscar(e);
  if (!e.producto) {
    const q = await preguntar(e, "producto", sv);
    return { estado: q.estado, mensajes: [...previos, q.mensaje] };
  }
  if (falta.length) {
    const q = await preguntar(e, falta[0], sv);
    return { estado: q.estado, mensajes: [...previos, q.mensaje] };
  }
  if (!e.seleccion) {
    const b = await buscar(e, sv);
    return { estado: b.estado, mensajes: [...previos, ...b.mensajes] };
  }

  if (e.producto === "programa") {
    const id = e.seleccion.startsWith("prog:") ? e.seleccion.slice(5) : "";
    const r = /^\d+$/.test(id) ? await sv.detallePrograma(id) : null;
    if (!r || !r.ok) {
      if (r && !r.ok && r.codigo !== "no_encontrado" && r.codigo !== "parametros_invalidos") return { estado: { ...e, pendiente: null }, mensajes: [...previos, mensajeFallo(r, e)] };
      return resolver({ ...e, seleccion: null }, sv, hoy, [...previos, caducada()]);
    }
    const d = r.datos;
    const precios =
      d.modo_precio === "categoria"
        ? d.categorias.slice(0, 3).map((c) => `${c.nombre ?? "Categoría"}: ${c.precios.map((p) => `${ACOM[p.acomodacion] ?? p.acomodacion} ${"a_solicitud" in p ? "a solicitud" : formatMoneda(p.pvp_por_persona, d.moneda)}`).join(" · ")}`)
        : d.salidas.slice(0, 3).map((s) => `${s.etiqueta ?? fmtFecha(s.fecha_desde)}: ${s.a_solicitud ? "a solicitud" : s.precios.map((p) => `${ACOM[p.acomodacion] ?? p.acomodacion} ${formatMoneda(p.pvp_por_persona, d.moneda)}`).join(" · ")}`);
    return {
      estado: { ...e, pendiente: null },
      mensajes: [...previos, {
        texto: `${d.nombre}${d.destino ? ` · ${d.destino}` : ""}${d.dias ? ` · ${d.dias} días / ${d.noches ?? "-"} noches` : ""}. Precios por persona, solo de referencia:`,
        lineas: [
          ...precios,
          ...d.incluye.slice(0, 4).map((i) => `Incluye: ${i.texto}`),
          ...(d.precio_en_revision ? ["Precio en revisión: confírmalo con el asesor antes de compartirlo."] : []),
          "El total depende de las fechas y la acomodación: lo calcula el asesor.",
          ...(await lineaAgencia(e, sv)),
        ],
        enlace: d.url_vitrina.startsWith("/") ? { etiqueta: "Ver ficha completa", href: d.url_vitrina } : undefined,
        opciones: opcionesTrasResultado(e),
      }],
    };
  }

  if (e.producto === "bloqueo") {
    const clave = e.seleccion.startsWith("blo:") ? e.seleccion.slice(4) : "";
    const oferta = clave ? await sv.ofertaBloqueo(clave) : null;
    if (!oferta) return resolver({ ...e, seleccion: null, combo: null }, sv, hoy, [...previos, caducada()]);
    const comboValido = e.combo && oferta.combos.some((c) => `${c.categoria}|${c.regimen}` === e.combo);
    if (!comboValido) {
      const combos = oferta.combos.slice(0, MAX_OPCIONES);
      return {
        estado: { ...e, combo: null, pendiente: "combo", ultimaLista: combos.map((c) => `combo:${c.categoria}|${c.regimen}`) },
        mensajes: [...previos, {
          texto: `${oferta.hotel_nombre ?? "Hotel"} · ${fmtFecha(oferta.fecha_ida)} al ${fmtFecha(oferta.fecha_regreso)}. ¿Qué categoría y régimen?`,
          opciones: [...combos.map((c) => ({ etiqueta: `${c.categoria} · ${c.regimen}`.slice(0, 60), valor: `combo:${c.categoria}|${c.regimen}` })), OP.resultados, OP.reiniciar],
        }],
      };
    }
    if (!e.habitaciones) {
      const q = await preguntar(e, "habitaciones", sv);
      return { estado: q.estado, mensajes: [...previos, q.mensaje] };
    }
    if (!e.edadesMenores) {
      const q = await preguntar(e, "menores", sv);
      return { estado: q.estado, mensajes: [...previos, q.mensaje] };
    }
    const r = await sv.cotizarBloqueo({ oferta: clave, combo: e.combo ?? undefined, ...entradaComposicion(e) });
    if (!r.ok) {
      if (r.codigo === "no_encontrado") return resolver({ ...e, seleccion: null, combo: null }, sv, hoy, [...previos, caducada()]);
      return { estado: { ...e, pendiente: null }, mensajes: [...previos, mensajeFallo(r, e)] };
    }
    const c = r.datos;
    const vuelo = textoVuelo(c.disponibilidad_vuelo, c.sillas_libres);
    return {
      estado: { ...e, pendiente: null },
      mensajes: [...previos, {
        texto: `Cotización ORIENTATIVA: ${formatMoneda(c.total_orientativo, c.moneda)} para ${c.total_pax} pax · ${c.hotel_nombre ?? "Hotel"} · ${c.categoria} · ${c.regimen} · ${fmtFecha(c.fecha_ida)} al ${fmtFecha(c.fecha_regreso)}.`,
        lineas: [
          ...lineasCotizacion(c),
          ...(vuelo ? [`Vuelo: ${vuelo}${c.alcanzan_sillas === false ? ". No alcanzan para esta composición." : "."}`] : []),
          "Precio del sistema de venta, vigente 15 minutos. El hotel está sujeto a confirmación; el asesor confirma antes de vender.",
          ...(await lineaAgencia(e, sv)),
        ],
        aviso: c.alcanzan_sillas === false,
        opciones: opcionesTrasResultado(e),
      }],
    };
  }

  // Porción: la selección es hotel + combo de la búsqueda; se revalida y se cotiza.
  const m = e.seleccion.match(/^por:(\d+)-(\d+)#(.+)$/);
  if (!m) return resolver({ ...e, seleccion: null }, sv, hoy, [...previos, caducada()]);
  const r = await sv.cotizarPorcion({ paquete: m[1], hotel: m[2], fechaIda: e.fechaIda ?? undefined, fechaRegreso: e.fechaRegreso ?? undefined, combo: m[3], ...entradaComposicion(e) });
  if (!r.ok) {
    if (r.codigo === "no_encontrado") return resolver({ ...e, seleccion: null }, sv, hoy, [...previos, caducada()]);
    const fallo = mensajeFallo(r, e);
    const sugerencias = "sugerencias_fecha" in r ? r.sugerencias_fecha.slice(0, 4).map((s) => ({ etiqueta: s.etiqueta, valor: `fechas:${s.fecha_ida},${s.fecha_regreso}` })) : [];
    return { estado: { ...e, seleccion: null, pendiente: null }, mensajes: [...previos, { ...fallo, opciones: [...sugerencias, ...(fallo.opciones ?? [])] }] };
  }
  const c = r.datos.cotizacion;
  if (!c) return resolver({ ...e, seleccion: null }, sv, hoy, [...previos, caducada()]);
  return {
    estado: { ...e, pendiente: null },
    mensajes: [...previos, {
      texto: `Cotización ORIENTATIVA: ${formatMoneda(c.total_orientativo, c.moneda)} para ${c.total_pax} pax · ${c.hotel_nombre ?? "Hotel"} · ${c.categoria} · ${c.regimen} · ${fmtFecha(c.fecha_ida)} al ${fmtFecha(c.fecha_regreso)} (${r.datos.noches} noches).`,
      lineas: [
        ...lineasCotizacion(c),
        ...(r.datos.precio_no_final ? [`Incluye servicios cobrados por grupo (${r.datos.servicios_grupo_pendientes.join(", ")}): confirma el total con el asesor.`] : []),
        "Precio del sistema de venta, vigente 15 minutos. Sujeto a disponibilidad del hotel; el asesor confirma antes de vender.",
        ...(await lineaAgencia(e, sv)),
      ],
      opciones: opcionesTrasResultado(e),
    }],
  };
}

// ── Agencia (B2B) ───────────────────────────────────────────────────────

async function elegirAgencia(e: EstadoConversacion, nombre: string | null, sv: ServiciosConversacion): Promise<Turno> {
  const r = await sv.listarAgencias();
  if (!r.ok) return { estado: e, mensajes: [mensajeFallo(r, e)] };
  const n = normalizar(nombre ?? "");
  const lista = n ? r.datos.filter((a) => normalizar(a.nombre).includes(n)) : r.datos;
  if (!lista.length) return { estado: { ...e, pendiente: "agencia" }, mensajes: [{ texto: "No encontré esa agencia. Escribe otra parte del nombre.", opciones: [OP.reiniciar] }] };
  return {
    estado: { ...e, pendiente: "agencia" },
    mensajes: [{ texto: n ? "¿Cuál de estas agencias?" : "Escribe el nombre de la agencia o elige una:", opciones: lista.slice(0, 8).map((a) => ({ etiqueta: a.nombre.slice(0, 60), valor: `ag:${a.id}` })) }],
  };
}

// ── Selección ────────────────────────────────────────────────────────────

/** Vuelve a mostrar el paso actual (con sus opciones) tras una selección que no es de la lista visible. */
async function pedirDeLasActuales(e: EstadoConversacion, sv: ServiciosConversacion, hoy: string): Promise<Turno> {
  const aviso: MensajeBot = { texto: "Esa opción no está en la lista actual. Elige una de las opciones actuales.", aviso: true };
  if (e.pendiente === "agencia") {
    const t = await elegirAgencia(e, null, sv);
    return { estado: t.estado, mensajes: [aviso, ...t.mensajes] };
  }
  return resolver(e, sv, hoy, [aviso]);
}

/**
 * Una selección (opción o número) solo vale si es de la ÚLTIMA lista mostrada y
 * el bot está esperando elegir de ella. Aun así no es prueba de vigencia: el
 * estado viene del navegador, y `resolver` revalida la oferta en el servidor.
 */
function elegir(e: EstadoConversacion, valor: string, sv: ServiciosConversacion, hoy: string): Promise<Turno> {
  if (e.pendiente !== "seleccion" || !e.ultimaLista.includes(`sel:${valor}`)) return pedirDeLasActuales(e, sv, hoy);
  return resolver({ ...e, seleccion: valor, combo: null, pendiente: null }, sv, hoy);
}

// ── Turno ────────────────────────────────────────────────────────────────

/**
 * Un turno completo. `hoy` es la fecha de negocio del servidor (AAAA-MM-DD).
 * La respuesta pasa por la lista negra: si apareciera una clave prohibida, se
 * descarta entera.
 */
export async function avanzar(estadoNavegador: unknown, entradaNavegador: unknown, sv: ServiciosConversacion, hoy: string): Promise<RespuestaConversacion> {
  const entrada = sanearEntrada(entradaNavegador);
  let e = sanearEstado(estadoNavegador);
  if (!entrada) return limpio({ ok: false, estado: e, mensajes: [{ texto: "No entendí el mensaje. Escríbelo de nuevo, máximo 300 caracteres.", aviso: true }] });
  if (entrada.tipo === "inicio") return limpio({ ok: true, estado: estadoInicial(), mensajes: [saludo()] });

  const cmd: Comando | null = entrada.tipo === "opcion" ? comandoDeOpcion(entrada.valor) : (interpretarComando(entrada.texto) as Comando | null);
  if (entrada.tipo === "opcion" && !cmd) return limpio({ ok: false, estado: e, mensajes: [{ texto: "Esa opción no es válida. Elige una de las opciones actuales.", aviso: true }] });

  const resultado = async (): Promise<Turno> => {
    if (cmd) {
      switch (cmd.tipo) {
        case "reiniciar":
          return { estado: estadoInicial(), mensajes: [{ texto: "Empecemos de nuevo." }, saludo()] };
        case "asesor":
          return { estado: e, mensajes: [mensajeAsesor()] };
        case "ayuda":
          return { estado: e, mensajes: [{ texto: "Dime el producto (Programas, Bloqueos o Porción terrestre) y te pido lo que falte. Puedes escribir «cambiar fechas», «otra opción», «es para una agencia» o «empezar de nuevo» en cualquier momento.", opciones: e.producto ? opcionesCorregir(e) : opcionesProducto() }] };
        case "agencia":
          return elegirAgencia(e, cmd.nombre, sv);
        case "agencia_id": {
          const r = await sv.porcentajeAgencia(cmd.id);
          if (!r.ok) return { estado: e, mensajes: [mensajeFallo(r, e)] };
          if (r.datos.estado === "no_encontrada") return { estado: { ...e, agenciaId: null }, mensajes: [{ texto: "No se encontró esa agencia.", opciones: [OP.agencia] }] };
          const conAgencia = { ...e, agenciaId: r.datos.agencia.id, pendiente: null };
          const siguiente = await resolver(conAgencia, sv, hoy, [{ texto: textoPorcentaje(r.datos) }]);
          return siguiente;
        }
        case "corregir": {
          const limpio = limpiar(e, cmd.campo);
          if (cmd.campo === "seleccion" || cmd.campo === "combo") return resolver(limpio, sv, hoy);
          const q = await preguntar(limpio, cmd.campo, sv);
          return { estado: q.estado, mensajes: [q.mensaje] };
        }
        case "producto":
          return resolver({ ...estadoInicial(), producto: cmd.producto, agenciaId: e.agenciaId, pendiente: null }, sv, hoy, [{ texto: `${NOMBRE_PRODUCTO[cmd.producto]}.` }]);
        case "destino": {
          if (cmd.valor === "*") {
            if (e.producto === "porcion") return resolver(e, sv, hoy);
            return resolver({ ...e, destino: null, cualquierDestino: true, seleccion: null, combo: null }, sv, hoy);
          }
          if (e.producto === "porcion") {
            const lista = await sv.destinosPorcion();
            const d = lista ? destinoEnLista(cmd.valor, lista) : null;
            if (d?.tipo !== "ok") return resolver({ ...e, destino: null }, sv, hoy, [{ texto: "Ese destino no está disponible.", aviso: true }]);
            return resolver({ ...e, destino: d.destino, seleccion: null }, sv, hoy);
          }
          const d = limpiarDestinoLibre(cmd.valor);
          return resolver({ ...e, destino: d, cualquierDestino: false, seleccion: null, combo: null }, sv, hoy);
        }
        case "fechas": {
          const ok = (f: string | null) => f == null || f >= hoy;
          if (!ok(cmd.ida) || !ok(cmd.regreso)) return resolver(e, sv, hoy, [{ texto: "Esa fecha ya pasó.", aviso: true }]);
          const x = { ...e, fechaIda: cmd.ida, fechaRegreso: cmd.regreso && cmd.regreso > cmd.ida ? cmd.regreso : null, seleccion: null };
          return resolver(sanearEstado(x), sv, hoy);
        }
        case "adultos":
          return resolver({ ...e, adultos: cmd.n, ...(e.producto === "porcion" ? { seleccion: null } : {}) }, sv, hoy);
        case "habitaciones":
          return resolver({ ...e, habitaciones: cmd.h, ...(e.producto === "porcion" ? { seleccion: null } : {}) }, sv, hoy);
        case "menores_no":
          return resolver({ ...e, edadesMenores: [], ...(e.producto === "porcion" ? { seleccion: null } : {}) }, sv, hoy);
        case "seleccion":
          return elegir(e, cmd.valor, sv, hoy);
        case "combo":
          return resolver({ ...e, combo: cmd.valor, pendiente: null }, sv, hoy);
        case "reintentar":
          return resolver(e, sv, hoy);
      }
    }
    // Texto libre: primero responde lo que se preguntó; después completa lo que venga en la frase.
    const texto = (entrada as { texto: string }).texto;
    if (e.pendiente === "agencia") return elegirAgencia(e, texto, sv);
    const a = await aplicarRespuesta(e, texto, hoy, sv);
    if (a?.aviso) {
      // Elección por número en la última lista: se trata como la opción misma (mismo filtro y revalidación).
      const c = comandoDeOpcion(a.aviso);
      if (c?.tipo === "seleccion") return elegir(a.estado, c.valor, sv, hoy);
      if (c?.tipo === "combo") return resolver({ ...a.estado, combo: c.valor, pendiente: null }, sv, hoy);
    }
    if (a?.aclaracion) return { estado: a.estado, mensajes: [{ ...a.aclaracion, opciones: [...(a.aclaracion.opciones ?? []), OP.reiniciar] }] };
    const base = a ? a.estado : e;
    const completado = await completarDesdeFrase({ ...base, pendiente: null }, texto, hoy, sv);
    if (!a && completado.producto === e.producto && JSON.stringify(completado) === JSON.stringify({ ...e, pendiente: null })) {
      // Nada se entendió: vuelve a preguntar lo mismo, con ejemplos.
      if (e.pendiente === "seleccion" || e.pendiente === "combo") return { estado: e, mensajes: [{ texto: "Elige una de las opciones de la lista (o escribe su número).", opciones: [OP.resultados, OP.reiniciar] }] };
      if (e.pendiente == null && e.producto) return { estado: e, mensajes: [{ texto: "No te entendí. ¿Qué quieres ajustar?", opciones: opcionesTrasResultado(e) }] };
      const q = await preguntar(e, e.pendiente ?? "producto", sv, "No te entendí.");
      return { estado: q.estado, mensajes: [q.mensaje] };
    }
    return resolver(completado, sv, hoy);
  };

  try {
    const t = await resultado();
    e = t.estado;
    return limpio({ ok: true, estado: e, mensajes: t.mensajes });
  } catch {
    return limpio({ ok: false, estado: e, mensajes: [{ texto: "No fue posible continuar en este momento.", aviso: true, opciones: [{ etiqueta: "Intentar de nuevo", valor: "reintentar" }, OP.reiniciar] }] });
  }
}

/** Defensa final: una respuesta con una clave prohibida (netos, PNR, sillas…) nunca sale. */
function limpio(r: RespuestaConversacion): RespuestaConversacion {
  if (clavesProhibidasEn(r).length) return { ok: false, estado: estadoInicial(), mensajes: [{ texto: "No fue posible mostrar esa información.", aviso: true, opciones: [OP.reiniciar] }] };
  return r;
}

export { textoHabitaciones };
