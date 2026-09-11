// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-1 Bernalo — contrato de transporte CARRITO → CHECKOUT para hoteles
// `hoteles.modelo_tarifario = "unidad"`.
//
// Módulo NEUTRAL: sin "use client"/"use server", sin Supabase/Next — puede
// importarse tanto desde un componente cliente (`lib/cart/CartContext.tsx`)
// como desde una Server Action (`app/tarifario/checkout/actions.ts`,
// `app/tarifario/cotizacionBernaloActions.ts`) sin que ninguno de los dos
// termine importando el archivo "use server" del otro — es la fuente ÚNICA
// de `SalidaSeleccionadaBernaloEntrada` (antes vivía solo dentro de
// `cotizacionBernaloActions.ts`, que ahora la reexporta desde aquí) y de la
// validación server-side del ítem Bernalo del carrito.
//
// Reutiliza, sin copiar:
//   - `validarHabitacionesOcupacion` (Fase 3D, `ocupacionPorHabitacion.ts`)
//     para las habitaciones físicas (id, acomodación, adultos, edades).
//   - `validarTextoAcotado`/`validarFechaConsulta`/`validarRangoFechas`
//     (`edadesMenores.ts`) para los campos de texto/fecha.
//   - `validarSolicitudItem`/`validarTourInput`/`validarClienteInput`
//     (`edadesMenores.ts`) para el resto del carrito (ítems "persona",
//     tours, cliente) — este archivo solo AGREGA el despacho de la variante
//     Bernalo, nunca reimplementa el camino persona.
//
// Import relativo (no `@/…`) a propósito — mismo motivo que
// `edadesMenores.ts`/`ocupacionPorHabitacion.ts`: debe poder ejecutarse bajo
// `node --test` sin bundler (ver pruebas/solicitudAlojamientoBernalo.test.ts).
//
// Por qué este archivo, y no mover el despacho a `edadesMenores.ts` directo:
// `ocupacionPorHabitacion.ts` YA importa de `edadesMenores.ts` (para
// `parseEdadMenor`/`ajustarCantidadEdades`/`EDAD_MENOR_MAX`/
// `MAX_MENORES_POR_CONSULTA`). Si `edadesMenores.ts` importara de vuelta
// `validarHabitacionesOcupacion` para poder validar el ítem Bernalo dentro
// de `validarCrearSolicitudInput`, se cerraría un ciclo de imports
// (`edadesMenores.ts` → `ocupacionPorHabitacion.ts` → `edadesMenores.ts`).
// Este módulo, al ser un TERCER archivo que consume a los otros dos sin que
// ninguno lo conozca a él, evita el ciclo — por eso `validarCrearSolicitudInput`
// y `CrearSolicitudInputValidado` (el punto de entrada completo del carrito
// público) se movieron AQUÍ desde `edadesMenores.ts` (el resto de
// validadores de ese archivo, sin relación con Bernalo, se quedan donde
// estaban — no se tocan).
//
// Alcance ESTRICTO de esta fase (3F-1, ver el encargo):
//   - Transporta SOLO decisiones del usuario — nunca neto/bruto/comisión/
//     snapshot/payload/costos/markup (ninguno de esos campos existe en los
//     tipos de este archivo; `validarSolicitudItemBernalo` ni siquiera LEE
//     esas claves del objeto crudo, aunque vengan presentes).
//   - `precio`/`moneda` del carrito son presentación, jamás autoridad — por
//     eso NO forman parte de `SolicitudItemBernaloValidado` (el ítem YA
//     validado, camino server), igual que `SolicitudItemValidado` (persona)
//     tampoco los lleva — el precio real siempre sale de re-liquidar.
//   - NO levanta la guardia de `computarReserva` ni escribe contrato/CxP —
//     eso es 3F-2+. `checkout/actions.ts` sigue enrutando el ítem Bernalo
//     HACIA `computarReserva`, que hoy lo bloquea (guardia de Fase 3,
//     `lib/reservar/computo.ts`, sin cambios en esta fase).
// ─────────────────────────────────────────────────────────────────────────

import {
  MAX_HABITACIONES_CONSULTA, MAX_ITEMS_CARRITO, MAX_LINEAS_CARRITO, MAX_TOURS_CARRITO,
  validarTextoAcotado, validarFechaConsulta, validarRangoFechas,
  validarSolicitudItem, validarTourInput, validarClienteInput,
  type SolicitudItemValidado, type SolicitudTourValidado, type SolicitudClienteValidado,
} from "./edadesMenores.ts";
import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionValidada,
} from "./ocupacionPorHabitacion.ts";

// ── Salida aérea SELECCIONADA (Fase 3E) — unión discriminada real ──────────
// Identidad de la salida elegida por el usuario — NUNCA un índice `[0]`.
// "sin_vuelo" solo es una elección legítima cuando el paquete de verdad no
// tiene ninguna salida configurada (porción terrestre); el servidor
// (`cotizacionBernaloActions.ts`) lo revalida contra el paquete real.
export type SalidaSeleccionadaBernaloEntrada =
  | { tipo: "bloqueo"; id: number }
  | { tipo: "empaquetado"; id: number }
  | { tipo: "sin_vuelo"; fechaIda: string; fechaRegreso: string };

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esEnteroPositivo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Valida la FORMA de una salida seleccionada — trata `v` como `unknown` siempre. */
export function validarSalidaSeleccionadaBernalo(
  v: unknown
): { ok: true; salida: SalidaSeleccionadaBernaloEntrada } | { ok: false; error: string } {
  if (!esObjetoPlano(v)) return { ok: false, error: "La salida seleccionada no tiene una forma válida." };
  if (v.tipo === "bloqueo" || v.tipo === "empaquetado") {
    if (!esEnteroPositivo(v.id)) return { ok: false, error: "La salida seleccionada tiene un id inválido." };
    return { ok: true, salida: { tipo: v.tipo, id: v.id } };
  }
  if (v.tipo === "sin_vuelo") {
    const vIda = validarFechaConsulta(v.fechaIda);
    if (!vIda.ok) return { ok: false, error: `La salida seleccionada: ${vIda.error}` };
    const vReg = validarFechaConsulta(v.fechaRegreso);
    if (!vReg.ok) return { ok: false, error: `La salida seleccionada: ${vReg.error}` };
    const vRango = validarRangoFechas(vIda.fecha, vReg.fecha);
    if (!vRango.ok) return { ok: false, error: `La salida seleccionada: ${vRango.error}` };
    return { ok: true, salida: { tipo: "sin_vuelo", fechaIda: vIda.fecha, fechaRegreso: vReg.fecha } };
  }
  return { ok: false, error: "La salida seleccionada tiene un tipo inválido." };
}

// ── Ítem Bernalo del carrito — SOLO decisiones del usuario ─────────────────
// Deliberadamente SIN `precio`/`moneda`/`pax`/ningún campo de dinero: el ítem
// ya validado (server) nunca lleva autoridad de precio, igual que
// `SolicitudItemValidado` (persona, `edadesMenores.ts`) tampoco la lleva.
export type SolicitudItemBernaloValidado = {
  modeloTarifario: "unidad";
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionValidada[];
};

export function validarSolicitudItemBernalo(
  v: unknown,
  indice: number
): { ok: true; item: SolicitudItemBernaloValidado } | { ok: false; error: string } {
  const ctx = `El ítem ${indice + 1} del carrito`;
  if (!esObjetoPlano(v)) return { ok: false, error: `${ctx} no tiene una forma válida.` };

  if (typeof v.paqueteId !== "number" || !Number.isInteger(v.paqueteId)) return { ok: false, error: `${ctx} tiene un paquete inválido.` };
  if (typeof v.hotelId !== "number" || !Number.isInteger(v.hotelId)) return { ok: false, error: `${ctx} tiene un hotel inválido.` };
  const vNombre = validarTextoAcotado(v.hotelNombre, `${ctx}: el nombre del hotel`);
  if (!vNombre.ok) return { ok: false, error: vNombre.error };
  let destino: string | null = null;
  if (v.destino !== null && v.destino !== undefined) {
    const vDest = validarTextoAcotado(v.destino, `${ctx}: el destino`, undefined, true);
    if (!vDest.ok) return { ok: false, error: vDest.error };
    destino = vDest.texto;
  }
  // B1 (auditoría DeepSeek, Fase 3E): categoría/alimentación son texto
  // acotado por forma acá — la pertenencia real al catálogo del hotel
  // (`armado_hoteles.categorias`/`regimenes`) la revalida
  // `cotizacionBernaloActions.ts`, no este archivo (este solo valida FORMA
  // del carrito, nunca pertenencia a un paquete real).
  const vCategoria = validarTextoAcotado(v.categoria, `${ctx}: la categoría`);
  if (!vCategoria.ok) return { ok: false, error: vCategoria.error };
  const vAlimentacion = validarTextoAcotado(v.alimentacion, `${ctx}: la alimentación`);
  if (!vAlimentacion.ok) return { ok: false, error: vAlimentacion.error };

  const vSalida = validarSalidaSeleccionadaBernalo(v.salida);
  if (!vSalida.ok) return { ok: false, error: `${ctx}: ${vSalida.error}` };

  // A1 (misma regla que `cotizacionBernaloActions.ts`): nunca `[0]`, nunca
  // se completa una salida ausente — si el objeto no la trae, es forma
  // inválida (ya cubierto arriba por `validarSalidaSeleccionadaBernalo`).
  const vHab = validarHabitacionesOcupacion(v.habitaciones);
  if (!vHab.ok) return { ok: false, error: `${ctx}: ${vHab.errores.map((e) => e.mensaje).join(" ")}` };
  if (vHab.habitaciones.length > MAX_HABITACIONES_CONSULTA) {
    return { ok: false, error: `${ctx}: no se pueden pedir más de ${MAX_HABITACIONES_CONSULTA} habitaciones.` };
  }

  return {
    ok: true,
    item: {
      modeloTarifario: "unidad",
      paqueteId: v.paqueteId, hotelId: v.hotelId, hotelNombre: vNombre.texto, destino,
      categoria: vCategoria.texto, alimentacion: vAlimentacion.texto,
      salida: vSalida.salida, habitaciones: vHab.habitaciones,
    },
  };
}

// ── Comparación de composiciones Bernalo (dedup — regla del encargo) ───────
// Dos ítems Bernalo son "la misma ocupación" solo si TODAS las decisiones
// coinciden exactamente: paquete, hotel, categoría, alimentación, salida
// (tipo+id, o tipo+fechas para "sin_vuelo") Y la composición COMPLETA de
// habitaciones (cada habitación física: id, acomodación, adultos, edades de
// SUS menores — nunca solo un conteo agregado, que colapsaría dos
// ocupaciones reales distintas en una sola). Puro: no decide política de
// carrito (si se fusiona o no) — eso es un consumidor futuro (3F-2+); hoy
// NADA llama a estas funciones desde `CartContext.tsx` (regla del encargo:
// la política actual — agregar siempre una línea nueva — sigue intacta).
function claveSalidaBernalo(s: SalidaSeleccionadaBernaloEntrada): string {
  if (s.tipo === "sin_vuelo") return `sin_vuelo:${s.fechaIda}:${s.fechaRegreso}`;
  return `${s.tipo}:${s.id}`;
}

// Las edades DENTRO de una misma habitación se normalizan (orden ascendente)
// para la clave: la Fase 3D no le da significado al ORDEN en que se
// escribieron ("menor 1"/"menor 2" son solo posiciones de captura, nunca
// identidades) — dos habitaciones con los mismos menores en otro orden son
// la MISMA ocupación real. El id/acomodación/adultos de la habitación SÍ se
// comparan tal cual (nunca se normalizan entre habitaciones distintas).
function claveHabitacionBernalo(h: HabitacionOcupacionValidada): string {
  const edadesOrdenadas = [...h.edadesMenores].sort((a, b) => a - b);
  return `${h.id}|${h.acom}|${h.adultos}|${edadesOrdenadas.join(",")}`;
}

// El arreglo de habitaciones se ordena por su propia clave (no por el orden
// de inserción) antes de unirse: dos ítems con las MISMAS habitaciones pero
// en distinto orden de arreglo deben comparar igual; dos ítems con
// habitaciones realmente distintas (aunque sea solo una edad distinta en una
// sola habitación) nunca pueden colisionar.
function claveOcupacionBernalo(habitaciones: HabitacionOcupacionValidada[]): string {
  return habitaciones.map(claveHabitacionBernalo).sort().join(";");
}

/** Decisiones que identifican una ocupación Bernalo — subconjunto compartido por el ítem del carrito y el ítem ya validado. */
export type DecisionesOcupacionBernalo = {
  paqueteId: number;
  hotelId: number;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionValidada[];
};

/** Clave canónica de una ocupación Bernalo completa — misma clave ⇔ misma composición real. */
export function claveOcupacionCompletaBernalo(d: DecisionesOcupacionBernalo): string {
  return [d.paqueteId, d.hotelId, d.categoria, d.alimentacion, claveSalidaBernalo(d.salida), claveOcupacionBernalo(d.habitaciones)].join("|");
}

/** `true` solo si TODAS las decisiones (salida + composición completa de habitaciones) coinciden. */
export function mismaOcupacionBernalo(a: DecisionesOcupacionBernalo, b: DecisionesOcupacionBernalo): boolean {
  return claveOcupacionCompletaBernalo(a) === claveOcupacionCompletaBernalo(b);
}

// ── Ítem del carrito — unión discriminada real (persona | Bernalo) ─────────
// `SolicitudItemValidado` (persona) nunca gana campos nuevos: el marcador
// `modeloTarifario?: undefined` (agregado en `edadesMenores.ts`) es SOLO
// para que TypeScript pueda discriminar la unión por una propiedad común —
// en runtime nunca se escribe (JSON.stringify descarta claves `undefined`),
// así que un ítem persona serializado es BYTE A BYTE el mismo JSON de
// siempre.
export type SolicitudItemVariante = SolicitudItemValidado | SolicitudItemBernaloValidado;

function validarItemVariante(v: unknown, indice: number): { ok: true; item: SolicitudItemVariante } | { ok: false; error: string } {
  if (esObjetoPlano(v) && v.modeloTarifario === "unidad") return validarSolicitudItemBernalo(v, indice);
  return validarSolicitudItem(v, indice);
}

// ── Frontera completa del carrito público (movida desde `edadesMenores.ts`,
// ver el porqué en el encabezado del archivo) ───────────────────────────────
export type CrearSolicitudInputValidado = {
  items: SolicitudItemVariante[];
  tours: SolicitudTourValidado[];
  cliente: SolicitudClienteValidado;
  modo?: "comisionable" | "neta";
};

export function validarCrearSolicitudInput(v: unknown): { ok: true; input: CrearSolicitudInputValidado } | { ok: false; error: string } {
  if (!esObjetoPlano(v)) return { ok: false, error: "La solicitud no tiene una forma válida." };
  if (!Array.isArray(v.items)) return { ok: false, error: "El carrito de hoteles debe ser un arreglo." };
  if (v.items.length > MAX_ITEMS_CARRITO) return { ok: false, error: `No se pueden cotizar más de ${MAX_ITEMS_CARRITO} hoteles a la vez.` };
  const toursRaw = v.tours;
  if (toursRaw !== undefined && !Array.isArray(toursRaw)) return { ok: false, error: "El carrito de servicios debe ser un arreglo." };
  const toursLen = Array.isArray(toursRaw) ? toursRaw.length : 0;
  if (toursLen > MAX_TOURS_CARRITO) return { ok: false, error: `No se pueden cotizar más de ${MAX_TOURS_CARRITO} servicios a la vez.` };
  if (v.items.length + toursLen > MAX_LINEAS_CARRITO) {
    return { ok: false, error: `No se pueden cotizar más de ${MAX_LINEAS_CARRITO} líneas (hoteles + servicios) a la vez.` };
  }

  const items: SolicitudItemVariante[] = [];
  for (let i = 0; i < v.items.length; i++) {
    const r = validarItemVariante(v.items[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    items.push(r.item);
  }
  const tours: SolicitudTourValidado[] = [];
  if (Array.isArray(toursRaw)) {
    for (let i = 0; i < toursRaw.length; i++) {
      const r = validarTourInput(toursRaw[i], i);
      if (!r.ok) return { ok: false, error: r.error };
      tours.push(r.tour);
    }
  }
  const vCliente = validarClienteInput(v.cliente);
  if (!vCliente.ok) return { ok: false, error: vCliente.error };

  // `modo` (comisionable/neta) — misma nota que la versión anterior de esta
  // función en `edadesMenores.ts`: se valida la FORMA acá, pero solo tiene
  // efecto si `crearSolicitudReserva` confirma `esB2B` server-side.
  let modo: "comisionable" | "neta" | undefined;
  if (v.modo !== undefined) {
    if (v.modo !== "comisionable" && v.modo !== "neta") return { ok: false, error: "La modalidad de compra es inválida." };
    modo = v.modo;
  }
  return { ok: true, input: { items, tours, cliente: vCliente.cliente, modo } };
}
