/**
 * ¿TIENE ESTE CONTRATO UNA FICHA DE ALIADO EN SU COMISIÓN MANUAL?
 *
 * Una fila de `aliados_b2b` con `aliado_id` es un vínculo POR ID entre el
 * contrato y una ficha del catálogo. Si existe, el respaldo legacy por nombre
 * queda prohibido para ese contrato (`accesoDocumentoContrato`). Por eso esta
 * pregunta es de AUTORIZACIÓN, no de presentación, y tiene que fallar cerrado:
 *
 *   un error, una respuesta incompleta, el límite de filas por respuesta del
 *   proyecto (Settings → API → Max rows) o una paginación rota NUNCA pueden
 *   leerse como "no hay ficha", porque "no hay ficha" ABRE el acceso por
 *   nombre.
 *
 * Cómo se garantiza que la respuesta está completa:
 *   · Se consulta por LOTES de números (URLs acotadas, `.in()` corto).
 *   · Cada lote se pagina en orden estable por `id`, pidiendo `count: "exact"`,
 *     y se avanza por las filas REALMENTE recibidas (el servidor puede devolver
 *     menos que el tamaño de página pedido).
 *   · Solo se da por completa cuando lo recibido iguala el total contado.
 *   · Cualquier anomalía —error, `data` no lista, `count` ausente o cambiante,
 *     página vacía antes de completar, más filas que las pedidas, una fila de
 *     un número que no se preguntó, una excepción— devuelve `completa: false`.
 *
 * La lógica es pura respecto de Supabase: la consulta se inyecta
 * (`ConsultarFichas`). `consultarFichasSupabase` es el adaptador real que usan
 * el portal B2B y los documentos por URL, así que los dos deciden con el MISMO
 * código.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type PaginaFichas = {
  data: { numero_contrato: unknown }[] | null;
  error: unknown;
  count: number | null;
};

/** Filas de `aliados_b2b` CON `aliado_id` de un lote de números, rango [desde, hasta]. */
export type ConsultarFichas = (lote: string[], desde: number, hasta: number) => PromiseLike<PaginaFichas>;

export type VerificacionFichas =
  | { completa: true; conFicha: ReadonlySet<string> }
  | { completa: false; motivo: string };

export const LOTE_NUMEROS = 100;
export const PAGINA_FILAS = 1000;

/**
 * Lee TODAS las filas de una consulta paginada, o dice que no pudo. Pide
 * `count: "exact"`, avanza por las filas realmente recibidas y solo da por
 * completa la lectura cuando lo recibido iguala el total contado. Cualquier
 * anomalía (error, sin datos, sin conteo o conteo cambiante, más filas que las
 * pedidas, página vacía antes de terminar, fila que no pasa `validar`,
 * excepción) devuelve `completa: false`.
 */
export type PaginaConConteo<T> = { data: T[] | null; error: unknown; count: number | null };
export type LecturaCompleta<T> = { completa: true; filas: T[] } | { completa: false; motivo: string };

export async function leerTodoConConteo<T>(
  consultar: (desde: number, hasta: number) => PromiseLike<PaginaConConteo<T>>,
  tamPagina: number = PAGINA_FILAS,
  validar: (fila: T) => boolean = () => true
): Promise<LecturaCompleta<T>> {
  const fallo = (motivo: string): LecturaCompleta<T> => ({ completa: false, motivo });
  const filas: T[] = [];
  let total: number | null = null;
  try {
    for (;;) {
      const r = await consultar(filas.length, filas.length + tamPagina - 1);
      if (r.error) return fallo("error en la consulta");
      if (!Array.isArray(r.data)) return fallo("respuesta sin datos");
      if (typeof r.count !== "number" || !Number.isInteger(r.count) || r.count < 0)
        return fallo("respuesta sin conteo total");
      if (total === null) total = r.count;
      else if (r.count !== total) return fallo("el total cambió durante la paginación");
      if (r.data.length > tamPagina) return fallo("la página trajo más filas de las pedidas");
      for (const f of r.data) {
        if (!validar(f)) return fallo("fila inesperada en la respuesta");
        filas.push(f);
      }
      if (filas.length === total) return { completa: true, filas };
      if (filas.length > total) return fallo("más filas que el total contado");
      if (r.data.length === 0) return fallo("página vacía antes de completar el total");
    }
  } catch {
    return fallo("excepción en la consulta");
  }
}

export async function verificarFichasComisionManual(
  numeros: readonly string[],
  consultar: ConsultarFichas,
  opts: { lote?: number; pagina?: number } = {}
): Promise<VerificacionFichas> {
  const tamLote = opts.lote ?? LOTE_NUMEROS;
  const tamPagina = opts.pagina ?? PAGINA_FILAS;
  const unicos = [...new Set(numeros.filter((n) => typeof n === "string" && n !== ""))];
  const conFicha = new Set<string>();

  for (let i = 0; i < unicos.length; i += tamLote) {
    const lote = unicos.slice(i, i + tamLote);
    const pedidos = new Set(lote);
    const r = await leerTodoConConteo(
      (desde, hasta) => consultar(lote, desde, hasta),
      tamPagina,
      (f) => typeof f?.numero_contrato === "string" && pedidos.has(f.numero_contrato)
    );
    if (!r.completa) return { completa: false, motivo: `aliados_b2b: ${r.motivo}` };
    for (const f of r.filas) conFicha.add(f.numero_contrato as string);
  }
  return { completa: true, conFicha };
}

/**
 * Lectura del resultado para UN contrato, en el formato que espera
 * `accesoDocumentoContrato.comisionManualConFicha`: true/false si se sabe,
 * null si la verificación no fue completa (= desconocido = no se abre por
 * nombre).
 */
export function fichaDeContrato(v: VerificacionFichas, numero: string): boolean | null {
  return v.completa ? v.conFicha.has(numero) : null;
}

/** Adaptador real (service-role). Orden estable por id para paginar. */
export function consultarFichasSupabase(admin: Admin): ConsultarFichas {
  return (lote, desde, hasta) =>
    admin
      .from("aliados_b2b")
      .select("numero_contrato", { count: "exact" })
      .in("numero_contrato", lote)
      .not("aliado_id", "is", null)
      .order("id", { ascending: true })
      .range(desde, hasta) as unknown as PromiseLike<PaginaFichas>;
}
