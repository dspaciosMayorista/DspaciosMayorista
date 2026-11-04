"use server";

// #90 — Precio de la TARJETA pública del hotel para fechas concretas, junto con la regla EBB / Long Stay que realmente ganó.
// Una sola fuente: `computarReserva` (el mismo cálculo que cotiza, convierte y cobra): para porción terrestre liquida las fechas elegidas con el motor en vivo; para bloqueo,
// empaquetado y salida recompone el precio PUBLICADO con el descuento de HOY (misma regla de mayor porcentaje, sin sumar). Precio y etiqueta salen de ese único cómputo.
// Públicas por diseño (como el checkout): devuelven solo PVP por persona; los motivos internos van al log, no al navegador.
import { createClient } from "@/lib/supabase/server";
import { computarReserva, type ReservaInput } from "@/lib/reservar/computo";
import { validarEntradaTarjeta, MENSAJE_TARJETA as MENSAJE, type ComboTarjeta, type DescuentoTarjeta } from "@/lib/tarifario/entradaTarjeta";
import { fechaNegocio } from "@/lib/fechaNegocio";

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
  | { ok: false; error: string };

export async function cotizarTarjetaHotel(raw: unknown): Promise<TarjetaCotizada> {
  const v = validarEntradaTarjeta(raw);
  if (!v.ok) return v;
  const e = v.entrada;
  const sb = await createClient();
  let mejor: { precio: number; moneda: string; categoria: string; regimen: string; fechaIda: string; fechaRegreso: string; descuento: DescuentoTarjeta | null } | null = null;
  let ultimoError = "";
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
    const comp = await computarReserva(sb, reserva);
    if (!comp.ok) { ultimoError = comp.error; continue; }
    const precio = comp.data.pvpPorAcom["doble"];
    if (!(precio > 0)) { ultimoError = "sin tarifa doble"; continue; }
    const d = comp.data.descuentoHotel;
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
    console.error(`[cotizarTarjetaHotel] paqueteId=${e.paqueteId} hotelId=${e.hotelId} modulo=${e.modulo} detalle=${ultimoError}`);
    return { ok: false, error: MENSAJE };
  }
  const a = new Date(`${mejor.fechaIda}T00:00:00Z`).getTime(), b = new Date(`${mejor.fechaRegreso}T00:00:00Z`).getTime();
  return {
    ok: true, precio: mejor.precio, moneda: mejor.moneda, categoria: mejor.categoria, regimen: mejor.regimen,
    fechaIda: mejor.fechaIda, fechaRegreso: mejor.fechaRegreso, noches: Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0,
    fechaCalculo: fechaNegocio(), descuentoHotel: mejor.descuento, combos,
  };
}
