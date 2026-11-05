import "server-only";
// Núcleo SERVIDOR de la selección de un paquete dinámico (#82): lo usan igual la cotización (`crearCotizacionDin`), el checkout y la vista previa de la tarjeta,
// así la pantalla y el servidor aceptan o rechazan EXACTAMENTE lo mismo. Nunca confía en conteos del navegador: Niño 1 / Niño 2 / infante salen de las
// EDADES con los umbrales del hotel y el reparto por habitación; los servicios vinculados se evalúan con su ficha (vigencia, rango por grupo, menores de 2 años).
import type { createAdminClient } from "@/lib/supabase/admin";
import { adultosDe, liquidarPaquete, type Composicion, type PaqueteDin, type ServicioResuelto } from "@/lib/paqueteDinamico/calculo";
import { armarPaqueteCalc, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "@/lib/paqueteDinamico/modelo";
import { resolverMenores } from "@/lib/paqueteDinamico/menores";
import { resolverServiciosVinculados } from "@/lib/paqueteDinamico/serviciosVinculados";
import { cargarFichasServicio, cargarReglasHoteles } from "@/lib/paqueteDinamico/fichas";

type Admin = ReturnType<typeof createAdminClient>;
export type SeleccionResuelta =
  | { ok: true; calc: PaqueteDin; composicion: Composicion; resueltos: Record<string, ServicioResuelto>; liq: ReturnType<typeof liquidarPaquete> }
  | { ok: false; error: string };

export async function resolverSeleccionDin(admin: Admin, a: {
  paquete: FilaPaqueteDin; hotel: FilaHotelDin | null; vuelo: FilaVueloDin | null; servicios: FilaServicioDin[]; composicion: Composicion; fechaIda: string;
}): Promise<SeleccionResuelta> {
  const p = a.paquete;
  const reglas = a.hotel ? (await cargarReglasHoteles(admin, [a.hotel])).get(a.hotel.id) ?? null : null;
  // Adults Only sale de la FICHA (reglas), nunca de lo que traiga la fila ni el navegador.
  const calc = armarPaqueteCalc(p, a.hotel ? { ...a.hotel, adults_only: reglas?.adultsOnly === true } : null, a.vuelo, a.servicios);
  const m = resolverMenores({ habitaciones: a.composicion.habitaciones, edades: a.composicion.edadesMenores, reglas });
  if (!m.ok) return m;
  const paxPorHabitacion = reglas ? Object.fromEntries(reglas.reglas.map((r) => [r.acomodacion, r.pax_tarifa])) : undefined;
  const comp: Composicion = { ...a.composicion, ninos: m.ninos, ninos2: m.ninos2, infantes: m.infantes, edadesMenores: m.edades, paxPorHabitacion };
  if (a.hotel && reglas === null && m.edades.length) {
    // Paquete anterior sin capacidad/edades configuradas: no hay con qué validar a los menores; se pide volver a guardar el hotel.
    return { ok: false, error: "Este hotel no tiene configurada la capacidad de niños ni las edades; no se pueden cotizar menores hasta que el equipo complete su configuración." };
  }

  // Servicios elegidos y vinculados a una ficha.
  const elegidos = p.usa_servicios ? (comp.servicios ? a.servicios.filter((s) => comp.servicios!.includes(String(s.id))) : a.servicios) : [];
  const vinculados = elegidos.filter((s) => s.servicio_id != null);
  let resueltos: Record<string, ServicioResuelto> = {};
  if (vinculados.length) {
    let fichas;
    try { fichas = await cargarFichasServicio(admin, vinculados.map((s) => s.servicio_id as number)); } catch { return { ok: false, error: "No se pudo leer la ficha de un servicio. Intenta de nuevo." }; }
    // Mismo cobro para tarjeta, checkout, cotización y contrato: la unidad (grupo/persona), la capacidad y los menores salen de la ficha.
    const r = resolverServiciosVinculados({
      calc, noches: p.noches, fechaIda: a.fechaIda, servicios: vinculados, fichas,
      pax: { adultos: adultosDe(comp), ninos: comp.ninos + comp.ninos2, infantes: comp.infantes, menoresDeDos: m.menoresDeDos },
    });
    if (!r.ok) return r;
    resueltos = r.resueltos;
  }
  try {
    const liq = liquidarPaquete(calc, comp, resueltos);
    return { ok: true, calc, composicion: comp, resueltos, liq };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
