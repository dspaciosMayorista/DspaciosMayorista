// ─────────────────────────────────────────────────────────────────────────
// #90 F — COSTOS que dan lugar a una CxP en la conversión de un carrito. FUENTE ÚNICA de las fórmulas.
//
// La revisión previa de moneda (antes de numerar) y la creación del contrato calculan el costo de cada obligación con ESTAS funciones, así que la primera
// evalúa exactamente las CxP que la segunda crearía con importe positivo (ni una más, ni una menos). Nada aquí cambia un importe: son las mismas fórmulas
// que antes vivían en línea dentro de `convertirCotizacionCarrito`.
// ─────────────────────────────────────────────────────────────────────────
import type { createAdminClient } from "@/lib/supabase/admin";
import { noches } from "@/lib/calc/paquetes";
import { costoNetoServicio, MENSAJE_SIN_TARIFA } from "@/lib/calc/servicioTarifa";
import type { FranjaSuplemento, HorasTramos, SuplementoAplicado } from "@/lib/calc/trasladoFranjas";
import { separarFranjas, type FilaTemporadaConFranjas } from "@/lib/reservar/liquidacionServicio";
import { leerTemporadasServicio } from "@/lib/reservar/temporadasServicio";
import { modalidadAlcance, type AlcanceVenta, type FilaPrecioAlcance } from "@/lib/calc/servicioAlcance";
import { leerAlcanceDeServicios } from "@/lib/servicios/alcanceContexto";

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
type TourLiquidable = { servicioId: number; paqueteId: number; pax: number; fechaIda: string | null; fechaRegreso: string | null; horas?: HorasTramos; alcance?: AlcanceVenta };

/**
 * Re-liquida el costo NETO de un tour opcional del carrito con la MISMA función que la venta (lib/calc/servicioTarifa.ts::costoNetoServicio): vigencia
 * aplicable a la fecha, modo persona/grupo con rango de pax, recargo individual si va 1 pax y suplementos de franja horaria según `horas`. SIN tarifa
 * «GENERAL»: sin vigencia, sin rango o sin hora requerida LANZA (el llamador falla cerrado y no numera ni crea CxP con un costo inventado).
 * `null` = el tour ya no está en el paquete (no genera CxP).
 */
export async function liquidarCostoTour(admin: ReturnType<typeof createAdminClient>, t: TourLiquidable): Promise<{ srv: ServicioTour | null; costoNeto: number; suplementos: SuplementoAplicado[]; alcance?: AlcanceVenta } | null> {
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
    leerTemporadasServicio(admin, [t.servicioId]),
  ]);
  if (gruposErr ?? tempsErr) throw new Error((gruposErr ?? tempsErr)!.message);
  if (!t.fechaIda) throw new Error("el tour no tiene fecha de ida para elegir su vigencia de tarifa");
  const { temporadas, franjas } = separarFranjas(((tempsNet ?? []) as unknown as FilaTemporadaConFranjas[]).map((x) => ({ ...x, servicio_id: t.servicioId })));
  const franjasPorTemporada = new Map<string, FranjaSuplemento[]>();
  const nombrePorId = new Map(temporadas.map((x) => [x.id, x.nombre]));
  for (const f of franjas) {
    const n = nombrePorId.get(f.servicio_temporada_id);
    if (n) (franjasPorTemporada.get(n) ?? franjasPorTemporada.set(n, []).get(n)!).push(f);
  }
  // 262: misma modalidad que el precio. Un traslado clasificado exige alcance (si no, NO hay costo: ni se numera ni se crea CxP); un alcance en otro servicio se rechaza.
  const lecAlc = await leerAlcanceDeServicios(admin, [t.servicioId], temporadas.map((x) => x.id).filter((x): x is number => x != null));
  if (!lecAlc.ok) throw new Error("no se pudo validar el alcance del traslado");
  if (!lecAlc.disponible && t.alcance) throw new Error("el alcance del traslado todavía no está habilitado");
  const clasifTour = lecAlc.ok && lecAlc.disponible ? lecAlc.clasificaciones.find((x) => x.servicio_id === t.servicioId) : undefined;
  const alcanceCfg = modalidadAlcance(clasifTour, t.alcance);
  if (!alcanceCfg.ok) throw new Error(alcanceCfg.motivo === "alcance_requerido" ? "el traslado no trae el alcance con que se cotizó (llegada, salida o ida y regreso)" : "el servicio no es un traslado y no admite alcance");
  const preciosAlcancePorTemporada = new Map<string, FilaPrecioAlcance[]>();
  if (lecAlc.ok && lecAlc.disponible) {
    for (const f of lecAlc.preciosAlcance) {
      const n = nombrePorId.get(f.servicio_temporada_id);
      if (n) (preciosAlcancePorTemporada.get(n) ?? preciosAlcancePorTemporada.set(n, []).get(n)!).push({ alcance: f.alcance, pax_desde: f.pax_desde, pax_hasta: f.pax_hasta, precio: f.precio });
    }
  }
  const nochesTour = t.fechaIda && t.fechaRegreso ? (noches(t.fechaIda, t.fechaRegreso) || 1) : 1;
  const costo = costoNetoServicio({
    temporadas, grupos: (gruposNet ?? []).map((g) => ({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: Number(g.precio), temporada: g.temporada })),
    franjasPorTemporada, modo, pax: t.pax, fecha: new Date(`${t.fechaIda}T00:00:00`), liquidacion: srv?.liquidacion ?? null, numNoches: nochesTour, horas: t.horas,
    ...(alcanceCfg.usaAlcance ? { alcance: alcanceCfg.alcance, preciosAlcancePorTemporada } : {}),
    ...(alcanceCfg.tramosCombo ? { tramos: alcanceCfg.tramosCombo } : {}),
  });
  if (!costo.ok) throw new Error(costo.motivo === "hora_requerida" ? `falta la hora de ${(costo.pendientes ?? []).join(" y ")} del traslado` : (MENSAJE_SIN_TARIFA[costo.motivo as keyof typeof MENSAJE_SIN_TARIFA] ?? costo.detalle ?? costo.motivo));
  return { srv, costoNeto: costo.costoNeto, suplementos: costo.suplementos, ...(alcanceCfg.usaAlcance ? { alcance: alcanceCfg.alcance } : {}) };
}

/** Costo de un tour que SÍ genera CxP: finito y positivo; cualquier otro valor no genera obligación. */
export function costoTourParaCxP(liq: { costoNeto: number } | null): number {
  return liq != null && Number.isFinite(liq.costoNeto) && liq.costoNeto > 0 ? liq.costoNeto : 0;
}
