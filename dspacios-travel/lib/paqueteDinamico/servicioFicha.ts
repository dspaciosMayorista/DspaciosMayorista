// Servicio VINCULADO a su ficha en el paquete dinámico (#82). PURO. Reutiliza las reglas reales de los servicios del tarifario normal:
// vigencia por fecha del viaje (`resolverTarifaServicio`), cobro por persona o por grupo con rangos de pasajeros, liquidación por noche/por persona
// (`factorLiquidacion`) y la regla de menores de 2 años (pagan `precio_infante`, no ocupan silla ni cuentan para el rango del grupo:
// `costoServicioContrato`). Un servicio vinculado NO se trata como uno manual: su precio y su aceptación salen de la ficha.
import { MENSAJE_SIN_TARIFA, costoServicioContrato, rangoCubrePax, resolverTarifaServicio, type GrupoServicioFila, type TemporadaServicioFila } from "@/lib/calc/servicioTarifa";

export type FichaServicioDin = {
  id: number; nombre: string; modo: "persona" | "grupo"; liquidacion: string | null; moneda: string;
  temporadas: TemporadaServicioFila[]; grupos: GrupoServicioFila[];
  /** Traslados/combos y servicios con suplementos por horario: su precio depende de alcance y hora, que este producto no captura. */
  noSoportado?: string | null;
};

export type ResumenFicha = { modo: "persona" | "grupo"; texto: string; capacidad: { min: number; max: number } | null };

/** Qué muestra la pantalla de la ficha: cobro y, por grupo, el rango de pasajeros que cubre (el menor de 2 años no cuenta). */
export function resumenFicha(f: Pick<FichaServicioDin, "modo" | "grupos" | "liquidacion">): ResumenFicha {
  if (f.modo === "grupo") {
    const g = f.grupos;
    const min = g.length ? Math.min(...g.map((x) => x.pax_desde)) : 0, max = g.length ? Math.max(...g.map((x) => x.pax_hasta)) : 0;
    return { modo: "grupo", capacidad: g.length ? { min, max } : null, texto: g.length ? `Se cobra por grupo: cubre de ${min} a ${max} pasajeros con silla (los menores de 2 años no cuentan).` : "Se cobra por grupo, pero la ficha no tiene rangos de pasajeros." };
  }
  return { modo: "persona", capacidad: null, texto: "Se cobra por persona; los menores de 2 años pagan la tarifa de infante de la ficha." };
}

/** Servicio vinculado cuyo PRECIO se escribió en el paquete (solo PVP): de la ficha solo importa la capacidad (rango por grupo) con los pasajeros con silla. */
export function validarCapacidadFicha(f: FichaServicioDin, a: { adultos: number; ninos: number; infantes: number; menoresDeDos: number }): { ok: true } | { ok: false; error: string } {
  if (f.noSoportado) return { ok: false, error: `«${f.nombre}»: ${f.noSoportado}` };
  const total = a.adultos + a.ninos + a.infantes;
  const pax = total - Math.min(Math.max(0, a.menoresDeDos), a.ninos + a.infantes);
  const cap = resumenFicha(f).capacidad;
  if (f.modo === "grupo" && (!cap || pax < cap.min || pax > cap.max)) {
    return { ok: false, error: cap ? `«${f.nombre}» cubre de ${cap.min} a ${cap.max} pasajeros con silla y tu grupo es de ${pax} (los menores de 2 años no cuentan). Reduce el grupo o quita este servicio.` : `«${f.nombre}» no tiene rangos de pasajeros en su ficha.` };
  }
  return { ok: true };
}

/** ¿La ficha cobra al infante (menor de 2 años)? Su tarifa de infante > 0, o sin tarifa propia (paga como adulto). Solo aplica al cobro por persona. */
export function cobraInfante(f: Pick<FichaServicioDin, "modo" | "temporadas">): boolean {
  if (f.modo !== "persona") return false;
  return f.temporadas.some((t) => (t.precio_infante == null ? (Number(t.precio_persona) || 0) > 0 : Number(t.precio_infante) > 0));
}

/** Unidad de cobro que queda guardada con el componente (se ve al registrar el costo y en la CxP): un grupo, o N personas (+ M infantes). */
export function unidadCobro(modo: "persona" | "grupo", paxConSilla: number, menoresDeDos: number): { cantidad: number; texto: string } {
  if (modo === "grupo") return { cantidad: 1, texto: `1 grupo (${paxConSilla} pasajero${paxConSilla === 1 ? "" : "s"} con silla)` };
  return { cantidad: paxConSilla + menoresDeDos, texto: `${paxConSilla} persona${paxConSilla === 1 ? "" : "s"}${menoresDeDos ? ` + ${menoresDeDos} infante${menoresDeDos === 1 ? "" : "s"} (menor de 2 años)` : ""}` };
}

export type CobroPvp = { ok: true; valor: number; cantidad: number; texto: string; paxConSilla: number } | { ok: false; error: string };

/**
 * SOLO PVP: el precio lo escribe el equipo, pero la UNIDAD de cobro es la de la ficha. Por grupo: el PVP es del grupo y se cobra UNA vez (dentro del rango
 * válido). Por persona: el PVP por persona se cobra a los pasajeros con silla y los menores de 2 años pagan el PVP de infante, que debe estar definido si la
 * ficha cobra al infante (nunca se vuelve gratis en silencio).
 */
export function cobrarServicioPvp(f: FichaServicioDin, a: { adultos: number; ninos: number; infantes: number; menoresDeDos: number }, pvp: { persona: number | null; infante: number | null }): CobroPvp {
  const cap = validarCapacidadFicha(f, a);
  if (!cap.ok) return cap;
  const md = Math.min(Math.max(0, a.menoresDeDos), a.ninos + a.infantes);
  const pax = a.adultos + a.ninos + a.infantes - md;
  if (!(pax >= 1)) return { ok: false, error: `«${f.nombre}»: debe viajar al menos un pasajero con silla.` };
  if (pvp.persona == null || !Number.isFinite(pvp.persona) || pvp.persona < 0) return { ok: false, error: `«${f.nombre}»: falta su PVP en el paquete.` };
  const u = unidadCobro(f.modo, pax, md);
  if (f.modo === "grupo") return { ok: true, valor: Math.round(pvp.persona), cantidad: u.cantidad, texto: u.texto, paxConSilla: pax };
  let infante = 0;
  if (md > 0) {
    if (pvp.infante == null) {
      if (cobraInfante(f)) return { ok: false, error: `«${f.nombre}» cobra al infante (menor de 2 años) y el paquete no define su PVP. Pide al equipo que lo defina en el montaje.` };
    } else infante = pvp.infante;
  }
  return { ok: true, valor: Math.round(pvp.persona * pax + infante * md), cantidad: u.cantidad, texto: u.texto, paxConSilla: pax };
}

export type EvaluacionServicio = { ok: true; costoNeto: number; paxConSilla: number; totalPax: number; cantidad: number; texto: string } | { ok: false; error: string };

/**
 * Acepta o rechaza la composición según la ficha y, si la acepta, devuelve el costo NETO del servicio para todo el grupo.
 * `fechaIda`: AAAA-MM-DD (la vigencia se resuelve con la fecha de salida). `menoresDeDos`: menores de 2 años dentro de `ninos`+`infantes`.
 */
export function evaluarServicioFicha(f: FichaServicioDin, a: { adultos: number; ninos: number; infantes: number; menoresDeDos: number; fechaIda: string; noches: number; hoy?: string }): EvaluacionServicio {
  if (f.noSoportado) return { ok: false, error: `«${f.nombre}»: ${f.noSoportado}` };
  const totalPax = a.adultos + a.ninos + a.infantes;
  const paxConSilla = totalPax - Math.min(Math.max(0, a.menoresDeDos), a.ninos + a.infantes);
  if (!(paxConSilla >= 1)) return { ok: false, error: `«${f.nombre}»: debe viajar al menos un pasajero con silla.` };
  const fecha = new Date(`${a.fechaIda}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: `«${f.nombre}»: la fecha de salida no es válida.` };
  const t = resolverTarifaServicio({ temporadas: f.temporadas, grupos: f.grupos, modo: f.modo, pax: paxConSilla, fecha, ...(a.hoy ? { hoy: a.hoy } : {}) });
  if (!t.ok) {
    if (t.motivo === "sin_rango_pax") {
      const r = resumenFicha(f).capacidad;
      const rango = r ? `cubre de ${r.min} a ${r.max} pasajeros con silla` : "no tiene rangos de pasajeros";
      return { ok: false, error: `«${f.nombre}» ${rango} y tu grupo es de ${paxConSilla} (${a.adultos} adulto${a.adultos === 1 ? "" : "s"} y ${a.ninos + a.infantes} menor${a.ninos + a.infantes === 1 ? "" : "es"}; los menores de 2 años no cuentan). Reduce el grupo o quita este servicio.` };
    }
    return { ok: false, error: `«${f.nombre}»: ${MENSAJE_SIN_TARIFA[t.motivo]}` };
  }
  const fila = f.temporadas.find((x) => x.nombre === t.temporada);
  const grupos = f.grupos.filter((g) => g.temporada === t.temporada);
  if (f.modo === "grupo" && !rangoCubrePax(grupos, paxConSilla)) return { ok: false, error: `«${f.nombre}»: ningún rango de la ficha cubre ${paxConSilla} pasajeros.` };
  const costoNeto = costoServicioContrato({
    modo: f.modo, netoPersona: t.netoPersona, netoInfanteVigencia: fila?.precio_infante, grupos,
    paxConSilla, numMenoresDeDos: Math.min(Math.max(0, a.menoresDeDos), a.ninos + a.infantes), liquidacion: f.liquidacion, nochesStay: a.noches, totalPax, recargoIndividual: t.recargoIndividual,
  });
  if (!Number.isFinite(costoNeto) || costoNeto < 0) return { ok: false, error: `«${f.nombre}»: el costo de la ficha no es válido.` };
  const md = Math.min(Math.max(0, a.menoresDeDos), a.ninos + a.infantes);
  const u = unidadCobro(f.modo, paxConSilla, md);
  return { ok: true, costoNeto, paxConSilla, totalPax, cantidad: u.cantidad, texto: u.texto };
}
