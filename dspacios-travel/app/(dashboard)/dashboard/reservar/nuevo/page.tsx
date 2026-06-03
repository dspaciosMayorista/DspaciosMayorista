import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ReservaForm, type Combo, type Meta, type ServicioDisp } from "./ReservaForm";

export const dynamic = "force-dynamic";

export default async function NuevaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ paquete?: string; hotel?: string; bloqueo?: string; modulo?: string }>;
}) {
  const sp = await searchParams;
  const paqueteId = Number(sp.paquete);
  const hotelId = Number(sp.hotel);
  const bloqueoId = sp.bloqueo ? Number(sp.bloqueo) : null;
  const modulo = (sp.modulo === "porcion_terrestre" ? "porcion_terrestre" : "bloqueo") as Meta["modulo"];

  const sb = await createClient();
  let q = sb
    .from("tarifario_resultado")
    .select("categoria, regimen, acomodacion, precio_pvp, hotel_nombre, destino_nombre, fecha_ida, fecha_regreso, noches, bloqueo_label")
    .eq("paquete_id", paqueteId)
    .eq("hotel_id", hotelId);
  q = bloqueoId ? q.eq("bloqueo_id", bloqueoId) : q.is("bloqueo_id", null);
  const { data: filas } = await q;

  if (!filas || !filas.length) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Link href="/tarifario" className="text-sm text-gray-400 hover:text-gray-600">← Tarifario</Link>
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No se encontró la tarifa seleccionada. Vuelve al tarifario y elige de nuevo.
        </p>
      </div>
    );
  }

  const meta: Meta = {
    paqueteId, hotelId, bloqueoId, modulo,
    hotelNombre: filas[0].hotel_nombre ?? "",
    destino: filas[0].destino_nombre ?? "",
    fechaIda: filas[0].fecha_ida,
    fechaRegreso: filas[0].fecha_regreso,
    noches: filas[0].noches,
    bloqueoLabel: filas[0].bloqueo_label,
  };

  // Agrupa categoría → régimen → {acomodación: pvp}
  const map = new Map<string, Combo>();
  for (const f of filas) {
    const categoria = f.categoria ?? "—";
    const regimen = f.regimen ?? "—";
    const key = `${categoria}|||${regimen}`;
    let c = map.get(key);
    if (!c) { c = { categoria, regimen, precios: {} }; map.set(key, c); }
    if (f.acomodacion) c.precios[f.acomodacion] = f.precio_pvp;
  }
  const combos = [...map.values()];

  // Servicios del paquete (PVP publicado) → add-ons en la reserva
  const { data: servFilas } = await sb
    .from("tarifario_resultado")
    .select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp")
    .eq("paquete_id", paqueteId)
    .eq("modulo", "servicios");
  const servMap = new Map<number, ServicioDisp>();
  for (const r of servFilas ?? []) {
    if (r.servicio_id == null) continue;
    let s = servMap.get(r.servicio_id);
    if (!s) {
      s = { servicioId: r.servicio_id, nombre: r.servicio_nombre ?? "—", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] };
      servMap.set(r.servicio_id, s);
    }
    if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
    else s.personaPvp = r.precio_pvp;
  }
  const serviciosDisp = [...servMap.values()];

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/tarifario" className="text-sm text-gray-400 hover:text-gray-600">← Tarifario</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Reservar — {meta.hotelNombre}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {meta.destino}
        {meta.fechaIda ? ` · ${meta.fechaIda} → ${meta.fechaRegreso} (${meta.noches}N)` : ""}
        {meta.bloqueoLabel ? ` · ${meta.bloqueoLabel}` : ""}
      </p>
      <ReservaForm meta={meta} combos={combos} serviciosDisp={serviciosDisp} />
    </div>
  );
}
