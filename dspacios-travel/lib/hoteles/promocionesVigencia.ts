// #43/#60 entrega 4 — Validación (pura) de los campos nuevos de una promoción al crear o editar
// una vigencia: noche bonificada (P), unidad del monto fijo (S/T) y días (Y). La usan el
// formulario y la acción del servidor con EXACTAMENTE la misma regla.
//
// «Nueva» = se crea, o cambia de tipo, o (monto) pasa a persona/estadía: ahí se exige ELEGIR, sin
// valor por defecto. Una promoción existente sin elección (promedio heredado / unidad anterior)
// se puede seguir editando tal cual; una vez elegida no vuelve a «heredado».
import { esReglaNocheGratis, esUnidadMonto, type ReglaNocheGratis, type UnidadMonto } from "../calc/promocionesGrupo.ts";

/** Elección de días del formulario: «todos» o una lista explícita. `null`/ausente = no se eligió. */
export type EleccionDias = "todos" | number[] | null | undefined;

export interface CamposPromo {
  tipo: string;
  descuentoUnidad?: UnidadMonto | null;
  nocheGratisRegla?: ReglaNocheGratis | null;
  diasPromo?: EleccionDias;
}
export interface PromoGuardada {
  tipo?: string | null;
  descuento_unidad?: string | null;
  noche_gratis_regla?: string | null;
}
export interface ColumnasPromo {
  descuento_unidad: UnidadMonto | null;
  noche_gratis_regla: ReglaNocheGratis | null;
  dias_promo: number[] | null;
}

function dias(e: EleccionDias, que: string): { ok: true; dias: number[] | null } | { ok: false; error: string } {
  if (e === "todos") return { ok: true, dias: null };
  if (!Array.isArray(e)) return { ok: false, error: `Elige ${que}: «Todos los días» o «Elegir días».` };
  const ds = [...new Set(e)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (!ds.length || ds.length !== new Set(e).size) return { ok: false, error: `Con «Elegir días» marca al menos un día válido (${que}).` };
  return { ok: true, dias: ds.length === 7 ? null : ds };
}

/** Valida y devuelve las columnas a guardar. `previa` = la fila guardada (al editar). */
export function validarCamposPromo(input: CamposPromo, previa?: PromoGuardada | null):
  { ok: true; columnas: ColumnasPromo } | { ok: false; error: string } {
  const vacio: ColumnasPromo = { descuento_unidad: null, noche_gratis_regla: null, dias_promo: null };
  const mismoTipo = !!previa && (previa.tipo ?? "tarifa") === input.tipo;

  if (input.tipo === "promo_noche_gratis") {
    const heredada = mismoTipo && previa!.noche_gratis_regla == null;
    if (input.nocheGratisRegla == null) {
      if (heredada && (input.diasPromo == null || input.diasPromo === "todos")) return { ok: true, columnas: vacio }; // promedio (anterior), sin cambios
      return { ok: false, error: "Elige qué noche se bonifica: la más barata, la más cara o la última." };
    }
    if (!esReglaNocheGratis(input.nocheGratisRegla)) return { ok: false, error: "La noche bonificada no es válida." };
    const d = dias(input.diasPromo, "los días que se pueden bonificar");
    if (!d.ok) return d;
    return { ok: true, columnas: { ...vacio, noche_gratis_regla: input.nocheGratisRegla, dias_promo: d.dias } };
  }

  if (input.tipo === "descuento_monto") {
    const heredada = mismoTipo && previa!.descuento_unidad == null;
    if (input.descuentoUnidad == null) {
      if (heredada && input.diasPromo == null) return { ok: true, columnas: vacio }; // «unidad anterior», sin cambios
      return { ok: false, error: "Elige la unidad del descuento: por persona y noche, por habitación y noche o por persona por estadía." };
    }
    if (!esUnidadMonto(input.descuentoUnidad)) return { ok: false, error: "La unidad del descuento no es válida." };
    if (input.descuentoUnidad !== "persona_estadia") {
      if (input.diasPromo != null) return { ok: false, error: "Los días de un descuento por noche se eligen en sus reglas por grupo." };
      return { ok: true, columnas: { ...vacio, descuento_unidad: input.descuentoUnidad } };
    }
    const d = dias(input.diasPromo, "los días de entrada");
    if (!d.ok) return d;
    return { ok: true, columnas: { ...vacio, descuento_unidad: "persona_estadia", dias_promo: d.dias } };
  }

  if (input.nocheGratisRegla != null || input.descuentoUnidad != null || input.diasPromo != null) {
    return { ok: false, error: "Ese tipo de vigencia no lleva noche bonificada, unidad ni días de promoción." };
  }
  return { ok: true, columnas: vacio };
}

/** Mensaje claro para los rechazos de la 300 que vienen de la base. `null` = no es de la 300. */
export function mensajePromo300(msg: string): string | null {
  const pref = /(CONFLICTO_PROMOCIONES|COMBINACION_SIN_CONFIGURAR|CONTRADICCION_PROMOCIONES|CAMBIO_CONCURRENTE|CAMBIO_NO_PENDIENTE):\s*/.exec(msg);
  if (pref) return msg.slice(pref.index + pref[0].length);
  if (/hotel_temporadas_promo_300/.test(msg)) {
    return "La promoción tiene reglas por grupo o una elección que no corresponde a ese tipo: quita sus reglas en «Reglas por grupo» antes de cambiar el tipo o la unidad.";
  }
  if (/hotel_temporadas_promo_base_id_fkey/.test(msg)) {
    return "Esta vigencia es la base de una promoción por grupo: desvincula o elimina esa promoción antes de borrarla.";
  }
  return null;
}

// ── Entrega 5 (301): combinación de una promoción con EBB / Long Stay ─────────────────────────────
export type FamiliaRegla = "ebb" | "long_stay";
export type AlternativaOrden = "promocion" | FamiliaRegla;
/** Respuesta del formulario: si acumula con cada familia que coincide (sin valor por defecto) y, si algo no acumula, el orden. */
export interface CombinacionEntrada {
  acumulable: Partial<Record<FamiliaRegla, boolean | null>>;
  orden?: AlternativaOrden[] | null;
}
const ETIQUETA_FAMILIA: Record<FamiliaRegla, string> = { ebb: "compra anticipada (EBB)", long_stay: "larga estadía (Long Stay)" };
export const ETIQUETA_ALTERNATIVA: Record<AlternativaOrden, string> = { promocion: "La promoción", ebb: "Compra anticipada (EBB)", long_stay: "Larga estadía (Long Stay)" };
export function textoFamilias(f: readonly string[] | null | undefined): string {
  return [...(f ?? [])].filter((x): x is FamiliaRegla => x === "ebb" || x === "long_stay").sort().map((x) => ETIQUETA_FAMILIA[x]).join(" y ");
}
/** ¿Hace falta un orden? Sí si alguna familia que coincide no acumula, o coinciden las dos (EBB y Long Stay nunca acumulan entre sí). */
export function requiereOrden(familias: readonly FamiliaRegla[], acumulable: CombinacionEntrada["acumulable"]): boolean {
  return familias.length === 2 || familias.some((f) => acumulable[f] === false);
}
/**
 * Valida la combinación contra las familias que coinciden (si se conocen): cada una respondida sí/no y, si hace falta, un orden con
 * EXACTAMENTE la promoción y esas familias, sin repetir. La RPC repite la validación con las coincidencias del servidor.
 */
export function validarCombinacion(c: CombinacionEntrada | null | undefined, familias?: readonly FamiliaRegla[]): { ok: true; valor: { acumulable: Record<string, boolean>; orden: AlternativaOrden[] | null } } | { ok: false; error: string } {
  if (!c || typeof c !== "object" || !c.acumulable || typeof c.acumulable !== "object") return { ok: false, error: "Responde si la promoción acumula con cada regla." };
  const acumulable: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(c.acumulable)) {
    if (k !== "ebb" && k !== "long_stay") return { ok: false, error: "Regla no válida." };
    if (v === true || v === false) acumulable[k] = v;
  }
  const fams = familias ?? (Object.keys(acumulable) as FamiliaRegla[]);
  const falta = fams.find((f) => acumulable[f] === undefined);
  if (falta) return { ok: false, error: `Responde, según el proveedor, si la promoción acumula con ${ETIQUETA_FAMILIA[falta]}.` };
  if (!requiereOrden(fams, acumulable)) return { ok: true, valor: { acumulable, orden: null } };
  const orden = Array.isArray(c.orden) ? c.orden : [];
  const esperadas: AlternativaOrden[] = ["promocion", ...fams];
  if (orden.length !== esperadas.length || new Set(orden).size !== orden.length || !esperadas.every((x) => orden.includes(x))) {
    return { ok: false, error: "Ordena, según el proveedor, la promoción y las reglas que coinciden (cada una una sola vez)." };
  }
  return { ok: true, valor: { acumulable, orden: [...orden] } };
}
