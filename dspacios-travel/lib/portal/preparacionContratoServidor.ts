// O-3 — lectura (service-role) de la preparación de contrato de las cotizaciones QUE LA PANTALLA YA MUESTRA al aliado (sus propias filas). La autorización de cada
// cotización ya la decidió quien arma esa lista; aquí solo se acota por ids, en lotes de 100 (una consulta por tabla y lote por carga de la pestaña, sin sondeos).
import { createAdminClient } from "@/lib/supabase/admin";
import { universoDeViajeros } from "@/lib/reservar/universoViajeros";
import { capturaPasajerosAliado, type EvidenciaCotizacion, type PasajeroAliado, type PreparacionCotizacion } from "@/lib/portal/preparacionContrato";

type Filtro = { in: (c: string, v: number[]) => PromiseLike<{ data: unknown; error: unknown }> & { eq: (c: string, v: boolean) => PromiseLike<{ data: unknown; error: unknown }> } };
type Tabla = { select: (cols: string) => Filtro };

export async function cargarPreparacionPortal(ids: number[]): Promise<{ porCotizacion: Record<number, PreparacionCotizacion>; error: boolean }> {
  const porCotizacion: Record<number, PreparacionCotizacion> = {};
  for (const id of ids) porCotizacion[id] = { evidencias: [], pasajeros: [], captura: { ok: false, motivo: "No pudimos comprobar si esta cotización admite pasajeros adicionales." }, universo: { tipo: "exacto", n: 1 } };
  if (ids.length === 0) return { porCotizacion, error: false };
  // Las tablas son nuevas (325) y aún no están en types/database.ts.
  try {
    // Dentro del try: si el cliente de servicio no se puede crear (entorno), la pantalla avisa que no pudo cargar esto en vez de caerse entera.
    const admin = createAdminClient() as unknown as { from: (t: string) => Tabla };
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const [ct, ev, pa] = await Promise.all([
        // Tipo y nº de pasajeros que YA trae cada cotización: deciden si su conversión consume la lista del aliado (misma regla que la base).
        (admin as unknown as { from: (t: string) => { select: (c: string) => { in: (c: string, v: number[]) => PromiseLike<{ data: unknown; error: unknown }> } } }).from("cotizaciones").select("id, tipo, pax, pasajeros_previos:payload->pasajeros, items:payload->items, tours:payload->tours").in("id", lote),
        admin.from("cotizacion_evidencias").select("id, cotizacion_id, nombre_original, mime, size_bytes, subido_en").in("cotizacion_id", lote).eq("vigente", true),
        admin.from("cotizacion_pasajeros_aliado").select("cotizacion_id, pasajeros").in("cotizacion_id", lote) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
      ]);
      if (ev.error || pa.error || ct.error) return { porCotizacion: {}, error: true };
      for (const c of (ct.data ?? []) as { id: number; tipo: string | null; pax: number | null; pasajeros_previos: unknown; items: unknown; tours: unknown }[]) {
        if (!porCotizacion[c.id]) continue;
        porCotizacion[c.id].captura = capturaPasajerosAliado(c.tipo, Array.isArray(c.pasajeros_previos) ? c.pasajeros_previos.length : 0);
        // Universo declarado: un carrito se descompone en sus unidades (hoteles/bloqueos y tours; un tour con `hotelRef` viaja con ese hotel); lo demás es su pax exacto.
        const lista = (v: unknown) => (Array.isArray(v) ? (v as { pax?: unknown; hotelRef?: unknown }[]) : []);
        const unidades = c.tipo === "carrito"
          ? [...lista(c.items).map((i) => ({ pax: Number(i?.pax) })), ...lista(c.tours).map((t) => ({ pax: Number(t?.pax), vinculada: typeof t?.hotelRef === "string" && t.hotelRef !== "" }))]
          : [];
        porCotizacion[c.id].universo = universoDeViajeros(c.pax, unidades);
      }
      for (const e of (ev.data ?? []) as EvidenciaCotizacion[]) porCotizacion[e.cotizacion_id]?.evidencias.push(e);
      for (const f of (pa.data ?? []) as { cotizacion_id: number; pasajeros: PasajeroAliado[] }[]) if (porCotizacion[f.cotizacion_id]) porCotizacion[f.cotizacion_id].pasajeros = f.pasajeros;
    }
  } catch { return { porCotizacion: {}, error: true }; }
  for (const k of Object.keys(porCotizacion)) porCotizacion[Number(k)].evidencias.sort((a, b) => a.id - b.id);
  return { porCotizacion, error: false };
}
