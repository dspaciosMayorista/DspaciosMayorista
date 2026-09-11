// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — descubrimiento PARALELO de hoteles Bernalo del catálogo
// público, sin pasar por `tarifario_resultado`/`tarifario_resumen` (regla 6
// de la tarea: esas tablas EXCLUYEN a propósito los hoteles
// `modelo_tarifario = 'unidad'` desde Fase 3, ver `generarTarifario` —
// nunca se les escribe una fila ficticia ahí, regla 7).
//
// Este loader NUNCA calcula ni publica un precio (regla 8): solo lista qué
// hoteles Bernalo pertenecen a paquetes activos, para que la grilla los
// muestre con una acción "Consultar tarifa" — el precio real sale, bajo
// demanda, de `cotizarAlojamientoBernaloPublico`
// (`app/tarifario/cotizacionBernaloActions.ts`).
//
// Corrección (auditoría DeepSeek, hallazgo A1): además del hotel, expone
// las SALIDAS aéreas reales del paquete (id/tipo/fechas/etiqueta — NUNCA
// tarifa ni costo, regla A1.7) para que la UI pueda exigir una selección
// inequívoca cuando hay más de una, en vez de que el servidor "tome la
// primera" en silencio. Mismos filtros EXACTOS que el generador legado
// (`generarTarifario`, `app/(dashboard)/dashboard/paquetes/actions.ts`):
// bloqueo con fechas completas; empaquetado activo + fechas completas +
// `empaquetadoVigente(compra_inicio, compra_fin, hoyBogota(...))`.
//
// Mismo criterio de visibilidad que el tarifario ya usa hoy
// (`armado_paquetes.activo = true`, igual que el filtro
// `.eq("paquete_activo", true)` de `cargarFilasTarifarioPaginado`) y mismo
// cliente (service role, `createAdminClient()`) que ya usan
// `cargarDatosTarifario`/`cargarResumenTarifario` para TODAS sus lecturas
// públicas — no es un patrón nuevo, es el que ya usa el tarifario público.
//
// Import relativo con extensión `.ts` (no `@/lib/...`) a propósito: este
// archivo debe poder ejecutarse bajo `node --test` sin bundler, mismo
// motivo documentado en `lib/tarifario/datos.ts`.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "../supabase/admin.ts";
import { empaquetadoVigente, hoyBogota } from "../reservar/origen.ts";

// Identidad discriminada de una salida aérea real — nunca un índice `[0]`.
// El servidor de cotización vuelve a validar que el id/tipo elegido
// pertenece al paquete (ver `cotizacionBernaloActions.ts`); esta lista es
// solo para que la UI sepa qué ofrecer.
export type SalidaAereaBernalo =
  | { tipo: "bloqueo"; id: number; fechaIda: string; fechaRegreso: string; etiqueta: string }
  | { tipo: "empaquetado"; id: number; fechaIda: string; fechaRegreso: string; etiqueta: string };

export type HotelBernaloDescubierto = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  destinoNombre: string | null;
  /** Categorías habilitadas para este hotel en este paquete (`armado_hoteles.categorias`). */
  categorias: string[];
  /** Alimentaciones/regímenes habilitados (`armado_hoteles.regimenes`). */
  regimenes: string[];
  /** `null` = el hotel no tiene moneda configurada — nunca se asume COP (regla A3.13). */
  moneda: "COP" | "USD" | null;
  /** Salidas aéreas válidas del paquete — vacío = porción terrestre (sin vuelo). */
  salidas: SalidaAereaBernalo[];
};

export type ResultadoHotelesBernaloDescubiertos =
  | { ok: true; hoteles: HotelBernaloDescubierto[] }
  | { ok: false; error: string };

// Mismo criterio de normalización que el generador legado
// (`app/(dashboard)/dashboard/paquetes/actions.ts`, `monedaDe`) — pero sin
// colapsar la ausencia a COP: un valor `null`/vacío queda `null` (regla
// A3.13). Esta lista es solo informativa (nunca fija el precio); la
// resolución/validación real vive en `lib/calc/pvpAlojamientoBernalo.ts`.
function monedaExplicita(m: string | null | undefined): "COP" | "USD" | null {
  if (m == null || m.trim() === "") return null;
  return m === "USD" ? "USD" : "COP";
}

/**
 * Lista los hoteles con `modelo_tarifario = 'unidad'` de TODOS los paquetes
 * activos del catálogo — sin precio, sin tocar `tarifario_resultado` — junto
 * con las salidas aéreas reales (id/tipo/fechas/etiqueta) de cada paquete.
 * Puro I/O: no decide nada, solo consulta y da forma a las filas.
 */
export async function cargarHotelesBernaloDescubiertos(): Promise<ResultadoHotelesBernaloDescubiertos> {
  const admin = createAdminClient();

  const { data: paquetes, error: ePq } = await admin
    .from("armado_paquetes")
    .select("id, nombre, destino_id, destinos(nombre)")
    .eq("activo", true);
  if (ePq) return { ok: false, error: ePq.message };
  const paquetesActivos = paquetes ?? [];
  if (!paquetesActivos.length) return { ok: true, hoteles: [] };
  const idsActivos = paquetesActivos.map((p) => p.id);

  const nombrePorPaquete = new Map<number, string>();
  const destinoPorPaquete = new Map<number, string | null>();
  for (const p of paquetesActivos) {
    nombrePorPaquete.set(p.id, p.nombre);
    destinoPorPaquete.set(p.id, (p.destinos as unknown as { nombre: string } | null)?.nombre ?? null);
  }

  const [{ data: filas, error: eAh }, { data: vuelosSel, error: eVuelo }, { data: empaquetadosSel, error: eEmp }] = await Promise.all([
    admin
      .from("armado_hoteles")
      .select("paquete_id, hotel_id, categorias, regimenes, hoteles(nombre, moneda, modelo_tarifario)")
      .in("paquete_id", idsActivos),
    admin
      .from("armado_vuelos")
      .select("paquete_id, bloqueo_id, bloqueos_vuelo(id, ruta, fecha_ida, fecha_regreso)")
      .in("paquete_id", idsActivos),
    admin
      .from("armado_empaquetados")
      .select("paquete_id, empaquetado_id, empaquetados(id, ruta, fecha_ida, fecha_regreso, activo, compra_inicio, compra_fin)")
      .in("paquete_id", idsActivos),
  ]);
  if (eAh) return { ok: false, error: eAh.message };
  if (eVuelo) return { ok: false, error: eVuelo.message };
  if (eEmp) return { ok: false, error: eEmp.message };

  // ── Salidas por paquete — MISMOS filtros exactos que `generarTarifario`
  // (regla A2.8): bloqueo con fechas completas; empaquetado activo +
  // fechas completas + vigente. Nunca se expone `tarifa_para_empaquetar`.
  const hoy = hoyBogota(new Date());
  const salidasPorPaquete = new Map<number, SalidaAereaBernalo[]>();
  const agregar = (paqueteId: number, salida: SalidaAereaBernalo) => {
    const arr = salidasPorPaquete.get(paqueteId) ?? [];
    arr.push(salida);
    salidasPorPaquete.set(paqueteId, arr);
  };
  for (const v of vuelosSel ?? []) {
    const b = v.bloqueos_vuelo as unknown as { id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null } | null;
    if (!b || !b.fecha_ida || !b.fecha_regreso) continue;
    agregar(v.paquete_id, { tipo: "bloqueo", id: b.id, fechaIda: b.fecha_ida, fechaRegreso: b.fecha_regreso, etiqueta: b.ruta || "" });
  }
  for (const v of empaquetadosSel ?? []) {
    const e = v.empaquetados as unknown as {
      id: number; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null;
      activo: boolean; compra_inicio: string | null; compra_fin: string | null;
    } | null;
    if (!e || !e.activo || !e.fecha_ida || !e.fecha_regreso) continue;
    if (!empaquetadoVigente(e.compra_inicio, e.compra_fin, hoy)) continue;
    agregar(v.paquete_id, { tipo: "empaquetado", id: e.id, fechaIda: e.fecha_ida, fechaRegreso: e.fecha_regreso, etiqueta: e.ruta || "" });
  }

  const hoteles: HotelBernaloDescubierto[] = [];
  for (const f of filas ?? []) {
    const hotelMeta = f.hoteles as unknown as { nombre: string; moneda?: string | null; modelo_tarifario?: string | null } | null;
    if (hotelMeta?.modelo_tarifario !== "unidad") continue;
    hoteles.push({
      hotelId: f.hotel_id,
      hotelNombre: hotelMeta.nombre,
      paqueteId: f.paquete_id,
      paqueteNombre: nombrePorPaquete.get(f.paquete_id) ?? "",
      destinoNombre: destinoPorPaquete.get(f.paquete_id) ?? null,
      categorias: (f.categorias as string[] | null) ?? [],
      regimenes: (f.regimenes as string[] | null) ?? [],
      moneda: monedaExplicita(hotelMeta.moneda),
      salidas: salidasPorPaquete.get(f.paquete_id) ?? [],
    });
  }
  return { ok: true, hoteles };
}
