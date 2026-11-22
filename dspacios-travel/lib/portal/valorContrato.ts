/**
 * #84 (ADL-039) — Tras convertirse una cotización en contrato, el portal muestra el valor ACTUAL del contrato (`ventas.precio_venta`, en vivo) y enlaza a él;
 * el valor de la cotización se conserva y se rotula como histórico. Nada se recalcula ni se «corrige» para que ambos coincidan: si personal interno cambió el
 * contrato, el aliado ve el número vigente y, aparte, el que se le cotizó.
 *
 * Lectura mínima con service-role: solo número, precio, moneda, estado y las dos llaves de pertenencia — NINGUNA columna de costo o margen viaja hacia la pantalla.
 * El valor se ofrece SOLO si el contrato es del aliado de la sesión por id (`aliado_id` de su ficha o `b2b_usuario_id` = su usuario); jamás por nombre. Si no se puede
 * acreditar (contrato sin enlazar, de otro aliado, lectura incompleta) la fila conserva solo el valor cotizado, con su rótulo, y no se inventa nada.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { origenVenta, contratoAnulado } from "@/lib/portal/b2bPortal";

export type AdminValor = { from(tabla: string): any };
export type ContratoVigente = { numero: string; valor: number; moneda: string; anulado: boolean; vista: "directas" | "asistidas" };

type FilaVenta = { numero_contrato: string; precio_venta: number | string | null; moneda: string | null; estado: string | null; aliado_id: number | null; b2b_usuario_id: string | null };
const COLUMNAS = "numero_contrato, precio_venta, moneda, estado, aliado_id, b2b_usuario_id";

/** Pertenencia por id (nunca por nombre). Pura: la usan el cargador y las pruebas. */
export function contratoEsDelAliado(v: Pick<FilaVenta, "aliado_id" | "b2b_usuario_id">, ctx: { userId: string; aliadoId: number | null }): boolean {
  return (ctx.aliadoId != null && v.aliado_id === ctx.aliadoId) || (!!v.b2b_usuario_id && v.b2b_usuario_id === ctx.userId);
}

/**
 * `numeros` = números de contrato de las cotizaciones convertidas que el aliado ya ve en su lista. Devuelve el valor vigente de los que se pueden acreditar.
 * Una lectura que no se pueda completar devuelve `error: true` y un mapa vacío (la pantalla avisa; no se muestra un valor a medias).
 */
export async function cargarValorContratos(
  admin: AdminValor, ctx: { userId: string; aliadoId: number | null }, numeros: ReadonlyArray<string | null | undefined>,
): Promise<{ mapa: Map<string, ContratoVigente>; error: boolean }> {
  const nums = [...new Set(numeros.filter((n): n is string => typeof n === "string" && n.length > 0))];
  const mapa = new Map<string, ContratoVigente>();
  for (let i = 0; i < nums.length; i += 100) {
    const lote = nums.slice(i, i + 100);
    const pedidos = new Set(lote);
    const r = await leerTodoConConteo<FilaVenta>(
      (d, h) => admin.from("ventas").select(COLUMNAS, { count: "exact" }).in("numero_contrato", lote).order("numero_contrato", { ascending: true }).range(d, h) as PromiseLike<PaginaConConteo<FilaVenta>>,
      PAGINA_FILAS,
      (f) => pedidos.has(String(f?.numero_contrato)),
    );
    if (!r.completa) return { mapa: new Map(), error: true };
    for (const v of r.filas) {
      if (!contratoEsDelAliado(v, ctx)) continue;
      const valor = v.precio_venta == null || v.precio_venta === "" ? NaN : Number(v.precio_venta);
      if (!Number.isFinite(valor) || valor < 0) continue; // nunca se infiere un cero a partir de un dato ausente
      mapa.set(v.numero_contrato, {
        numero: v.numero_contrato, valor, moneda: v.moneda || "COP", anulado: contratoAnulado({ estado: v.estado }),
        vista: origenVenta({ relacion: "propio", b2b_usuario_id: v.b2b_usuario_id }, ctx.userId) === "directa" ? "directas" : "asistidas",
      });
    }
  }
  return { mapa, error: false };
}
