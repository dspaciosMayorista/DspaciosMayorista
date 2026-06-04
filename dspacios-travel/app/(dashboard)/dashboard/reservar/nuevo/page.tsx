import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { ReservaForm, type Combo, type Meta, type ServicioDisp } from "./ReservaForm";
import type { AcomConfig } from "@/lib/acomodaciones";

export const dynamic = "force-dynamic";

export default async function NuevaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ paquete?: string; hotel?: string; bloqueo?: string; modulo?: string }>;
}) {
  const sp = await searchParams;
  const paqueteId = Number(sp.paquete);
  const hotelId = Number(sp.hotel) || 0;
  const bloqueoId = sp.bloqueo ? Number(sp.bloqueo) : null;
  const modulo = (sp.modulo === "porcion_terrestre" ? "porcion_terrestre" : sp.modulo === "servicios" ? "servicios" : "bloqueo") as Meta["modulo"];
  const esServicios = modulo === "servicios";

  const sb = await createClient();
  let meta: Meta;
  let combos: Combo[] = [];
  let acomConfigs: AcomConfig[] = [];

  if (!esServicios) {
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
    // Edades y pax del hotel (para validar pasajeros ↔ acomodación).
    const { data: hotelRow } = await sb
      .from("hoteles")
      .select("edad_infante_max, edad_nino_max, pax_min, pax_max")
      .eq("id", hotelId)
      .maybeSingle();
    meta = {
      paqueteId, hotelId, bloqueoId, modulo,
      hotelNombre: filas[0].hotel_nombre ?? "",
      destino: filas[0].destino_nombre ?? "",
      fechaIda: filas[0].fecha_ida,
      fechaRegreso: filas[0].fecha_regreso,
      noches: filas[0].noches,
      bloqueoLabel: filas[0].bloqueo_label,
      edadInfanteMax: hotelRow?.edad_infante_max ?? 2,
      edadNinoMax: hotelRow?.edad_nino_max ?? 10,
      paxMinHotel: hotelRow?.pax_min ?? null,
      paxMaxHotel: hotelRow?.pax_max ?? null,
    };
    const map = new Map<string, Combo>();
    for (const f of filas) {
      const categoria = f.categoria ?? "—";
      const regimen = f.regimen ?? "—";
      const key = `${categoria}|||${regimen}`;
      let c = map.get(key);
      if (!c) { c = { categoria, regimen, precios: {} }; map.set(key, c); }
      if (f.acomodacion) c.precios[f.acomodacion] = f.precio_pvp;
    }
    combos = [...map.values()];

    // Config de acomodaciones del hotel (reservar por habitaciones).
    const { data: acoms } = await sb
      .from("hotel_acomodaciones")
      .select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
      .eq("hotel_id", hotelId);
    acomConfigs = (acoms ?? []) as AcomConfig[];
  } else {
    const { data: m } = await sb
      .from("tarifario_resultado")
      .select("paquete_nombre, destino_nombre")
      .eq("paquete_id", paqueteId)
      .eq("modulo", "servicios")
      .limit(1)
      .maybeSingle();
    meta = {
      paqueteId, hotelId: 0, bloqueoId: null, modulo,
      hotelNombre: m?.paquete_nombre ?? "Servicios",
      destino: m?.destino_nombre ?? "",
      fechaIda: null, fechaRegreso: null, noches: null, bloqueoLabel: null,
      edadInfanteMax: 2, edadNinoMax: 10, paxMinHotel: null, paxMaxHotel: null,
    };
  }

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

  // Cupos disponibles del bloqueo (obs 5): se muestran al asesor.
  let cuposDisponibles: number | null = null;
  if (bloqueoId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: cup } = await admin.from("cupos_por_bloqueo").select("cupos_disponibles").eq("id", bloqueoId).maybeSingle();
    cuposDisponibles = cup ? Number(cup.cupos_disponibles) || 0 : null;
  }

  const [{ data: vendedores }, { data: aliados }] = await Promise.all([
    sb.from("usuarios").select("nombre").eq("rol", "venta").eq("activo", true).order("nombre"),
    sb.from("aliados").select("id, nombre, tipo").order("nombre"),
  ]);
  const agencias = (aliados ?? []).filter((a) => (a.tipo ?? "agencia") === "agencia").map((a) => ({ id: a.id, nombre: a.nombre }));
  const freelances = (aliados ?? []).filter((a) => a.tipo === "freelance").map((a) => ({ id: a.id, nombre: a.nombre }));

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/tarifario" className="text-sm text-gray-400 hover:text-gray-600">← Tarifario</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Reservar — {meta.hotelNombre}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {meta.destino}
        {meta.fechaIda ? ` · ${meta.fechaIda} → ${meta.fechaRegreso} (${meta.noches}N)` : ""}
        {meta.bloqueoLabel ? ` · ${meta.bloqueoLabel}` : ""}
        {cuposDisponibles != null && (
          <span style={{ color: cuposDisponibles > 0 ? "var(--brand-success)" : "#dc2626" }}>
            {` · ${cuposDisponibles} cupo(s) disponible(s)`}
          </span>
        )}
      </p>
      {cuposDisponibles === 0 && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Este vuelo no tiene cupos disponibles. No se puede generar el contrato.
        </p>
      )}
      <ReservaForm meta={meta} combos={combos} serviciosDisp={serviciosDisp} acomConfigs={acomConfigs}
        vendedores={vendedores ?? []} agencias={agencias} freelances={freelances} />
    </div>
  );
}
