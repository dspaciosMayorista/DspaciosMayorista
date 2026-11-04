"use server";
// Vista previa autoritativa de la selección de un paquete dinámico (#82): la tarjeta y el checkout muestran EXACTAMENTE lo que el servidor aceptaría al
// cotizar (mismo núcleo `resolverSeleccionDin`: menores por edad, capacidad por habitación, servicios con su ficha). Pública: solo devuelve PVP, nunca costos.
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { composicionValida, vueloPasajeros, type Composicion } from "@/lib/paqueteDinamico/calculo";
import type { FilaHotelDin, FilaPaqueteDin, FilaServicioDin, FilaVueloDin } from "@/lib/paqueteDinamico/modelo";
import { tenantVisibleDin } from "@/lib/paqueteDinamico/cargarPublico";
import { resolverSeleccionDin } from "@/lib/paqueteDinamico/seleccion";

export type VistaPreviaDin =
  | { ok: true; total: number; lineas: { descripcion: string; valor: number }[]; menores: { ninos: number; ninos2: number; infantes: number; menoresDeDos: number };
      /** Pasajeros del vuelo por EDAD (no por las clases del hotel): sillas (adultos + menores desde 2 años) e infantes menores de 2 años sin silla. */
      vuelo: { sillas: number; infantes: number } }
  | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function evaluarSeleccionDin(input: { paqueteId: number; hotelId: number | null; vueloId: number | null; composicion: Composicion; fechaIda: string }): Promise<VistaPreviaDin> {
  if (!composicionValida(input?.composicion)) return { ok: false, error: "La composición de habitaciones y menores no es válida." };
  if (!Number.isInteger(input.paqueteId) || input.paqueteId <= 0) return { ok: false, error: "El paquete no es válido." };
  try {
    const admin = createAdminClient();
    const tenant = await tenantVisibleDin();
    const { data: p } = await admin.from("paquete_din" as never).select("*").eq("id", input.paqueteId).eq("tenant", tenant).eq("publicado", true).eq("activo", true).maybeSingle() as { data: (FilaPaqueteDin & { compra_inicio: string | null; compra_fin: string | null }) | null };
    const hoy = hoyBogota();
    if (!p || (p.compra_inicio && p.compra_inicio > hoy) || (p.compra_fin && p.compra_fin < hoy)) return { ok: false, error: "Este paquete ya no está disponible." };
    const [h, v, s] = await Promise.all(["paquete_din_hoteles", "paquete_din_vuelos", "paquete_din_servicios"].map(async (t) => (await admin.from(t as never).select("*").eq("paquete_id", p.id).order("orden")).data ?? []));
    const hotel = (h as unknown as FilaHotelDin[]).find((x) => x.id === input.hotelId) ?? null;
    const vuelo = (v as unknown as FilaVueloDin[]).find((x) => x.id === input.vueloId) ?? null;
    if (p.usa_hotel && !hotel) return { ok: false, error: "El hotel elegido no pertenece al paquete." };
    if (p.usa_vuelo && !vuelo) return { ok: false, error: "El vuelo elegido no pertenece al paquete." };
    const servicios = s as unknown as FilaServicioDin[];
    if (input.composicion.servicios?.some((x) => !servicios.some((y) => String(y.id) === x))) return { ok: false, error: "Un servicio elegido no pertenece al paquete." };
    if (!ISO.test(input.fechaIda)) {
      if (servicios.some((x) => x.servicio_id != null) && p.usa_servicios) return { ok: false, error: "Elige las fechas del viaje para calcular los servicios." };
    }
    const sel = await resolverSeleccionDin(admin, { paquete: p, hotel, vuelo, servicios, composicion: input.composicion, fechaIda: input.fechaIda });
    if (!sel.ok) return sel;
    return {
      ok: true, total: sel.liq.total, lineas: sel.liq.lineas.map((l) => ({ descripcion: l.descripcion, valor: l.valor })),
      vuelo: (() => { const v = vueloPasajeros(sel.composicion); return { sillas: v.sillas, infantes: v.menoresDeDos }; })(),
      menores: { ninos: sel.composicion.ninos, ninos2: sel.composicion.ninos2, infantes: sel.composicion.infantes, menoresDeDos: (sel.composicion.edadesMenores ?? []).filter((e) => e < 2).length },
    };
  } catch (e) {
    console.error("evaluarSeleccionDin", (e as Error).message);
    return { ok: false, error: "No se pudo calcular la selección. Intenta de nuevo." };
  }
}
