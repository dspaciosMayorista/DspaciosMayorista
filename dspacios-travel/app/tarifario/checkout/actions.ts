"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computarReserva, type ReservaInput } from "@/lib/reservar/computo";
import { computarReservaBernalo, type SalidaResueltaBernalo } from "@/lib/reservar/computoReservaBernalo";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { formatMoneda } from "@/lib/utils";
import { comisionDefault } from "@/lib/b2b";
import {
  resolverB2BParaMensaje, resolverContextoB2B,
  respuestaPublicaInsertCotizacion, formatearLogInsertCotizacion,
  type SolicitudItemValidado, type SolicitudTourValidado,
} from "@/lib/reservar/edadesMenores";
import {
  validarCrearSolicitudInput,
  type SolicitudItemVariante,
  type SalidaSeleccionadaBernaloEntrada,
} from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { HabitacionOcupacionEntrada, HabitacionOcupacionValidada } from "@/lib/reservar/ocupacionPorHabitacion";
import { liquidarServicioPuntual } from "@/lib/reservar/cotizar";
import { resumirServiciosContrato, type CategoriaServicio, type ServicioEfectivo } from "@/lib/reservar/serviciosPaquete";
import { hoyBogota, resolverVigenciaCotizacion } from "@/lib/cotizacion/vigencia";
import type { ComposicionBernaloDocumento } from "@/lib/reservar/alojamientoBernaloDocumento";
import type { Json } from "@/types/database";

// Forma que arma el CARRITO en el cliente (ver lib/cart/CartContext.tsx) —
// incluye `ninos`/`ninos2`/`infantes`/`pax`/`precio` para la vista previa en
// el navegador (carrito, resumen antes de enviar), pero NADA de esto se
// confía en el servidor: `crearSolicitudReserva` recibe el ítem como
// `unknown`, lo revalida con `validarSolicitudItem` (que ni siquiera lee
// estos 5 campos) y el precio/pax/ninos/ninos2/infantes reales SIEMPRE salen
// de `computarReserva` — nunca de lo que mande el navegador.
export type SolicitudItemPersona = {
  modeloTarifario?: undefined;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  regimen: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  habitaciones: Record<string, number>;
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
  // Edad exacta de cada menor tal como se pidió en Vista Booking — ver
  // lib/reservar/edadesMenores.ts. Obligatoria en este flujo público
  // (`validarSolicitudItem` rechaza el ítem si falta): nunca cae al reparto
  // legado ninos/ninos2/infantes de arriba.
  edadesMenores?: number[];
};

// Ítem Bernalo del carrito (Fase 3F-1, `hoteles.modelo_tarifario = "unidad"`)
// — SOLO decisiones del usuario, mismo criterio que `HotelCartItemBernalo`
// (lib/cart/CartContext.tsx): nunca neto/bruto/comisión/snapshot/payload/
// costos/markup. `precio`/`moneda` son presentación, nunca autoridad —
// `validarSolicitudItemBernalo` (lib/reservar/solicitudAlojamientoBernalo.ts)
// ni siquiera los lee.
// `itemId` (cierre 3F-4A #1) es el `id` estable que el carrito ya asignó al
// ítem (`HotelCartItemBernalo.id`) — viaja SOLO para correlación: permite que
// un `precio_actualizado` señale exactamente cuál ítem cambió, incluso si el
// carrito tiene dos ítems del mismo paquete/hotel con ocupaciones distintas.
// Nunca se usa para autorizar ni para calcular nada.
export type SolicitudItemBernalo = {
  modeloTarifario: "unidad";
  itemId: string;
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionEntrada[];
  precio: number;
  moneda: string | null;
};

export type SolicitudItem = SolicitudItemPersona | SolicitudItemBernalo;

// Ítem YA validado (`validarSolicitudItem`) + los valores REALES que arrojó
// `computarReserva` para ese ítem — es lo único que se usa para el resumen
// visible al asesor/cliente (mensaje de WhatsApp/email, snapshot de la
// cotización). Nunca se construye a partir del `SolicitudItem` crudo del
// carrito.
type SolicitudItemComputado = SolicitudItemValidado & {
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
};

// Ítem Bernalo YA re-liquidado con `computarReservaBernalo` — SOLO decisiones
// + PVP/moneda/pax autoritativos (regla C.12/13 de Fase 3F-4A). Deliberadamente
// SIN `resultado`/`snapshot` por habitación (netos, comisión, fuente,
// proveedor): eso vive en `ComputoReservaBernaloOk.habitaciones[].resultado/
// .snapshot` y NUNCA debe llegar a este objeto — lo único que se conserva de
// cada habitación es su ocupación de ENTRADA (`HabitacionOcupacionValidada`,
// ya sin dinero).
type SolicitudItemBernaloComputado = {
  modeloTarifario: "unidad";
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  alimentacion: string;
  salida: SalidaResueltaBernalo;
  habitaciones: HabitacionOcupacionValidada[];
  pax: number;
  precio: number;
};

// Tour/servicio agregado al carrito — entra a la MISMA cotización combinada
// que los hoteles del carrito (ver crearCotizacionCarrito), como una línea
// más de "Servicios adicionales". `servicioId`/`paqueteId` (ver
// lib/cart/CartContext.tsx → TourCartItem, siempre los trae desde que
// BuscadorReceptivos es el único lugar que arma este ítem) son la ÚNICA
// forma de re-liquidar el precio real en el servidor — `nombre`/`precio`/
// `moneda`/`destino` que manda el navegador NUNCA se usan para calcular ni
// para persistir: son solo lo que el cliente cree que agregó, y se
// descartan por completo en cuanto se re-liquida (ver `validarTourInput`).
export type SolicitudTour = {
  servicioId: number | null; paqueteId: number;
  nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null;
  pax: number; precio: number; moneda: string;
};

// Ítem YA re-liquidado en servidor (`liquidarServicioPuntual`, misma fórmula
// que `buscarReceptivos`) — lo único que se usa para mensaje/snapshot.
type SolicitudTourComputado = {
  servicioId: number; paqueteId: number;
  nombre: string; destino: string | null; descripcion: string | null;
  fechaIda: string; fechaRegreso: string; noches: number;
  pax: number; precio: number; moneda: string;
  categoria: CategoriaServicio;
};

export type SolicitudCliente = { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };

// Datos de facturación (contrato neto): normalmente la agencia.
export type Facturacion = { nombre: string; nit: string; email: string; telefono: string };

export type ContextoB2B = {
  esB2B: boolean;
  tipo: "agencia" | "freelance" | null;
  agencia: Facturacion | null;
  pctComision: number; // fracción (0.10)
  categoria: string | null; // "Agencia Junior" / "Agencia Senior" / ...
};

// Contexto del aliado logueado (para el checkout B2B): tipo, datos de
// facturación de la agencia y su % de comisión.
//
// FALLA CERRADO (ronda 4): esta función solo consulta — TODA la decisión
// (usuario activo, agencia titular activa y con rol B2B válido, comisión en
// rango) vive en `resolverContextoB2B` (lib/reservar/edadesMenores.ts,
// módulo puro, testeable con node --test sin tocar Supabase). Defecto real
// corregido: antes ni el usuario logueado ni la agencia titular se
// verificaban contra `usuarios.activo` — un aliado B2B desactivado por un
// administrador seguía viendo la sección B2B del checkout (facturación neta,
// % de comisión) hasta que expirara su sesión.
export async function getContextoB2B(): Promise<ContextoB2B> {
  const DEFAULT: ContextoB2B = { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };
  const sb = await createClient();
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) return DEFAULT;

  const { data: perfil, error: perfilErr } = await sb
    .from("usuarios").select("nombre, email, rol, agencia_id, pct_comision, activo").eq("id", user.id).maybeSingle();
  if (perfilErr) return DEFAULT;

  // El default general de comisión (parámetro tributario) hace falta para
  // decidir la categoría (Junior/Senior) y como fallback si `pct_comision`
  // del usuario está vacío — se consulta con el rol crudo (si no es
  // "agencia"/"freelance", `comisionDefault` ya cae a un default razonable;
  // `resolverContextoB2B` de todas formas rechaza cualquier rol inválido).
  const def = await comisionDefault(sb, perfil?.rol ?? "");

  let agenciaTitular: { nombre: string | null; email: string | null; rol: string | null; pct_comision: number | null; activo: boolean | null } | null = null;
  let agenciaTitularErr = false;
  const agenciaId: string | null = perfil?.agencia_id ?? null;
  if (agenciaId) {
    const { data: ap, error: apErr } = await sb
      .from("usuarios").select("nombre, email, rol, pct_comision, activo").eq("id", agenciaId).maybeSingle();
    agenciaTitular = ap ?? null;
    agenciaTitularErr = !!apErr;
  }

  const agenciaUserId = agenciaId ?? user.id;
  const { data: sols, error: solsErr } = await sb
    .from("b2b_solicitudes")
    .select("nombre, nit, email, telefono")
    .eq("usuario_id", agenciaUserId)
    .order("created_at", { ascending: false })
    .limit(1);

  const r = resolverContextoB2B({
    usuarioAutenticado: true,
    perfil: perfil ?? null, perfilError: !!perfilErr,
    agenciaId, agenciaTitular, agenciaTitularError: agenciaTitularErr,
    solicitud: sols?.[0] ?? null, solicitudError: !!solsErr,
    pctComisionDefault: def,
  });
  if (!r.esB2B) return DEFAULT;
  return { esB2B: true, tipo: r.tipo, agencia: r.agencia, pctComision: r.pctComision, categoria: r.categoria };
}

// Portada actual por hotel (para resolver la foto de ítems del carrito que se
// guardaron sin fotoUrl). hotel_fotos es lectura pública.
export async function fotosPortada(hotelIds: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (!hotelIds.length) return out;
  const sb = await createClient();
  const { data } = await sb.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", hotelIds).order("orden");
  for (const f of data ?? []) {
    if (out[f.hotel_id] == null) out[f.hotel_id] = f.url;
    if (f.es_portada) out[f.hotel_id] = f.url;
  }
  return out;
}

// Fase 3F-4A, regla B.10: cuando el PVP/moneda AUTORITATIVOS de un ítem
// Bernalo ya no coinciden con lo que el carrito mostraba, el checkout NUNCA
// crea la cotización — devuelve este resultado estructurado en su lugar, con
// SOLO el nuevo PVP/moneda públicos (nunca netos/costos/comisión/snapshot).
// El cliente debe actualizar el ítem visible y reintentar — el reintento
// vuelve a pasar por el MISMO recálculo completo (regla B.11: "nunca acepta
// el precio solo porque coincide con el cliente" — no existe un modo
// "confía en esto", solo repetición de la misma verificación autoritativa).
export type ResultadoPrecioActualizadoBernalo = {
  ok: false;
  tipo: "precio_actualizado";
  // Cierre 3F-4A #1: identifica el ítem EXACTO del carrito (no
  // paqueteId+hotelId, que puede repetirse entre dos ítems con ocupaciones
  // distintas) — la UI actualiza este ítem y solo este.
  itemId: string;
  paqueteId: number;
  hotelId: number;
  pvp: number;
  moneda: string;
  mensaje: string;
};

export type SolicitudResult =
  | { ok: true; cotizacion: { id: number; codigo: string; url: string }; waUrl: string | null; mailtoUrl: string | null; mensaje: string }
  | { ok: false; error: string }
  | ResultadoPrecioActualizadoBernalo;

// ── Snapshot público de vuelo — compartido entre persona (bloqueo) y Bernalo
// (bloqueo/empaquetado, Fase 3F-4A cierre #3). `bloqueos_vuelo` y
// `empaquetados` tienen EXACTAMENTE las mismas columnas de vuelo (mismo
// select de siempre) — un solo constructor arma los 1-2 tramos (ida +
// regreso si aplica) con la MISMA forma pública que ya renderiza
// `ContratoDocumento`. Nunca expone tarifa/costo (esas columnas ni siquiera
// se seleccionan en `CAMPOS_VUELO_SNAP`).
const CAMPOS_VUELO_SNAP = "aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg";

type FilaVueloSnap = {
  aerolinea: string | null; record: string | null; ruta: string | null;
  fecha_ida: string | null; fecha_regreso: string | null;
  vuelo_ida: string | null; vuelo_regreso: string | null;
  hora_salida_ida: string | null; hora_llegada_ida: string | null;
  hora_salida_reg: string | null; hora_llegada_reg: string | null;
};

function construirTramosVueloSnap(bq: FilaVueloSnap): Record<string, unknown>[] {
  const r = parseRuta(bq.ruta);
  const tramos: Record<string, unknown>[] = [{
    aerolinea: bq.aerolinea, record: bq.record, direccion: "ida",
    origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
    destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
    numero_vuelo: bq.vuelo_ida, hora_salida: bq.hora_salida_ida, hora_llegada: bq.hora_llegada_ida,
    fecha_salida: bq.fecha_ida,
  }];
  if (bq.fecha_regreso || bq.vuelo_regreso) {
    tramos.push({
      aerolinea: bq.aerolinea, record: bq.record, direccion: "regreso",
      origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino),
      destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
      numero_vuelo: bq.vuelo_regreso, hora_salida: bq.hora_salida_reg, hora_llegada: bq.hora_llegada_reg,
      fecha_salida: bq.fecha_regreso,
    });
  }
  return tramos;
}

function resumenHab(it: SolicitudItemComputado): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  if (it.infantes > 0) partes.push(`${it.infantes} Infante(s)`);
  return partes.join(", ");
}

// Bernalo no tiene conteo por acomodación (regla A.2: habitaciones FÍSICAS
// con adultos/edades propias, no columnas persona/nino/nino2/infante) — el
// resumen de texto solo cuenta habitaciones y menores, nunca inventa una
// clasificación que este modelo no tiene.
function resumenHabBernalo(it: SolicitudItemBernaloComputado): string {
  const totalMenores = it.habitaciones.reduce((s, h) => s + h.edadesMenores.length, 0);
  const partes = [`${it.habitaciones.length} habitación(es)`];
  if (totalMenores > 0) partes.push(`${totalMenores} menor(es)`);
  return partes.join(", ");
}

function construirMensaje(
  cliente: SolicitudCliente,
  cot: { codigo: string; url: string },
  items: SolicitudItemComputado[],
  tours: SolicitudTourComputado[],
  moneda: string,
  extra: string | null,
  b2b?: { modo: "comisionable" | "neta"; facturacion: Facturacion; pctComision: number },
  itemsBernalo: SolicitudItemBernaloComputado[] = [],
): string {
  const L: string[] = [];
  L.push("Solicitud de reserva — D'spacios Travel");
  L.push("");
  if (b2b) L.push(`Modalidad: ${b2b.modo === "neta" ? "CONTRATO NETO" : "CONTRATO COMISIONABLE"}`);
  L.push(`${b2b?.modo === "neta" ? "Titular / pasajero" : "Cliente"}: ${`${cliente.nombres} ${cliente.apellidos}`.trim()}`);
  const contacto = [cliente.telefono, cliente.email].map((x) => x?.trim()).filter(Boolean).join(" · ");
  if (contacto) L.push(`Contacto: ${contacto}`);
  if (cliente.numeroDoc?.trim()) L.push(`Documento: ${cliente.numeroDoc.trim()}`);
  if (b2b?.modo === "neta" && b2b.facturacion.nombre) {
    L.push("");
    L.push(`Facturar a: ${b2b.facturacion.nombre}${b2b.facturacion.nit ? ` · NIT ${b2b.facturacion.nit}` : ""}`);
    const fc = [b2b.facturacion.telefono, b2b.facturacion.email].map((x) => x?.trim()).filter(Boolean).join(" · ");
    if (fc) L.push(`   ${fc}`);
  }
  L.push("");
  let total = 0;
  items.forEach((it, i) => {
    total += it.precio;
    L.push(`${i + 1}) ${it.hotelNombre}${it.destino ? ` — ${it.destino}` : ""}`);
    if (it.fechaIda) L.push(`   ${it.fechaIda} → ${it.fechaRegreso ?? ""}${it.noches ? ` (${it.noches} noches)` : ""}`);
    L.push(`   ${it.categoria} / ${it.regimen} · ${resumenHab(it)}`);
    L.push(`   ${it.pax} pax · Valor estimado: ${formatMoneda(it.precio, moneda)}`);
    L.push("");
  });
  itemsBernalo.forEach((it, i) => {
    total += it.precio;
    L.push(`${items.length + i + 1}) ${it.hotelNombre}${it.destino ? ` — ${it.destino}` : ""}`);
    L.push(`   ${it.salida.fechaIda} → ${it.salida.fechaRegreso}`);
    L.push(`   ${it.categoria} / ${it.alimentacion} · ${resumenHabBernalo(it)}`);
    L.push(`   ${it.pax} pax · Valor estimado: ${formatMoneda(it.precio, moneda)}`);
    L.push("");
  });
  if (tours.length) {
    L.push("Servicios / tours adicionales:");
    for (const t of tours) {
      L.push(`- ${t.nombre}${t.destino ? ` — ${t.destino}` : ""}`);
      if (t.fechaIda) L.push(`   ${t.fechaIda} → ${t.fechaRegreso ?? ""}`);
      L.push(`   ${t.pax} pax · Valor estimado: ${formatMoneda(t.precio, moneda)}`);
      total += t.precio;
    }
    L.push("");
  }
  L.push(`Total (PVP): ${formatMoneda(total, moneda)}`);
  if (b2b?.modo === "neta") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión (${Math.round((b2b.pctComision || 0) * 100)}%): −${formatMoneda(comision, moneda)}`);
    L.push(`TOTAL NETO a pagar: ${formatMoneda(total - comision, moneda)}`);
  } else if (b2b?.modo === "comisionable") {
    const comision = Math.round(total * (b2b.pctComision || 0));
    L.push(`Comisión a liquidar (${Math.round((b2b.pctComision || 0) * 100)}%): ${formatMoneda(comision, moneda)}`);
  }
  L.push("");
  L.push(`Cotización: ${cot.codigo}`);
  if (cot.url) L.push(`Documento: ${cot.url}`);
  if (extra?.trim()) { L.push(""); L.push(extra.trim()); }
  return L.join("\n");
}

// Genera UNA sola cotización combinada para todo el carrito (hoteles + tours):
// re-liquida cada hotel con el motor autoritativo (computarReserva, mismo
// precio que usaría un contrato) y arma un solo snapshot {venta, hoteles,
// vuelos, items} — el mismo formato que ya renderiza ContratoDocumento, así
// que /cot/[token] y /cotizacion/[id] la muestran sin cambios. Si el carrito
// mezcla monedas (raro: un hotel/tour en USD junto a otros en COP), los ítems
// de la moneda minoritaria quedan FUERA de esta cotización (se listan en
// `excluidos` para avisar) — evita totales mezclando pesos y dólares.
// Un ítem excluido siempre trae SU motivo real — nunca se resume todo el
// arreglo bajo un solo texto genérico ("otra moneda") aunque la causa real
// haya sido que el servicio no estaba disponible (defecto real corregido,
// ronda 4: `notaExcluidos` en `crearSolicitudReserva` decía "por estar en
// otra moneda" para CUALQUIER exclusión, incl. tours simplemente no
// disponibles para esas fechas/pax).
export type ItemExcluido = { etiqueta: string; motivo: "moneda" | "no_disponible" };

async function crearCotizacionCarrito(input: {
  items: SolicitudItemVariante[];
  tours: SolicitudTourValidado[];
  cliente: SolicitudCliente;
}): Promise<
  | { ok: true; id: number; codigo: string; url: string; moneda: string; itemsOk: SolicitudItemComputado[]; itemsBernaloOk: SolicitudItemBernaloComputado[]; toursOk: SolicitudTourComputado[]; excluidos: ItemExcluido[] }
  | { ok: false; error: string }
  | ResultadoPrecioActualizadoBernalo
> {
  const sb = await createClient();
  const clienteNombre = `${input.cliente.nombres} ${input.cliente.apellidos}`.trim();
  if (!clienteNombre) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const hoy = hoyBogota();
  const hotelesSnap: Record<string, unknown>[] = [];
  const vuelosSnap: Record<string, unknown>[] = [];
  const itemsSnap: Record<string, unknown>[] = [];
  // Detalle por habitación de los hoteles Bernalo del carrito — SOLO datos
  // no sensibles (mismo criterio que `habitacionesBernaloDeContrato`, la
  // función que lee esto ya convertido a contrato desde
  // `contrato_alojamiento_bernalo`): nunca neto/bruto/comisión/fuente. Antes
  // de convertir, esta cotización todavía no tiene filas en esa tabla —
  // este snapshot es la única forma de mostrar el mismo detalle por
  // habitación en el documento previo.
  const habitacionesBernaloSnap: Record<string, unknown>[] = [];
  const composicionBernaloSnap: ComposicionBernaloDocumento[] = [];
  const itemsOk: SolicitudItemComputado[] = [];
  const itemsBernaloOk: SolicitudItemBernaloComputado[] = [];
  const toursOk: SolicitudTourComputado[] = [];
  // Servicios INCLUIDOS de cada paquete de hotel del carrito — acumulados
  // acá para el resumen (asistencia/tours) y el snapshot que
  // `convertirCotizacionCarrito` reutiliza al crear la CxP del proveedor
  // real (nunca se vuelven a sumar al precio: ya vienen horneados en
  // `precioVenta` desde `computarReserva`).
  const incluidosSnap: ServicioEfectivo[] = [];
  const excluidos: ItemExcluido[] = [];
  let monedaPrincipal: string | null = null;
  let total = 0;
  let hIdx = 0, vIdx = 0, iIdx = 0;

  for (const it of input.items) {
    // Fase 3F-4A: el ítem Bernalo se re-liquida DIRECTO con el servicio
    // interno autoritativo (`computarReservaBernalo`, Fase 3F-3) — el MISMO
    // que usa la cotización pública en vivo (`cotizarAlojamientoBernaloPublico`),
    // nunca una segunda implementación del cálculo (regla D.17). `computarReserva`
    // (persona) ni su guardia de Fase 3 se tocan para este ítem.
    if (it.modeloTarifario === "unidad") {
      const resultadoBernalo = await computarReservaBernalo({
        paqueteId: it.paqueteId,
        hotelId: it.hotelId,
        categoria: it.categoria,
        alimentacion: it.alimentacion,
        salida: it.salida,
        habitaciones: it.habitaciones,
      });
      if (!resultadoBernalo.ok) {
        // Regla D.18: tarifa/salida ya no vigente ⇒ bloquea, nunca crea
        // cotización — mismo criterio fail-closed que el resto del archivo
        // (ver `comp.ok` de persona más abajo).
        return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: ${resultadoBernalo.mensaje}` };
      }

      // Regla B.9/B.10/B.11: el resultado del SERVIDOR reemplaza cualquier
      // precio que haya mandado el navegador. Si el PVP/moneda autoritativos
      // ya no coinciden con lo que el carrito mostraba (`precioDeclarado`/
      // `monedaDeclarada` — Fase 3F-4A, `solicitudAlojamientoBernalo.ts`),
      // NUNCA se crea la cotización: se corta acá mismo y se devuelve el
      // nuevo precio público para que el cliente confirme de nuevo. No hay
      // un modo "confía en esto": el PRÓXIMO intento vuelve a pasar por este
      // mismo bloque y se recalcula de cero (regla B.11).
      if (resultadoBernalo.precioVenta !== it.precioDeclarado || resultadoBernalo.moneda !== it.monedaDeclarada) {
        return {
          ok: false,
          tipo: "precio_actualizado",
          // Cierre 3F-4A #1: `itemId` (el `id` del ítem del carrito, nunca
          // paqueteId+hotelId) para que la UI actualice EXACTAMENTE ese
          // ítem — dos ítems del mismo paquete/hotel con ocupaciones
          // distintas nunca se confunden entre sí.
          itemId: it.itemId,
          paqueteId: it.paqueteId,
          hotelId: it.hotelId,
          pvp: resultadoBernalo.precioVenta,
          moneda: resultadoBernalo.moneda,
          mensaje: `El precio de ${it.hotelNombre} cambió a ${formatMoneda(resultadoBernalo.precioVenta, resultadoBernalo.moneda)}. Confirma de nuevo para continuar.`,
        };
      }

      if (monedaPrincipal && resultadoBernalo.moneda !== monedaPrincipal) {
        excluidos.push({ etiqueta: `${it.hotelNombre} (moneda ${resultadoBernalo.moneda})`, motivo: "moneda" });
        continue;
      }
      monedaPrincipal = monedaPrincipal ?? resultadoBernalo.moneda;

      // Regla C.13: SOLO la ocupación de ENTRADA de cada habitación (nunca
      // `.resultado`/`.snapshot`, que traen netos/comisión/fuente/tarifa) —
      // ver `SolicitudItemBernaloComputado`.
      const habitacionesSnap = resultadoBernalo.habitaciones.map((h) => h.ocupacion);
      // Cierre 3F-4A #2: destino AUTORITATIVO (`resultadoBernalo.hotelDestino`,
      // resuelto server-side contra `armado_paquetes.destino_id -> destinos`
      // dentro de `computarReservaBernalo`) — NUNCA `it.destino` (texto libre
      // del carrito, sin validar contra nada real).
      const destinoAutoritativo = resultadoBernalo.hotelDestino;

      hIdx++;
      hotelesSnap.push({
        id: hIdx, nombre: resultadoBernalo.hotelNombre, categoria: it.categoria, ciudad: destinoAutoritativo,
        proveedor: null, alimentacion: it.alimentacion, acomodacion: it.categoria,
        detalle_acomodacion: `${habitacionesSnap.length} habitación(es)`,
        fecha_ingreso: resultadoBernalo.salida.fechaIda, fecha_salida: resultadoBernalo.salida.fechaRegreso,
        nota_regimen: null, foto_url: null,
      });
      // Bernalo se cobra por unidad (pareja/habitación/apartamento/persona
      // según la tarifa capturada), así que el documento previo NO inventa
      // una tarifa adulto/niño dividiendo el PVP. La tabla per-cápita queda
      // para hoteles persona; Bernalo viaja como línea total + composición.
      iIdx++;
      itemsSnap.push({
        id: iIdx,
        descripcion: `${resultadoBernalo.hotelNombre}${destinoAutoritativo ? ` — ${destinoAutoritativo}` : ""} · ${it.categoria} / ${it.alimentacion} · ${habitacionesSnap.length} habitación(es), ${resultadoBernalo.paxTotal} viajero(s)`,
        adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,
        modo_precio: "total", valor_total: resultadoBernalo.precioVenta,
      });
      resultadoBernalo.habitaciones.forEach((hComp, idx) => {
        const h = hComp.ocupacion;
        habitacionesBernaloSnap.push({
          habitacionId: h.id,
          orden: idx,
          hotelNombre: resultadoBernalo.hotelNombre,
          categoria: it.categoria,
          alimentacion: it.alimentacion,
          adultos: h.adultos,
          edadesMenores: h.edadesMenores,
        });
        for (const linea of hComp.resultado.desglose) {
          composicionBernaloSnap.push({
            habitacionId: h.id,
            orden: idx,
            hotelNombre: resultadoBernalo.hotelNombre,
            concepto: linea.concepto,
            cantidad: linea.cantidad,
            valorUnitario: linea.valorUnitario,
            valorTotal: linea.valorTotal,
            periodicidad: linea.periodicidad,
          });
        }
      });

      // Cierre 3F-4A #3: `vuelosSnap` público con la MISMA forma que persona
      // (`construirTramosVueloSnap`, arriba) — SOLO para bloqueo/empaquetado,
      // y SIEMPRE sobre `resultadoBernalo.salida` (la salida RESUELTA por el
      // servicio interno, confirmada perteneciente al paquete real — nunca
      // `it.salida`, que es la elección cruda del navegador). "sin_vuelo"
      // nunca genera un tramo — no hay vuelo que inventar.
      if (resultadoBernalo.salida.tipo === "bloqueo" || resultadoBernalo.salida.tipo === "empaquetado") {
        const tabla = resultadoBernalo.salida.tipo === "bloqueo" ? "bloqueos_vuelo" : "empaquetados";
        const { data: bq } = await sb
          .from(tabla)
          .select(CAMPOS_VUELO_SNAP)
          .eq("id", resultadoBernalo.salida.id)
          .maybeSingle();
        if (bq) {
          for (const tramo of construirTramosVueloSnap(bq)) { vIdx++; vuelosSnap.push({ id: vIdx, ...tramo }); }
        }
      }

      total += resultadoBernalo.precioVenta;
      itemsBernaloOk.push({
        modeloTarifario: "unidad",
        paqueteId: it.paqueteId, hotelId: it.hotelId, hotelNombre: resultadoBernalo.hotelNombre, destino: destinoAutoritativo,
        categoria: it.categoria, alimentacion: it.alimentacion,
        salida: resultadoBernalo.salida, habitaciones: habitacionesSnap,
        pax: resultadoBernalo.paxTotal, precio: resultadoBernalo.precioVenta,
      });
      continue;
    }

    const reserva: ReservaInput = {
      paqueteId: it.paqueteId,
      bloqueoId: it.bloqueoId,
      modulo: it.modulo,
      hotelId: it.hotelId,
      fechaIda: it.modulo !== "bloqueo" ? (it.fechaIda ?? undefined) : undefined,
      fechaRegreso: it.modulo !== "bloqueo" ? (it.fechaRegreso ?? undefined) : undefined,
      categoria: it.categoria,
      regimen: it.regimen,
      habitaciones: it.habitaciones,
      // `it` ya pasó por `validarSolicitudItem`: `edadesMenores` SIEMPRE viene
      // presente (arreglo, posiblemente vacío) en este flujo público — nunca
      // `undefined`, así que `computarReserva` nunca cae al reparto legado
      // ninos/ninos2/infantes. Esos 3 quedan en 0: es la única fuente de
      // verdad la edad real, reclasificada por hotel más abajo.
      ninos: 0, ninos2: 0, infantes: 0,
      edadesMenores: it.edadesMenores,
      cantidadMenores: it.cantidadMenores,
      cliente: {
        nombres: input.cliente.nombres, apellidos: input.cliente.apellidos, tipoDoc: "CC",
        numeroDoc: input.cliente.numeroDoc, telefono: input.cliente.telefono, email: input.cliente.email,
      },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
      aliadoId: null, plazo: "", pasajeros: [], servicios: [],
    };
    const comp = await computarReserva(sb, reserva);
    if (!comp.ok) return { ok: false, error: `No se pudo cotizar ${it.hotelNombre}: ${comp.error}` };
    const { meta, precioVenta, monedaReserva, lineasHab, numNinos, numNinos2, numInfantes, totalPax, distribucionMenores, edadesMenoresUsadas, serviciosIncluidos } = comp.data;
    incluidosSnap.push(...serviciosIncluidos.map((s) => ({ ...s, paqueteId: it.paqueteId })));

    if (monedaPrincipal && monedaReserva !== monedaPrincipal) {
      excluidos.push({ etiqueta: `${it.hotelNombre} (moneda ${monedaReserva})`, motivo: "moneda" });
      continue;
    }
    monedaPrincipal = monedaPrincipal ?? monedaReserva;

    // Las edades usadas para clasificar infante/Niño 1/Niño 2 SIEMPRE deben
    // salir de `comp.data` (única fuente autoritativa, ver
    // `resolverMenoresPorEdad` en computo.ts) — en este flujo público
    // `edadesMenores` es obligatorio en el ítem de entrada, así que
    // `computarReserva` siempre reclasifica por edad y siempre debería
    // devolver un arreglo. Si por algún motivo no lo hace, es una
    // inconsistencia interna del servidor — nunca se completa en silencio
    // con `it.edadesMenores` (defecto real corregido, ronda 4: ese fallback
    // podía dejar en el snapshot/cotización una edad que NO fue la que en
    // realidad se usó para calcular el precio).
    if (edadesMenoresUsadas == null) {
      return { ok: false, error: `No se pudo confirmar la edad de los menores cotizados para ${it.hotelNombre} (inconsistencia interna del servidor) — inténtalo de nuevo.` };
    }
    const edadesMenoresConfirmadas = [...edadesMenoresUsadas]; // copia — nunca la referencia de comp.data

    let fotoUrl: string | null = null;
    const { data: fotos } = await sb.from("hotel_fotos").select("url, es_portada, orden").eq("hotel_id", it.hotelId).order("orden");
    for (const f of fotos ?? []) { if (fotoUrl == null) fotoUrl = f.url; if (f.es_portada) fotoUrl = f.url; }

    const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
    if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
    if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
    if (numInfantes > 0) partes.push(`${numInfantes} Infante(s)`);

    hIdx++;
    hotelesSnap.push({
      id: hIdx, nombre: meta.hotel_nombre ?? it.hotelNombre, categoria: it.categoria, ciudad: meta.destino_nombre ?? it.destino,
      proveedor: null, alimentacion: it.regimen, acomodacion: it.categoria, detalle_acomodacion: partes.join(", "),
      fecha_ingreso: meta.fecha_ida, fecha_salida: meta.fecha_regreso, nota_regimen: null, foto_url: fotoUrl,
      // Edad exacta de cada menor tal como se cotizó y clasificación/reparto
      // resultantes — todo autoritativo del servidor (`comp.data`), nunca lo
      // que haya mandado el navegador. `distribucion_menores` es la
      // asignación POR HABITACIÓN (quién paga Niño 1/Niño 2/infante en cada
      // una) — estructura estable de `distribuirPorHabitaciones()` (ver
      // lib/reservar/distribucionHabitaciones.ts), útil para auditar cómo se
      // llegó a `menores_clasificados` sin tener que recalcularlo.
      edades_menores: edadesMenoresConfirmadas,
      menores_clasificados: { infantes: numInfantes, nino: numNinos, nino2: numNinos2 },
      distribucion_menores: distribucionMenores,
    });

    if (it.modulo === "bloqueo" && it.bloqueoId) {
      const { data: bq } = await sb
        .from("bloqueos_vuelo")
        .select(CAMPOS_VUELO_SNAP)
        .eq("id", it.bloqueoId).maybeSingle();
      if (bq) {
        for (const tramo of construirTramosVueloSnap(bq)) { vIdx++; vuelosSnap.push({ id: vIdx, ...tramo }); }
      }
    }

    iIdx++;
    itemsSnap.push({
      id: iIdx,
      descripcion: `${meta.hotel_nombre ?? it.hotelNombre}${meta.destino_nombre ?? it.destino ? ` — ${meta.destino_nombre ?? it.destino}` : ""} · ${it.categoria} / ${it.regimen} · ${partes.join(", ")}`,
      adultos: 1, ninos: 0, tarifa_adulto: precioVenta, tarifa_nino: 0,
    });
    total += precioVenta;
    itemsOk.push({ ...it, edadesMenores: edadesMenoresConfirmadas, ninos: numNinos, ninos2: numNinos2, infantes: numInfantes, pax: totalPax, precio: precioVenta });
  }

  for (const t of input.tours) {
    // Re-liquida EN VIVO con la misma fórmula de `buscarReceptivos` — nunca
    // se usa nombre/precio/moneda/destino que haya mandado el navegador
    // (esos ni siquiera llegan hasta acá: `validarTourInput` no los lee).
    //
    // FALLO CERRADO (ronda 4): `liquidarServicioPuntual` ahora distingue tres
    // motivos de fallo (ver lib/reservar/liquidacionServicio.ts). Solo
    // "no_disponible" es un motivo legítimo de negocio para EXCLUIR el tour
    // y seguir con el resto del carrito — un "error_consulta" (Supabase
    // falló técnicamente) o una "configuracion_invalida" (el catálogo tiene
    // un dato incompleto/incoherente) aborta la cotización COMPLETA: nunca
    // se genera una cotización parcial a partir de un fallo técnico, y nunca
    // se cobra un tour con un modo/margen inventado por no encontrar su
    // configuración real.
    //
    // FRONTERA PÚBLICA (ronda 6): `liquidarServicioPuntual` ya devuelve la
    // respuesta SANEADA (`resultado.mensaje`, nunca el detalle técnico real
    // de Supabase — ese queda solo en el log del servidor, ver cotizar.ts).
    // Este bloque NUNCA debe leer un campo que no sea `.tipo`/`.codigo`/`.mensaje`.
    const resultado = await liquidarServicioPuntual(t);
    if (!resultado.ok) {
      if (resultado.tipo === "no_disponible") {
        excluidos.push({ etiqueta: `Servicio #${t.servicioId} (${resultado.mensaje})`, motivo: "no_disponible" });
        continue;
      }
      return { ok: false, error: `No se pudo cotizar el servicio #${t.servicioId}: ${resultado.mensaje}` };
    }
    const tMoneda = resultado.resultado.moneda || "COP";
    if (monedaPrincipal && tMoneda !== monedaPrincipal) {
      excluidos.push({ etiqueta: `${resultado.resultado.nombre} (moneda ${tMoneda})`, motivo: "moneda" });
      continue;
    }
    monedaPrincipal = monedaPrincipal ?? tMoneda;
    iIdx++;
    itemsSnap.push({
      id: iIdx,
      descripcion: `Servicio · ${resultado.resultado.nombre}${resultado.resultado.destino ? ` — ${resultado.resultado.destino}` : ""}`,
      adultos: 1, ninos: 0, tarifa_adulto: resultado.resultado.total, tarifa_nino: 0,
    });
    total += resultado.resultado.total;
    toursOk.push({
      servicioId: resultado.resultado.servicioId, paqueteId: resultado.resultado.paqueteId,
      nombre: resultado.resultado.nombre, destino: resultado.resultado.destino, descripcion: resultado.resultado.descripcion,
      fechaIda: t.fechaIda, fechaRegreso: t.fechaRegreso, noches: resultado.resultado.noches,
      pax: resultado.resultado.pax, precio: resultado.resultado.total, moneda: resultado.resultado.moneda,
      categoria: resultado.resultado.categoria,
    });
  }

  if (!itemsOk.length && !itemsBernaloOk.length && !toursOk.length) return { ok: false, error: "No se pudo generar la cotización (revisa disponibilidad)." };

  const totalHoteles = itemsOk.length + itemsBernaloOk.length;
  const moneda = monedaPrincipal ?? "COP";
  const destinos = [...new Set([...itemsOk.map((i) => i.destino), ...itemsBernaloOk.map((i) => i.destino)].filter((d): d is string => !!d))];
  const destinoTxt = destinos.length ? destinos.join(" · ") : null;
  const fechasIda = [...itemsOk.map((i) => i.fechaIda), ...itemsBernaloOk.map((i) => i.salida.fechaIda)].filter((f): f is string => !!f).sort();
  const fechasRegreso = [...itemsOk.map((i) => i.fechaRegreso), ...itemsBernaloOk.map((i) => i.salida.fechaRegreso)].filter((f): f is string => !!f).sort();
  const fechaIda = fechasIda[0] ?? null;
  const fechaRegreso = fechasRegreso.length ? fechasRegreso[fechasRegreso.length - 1] : null;
  const paxTotal = itemsOk.reduce((s, i) => s + (i.pax || 0), 0) + itemsBernaloOk.reduce((s, i) => s + (i.pax || 0), 0) || (toursOk[0]?.pax ?? 0);
  const planNombre: string | null = totalHoteles > 1
    ? `${totalHoteles} hoteles`
    : (itemsOk[0] ? `${itemsOk[0].categoria} · ${itemsOk[0].regimen}` : (itemsBernaloOk[0] ? `${itemsBernaloOk[0].categoria} · ${itemsBernaloOk[0].alimentacion}` : null));

  // Resumen ÚNICO (asistencia/tours) de servicios INCLUIDOS + opcionales
  // realmente seleccionados — misma fuente que reservarDesdeTarifarioInterno/
  // crearCotizacion (lib/reservar/serviciosPaquete.ts), deduplicado por
  // servicioId. Nunca clasifica una asistencia como tour ni inventa
  // categoría para un servicio "otro".
  const serviciosEfectivosSnap: ServicioEfectivo[] = [
    ...incluidosSnap,
    // `proveedorId: null` a propósito: el proveedor NUNCA viaja por el
    // snapshot público del carrito — quien crea la CxP lo vuelve a resolver
    // server-side contra el catálogo (ver convertirCotizacionCarrito).
    ...toursOk.map((t): ServicioEfectivo => ({ servicioId: t.servicioId, nombre: t.nombre, categoria: t.categoria, incluido: false, costoNeto: 0, proveedorId: null })),
  ];
  const resumenServicios = resumirServiciosContrato(serviciosEfectivosSnap);

  const ventaSnap: Record<string, unknown> = {
    numero_contrato: "", cliente: clienteNombre, cliente_documento: input.cliente.numeroDoc.trim() || null,
    cliente_telefono: input.cliente.telefono.trim() || null, cliente_direccion: null,
    destino: destinoTxt, fecha_emision: hoy, fecha_salida: fechaIda, fecha_regreso: fechaRegreso,
    pax: paxTotal, estado: "pendiente",
    plan_nombre: planNombre,
    asistencia_medica: resumenServicios.asistenciaMedica,
    tours_traslados: resumenServicios.toursTraslados,
    moneda,
  };

  const detalle = {
    venta: ventaSnap, pasajeros: [], hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap,
    habitacionesBernalo: habitacionesBernaloSnap,
    composicionBernalo: composicionBernaloSnap,
  };

  const vigenciaRes = resolverVigenciaCotizacion({
    hoy,
    fechaSalida: fechaIda,
    diasPorDefecto: 1,
  });
  if (!vigenciaRes.ok) return { ok: false, error: vigenciaRes.error };
  const vigencia = vigenciaRes.vigencia;

  const { data: { user } } = await sb.auth.getUser();
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  const { data: row, error } = await admin.from("cotizaciones").insert({
    // Estampado FIJO en el servidor — nunca desde `input` (el cliente no
    // manda ni puede mandar un tenant): este checkout es el carrito público
    // del tarifario, que es un producto exclusivo de mayorista (minorista no
    // tiene tarifario/catálogo público — MINORISTA_OCULTAS en proxy.ts).
    tenant: "mayorista",
    tipo: "carrito",
    // Regla C.14: cada ítem Bernalo persistido lleva `modeloTarifario:
    // "unidad"` (ya presente en `SolicitudItemBernaloComputado`) para que
    // `convertirCotizacionCarrito` (3F-4B) lo detecte y bloquee la
    // conversión a contrato explícitamente, sin caer al flujo persona.
    payload: { items: [...itemsOk, ...itemsBernaloOk], tours: toursOk, serviciosIncluidos: incluidosSnap, cliente: input.cliente } as unknown as Json,
    detalle: detalle as unknown as Json,
    cliente: clienteNombre,
    cliente_documento: input.cliente.numeroDoc.trim() || null,
    destino: destinoTxt,
    hotel: totalHoteles === 1 ? (itemsOk[0]?.hotelNombre ?? itemsBernaloOk[0]?.hotelNombre ?? null) : (totalHoteles ? `${totalHoteles} hoteles` : null),
    modulo: "carrito",
    plan_nombre: planNombre,
    pax: paxTotal,
    precio_venta: total,
    moneda,
    fecha_salida: fechaIda,
    fecha_regreso: fechaRegreso,
    vigencia_hasta: vigencia,
    asesor: null,
    creado_por: user?.email ?? null,
  }).select("id, codigo, share_token").single();
  // FRONTERA PÚBLICA (ronda 7): nunca se reenvía `error.message` — un fallo
  // real de Postgres/Supabase (columna faltante, RLS, restricción violada)
  // no debe llegar a esta Server Action pública. `respuestaPublicaInsertCotizacion`
  // (lib/reservar/edadesMenores.ts, función pura) decide el mensaje FIJO; el
  // detalle técnico real se registra ACÁ, server-side — nunca datos del
  // cliente (nombre/documento/teléfono/email) ni el payload de la cotización.
  // El `if (error || !row)` se conserva explícito (en vez de solo leer
  // `pubInsert.ok`) para que TypeScript siga estrechando `row` a no-nulo en
  // el resto de la función — `pubInsert` decide el MENSAJE, no el control de flujo.
  if (error || !row) {
    const detalle = error?.message ?? "insert no devolvió fila (row ausente)";
    console.error(formatearLogInsertCotizacion({ etapa: "insertar_cotizacion", detalle }));
    return respuestaPublicaInsertCotizacion(detalle);
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";
  const url = origin && row.share_token ? `${origin}/cot/${row.share_token}` : "";

  return { ok: true, id: row.id, codigo: row.codigo, url, moneda, itemsOk, itemsBernaloOk, toursOk, excluidos };
}

// Genera UNA sola cotización combinada para todo el carrito y arma los
// enlaces wa.me + mailto hacia los destinatarios configurados. Público (sin
// login) — `inputRaw` se trata como `unknown`, ver `validarCrearSolicitudInput`.
export async function crearSolicitudReserva(inputRaw: unknown): Promise<SolicitudResult> {
  const v = validarCrearSolicitudInput(inputRaw);
  if (!v.ok) return { ok: false, error: v.error };
  const input = v.input;
  const tours = input.tours;
  if (!input.items.length && !tours.length) return { ok: false, error: "El carrito está vacío." };
  if (!`${input.cliente.nombres}${input.cliente.apellidos}`.trim()) return { ok: false, error: "Ingresa nombres y apellidos." };
  if (!input.cliente.numeroDoc.trim()) return { ok: false, error: "El documento es obligatorio." };
  if (!input.cliente.telefono.trim()) return { ok: false, error: "El teléfono / WhatsApp es obligatorio." };

  const cot = await crearCotizacionCarrito({ items: input.items, tours, cliente: input.cliente });
  if (!cot.ok) return cot;

  // Agrega el cliente a la base de contactos del CRM como B2C (cliente_final),
  // editable luego a B2B (agencia/freelance). Service-role: el checkout es público.
  try {
    const admin = createAdminClient();
    const nombre = `${input.cliente.nombres} ${input.cliente.apellidos}`.trim();
    if (nombre) {
      // Si ya existe (índice único por documento/email/teléfono) el insert falla
      // con 23505 y simplemente se ignora (no se duplica ni bloquea la solicitud).
      await admin.from("crm_contactos").insert({
        categoria: "cliente_final",
        nombre,
        tipo_doc: input.cliente.numeroDoc.trim() ? "CC" : null,
        documento: input.cliente.numeroDoc.trim() || null,
        email: input.cliente.email.trim() || null,
        telefono: input.cliente.telefono.trim() || null,
        origen: "Cotización tarifario (B2C)",
      });
    }
  } catch { /* no bloquear la solicitud */ }

  // Destinatarios configurados (service-role: el checkout es público/anónimo).
  let whatsapp: string | null = null, emails: string | null = null, mensajeExtra: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("config_solicitudes").select("whatsapp, emails, mensaje_extra").eq("id", 1).maybeSingle();
    whatsapp = cfg?.whatsapp ?? null; emails = cfg?.emails ?? null; mensajeExtra = cfg?.mensaje_extra ?? null;
  } catch { /* ignore */ }

  // El contexto B2B se resuelve ENTERO desde la sesión autenticada + la base
  // de datos (`getContextoB2B()`, la misma fuente que ya usa el cliente para
  // decidir si mostrar la sección B2B) — nunca desde `input`. Un visitante
  // anónimo (o un usuario B2C autenticado) nunca puede autodeclararse B2B,
  // elegir modo neto ni inflar una comisión: `ctxB2B.esB2B` sale de
  // `usuarios.rol` vía `auth.getUser()`, y `pctComision`/`agencia` salen de
  // `usuarios.pct_comision`/`b2b_solicitudes` — ninguno es un valor que el
  // navegador pueda mandar. Corrige un defecto real: antes `pctComision`
  // llegaba tal cual del cliente (podía mandar `1` = 100%/"gratis").
  const ctxB2B = await getContextoB2B();
  const b2b = resolverB2BParaMensaje(ctxB2B, input.modo);
  // Si algo del carrito quedó fuera de la cotización, se avisa igual en el
  // mensaje para no perderlo silenciosamente — pero cada motivo se reporta
  // por separado (nunca todos como "otra moneda": un tour excluido por no
  // estar disponible para esas fechas/pax es un motivo distinto, y decir lo
  // contrario sería falso — defecto real corregido, ronda 4).
  const excluidosPorMoneda = cot.excluidos.filter((e) => e.motivo === "moneda").map((e) => e.etiqueta);
  const excluidosNoDisponibles = cot.excluidos.filter((e) => e.motivo === "no_disponible").map((e) => e.etiqueta);
  const notasExcluidos: string[] = [];
  if (excluidosPorMoneda.length) {
    notasExcluidos.push(`Nota: quedaron fuera de esta cotización por estar en otra moneda — coordinar aparte: ${excluidosPorMoneda.join(", ")}.`);
  }
  if (excluidosNoDisponibles.length) {
    notasExcluidos.push(`Nota: no se pudieron incluir en esta cotización (ya no disponibles) — coordinar aparte: ${excluidosNoDisponibles.join(", ")}.`);
  }
  const notaExcluidos = notasExcluidos.length ? notasExcluidos.join("\n") : null;
  const extra = [mensajeExtra?.trim() || null, notaExcluidos].filter(Boolean).join("\n\n") || null;
  const mensaje = construirMensaje(input.cliente, { codigo: cot.codigo, url: cot.url }, cot.itemsOk, cot.toursOk, cot.moneda, extra, b2b, cot.itemsBernaloOk);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  const mailtoUrl = correos
    ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de reserva — D'spacios Travel")}&body=${encodeURIComponent(mensaje)}`
    : null;

  return { ok: true, cotizacion: { id: cot.id, codigo: cot.codigo, url: cot.url }, waUrl, mailtoUrl, mensaje };
}
