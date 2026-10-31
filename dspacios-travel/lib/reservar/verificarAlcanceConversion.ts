// ─────────────────────────────────────────────────────────────────────────
// Verificación, ANTES de numerar, de los servicios de una cotización de carrito que usan la modalidad por ALCANCE (262, provisional).
//
// La cotización es un snapshot congelado: antes de crear contrato y CxP se acredita, contra el catálogo VIVO, que cada traslado conserva su alcance, su precio y su
// composición (misma liquidación que la venta: lib/reservar/liquidacionServicio.ts vía liquidarServicioPuntual, con las horas VIGENTES). Falla cerrado:
//  - alcance con un valor ajeno a llegada | salida | ida_regreso (payload alterado);
//  - servicio clasificado como traslado SIN alcance, o alcance en un servicio que no es traslado (cotización anterior o alterada);
//  - el precio vivo no se puede calcular (sin tarifa propia para ese alcance y rango de pasajeros, sin vigencia, sin hora) o difiere del cotizado.
// Un servicio SIN la modalidad nueva (sin clasificar, tour, asistencia) no se toca: conserva su comportamiento anterior, incluido confiar en el precio congelado.
// ─────────────────────────────────────────────────────────────────────────
import { modalidadAlcance, parseAlcanceVenta, ROTULO_ALCANCE_VENTA, type AlcanceVenta } from "@/lib/calc/servicioAlcance";
import type { HorasTramos } from "@/lib/calc/trasladoFranjas";
import { leerAlcanceDeServicios } from "@/lib/servicios/alcanceContexto";
import { liquidarServicioPuntual } from "@/lib/reservar/cotizar";

type Cliente = Parameters<typeof leerAlcanceDeServicios>[0];
export type TourParaVerificar = {
  idx: number; nombre: string; servicioId?: number | null; paqueteId?: number | null; pax: number; fechaIda: string | null; fechaRegreso: string | null;
  precio: number; moneda: string; alcance?: unknown; horasVigentes?: HorasTramos;
};

export const etiquetaAlcanceTraslado = (a: AlcanceVenta | undefined): string => (a ? ROTULO_ALCANCE_VENTA[a] : "");

export async function verificarToursConAlcance(
  admin: Cliente, tours: readonly TourParaVerificar[],
): Promise<{ ok: true; alcancePorIdx: Map<number, AlcanceVenta> } | { ok: false; error: string }> {
  const alcancePorIdx = new Map<number, AlcanceVenta>();
  const conId = tours.filter((t) => t.servicioId != null && t.paqueteId != null);
  if (!conId.length) {
    // Sin ids no hay re-liquidación posible (cotizaciones legadas): solo se impide que traigan un alcance.
    const raro = tours.find((t) => t.alcance != null);
    return raro ? { ok: false, error: `El servicio «${raro.nombre}» trae un alcance que no se puede acreditar. Recotiza antes de generar el contrato. No se creó ningún contrato.` } : { ok: true, alcancePorIdx };
  }
  const lec = await leerAlcanceDeServicios(admin, [...new Set(conId.map((t) => t.servicioId as number))], []);
  if (!lec.ok) return { ok: false, error: "No se pudo validar el alcance de los traslados; no se crea ningún contrato. Intenta de nuevo." };
  for (const t of tours) {
    const pa = parseAlcanceVenta(t.alcance);
    if (!pa.ok) return { ok: false, error: `El servicio «${t.nombre}» trae un alcance inválido. Recotiza antes de generar el contrato. No se creó ningún contrato.` };
    if (t.servicioId == null || t.paqueteId == null) {
      if (pa.alcance) return { ok: false, error: `El servicio «${t.nombre}» trae un alcance que no se puede acreditar. Recotiza antes de generar el contrato. No se creó ningún contrato.` };
      continue;
    }
    const clasif = lec.disponible ? lec.clasificaciones.find((x) => x.servicio_id === t.servicioId) : undefined;
    const mod = modalidadAlcance(clasif, pa.alcance);
    if (!mod.ok) {
      return { ok: false, error: mod.motivo === "alcance_requerido"
        ? `El traslado «${t.nombre}» se cotizó sin indicar si es de llegada, de salida o de ida y regreso. Recotiza antes de generar el contrato. No se creó ningún contrato.`
        : `El servicio «${t.nombre}» no es un traslado y no admite alcance. Recotiza antes de generar el contrato. No se creó ningún contrato.` };
    }
    if (!mod.usaAlcance) continue; // modalidad anterior: sin cambios
    const vivo = await liquidarServicioPuntual({
      paqueteId: t.paqueteId, servicioId: t.servicioId, fechaIda: t.fechaIda ?? "", fechaRegreso: t.fechaRegreso ?? "", pax: t.pax, horas: t.horasVigentes, alcance: pa.alcance,
    });
    if (!vivo.ok) return { ok: false, error: `El traslado «${t.nombre}» ya no se puede vender con ese alcance (${vivo.mensaje}). Recotiza antes de generar el contrato. No se creó ningún contrato.` };
    if (vivo.resultado.alcance !== pa.alcance || vivo.resultado.total !== t.precio || vivo.resultado.moneda !== t.moneda) {
      return { ok: false, error: `El precio del traslado «${t.nombre}» (${etiquetaAlcanceTraslado(pa.alcance).toLowerCase()}) cambió desde que se cotizó. Recotiza antes de generar el contrato. No se creó ningún contrato.` };
    }
    alcancePorIdx.set(t.idx, pa.alcance as AlcanceVenta);
  }
  return { ok: true, alcancePorIdx };
}
