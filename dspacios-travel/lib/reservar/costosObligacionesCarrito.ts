// ─────────────────────────────────────────────────────────────────────────
// #90 F — COSTOS que dan lugar a una CxP en la conversión de un carrito. FUENTE ÚNICA de las fórmulas.
//
// La revisión previa de moneda (antes de numerar) y la creación del contrato calculan el costo de cada obligación con ESTAS funciones, así que la primera
// evalúa exactamente las CxP que la segunda crearía con importe positivo (ni una más, ni una menos). Nada aquí cambia un importe: son las mismas fórmulas
// que antes vivían en línea dentro de `convertirCotizacionCarrito`.
// ─────────────────────────────────────────────────────────────────────────
import type { createAdminClient } from "@/lib/supabase/admin";
import { precioServicio, noches, temporadaVigenteParaFecha, toTemporadaRango, factorLiquidacion, type TemporadaRango } from "@/lib/calc/paquetes";

/** Costo neto del hotel por persona: Σ neto por acomodación × pax + niños 1/2 + infantes (las filas sin neto no suman). */
export function costoHotelPersona(
  comp: { lineasHab: ReadonlyArray<{ acom: string; pax: number }>; netoPorAcom: Record<string, number | null | undefined>; numNinos: number; numNinos2: number },
  numInfantes: number,
): number {
  let costo = 0;
  for (const l of comp.lineasHab) { const per = comp.netoPorAcom[l.acom]; if (per != null) costo += per * l.pax; }
  if (comp.numNinos > 0 && comp.netoPorAcom["nino"] != null) costo += (comp.netoPorAcom["nino"] as number) * comp.numNinos;
  if (comp.numNinos2 > 0 && comp.netoPorAcom["nino2"] != null) costo += (comp.netoPorAcom["nino2"] as number) * comp.numNinos2;
  if (numInfantes > 0 && comp.netoPorAcom["infante"] != null) costo += (comp.netoPorAcom["infante"] as number) * numInfantes;
  return costo;
}

/** Costo aéreo de un bloqueo por persona: tarifa × pax con silla + fee de infante × menores de 2 años. */
export function costoAereoBloqueo(bq: { tarifa_para_empaquetar: unknown; fee_infante: unknown }, paxConSilla: number, numMenoresDeDos: number): number {
  return (Number(bq.tarifa_para_empaquetar) || 0) * paxConSilla + (Number(bq.fee_infante) || 0) * numMenoresDeDos;
}

/** Costo aéreo REAL de un hotel Bernalo con vuelo: neto × pax con silla + fee de infante × (pax − pax con silla). */
export function costoVueloBernalo(dv: { costo_neto: number; fee_infante: number }, paxTotal: number, paxConSilla: number): number {
  return dv.costo_neto * paxConSilla + dv.fee_infante * (paxTotal - paxConSilla);
}

export type ProveedorTour = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
export type ServicioTour = {
  precio_persona: number | null; recargo_individual: number | null; categoria: string | null; nombre: string; liquidacion: string | null;
  proveedor_id: number | null; proveedores: ProveedorTour;
};
type TourLiquidable = { servicioId: number; paqueteId: number; pax: number; fechaIda: string | null; fechaRegreso: string | null };

/**
 * Re-liquida el costo NETO de un tour opcional del carrito con la misma fórmula del flujo de reserva (temporada vigente, modo persona/grupo, recargo
 * individual si va 1 pax). `null` = el tour ya no está en el paquete (no genera CxP). Lanza ante un error de lectura (el llamador falla cerrado).
 */
export async function liquidarCostoTour(admin: ReturnType<typeof createAdminClient>, t: TourLiquidable): Promise<{ srv: ServicioTour | null; costoNeto: number } | null> {
  const { data: arm, error: armErr } = await admin
    .from("armado_servicios")
    .select("modo, servicios_adicionales(precio_persona, recargo_individual, categoria, nombre, liquidacion, proveedor_id, proveedores(nombre, aplica_retencion, pct_retencion))")
    .eq("paquete_id", t.paqueteId).eq("servicio_id", t.servicioId).maybeSingle();
  // Un error de lectura se distingue de un tour que ya no está en el paquete.
  if (armErr) throw new Error(armErr.message);
  if (!arm) return null;
  const srv = arm.servicios_adicionales as unknown as ServicioTour | null;
  const modo = (arm.modo as string) === "grupo" ? "grupo" : "persona";
  const [{ data: gruposNet, error: gruposErr }, { data: tempsNet, error: tempsErr }] = await Promise.all([
    admin.from("servicio_tarifa_pax").select("pax_desde, pax_hasta, precio, temporada").eq("servicio_id", t.servicioId),
    admin.from("servicio_temporadas").select("nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").eq("servicio_id", t.servicioId),
  ]);
  if (gruposErr ?? tempsErr) throw new Error((gruposErr ?? tempsErr)!.message);
  const tempsRango: TemporadaRango[] = (tempsNet ?? []).map((tt) => toTemporadaRango(tt));
  const nombreTemp = t.fechaIda && tempsRango.length ? temporadaVigenteParaFecha(new Date(`${t.fechaIda}T00:00:00`), tempsRango) : null;
  const netoTemp = nombreTemp ? (tempsNet ?? []).find((tt) => tt.nombre === nombreTemp) ?? null : null;
  const netoPersona = netoTemp?.precio_persona ?? srv?.precio_persona ?? null;
  const gruposGeneral = (gruposNet ?? []).filter((g) => (g.temporada ?? "GENERAL") === "GENERAL").map((g) => ({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio }));
  const gruposTempArr = nombreTemp ? (gruposNet ?? []).filter((g) => g.temporada === nombreTemp).map((g) => ({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio })) : [];
  const grupos = gruposTempArr.length ? gruposTempArr : gruposGeneral;
  const nochesTour = t.fechaIda && t.fechaRegreso ? (noches(t.fechaIda, t.fechaRegreso) || 1) : 1;
  let costoNeto = precioServicio(modo, netoPersona, grupos, t.pax) * factorLiquidacion(srv?.liquidacion ?? null, nochesTour);
  if (modo === "persona" && t.pax === 1) {
    const recTemp = netoTemp?.recargo_individual;
    costoNeto += Math.max(Number(recTemp ?? srv?.recargo_individual) || 0, 0);
  }
  return { srv, costoNeto };
}

/** Costo de un tour que SÍ genera CxP: finito y positivo; cualquier otro valor no genera obligación. */
export function costoTourParaCxP(liq: { costoNeto: number } | null): number {
  return liq != null && Number.isFinite(liq.costoNeto) && liq.costoNeto > 0 ? liq.costoNeto : 0;
}
