"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computarReserva, type ReservaInput } from "@/lib/reservar/computo";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { formatMoneda } from "@/lib/utils";
import { comisionDefault, categoriaAliado } from "@/lib/b2b";
import {
  resolverB2BParaMensaje, validarCrearSolicitudInput,
  type SolicitudItemValidado, type SolicitudTourValidado,
} from "@/lib/reservar/edadesMenores";
import { liquidarServicioPuntual } from "@/lib/reservar/cotizar";
import type { Json } from "@/types/database";

// Forma que arma el CARRITO en el cliente (ver lib/cart/CartContext.tsx) —
// incluye `ninos`/`ninos2`/`infantes`/`pax`/`precio` para la vista previa en
// el navegador (carrito, resumen antes de enviar), pero NADA de esto se
// confía en el servidor: `crearSolicitudReserva` recibe el ítem como
// `unknown`, lo revalida con `validarSolicitudItem` (que ni siquiera lee
// estos 5 campos) y el precio/pax/ninos/ninos2/infantes reales SIEMPRE salen
// de `computarReserva` — nunca de lo que mande el navegador.
export type SolicitudItem = {
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
export async function getContextoB2B(): Promise<ContextoB2B> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };
  const { data: perfil } = await sb.from("usuarios").select("nombre, email, rol, agencia_id, pct_comision").eq("id", user.id).maybeSingle();
  const rol = perfil?.rol ?? null;
  if (rol !== "agencia" && rol !== "freelance") return { esB2B: false, tipo: null, agencia: null, pctComision: 0, categoria: null };

  // Si es un AGENTE, la facturación/comisión es la de su AGENCIA titular.
  const agenciaUserId = perfil?.agencia_id ?? user.id;
  let agenciaPerfil = perfil;
  if (perfil?.agencia_id) {
    const { data: ap } = await sb.from("usuarios").select("nombre, email, rol, pct_comision").eq("id", perfil.agencia_id).maybeSingle();
    if (ap) agenciaPerfil = { ...ap, agencia_id: null };
  }

  const { data: sols } = await sb
    .from("b2b_solicitudes")
    .select("nombre, nit, email, telefono")
    .eq("usuario_id", agenciaUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  const sol = sols?.[0];
  const agencia: Facturacion = {
    nombre: sol?.nombre ?? agenciaPerfil?.nombre ?? "",
    nit: sol?.nit ?? "",
    email: sol?.email ?? agenciaPerfil?.email ?? "",
    telefono: sol?.telefono ?? "",
  };

  // Comisión POR AGENCIA: el % vive en el usuario (la agencia titular). El
  // default general sale del parámetro tributario; la categoría compara contra él.
  const def = await comisionDefault(sb, rol);
  const pct = agenciaPerfil?.pct_comision ?? def;
  const categoria = categoriaAliado(rol, pct, def).label;
  return { esB2B: true, tipo: rol, agencia, pctComision: pct, categoria };
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

export type SolicitudResult =
  | { ok: true; cotizacion: { id: number; codigo: string; url: string }; waUrl: string | null; mailtoUrl: string | null; mensaje: string }
  | { ok: false; error: string };

function resumenHab(it: SolicitudItemComputado): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  if (it.infantes > 0) partes.push(`${it.infantes} Infante(s)`);
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
async function crearCotizacionCarrito(input: {
  items: SolicitudItemValidado[];
  tours: SolicitudTourValidado[];
  cliente: SolicitudCliente;
}): Promise<
  | { ok: true; id: number; codigo: string; url: string; moneda: string; itemsOk: SolicitudItemComputado[]; toursOk: SolicitudTourComputado[]; excluidos: string[] }
  | { ok: false; error: string }
> {
  const sb = await createClient();
  const clienteNombre = `${input.cliente.nombres} ${input.cliente.apellidos}`.trim();
  if (!clienteNombre) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const hoy = new Date().toISOString().slice(0, 10);
  const hotelesSnap: Record<string, unknown>[] = [];
  const vuelosSnap: Record<string, unknown>[] = [];
  const itemsSnap: Record<string, unknown>[] = [];
  const itemsOk: SolicitudItemComputado[] = [];
  const toursOk: SolicitudTourComputado[] = [];
  const excluidos: string[] = [];
  let monedaPrincipal: string | null = null;
  let total = 0;
  let hIdx = 0, vIdx = 0, iIdx = 0;

  for (const it of input.items) {
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
    const { meta, precioVenta, monedaReserva, lineasHab, numNinos, numNinos2, numInfantes, totalPax, distribucionMenores, edadesMenoresUsadas } = comp.data;

    if (monedaPrincipal && monedaReserva !== monedaPrincipal) {
      excluidos.push(`${it.hotelNombre} (moneda ${monedaReserva})`);
      continue;
    }
    monedaPrincipal = monedaPrincipal ?? monedaReserva;

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
      edades_menores: edadesMenoresUsadas,
      menores_clasificados: { infantes: numInfantes, nino: numNinos, nino2: numNinos2 },
      distribucion_menores: distribucionMenores,
    });

    if (it.modulo === "bloqueo" && it.bloqueoId) {
      const { data: bq } = await sb
        .from("bloqueos_vuelo")
        .select("aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg")
        .eq("id", it.bloqueoId).maybeSingle();
      if (bq) {
        const r = parseRuta(bq.ruta);
        vIdx++;
        vuelosSnap.push({
          id: vIdx, aerolinea: bq.aerolinea, record: bq.record, direccion: "ida",
          origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
          destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
          numero_vuelo: bq.vuelo_ida, hora_salida: bq.hora_salida_ida, hora_llegada: bq.hora_llegada_ida,
          fecha_salida: bq.fecha_ida,
        });
        if (bq.fecha_regreso || bq.vuelo_regreso) {
          vIdx++;
          vuelosSnap.push({
            id: vIdx, aerolinea: bq.aerolinea, record: bq.record, direccion: "regreso",
            origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino),
            destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
            numero_vuelo: bq.vuelo_regreso, hora_salida: bq.hora_salida_reg, hora_llegada: bq.hora_llegada_reg,
            fecha_salida: bq.fecha_regreso,
          });
        }
      }
    }

    iIdx++;
    itemsSnap.push({
      id: iIdx,
      descripcion: `${meta.hotel_nombre ?? it.hotelNombre}${meta.destino_nombre ?? it.destino ? ` — ${meta.destino_nombre ?? it.destino}` : ""} · ${it.categoria} / ${it.regimen} · ${partes.join(", ")}`,
      adultos: 1, ninos: 0, tarifa_adulto: precioVenta, tarifa_nino: 0,
    });
    total += precioVenta;
    // `edadesMenores` se sobreescribe con lo que `comp.data` realmente usó
    // (única fuente, ver `resolverMenoresPorEdad` en computo.ts) — nunca la
    // referencia cruda de `it`, aunque ya haya sido validada antes.
    itemsOk.push({ ...it, edadesMenores: edadesMenoresUsadas ?? it.edadesMenores, ninos: numNinos, ninos2: numNinos2, infantes: numInfantes, pax: totalPax, precio: precioVenta });
  }

  for (const t of input.tours) {
    // Re-liquida EN VIVO con la misma fórmula de `buscarReceptivos` — nunca
    // se usa nombre/precio/moneda/destino que haya mandado el navegador
    // (esos ni siquiera llegan hasta acá: `validarTourInput` no los lee).
    // `null` = el servicio ya no está publicado/activo o no tiene tarifa
    // vigente para esas fechas/pax: se excluye (mismo criterio que un
    // choque de moneda), nunca se aproxima ni se inventa un precio.
    const resultado = await liquidarServicioPuntual(t);
    if (!resultado) {
      excluidos.push(`Servicio #${t.servicioId} (ya no disponible para esas fechas/pax)`);
      continue;
    }
    const tMoneda = resultado.moneda || "COP";
    if (monedaPrincipal && tMoneda !== monedaPrincipal) { excluidos.push(`${resultado.nombre} (moneda ${tMoneda})`); continue; }
    monedaPrincipal = monedaPrincipal ?? tMoneda;
    iIdx++;
    itemsSnap.push({
      id: iIdx,
      descripcion: `Servicio · ${resultado.nombre}${resultado.destino ? ` — ${resultado.destino}` : ""}`,
      adultos: 1, ninos: 0, tarifa_adulto: resultado.total, tarifa_nino: 0,
    });
    total += resultado.total;
    toursOk.push({
      servicioId: resultado.servicioId, paqueteId: resultado.paqueteId,
      nombre: resultado.nombre, destino: resultado.destino, descripcion: resultado.descripcion,
      fechaIda: t.fechaIda, fechaRegreso: t.fechaRegreso, noches: resultado.noches,
      pax: resultado.pax, precio: resultado.total, moneda: resultado.moneda,
    });
  }

  if (!itemsOk.length && !toursOk.length) return { ok: false, error: "No se pudo generar la cotización (revisa disponibilidad)." };

  const moneda = monedaPrincipal ?? "COP";
  const destinos = [...new Set(itemsOk.map((i) => i.destino).filter((d): d is string => !!d))];
  const destinoTxt = destinos.length ? destinos.join(" · ") : null;
  const fechasIda = itemsOk.map((i) => i.fechaIda).filter((f): f is string => !!f).sort();
  const fechasRegreso = itemsOk.map((i) => i.fechaRegreso).filter((f): f is string => !!f).sort();
  const fechaIda = fechasIda[0] ?? null;
  const fechaRegreso = fechasRegreso.length ? fechasRegreso[fechasRegreso.length - 1] : null;
  const paxTotal = itemsOk.reduce((s, i) => s + (i.pax || 0), 0) || (toursOk[0]?.pax ?? 0);
  const planNombre: string | null = itemsOk.length > 1 ? `${itemsOk.length} hoteles` : (itemsOk[0] ? `${itemsOk[0].categoria} · ${itemsOk[0].regimen}` : null);

  const ventaSnap: Record<string, unknown> = {
    numero_contrato: "", cliente: clienteNombre, cliente_documento: input.cliente.numeroDoc.trim() || null,
    cliente_telefono: input.cliente.telefono.trim() || null, cliente_direccion: null,
    destino: destinoTxt, fecha_emision: hoy, fecha_salida: fechaIda, fecha_regreso: fechaRegreso,
    pax: paxTotal, estado: "pendiente",
    plan_nombre: planNombre,
    asistencia_medica: false,
    tours_traslados: toursOk.length ? toursOk.map((t) => t.nombre).join(", ") : null,
    moneda,
  };

  const detalle = { venta: ventaSnap, pasajeros: [], hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap };

  const vig = new Date();
  vig.setDate(vig.getDate() + 1);
  const vigencia = vig.toISOString().slice(0, 10);

  const { data: { user } } = await sb.auth.getUser();
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  const { data: row, error } = await admin.from("cotizaciones").insert({
    // Estampado FIJO en el servidor — nunca desde `input` (el cliente no
    // manda ni puede mandar un tenant): este checkout es el carrito público
    // del tarifario, que es un producto exclusivo de mayorista (minorista no
    // tiene tarifario/catálogo público — MINORISTA_OCULTAS en proxy.ts).
    tenant: "mayorista",
    tipo: "carrito",
    payload: { items: itemsOk, tours: toursOk, cliente: input.cliente } as unknown as Json,
    detalle: detalle as unknown as Json,
    cliente: clienteNombre,
    cliente_documento: input.cliente.numeroDoc.trim() || null,
    destino: destinoTxt,
    hotel: itemsOk.length === 1 ? itemsOk[0].hotelNombre : (itemsOk.length ? `${itemsOk.length} hoteles` : null),
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
  if (error || !row) return { ok: false, error: error?.message ?? "No se pudo crear la cotización." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";
  const url = origin && row.share_token ? `${origin}/cot/${row.share_token}` : "";

  return { ok: true, id: row.id, codigo: row.codigo, url, moneda, itemsOk, toursOk, excluidos };
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
  // Si algo del carrito quedó fuera de la cotización (moneda distinta a la del
  // resto), se avisa igual en el mensaje para no perderlo silenciosamente.
  const notaExcluidos = cot.excluidos.length
    ? `Nota: quedaron fuera de esta cotización por estar en otra moneda — coordinar aparte: ${cot.excluidos.join(", ")}.`
    : null;
  const extra = [mensajeExtra?.trim() || null, notaExcluidos].filter(Boolean).join("\n\n") || null;
  const mensaje = construirMensaje(input.cliente, { codigo: cot.codigo, url: cot.url }, cot.itemsOk, cot.toursOk, cot.moneda, extra, b2b);
  const wa = (whatsapp ?? "").replace(/\D/g, "");
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
  const correos = (emails ?? "").split(",").map((e) => e.trim()).filter(Boolean).join(",");
  const mailtoUrl = correos
    ? `mailto:${correos}?subject=${encodeURIComponent("Solicitud de reserva — D'spacios Travel")}&body=${encodeURIComponent(mensaje)}`
    : null;

  return { ok: true, cotizacion: { id: cot.id, codigo: cot.codigo, url: cot.url }, waUrl, mailtoUrl, mensaje };
}
