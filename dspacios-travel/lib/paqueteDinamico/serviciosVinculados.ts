// Cobro de los servicios VINCULADOS a su ficha en el paquete dinámico (#82). PURO: lo usa el núcleo del servidor (`resolverSeleccionDin`) y las pruebas, así la
// tarjeta, el checkout, la cotización y el contrato salen del MISMO cobro. Por esquema:
//  · netas+markup → el precio sale de la ficha (vigencia, grupo, menores de 2 años) con el markup del paquete;
//  · solo PVP por componente → el equipo escribe el PVP, pero la UNIDAD de cobro es la de la ficha (por grupo, una vez; por persona, con el PVP de infante);
//  · solo PVP general → el servicio no lleva PVP, pero su capacidad y la cantidad que se guarda para costos/CxP son las de la ficha.
import { pvpDeNeto, type PaqueteDin, type ServicioResuelto } from "@/lib/paqueteDinamico/calculo";
import { cobrarServicioPvp, evaluarServicioFicha, type FichaServicioDin } from "@/lib/paqueteDinamico/servicioFicha";
import type { FilaServicioDin } from "@/lib/paqueteDinamico/modelo";

export function resolverServiciosVinculados(a: {
  calc: Pick<PaqueteDin, "esquema" | "pvpModo" | "pctMk" | "moneda">;
  noches: number; fechaIda: string;
  /** Solo los servicios ELEGIDOS que tienen ficha. */
  servicios: FilaServicioDin[];
  fichas: Map<number, FichaServicioDin>;
  pax: { adultos: number; ninos: number; infantes: number; menoresDeDos: number };
}): { ok: true; resueltos: Record<string, ServicioResuelto> } | { ok: false; error: string } {
  const resueltos: Record<string, ServicioResuelto> = {};
  for (const s of a.servicios) {
    const f = a.fichas.get(s.servicio_id as number);
    if (!f) return { ok: false, error: `El servicio «${s.nombre}» ya no existe en el catálogo.` };
    if (a.calc.esquema === "neta_markup") {
      const ev = evaluarServicioFicha(f, { ...a.pax, fechaIda: a.fechaIda, noches: a.noches });
      if (!ev.ok) return ev;
      const valor = pvpDeNeto(ev.costoNeto, a.calc.pctMk, a.calc.moneda);
      if (!Number.isFinite(valor)) return { ok: false, error: `«${s.nombre}»: no se pudo calcular el precio con su ficha.` };
      resueltos[String(s.id)] = { valor, costoNeto: Math.round(ev.costoNeto), cantidad: ev.cantidad, unidad: ev.texto };
    } else if (a.calc.pvpModo === "general") {
      const v = cobrarServicioPvp(f, a.pax, { persona: 0, infante: 0 });
      if (!v.ok) return v;
      resueltos[String(s.id)] = { valor: 0, costoNeto: 0, cantidad: v.cantidad, unidad: v.texto };
    } else {
      const v = cobrarServicioPvp(f, a.pax, { persona: s.pvp, infante: s.pvp_infante ?? null });
      if (!v.ok) return v;
      resueltos[String(s.id)] = { valor: v.valor, costoNeto: 0, cantidad: v.cantidad, unidad: v.texto };
    }
  }
  return { ok: true, resueltos };
}
