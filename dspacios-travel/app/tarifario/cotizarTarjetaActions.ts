"use server";

// #90 — Precio de la TARJETA pública del hotel para fechas concretas, junto con la regla EBB / Long Stay que realmente ganó.
// Una sola fuente: `computarReserva` (el mismo cálculo que cotiza, convierte y cobra): para porción terrestre liquida las fechas elegidas con el motor en vivo; para bloqueo,
// empaquetado y salida recompone el precio PUBLICADO con el descuento de HOY (misma regla de mayor porcentaje, sin sumar). Precio y etiqueta salen de ese único cómputo.
// Públicas por diseño (como el checkout): devuelven solo PVP por persona; los motivos internos van al log, no al navegador.
import { createClient } from "@/lib/supabase/server";
import { computarReserva, type ReservaInput } from "@/lib/reservar/computo";
import { validarEntradaTarjeta, MENSAJE_TARJETA as MENSAJE, MOTIVO_RECHAZO_TARJETA, type ComboTarjeta, type DescuentoTarjeta } from "@/lib/tarifario/entradaTarjeta";
import { crearLecturasCompartidas } from "@/lib/reservar/lecturasCompartidas";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { motivosUnicos } from "@/lib/tarifario/motivoTarjeta";
import { canalDeRol } from "@/lib/cotizacion/comparativa";

/**
 * ¿Quien cotiza es un rol INTERNO con sesion ACTIVA? Lee `rol` Y `activo` de la fila real de
 * `usuarios` (nunca de algo que mande el navegador) y decide con `canalDeRol` — la MISMA regla
 * que ya usan las cotizaciones comparativas: un interno con `activo=false` (JWT todavia vivo,
 * pero la cuenta se desactivo) cae a "publico", igual que `mi_rol()` en Postgres (migracion 140)
 * ya trata a un usuario inactivo como sin rol. Antes este archivo usaba `miRol()` (lib/roles.ts),
 * que SOLO lee `rol` — un interno desactivado habria seguido recibiendo el motivo real.
 */
async function esInternoActivo(sb: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  return canalDeRol(perfil?.rol, perfil?.activo) === "interno";
}

export type TarjetaCotizada =
  | {
      ok: true;
      /** PVP por persona en habitación doble de la combinación más barata para esas fechas. */
      precio: number; moneda: string; categoria: string; regimen: string;
      fechaIda: string; fechaRegreso: string; noches: number;
      /** Día (America/Bogota) con el que se calculó el descuento: si el día cambia, el par precio+etiqueta caduca y se recalcula. */
      fechaCalculo: string;
      descuentoHotel: DescuentoTarjeta | null;
      /** Todas las categorías/regímenes que se pudieron cotizar para esas fechas (el modal los usa tal cual). */
      combos: ComboTarjeta[];
    }
  | {
      ok: false; error: string;
      /** Motivo(s) de negocio REALES (lista blanca, ver lib/tarifario/motivoTarjeta.ts), únicos y sin texto crudo de Supabase ni netos/costos/markups.
       *  SOLO presente para roles internos con sesión (resuelto en el servidor); público y B2B nunca lo reciben — siguen viendo solo `error`. */
      motivos?: string[];
    };

export async function cotizarTarjetaHotel(raw: unknown): Promise<TarjetaCotizada> {
  const v = validarEntradaTarjeta(raw);
  if (!v.ok) {
    // #439: un rechazo ANTES de computarReserva deja un registro identificable (código fijo y números; nunca el valor recibido) y, para el personal interno, su motivo propio.
    // Jamás se presenta como ausencia de tarifa: el mensaje público es el de siempre, pero el servidor y el rol interno distinguen la causa.
    const modulo = typeof raw === "object" && raw !== null && ["bloqueo", "porcion_terrestre", "dinamico"].includes((raw as { modulo?: string }).modulo as string) ? (raw as { modulo: string }).modulo : "invalido";
    console.error(`[cotizarTarjetaHotel] entrada_rechazada codigo=${v.codigo} modulo=${modulo}${v.recibidas != null ? ` combos_recibidos=${v.recibidas}` : ""}${v.limite != null ? ` limite=${v.limite}` : ""}`);
    let interno = false;
    try { interno = await esInternoActivo(await createClient()); } catch { interno = false; }
    if (interno) return { ok: false, error: v.error, motivos: [v.codigo === "combos_exceden_limite" ? `${MOTIVO_RECHAZO_TARJETA[v.codigo]} (recibidas ${v.recibidas}, máximo ${v.limite}).` : MOTIVO_RECHAZO_TARJETA[v.codigo]] };
    return { ok: false, error: v.error };
  }
  const e = v.entrada;
  const sb = await createClient();
  // Memo EXCLUSIVO de esta llamada: las lecturas idénticas entre combinaciones (paquete, hotel, origen, temporadas, incluidos, evidencia) se hacen una vez; las que dependen del combo, no.
  const lecturas = crearLecturasCompartidas();
  let mejor: { precio: number; moneda: string; categoria: string; regimen: string; fechaIda: string; fechaRegreso: string; descuento: DescuentoTarjeta | null } | null = null;
  // TODOS los combos fallidos (no solo el último): categoría, régimen y el mensaje de negocio
  // devuelto por computarReserva (o el sintético "sin tarifa doble" de aquí abajo) — el log del
  // servidor los registra todos; el motivo clasificado (lista blanca) solo llega al navegador
  // si quien cotiza es un rol interno con sesión (resuelto más abajo).
  const fallidos: { categoria: string; regimen: string; detalle: string }[] = [];
  const combos: ComboTarjeta[] = [];
  for (const c of e.combos) {
    const reserva: ReservaInput = {
      paqueteId: e.paqueteId, bloqueoId: e.modulo === "bloqueo" ? e.bloqueoId ?? null : null,
      empaquetadoId: e.modulo === "bloqueo" ? e.empaquetadoId ?? null : undefined,
      salidaId: e.modulo === "dinamico" ? e.salidaId : undefined,
      modulo: e.modulo, hotelId: e.hotelId,
      fechaIda: e.modulo === "porcion_terrestre" ? e.fechaIda : undefined, fechaRegreso: e.modulo === "porcion_terrestre" ? e.fechaRegreso : undefined,
      categoria: c.categoria, regimen: c.regimen,
      // Referencia de precio por persona: una habitación doble, dos adultos, sin menores (la misma base del «desde»).
      habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
      cliente: { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [],
    };
    const comp = await computarReserva(sb, reserva, undefined, lecturas);
    if (!comp.ok) { fallidos.push({ categoria: c.categoria, regimen: c.regimen, detalle: comp.error }); continue; }
    const precio = comp.data.pvpPorAcom["doble"];
    if (!(precio > 0)) { fallidos.push({ categoria: c.categoria, regimen: c.regimen, detalle: "sin tarifa doble" }); continue; }
    // Una habitación doble: una sola acomodación, la etiqueta nunca es mixta.
    const d0 = comp.data.descuentoHotel;
    const d = d0?.tipo && d0.umbral != null && d0.pct != null ? { etiqueta: d0.etiqueta, tipo: d0.tipo, umbral: d0.umbral, pct: d0.pct } : null;
    combos.push({
      categoria: c.categoria, regimen: c.regimen, precios: { ...comp.data.pvpPorAcom }, preciosMenor2: { ...comp.data.pvpMenor2PorAcom }, infanteSinFijo: { ...comp.data.pvpInfanteSinFijo },
      descuento: d?.etiqueta ? { etiqueta: d.etiqueta, tipo: d.tipo, umbral: d.umbral, pct: d.pct } : null,
    });
    if (mejor == null || precio < mejor.precio) {
      mejor = {
        precio, moneda: comp.data.monedaReserva, categoria: c.categoria, regimen: c.regimen,
        fechaIda: comp.data.meta.fecha_ida ?? e.fechaIda ?? "", fechaRegreso: comp.data.meta.fecha_regreso ?? e.fechaRegreso ?? "",
        descuento: d?.etiqueta ? { etiqueta: d.etiqueta, tipo: d.tipo, umbral: d.umbral, pct: d.pct } : null,
      };
    }
  }
  if (!mejor) {
    for (const f of fallidos) {
      console.error(`[cotizarTarjetaHotel] paqueteId=${e.paqueteId} hotelId=${e.hotelId} modulo=${e.modulo} categoria=${f.categoria} regimen=${f.regimen} detalle=${f.detalle}`);
    }
    // El motivo real (clasificado contra una lista blanca, nunca el texto crudo de arriba)
    // solo se devuelve al navegador si quien cotiza tiene sesión, un rol interno Y esa cuenta
    // sigue ACTIVA — todo resuelto en el SERVIDOR (nunca se confía en nada que mande el
    // cliente). Público, B2B y un interno desactivado siguen viendo exactamente el mismo
    // mensaje genérico de siempre.
    if (await esInternoActivo(sb)) {
      const motivos = motivosUnicos(fallidos.map((f) => f.detalle));
      return { ok: false, error: MENSAJE, motivos };
    }
    return { ok: false, error: MENSAJE };
  }
  const a = new Date(`${mejor.fechaIda}T00:00:00Z`).getTime(), b = new Date(`${mejor.fechaRegreso}T00:00:00Z`).getTime();
  return {
    ok: true, precio: mejor.precio, moneda: mejor.moneda, categoria: mejor.categoria, regimen: mejor.regimen,
    fechaIda: mejor.fechaIda, fechaRegreso: mejor.fechaRegreso, noches: Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0,
    fechaCalculo: fechaNegocio(), descuentoHotel: mejor.descuento, combos,
  };
}
