/**
 * #85 — Carga de vuelos por contrato PROPIO para el portal B2B (servidor, service-role).
 *
 * La autorización no se decide aquí: recibe las ventas que `cargarConjuntoPortal` ya autorizó y descarta
 * toda la de `relacion !== "propio"` (participar en la comisión no da acceso al itinerario). Nunca se
 * leen ids que vengan del navegador. Todas las lecturas son por lotes, paginadas y con conteo exacto; si
 * alguna no se completa, el contrato afectado se marca `incompleto` en vez de mostrarse a medias.
 * Columnas explícitas: sin notas, costos, cupos, sillas ni datos de pasajeros.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { armarTramosPortal, type FuenteVuelo, type TramoFila, type TramoPortal, type VentaRef } from "@/lib/portal/vuelosContrato";

type Fila = Record<string, unknown>;
// Mínimo que necesitamos del cliente (permite probar con un doble sin Supabase).
export type AdminLectura = { from: (tabla: string) => any };

export type VuelosContrato = { tramos: TramoPortal[]; incompleto: boolean };
export type VentaAutorizada = { numero_contrato: string; relacion: "propio" | "participacion" };

const COLS_TRAMO = "id, numero_contrato, direccion, aerolinea, origen_codigo, destino_codigo, origen_ciudad, destino_ciudad, numero_vuelo, hora_salida, hora_llegada, fecha_salida, record, orden, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, fecha_regreso";
const COLS_FUENTE = "id, record, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg";

async function porLotes<T extends Fila>(
  claves: (string | number)[], leer: (lote: (string | number)[], d: number, h: number) => PromiseLike<PaginaConConteo<T>>, clave: (f: T) => string,
): Promise<{ filas: T[]; completa: boolean }> {
  const filas: T[] = [];
  for (let i = 0; i < claves.length; i += 100) {
    const lote = claves.slice(i, i + 100);
    const pedidos = new Set(lote.map(String));
    const r = await leerTodoConConteo<T>((d, h) => leer(lote, d, h), PAGINA_FILAS, (f) => pedidos.has(clave(f)));
    if (!r.completa) return { filas: [], completa: false };
    filas.push(...r.filas);
  }
  return { filas, completa: true };
}

export async function cargarVuelosPortal(admin: AdminLectura, ventas: VentaAutorizada[]): Promise<{ porContrato: Map<string, VuelosContrato>; completa: boolean }> {
  const propios = [...new Set(ventas.filter((v) => v.relacion === "propio").map((v) => v.numero_contrato))];
  const porContrato = new Map<string, VuelosContrato>();
  if (!propios.length) return { porContrato, completa: true };

  const [refs, tramos] = await Promise.all([
    porLotes<Fila>(propios, (lote, d, h) => admin.from("ventas").select("numero_contrato, bloqueo_ref_id, empaquetado_ref_id", { count: "exact" })
      .in("numero_contrato", lote).order("numero_contrato", { ascending: true }).range(d, h), (f) => String(f.numero_contrato)),
    porLotes<Fila>(propios, (lote, d, h) => admin.from("contrato_vuelos").select(COLS_TRAMO, { count: "exact" })
      .in("numero_contrato", lote).order("id", { ascending: true }).range(d, h), (f) => String(f.numero_contrato)),
  ]);
  if (!refs.completa || !tramos.completa) {
    for (const n of propios) porContrato.set(n, { tramos: [], incompleto: true });
    return { porContrato, completa: false };
  }

  const refDe = new Map<string, VentaRef>();
  for (const f of refs.filas) {
    refDe.set(String(f.numero_contrato), {
      numero_contrato: String(f.numero_contrato),
      bloqueo_ref_id: typeof f.bloqueo_ref_id === "number" ? f.bloqueo_ref_id : null,
      empaquetado_ref_id: typeof f.empaquetado_ref_id === "number" ? f.empaquetado_ref_id : null,
    });
  }
  const idsB = [...new Set([...refDe.values()].map((r) => r.bloqueo_ref_id).filter((x): x is number => x != null))];
  const idsE = [...new Set([...refDe.values()].map((r) => r.empaquetado_ref_id).filter((x): x is number => x != null))];
  const [bq, em] = await Promise.all([
    idsB.length ? porLotes<Fila>(idsB, (lote, d, h) => admin.from("bloqueos_vuelo").select(COLS_FUENTE, { count: "exact" }).in("id", lote).order("id", { ascending: true }).range(d, h), (f) => String(f.id)) : Promise.resolve({ filas: [] as Fila[], completa: true }),
    idsE.length ? porLotes<Fila>(idsE, (lote, d, h) => admin.from("empaquetados").select(COLS_FUENTE, { count: "exact" }).in("id", lote).order("id", { ascending: true }).range(d, h), (f) => String(f.id)) : Promise.resolve({ filas: [] as Fila[], completa: true }),
  ]);
  // Si la fuente no se pudo leer completa, esos contratos se muestran solo con lo contratado (nunca se afirma vínculo).
  const fuenteDe = (tipo: FuenteVuelo["tipo"], f: Fila): FuenteVuelo => ({ ...(f as unknown as Omit<FuenteVuelo, "tipo">), tipo });
  const bloqueos = new Map<number, FuenteVuelo>(bq.completa ? bq.filas.map((f) => [Number(f.id), fuenteDe("bloqueo", f)]) : []);
  const empaq = new Map<number, FuenteVuelo>(em.completa ? em.filas.map((f) => [Number(f.id), fuenteDe("empaquetado", f)]) : []);

  const tramosDe = new Map<string, TramoFila[]>();
  for (const f of tramos.filas) {
    const k = String(f.numero_contrato);
    (tramosDe.get(k) ?? tramosDe.set(k, []).get(k)!).push(f as unknown as TramoFila);
  }
  for (const n of propios) {
    const ref = refDe.get(n) ?? { numero_contrato: n, bloqueo_ref_id: null, empaquetado_ref_id: null };
    porContrato.set(n, {
      tramos: armarTramosPortal(tramosDe.get(n) ?? [], ref, {
        bloqueo: ref.bloqueo_ref_id != null ? bloqueos.get(ref.bloqueo_ref_id) ?? null : null,
        empaquetado: ref.empaquetado_ref_id != null ? empaq.get(ref.empaquetado_ref_id) ?? null : null,
      }, {
        // Lectura fallida o fila referenciada ausente: «no se pudo comprobar», no «sin vínculo».
        bloqueo: ref.bloqueo_ref_id != null && (!bq.completa || !bloqueos.has(ref.bloqueo_ref_id)),
        empaquetado: ref.empaquetado_ref_id != null && (!em.completa || !empaq.has(ref.empaquetado_ref_id)),
      }),
      incompleto: false,
    });
  }
  return { porContrato, completa: true };
}
