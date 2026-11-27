// #103 — server-side loaders for supplier requests and payment notices. Every function takes its Supabase clients as ARGUMENTS (the Server Action passes the session client — RLS decides what the person
// may read — and, only where the bucket needs it, the service client), so the same code runs against a disposable database in tests. Nothing here writes a payment, an accounting entry or a reconciliation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Database } from "@/types/database";
import { nochesDeEstancia, resolverCodigo, vigenciasQueExigenCodigoEn, type Estancia, type EleccionCodigo, type ResultadoCodigo, type VigenciaConCodigo } from "./codigos.ts";
import { construirCorreoSolicitud, type CorreoSolicitud, type DatosSolicitud } from "./documento.ts";
import { construirCorreoPago, type CorreoPago, type LineaPago } from "./avisoPago.ts";
import type { Adjunto } from "./transporte.ts";

type Sb = SupabaseClient<Database>;
export const BUCKET_SOPORTES = "soportes-pago-proveedor";
export const MAX_ADJUNTOS_BYTES = 10 * 1024 * 1024;     // total per e-mail (providers allow far more; this keeps one message small and cheap)
export const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
const norm = (t: string | null | undefined): string => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

// ── Supplier request ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EstanciaSolicitable = { id: number; nombre: string; ingreso: string | null; salida: string | null };
export type ProveedorSolicitable = { proveedor: string; clase: "hotel" | "servicios"; hoteles: number; servicios: number; estancias: EstanciaSolicitable[] };
/** WHICH rows of one supplier a request carries. `null` (the default everywhere) = everything of that supplier. A selection names contract stay rows by id (they must belong to this contract AND this supplier) and says whether the supplier's service lines travel too. */
export type SeleccionSolicitud = { estanciaIds: number[]; servicios: boolean };

/** Suppliers of the contract that have something to request (hotel stays and/or service lines), from the contract's own rows. */
export async function proveedoresDelContrato(sb: Sb, numero: string): Promise<ProveedorSolicitable[]> {
  const [{ data: hs }, { data: ss }] = await Promise.all([
    sb.from("contrato_hoteles").select("id, nombre, fecha_ingreso, fecha_salida, proveedor, orden").eq("numero_contrato", numero).order("orden").order("id"),
    sb.from("contrato_servicios").select("proveedor").eq("numero_contrato", numero),
  ]);
  const mapa = new Map<string, ProveedorSolicitable>();
  for (const h of hs ?? []) { const n = (h.proveedor ?? "").trim(); if (n) { const x = mapa.get(n) ?? { proveedor: n, clase: "hotel" as const, hoteles: 0, servicios: 0, estancias: [] }; x.hoteles++; x.estancias.push({ id: h.id, nombre: h.nombre, ingreso: h.fecha_ingreso, salida: h.fecha_salida }); mapa.set(n, x); } }
  for (const s of ss ?? []) { const n = (s.proveedor ?? "").trim(); if (n) { const x = mapa.get(n) ?? { proveedor: n, clase: "servicios" as const, hoteles: 0, servicios: 0, estancias: [] }; x.servicios++; mapa.set(n, x); } }
  return [...mapa.values()].sort((a, b) => a.proveedor.localeCompare(b.proveedor));
}

const edadA = (nacimiento: string | null, ref: string | null): number | null => {
  if (!nacimiento || !ref || !/^\d{4}-\d{2}-\d{2}/.test(nacimiento) || !/^\d{4}-\d{2}-\d{2}/.test(ref)) return null;
  const [y, m, d] = nacimiento.slice(0, 10).split("-").map(Number), [ry, rm, rd] = ref.slice(0, 10).split("-").map(Number);
  const e = ry - y - (rm < m || (rm === m && rd < d) ? 1 : 0);
  return e >= 0 && e < 120 ? e : null;
};

export type SolicitudCargada = { datos: Omit<DatosSolicitud, "codigo">; filasHotel: { nombre: string; ingreso: string | null; salida: string | null }[]; tenant: string };

/** Reservation data for ONE supplier of ONE contract — read with the person's session (RLS). Prices, costs and commissions are never selected. */
export async function cargarDatosSolicitud(sb: Sb, numero: string, proveedor: string, seleccion: SeleccionSolicitud | null = null): Promise<{ ok: true; v: SolicitudCargada } | { ok: false; error: string }> {
  const { data: venta, error: eVenta } = await sb.from("ventas").select("tenant, cliente, destino, fecha_salida, fecha_regreso, pax").eq("numero_contrato", numero).maybeSingle();
  if (eVenta) return { ok: false, error: ERR_LECTURA };
  if (!venta) return { ok: false, error: "Contrato no encontrado." };
  const [{ data: hs, error: eH }, { data: ss, error: eS }, { data: ps, error: eP }] = await Promise.all([
    sb.from("contrato_hoteles").select("id, nombre, ciudad, categoria, alimentacion, acomodacion, detalle_acomodacion, fecha_ingreso, fecha_salida, orden").eq("numero_contrato", numero).eq("proveedor", proveedor).order("orden"),
    sb.from("contrato_servicios").select("tipo, descripcion, alcance_traslado, orden").eq("numero_contrato", numero).eq("proveedor", proveedor).order("orden"),
    sb.from("contrato_pasajeros").select("nombre, fecha_nacimiento").eq("numero_contrato", numero).order("id"),
  ]);
  if (eH || eS || eP || !hs || !ss || !ps) return { ok: false, error: ERR_LECTURA };   // a partial read would silently drop stays, services or passengers from the e-mail
  if (!hs.length && !ss.length) return { ok: false, error: "Ese proveedor no tiene hoteles ni servicios en este contrato." };
  // A selection is applied to rows ALREADY filtered by contract AND supplier, so an id from another supplier/contract can never reach the message; every chosen id must be found.
  let estancias = hs, servicios = ss;
  if (seleccion) {
    const ids = [...new Set(seleccion.estanciaIds)];
    estancias = hs.filter((h) => ids.includes(h.id));
    if (estancias.length !== ids.length) return { ok: false, error: "Alguna de las estancias elegidas no pertenece a este proveedor en este contrato. Recarga la página." };
    servicios = seleccion.servicios ? ss : [];
    if (!estancias.length && !servicios.length) return { ok: false, error: "Elige al menos una estancia o los servicios de este proveedor." };
  }
  const ingresos = estancias.map((h) => h.fecha_ingreso).filter((x): x is string => !!x).sort();
  const salidas = estancias.map((h) => h.fecha_salida).filter((x): x is string => !!x).sort();
  const ingreso = ingresos[0] ?? venta.fecha_salida ?? null;
  const salida = salidas[salidas.length - 1] ?? venta.fecha_regreso ?? null;
  const datos: Omit<DatosSolicitud, "codigo"> = {
    numero, proveedor, clase: estancias.length ? "hotel" : "servicios", titular: venta.cliente ?? null, destino: venta.destino ?? null, salida: venta.fecha_salida ?? null, regreso: venta.fecha_regreso ?? null, pax: venta.pax ?? null,
    hoteles: estancias.map((h) => ({ nombre: h.nombre, ciudad: h.ciudad, categoria: h.categoria, ingreso: h.fecha_ingreso, salida: h.fecha_salida, noches: nochesDeEstancia(h.fecha_ingreso, h.fecha_salida).length || null, acomodacion: h.acomodacion, detalleAcomodacion: h.detalle_acomodacion, alimentacion: h.alimentacion })),
    servicios: servicios.map((s) => ({ tipo: s.tipo, descripcion: s.descripcion, alcance: s.alcance_traslado ?? null })),
    pasajeros: (ps ?? []).map((p) => ({ nombre: p.nombre, edad: edadA(p.fecha_nacimiento, ingreso) })),
  };
  return { ok: true, v: { datos, filasHotel: estancias.map((h) => ({ nombre: h.nombre, ingreso: h.fecha_ingreso, salida: h.fecha_salida })), tenant: venta.tenant ?? "mayorista" } };
}

const ERR_LECTURA = "No se pudieron leer los datos necesarios para armar la solicitud (códigos de promoción, hoteles o reserva). No se envió nada; intenta de nuevo.";

/** Coded validities (with their requirement) of the given hotels. A failed or partial read is an ERROR, never «no code required». */
export async function cargarVigenciasConCodigo(sb: Sb, hotelIds: number[]): Promise<{ ok: true; data: VigenciaConCodigo[] } | { ok: false; error: string }> {
  if (!hotelIds.length) return { ok: true, data: [] };
  const { data: cods, error: eC } = await sb.from("hotel_codigos_promocion").select("id, hotel_id, vigencia_id, requerido, codigo").in("hotel_id", hotelIds);
  if (eC || !cods) return { ok: false, error: ERR_LECTURA };
  if (!cods.length) return { ok: true, data: [] };
  const { data: vigs, error: eV } = await sb.from("hotel_temporadas").select("id, nombre, fecha_inicio, fecha_fin, rangos, blackouts").in("id", cods.map((c) => c.vigencia_id));
  const porId = new Map((vigs ?? []).map((v) => [v.id, v]));
  // every configured code must resolve to its validity: a missing one means the read was partial
  if (eV || !vigs || cods.some((c) => !porId.has(c.vigencia_id))) return { ok: false, error: ERR_LECTURA };
  return { ok: true, data: cods.map((c) => { const v = porId.get(c.vigencia_id)!; return { codigoId: c.id, hotelId: c.hotel_id, vigenciaId: c.vigencia_id, nombre: v.nombre, fechaInicio: v.fecha_inicio, fechaFin: v.fecha_fin, rangos: v.rangos, blackouts: v.blackouts, requerido: c.requerido, codigo: c.codigo }; }) };
}

export type HotelCatalogo = { id: number; nombre: string };
/** Catalog hotels whose name equals (accent/case-insensitive) one of the contract's hotel names — a SUGGESTION for the sender, never an automatic link. A failed read is an ERROR. */
export async function hotelesDelCatalogo(sb: Sb, nombres: string[]): Promise<{ ok: true; data: HotelCatalogo[] } | { ok: false; error: string }> {
  if (!nombres.length) return { ok: true, data: [] };
  const { data, error } = await sb.from("hoteles").select("id, nombre").order("nombre");
  if (error || !data) return { ok: false, error: ERR_LECTURA };
  const buscados = new Set(nombres.map(norm));
  return { ok: true, data: data.filter((h) => buscados.has(norm(h.nombre))) };
}

export type ArmadoSolicitud =
  | { ok: true; correo: CorreoSolicitud; datos: DatosSolicitud; cargada: SolicitudCargada; hotelId: number | null; codigo: { codigoId: number; texto: string; promocion: string } | null; sinPromocion: boolean; candidatas: VigenciaConCodigo[]; hotelesSugeridos: HotelCatalogo[] }
  | { ok: false; error: string; candidatas?: VigenciaConCodigo[]; hotelesSugeridos?: HotelCatalogo[] };

/**
 * Builds the preview/outgoing request and enforces the promotion-code rules.
 *  · Every authoritative read must succeed (a failed catalogue read blocks the send; it is never «no code required»).
 *  · `hotelId` (the catalog hotel the sender chose, or null) must be one of the catalog hotels that match THIS reservation's hotel names: an arbitrary existing hotel is rejected.
 *  · Each stay is judged on its own nights against the coded validities of the hotel it belongs to; a stay at ANOTHER matched hotel that has a covering coded validity cannot be skipped by choosing a different hotel
 *    (one request carries one code choice). The way out is `seleccion`: the sender sends the stays of each hotel in its OWN request (message, snapshot and key contain only the chosen stays, each judged against its own hotel's code);
 *    everything is still judged on the stays the message carries, so a request can never leave a coded stay out of the check by naming a different hotel.
 */
export async function armarSolicitud(sb: Sb, numero: string, proveedor: string, hotelId: number | null, eleccion: EleccionCodigo, seleccion: SeleccionSolicitud | null = null, mensaje: string | null = null): Promise<ArmadoSolicitud> {
  const c = await cargarDatosSolicitud(sb, numero, proveedor, seleccion);
  if (!c.ok) return c;
  const cat = await hotelesDelCatalogo(sb, c.v.filasHotel.map((f) => f.nombre));
  if (!cat.ok) return cat;
  const sugeridos = cat.data;
  if (hotelId != null && !c.v.filasHotel.length) return { ok: false, error: "Este proveedor no tiene hoteles en la reserva: no corresponde elegir un hotel del catálogo.", hotelesSugeridos: sugeridos };
  if (hotelId != null && !sugeridos.some((h) => h.id === hotelId)) return { ok: false, error: "El hotel elegido no corresponde a ningún hotel de esta reserva.", hotelesSugeridos: sugeridos };
  const vig = await cargarVigenciasConCodigo(sb, sugeridos.map((h) => h.id));
  if (!vig.ok) return { ok: false, error: vig.error, hotelesSugeridos: sugeridos };
  const candidatas = vig.data;
  // stays (contract rows) grouped by the catalog hotels their name matches
  const estanciasDe = (h: HotelCatalogo): Estancia[] => c.v.filasHotel.filter((f) => norm(f.nombre) === norm(h.nombre)).map((f) => ({ ingreso: f.ingreso, salida: f.salida }));
  const otros = sugeridos.filter((h) => h.id !== hotelId && !(hotelId != null && norm(h.nombre) === norm(sugeridos.find((x) => x.id === hotelId)!.nombre)));
  const sinCubrir = otros.flatMap((h) => vigenciasQueExigenCodigoEn(candidatas, h.id, estanciasDe(h)));
  if (sinCubrir.length) {
    const nombre = sugeridos.find((h) => h.id === sinCubrir[0].hotelId)?.nombre;
    return { ok: false, error: hotelId == null
      ? `El hotel «${nombre}» tiene promociones que exigen código para estas fechas: selecciona el hotel del catálogo para elegir el código.`
      : `Esta solicitud incluye otro hotel («${nombre}») con una promoción que exige código para sus fechas, y una solicitud lleva un solo código. Marca solo las estancias de un hotel en «Estancias de esta solicitud» y envía las del otro hotel en una solicitud aparte.`,
    candidatas: hotelId != null ? vigenciasQueExigenCodigoEn(candidatas, hotelId, estanciasDe(sugeridos.find((h) => h.id === hotelId)!)) : [], hotelesSugeridos: sugeridos };
  }
  const elegido = hotelId != null ? sugeridos.find((h) => h.id === hotelId)! : null;
  const estancias = elegido ? estanciasDe(elegido) : [];
  const r: ResultadoCodigo = hotelId == null
    ? (eleccion.codigoId != null ? { ok: false, error: "Elige primero el hotel del catálogo para usar su código de promoción." } : { ok: true, codigo: null, sinPromocion: false })
    : resolverCodigo({ candidatas, hotelId, estancias, eleccion });
  const cubren = hotelId != null ? vigenciasQueExigenCodigoEn(candidatas, hotelId, estancias) : [];   // the screen only offers what covers THIS hotel's stays
  if (!r.ok) return { ok: false, error: r.error, candidatas: cubren, hotelesSugeridos: sugeridos };
  // `mensaje` only exists in the data when written: without it the data (and therefore the idempotency key and the message) is exactly the one of before H103-13.
  const datos: DatosSolicitud = { ...c.v.datos, codigo: r.codigo ? { texto: r.codigo.texto, promocion: r.codigo.promocion } : null, ...(mensaje ? { mensaje } : {}) };
  return { ok: true, correo: construirCorreoSolicitud(datos), datos, cargada: c.v, hotelId, codigo: r.codigo ? { codigoId: r.codigo.codigoId, texto: r.codigo.texto, promocion: r.codigo.promocion } : null, sinPromocion: r.sinPromocion, candidatas: cubren, hotelesSugeridos: sugeridos };
}

// ── Supplier payment notice ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PagoListado = { pagoId: number; numeroContrato: string; servicio: string | null; fecha: string; valor: number; moneda: "COP" | "USD"; trm: number; soportes: { id: number; nombre: string; bytes: number }[]; yaAvisado: boolean };

/** Payments of ONE supplier in the active agency (RLS + explicit tenant), with their evidence and whether a notice already reported them. */
export async function listarPagosDeProveedor(sb: Sb, tenant: string, proveedor: string): Promise<PagoListado[]> {
  const { data: cxps } = await sb.from("cuentas_por_pagar").select("id, numero_contrato, servicio, moneda").eq("tenant", tenant).eq("proveedor", proveedor);
  if (!(cxps ?? []).length) return [];
  const { data: pagos } = await sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, fecha, valor, trm").eq("tenant", tenant).in("cuenta_por_pagar_id", cxps!.map((x) => x.id)).order("fecha", { ascending: false }).order("id", { ascending: false }).limit(300);
  if (!(pagos ?? []).length) return [];
  const ids = pagos!.map((p) => p.id);
  const [{ data: sop }, { data: avs }] = await Promise.all([
    sb.from("cxp_pago_soportes").select("id, cxp_pago_id, nombre, size_bytes").in("cxp_pago_id", ids),
    sb.from("solicitud_proveedor_pagos").select("cxp_pago_id").in("cxp_pago_id", ids),
  ]);
  const avisados = new Set((avs ?? []).map((a) => a.cxp_pago_id));
  const porCxp = new Map(cxps!.map((x) => [x.id, x]));
  return pagos!.map((p) => { const x = porCxp.get(p.cuenta_por_pagar_id)!; return { pagoId: p.id, numeroContrato: x.numero_contrato, servicio: x.servicio, fecha: p.fecha, valor: Number(p.valor), moneda: x.moneda === "USD" ? "USD" as const : "COP" as const, trm: Number(p.trm) || 1, soportes: (sop ?? []).filter((s) => s.cxp_pago_id === p.id).map((s) => ({ id: s.id, nombre: s.nombre, bytes: s.size_bytes })), yaAvisado: avisados.has(p.id) }; });
}

/** Persisted payment rows → notice lines. Rejects a selection that is not entirely this supplier's, this agency's and visible to the person. Never computes a split. */
export async function cargarLineasPago(sb: Sb, tenant: string, proveedor: string, pagoIds: number[]): Promise<{ ok: true; lineas: LineaPago[] } | { ok: false; error: string }> {
  const ids = [...new Set(pagoIds)];
  if (!ids.length) return { ok: false, error: "Elige al menos un pago." };
  if (ids.length > 50) return { ok: false, error: "Máximo 50 pagos por aviso." };
  const { data: pagos } = await sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, fecha, valor, trm, tenant").in("id", ids);
  if ((pagos ?? []).length !== ids.length) return { ok: false, error: "Alguno de los pagos no existe o no tienes acceso a él." };
  if (pagos!.some((p) => p.tenant !== tenant)) return { ok: false, error: "Alguno de los pagos pertenece a otra agencia." };
  const cxpIds = [...new Set(pagos!.map((p) => p.cuenta_por_pagar_id))];
  const [{ data: cxps }, { data: todos }] = await Promise.all([
    sb.from("cuentas_por_pagar").select("id, numero_contrato, proveedor, tipo_proveedor, servicio, moneda, valor_total, tenant").in("id", cxpIds),
    sb.from("cxp_pagos").select("cuenta_por_pagar_id, valor").in("cuenta_por_pagar_id", cxpIds),
  ]);
  if ((cxps ?? []).length !== cxpIds.length) return { ok: false, error: "No se pudo leer la obligación de alguno de los pagos." };
  if (cxps!.some((x) => (x.proveedor ?? "") !== proveedor || x.tenant !== tenant)) return { ok: false, error: "Todos los pagos deben ser del mismo proveedor y de esta agencia." };
  const acumulado = new Map<number, number>();
  for (const t of todos ?? []) acumulado.set(t.cuenta_por_pagar_id, (acumulado.get(t.cuenta_por_pagar_id) ?? 0) + Number(t.valor));
  const porId = new Map(cxps!.map((x) => [x.id, x]));
  return { ok: true, lineas: pagos!.map((p) => { const x = porId.get(p.cuenta_por_pagar_id)!; return { pagoId: p.id, numeroContrato: x.numero_contrato, servicio: x.servicio, tipoProveedor: x.tipo_proveedor, fecha: p.fecha, valor: Number(p.valor), moneda: x.moneda === "USD" ? "USD" as const : "COP" as const, trm: Number(p.trm) || 1, valorObligacion: Number(x.valor_total), pagadoAcumulado: Math.round((acumulado.get(x.id) ?? 0) * 100) / 100 }; }) };
}

export type AdjuntoCargado = { soporteId: number; nombre: string; bytes: number; sha256: string; adjunto: Adjunto };

/** Evidence files of the selected payments → attachments. Every file must be linked to one of the selected payments (same agency); the bytes come from the private bucket and their hash must still match. */
export async function cargarAdjuntosPago(sb: Sb, admin: Sb, tenant: string, pagoIds: number[], soporteIds: number[]): Promise<{ ok: true; adjuntos: AdjuntoCargado[] } | { ok: false; error: string }> {
  const ids = [...new Set(soporteIds)];
  if (!ids.length) return { ok: true, adjuntos: [] };
  if (ids.length > 6) return { ok: false, error: "Máximo 6 archivos por aviso." };
  const { data: filas } = await sb.from("cxp_pago_soportes").select("id, cxp_pago_id, tenant, nombre, path, content_type, size_bytes, sha256").in("id", ids);
  if ((filas ?? []).length !== ids.length) return { ok: false, error: "Alguno de los archivos no existe o no tienes acceso a él." };
  if (filas!.some((f) => f.tenant !== tenant || !pagoIds.includes(f.cxp_pago_id))) return { ok: false, error: "Los archivos deben pertenecer a los pagos elegidos de esta agencia." };
  if (filas!.reduce((a, f) => a + f.size_bytes, 0) > MAX_ADJUNTOS_BYTES) return { ok: false, error: "Los adjuntos superan el máximo de 10 MB por correo." };
  const out: AdjuntoCargado[] = [];
  const vistos = new Set<string>();
  for (const f of filas!) {
    if (vistos.has(f.path)) continue;                      // the same file linked to several selected payments is attached once
    vistos.add(f.path);
    const { data, error } = await admin.storage.from(BUCKET_SOPORTES).download(f.path);
    if (error || !data) return { ok: false, error: `No se pudo leer el archivo «${f.nombre}».` };
    const buf = Buffer.from(await data.arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex") !== f.sha256) return { ok: false, error: `El archivo «${f.nombre}» cambió desde que se subió; súbelo de nuevo.` };
    out.push({ soporteId: f.id, nombre: f.nombre, bytes: buf.length, sha256: f.sha256, adjunto: { nombre: f.nombre, contentType: f.content_type, base64: buf.toString("base64") } });
  }
  return { ok: true, adjuntos: out };
}

/** Re-reads the evidence a FROZEN payment notice referenced (by id, same agency) from the private bucket and verifies each hash against what was recorded at first send. */
export function hidratarAdjuntosPago(admin: Sb, tenant: string): import("./servicio.ts").HidratarAdjuntos {
  return async (refs) => {
    const out: Adjunto[] = [];
    const vistos = new Set<string>();
    for (const r of refs) {
      const { data: fila, error } = await admin.from("cxp_pago_soportes").select("id, tenant, nombre, path, content_type, sha256").eq("id", r.soporteId).maybeSingle();
      if (error || !fila || fila.tenant !== tenant || fila.sha256 !== r.sha256) return { ok: false, error: `El soporte «${r.nombre}» ya no está disponible tal como se envió originalmente.` };
      if (vistos.has(fila.path)) continue;
      vistos.add(fila.path);
      const { data, error: eD } = await admin.storage.from(BUCKET_SOPORTES).download(fila.path);
      if (eD || !data) return { ok: false, error: `No se pudo leer el soporte «${r.nombre}».` };
      const buf = Buffer.from(await data.arrayBuffer());
      if (createHash("sha256").update(buf).digest("hex") !== r.sha256) return { ok: false, error: `El soporte «${r.nombre}» cambió desde que se envió originalmente.` };
      out.push({ nombre: fila.nombre, contentType: fila.content_type, base64: buf.toString("base64") });
    }
    return { ok: true, adjuntos: out };
  };
}

export function armarAvisoPago(proveedor: string, referencia: string | null, lineas: LineaPago[], adjuntos: AdjuntoCargado[], mensaje: string | null = null): CorreoPago & { adjuntos: Adjunto[] } {
  const c = construirCorreoPago({ proveedor, referencia, lineas, adjuntos: adjuntos.map((a) => ({ nombre: a.nombre, bytes: a.bytes })), ...(mensaje ? { mensaje } : {}) });
  return { ...c, adjuntos: adjuntos.map((a) => a.adjunto) };
}
