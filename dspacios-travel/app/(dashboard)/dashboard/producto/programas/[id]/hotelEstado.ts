// PR #409 — Estado del editor de hoteles por vigencia (puro, sin React): conversión catálogo ↔ formulario, clonado,
// conflictos (capacidad y noches ligadas a las vigencias base) y resumen compacto. El editor SOLO presenta lo que
// calculan estas funciones y las de `lib/programas/estanciaHotel88` (las mismas que exige el servidor al guardar).
import { parseNumOrNull } from "@/lib/calc/programaPrecio";
import {
  CLAVES_TARIFA,
  clavesIncompatibles,
  conflictosHotel,
  fechaLegible,
  opcionesVigenciaBase,
  vacioPorAcom,
  type ClaveTarifa,
  type PorAcom,
} from "@/lib/programas/estanciaHotel88";
import type { CatalogoHoteles88 } from "@/lib/programas/estanciaHotelDatos88";
import type { HotelVigenciaInput } from "../actions";

export type Netos = Record<ClaveTarifa, string>;
export type BaseState = { desde: string; hasta: string; modalidad: string; bajoSolicitud: boolean; neto: Netos };
export type NocheState = { desde: string; hasta: string; unidad: string; neto: Netos };
export type HotelState = {
  id: number | null;
  nombre: string;
  zona: string;
  tipoHabitacion: string;
  maxPax: string;
  maxMenores: string;
  proveedorId: number | null;
  base: BaseState[];
  noches: NocheState[];
};

export const netosVacios = (): Netos => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "" });
const texto = (v: number | null | undefined) => (v == null ? "" : String(v));
export const aTexto = (n: PorAcom): Netos => ({
  sencilla: texto(n.sencilla), doble: texto(n.doble), triple: texto(n.triple), multiple: texto(n.multiple), nino: texto(n.nino),
});
export const aPorAcom = (n: Netos): PorAcom => {
  const o = vacioPorAcom();
  for (const k of CLAVES_TARIFA) o[k] = parseNumOrNull(n[k]);
  return o;
};

export function desdeCatalogo(c: CatalogoHoteles88): HotelState[] {
  return c.hoteles.map((h) => ({
    id: h.id,
    nombre: h.nombre,
    zona: h.zona ?? "",
    tipoHabitacion: h.tipoHabitacion ?? "",
    maxPax: texto(h.maxPaxHabitacion),
    maxMenores: texto(h.maxMenoresHabitacion),
    proveedorId: h.proveedorId,
    base: c.base.filter((b) => b.hotelId === h.id).map((b) => ({ desde: b.desde, hasta: b.hasta, modalidad: b.modalidad, bajoSolicitud: b.bajoSolicitud, neto: aTexto(b.neto) })),
    noches: c.noches.filter((t) => t.hotelId === h.id).map((t) => ({ desde: t.desde, hasta: t.hasta, unidad: t.unidad, neto: aTexto(t.neto) })),
  }));
}

export const hotelNuevo = (): HotelState => ({ id: null, nombre: "", zona: "", tipoHabitacion: "", maxPax: "", maxMenores: "", proveedorId: null, base: [], noches: [] });

/** Copia profunda (el diálogo edita un borrador; el original no se toca hasta guardar). */
export const copiarHotel = (h: HotelState): HotelState => ({
  ...h,
  base: h.base.map((b) => ({ ...b, neto: { ...b.neto } })),
  noches: h.noches.map((n) => ({ ...n, neto: { ...n.neto } })),
});

const norm = (s: string) => s.trim().toLowerCase();

/** ¿Hay otro hotel con este nombre (sin distinguir mayúsculas)? */
export const nombreRepetido = (nombre: string, otros: readonly string[]) => !!norm(nombre) && otros.some((o) => norm(o) === norm(nombre));

/**
 * Borrador de CLON: identidad nueva (sin id), nombre único y vigencias, modalidades y tarifas copiadas. NO se guarda:
 * el original queda intacto hasta que el usuario confirma en el diálogo.
 */
export function clonarHotel(h: HotelState, nombresExistentes: readonly string[]): HotelState {
  const base = `${h.nombre.trim() || "Hotel"} (copia)`;
  let nombre = base;
  for (let i = 2; nombreRepetido(nombre, nombresExistentes); i++) nombre = `${h.nombre.trim() || "Hotel"} (copia ${i})`;
  return { ...copiarHotel(h), id: null, nombre };
}

const entero = (s: string): number | null => {
  const n = parseNumOrNull(s);
  return n != null && Number.isInteger(n) ? n : null;
};

/** Lo mínimo que necesitan las reglas puras de `estanciaHotel88`. */
export function paraValidar(h: HotelState) {
  return {
    nombre: h.nombre,
    maxPaxHabitacion: entero(h.maxPax),
    maxMenoresHabitacion: entero(h.maxMenores),
    base: h.base.map((b) => ({ desde: b.desde, hasta: b.hasta, modalidad: b.modalidad, neto: aPorAcom(b.neto) })),
    noches: h.noches.map((n) => ({ desde: n.desde, hasta: n.hasta, unidad: n.unidad, neto: aPorAcom(n.neto) })),
  };
}

/** Conflictos que impiden guardar (los mismos que exige el servidor): se muestran en el diálogo y deshabilitan «Guardar». */
export const conflictosDe = (h: HotelState): string[] => conflictosHotel(paraValidar(h));

export type Incompatible = { donde: "base" | "noche"; indice: number; clave: ClaveTarifa };

/** Tarifas cargadas que el hotel (con su ocupación actual) no admite. */
export function incompatiblesDe(h: HotelState): Incompatible[] {
  const v = paraValidar(h);
  const out: Incompatible[] = [];
  v.base.forEach((b, indice) => clavesIncompatibles(v, b.neto).forEach((clave) => out.push({ donde: "base", indice, clave })));
  v.noches.forEach((n, indice) =>
    clavesIncompatibles(v, n.neto).filter((k) => !(k === "nino" && n.unidad === "habitacion")).forEach((clave) => out.push({ donde: "noche", indice, clave })),
  );
  return out;
}

/** Acción EXPLÍCITA del usuario: vacía las tarifas incompatibles (nunca ocurre sola). */
export function quitarIncompatibles(h: HotelState): HotelState {
  const f = copiarHotel(h);
  for (const i of incompatiblesDe(h)) (i.donde === "base" ? f.base[i.indice] : f.noches[i.indice]).neto[i.clave] = "";
  return f;
}

/** Resumen de una línea para la tarjeta compacta. */
export function resumenVigencias(h: HotelState): { base: string; noches: string } {
  const v = paraValidar(h);
  const { opciones } = opcionesVigenciaBase(v.base);
  const rangos = opciones.map((o) => `${fechaLegible(o.desde)}–${fechaLegible(o.hasta)}`);
  const corto = rangos.length > 2 ? `${rangos.slice(0, 2).join(" · ")} · +${rangos.length - 2}` : rangos.join(" · ");
  return {
    base: rangos.length ? `${rangos.length} vigencia${rangos.length === 1 ? "" : "s"} base: ${corto}` : "Sin vigencias base",
    noches: h.noches.length ? `${h.noches.length} tarifa${h.noches.length === 1 ? "" : "s"} de noche adicional` : "Sin noches adicionales",
  };
}

export function ocupacionTexto(h: HotelState): string {
  return [
    h.maxPax.trim() ? `máx. ${h.maxPax} pers./hab.` : "sin tope de personas",
    h.maxMenores.trim() ? `máx. ${h.maxMenores} menor(es)` : null,
  ].filter(Boolean).join(" · ");
}

/** Forma que recibe `guardarHoteles`. */
export const aPayload = (h: HotelState): HotelVigenciaInput => ({
  id: h.id, nombre: h.nombre, zona: h.zona, tipoHabitacion: h.tipoHabitacion,
  maxPaxHabitacion: h.maxPax, maxMenoresHabitacion: h.maxMenores, proveedorId: h.proveedorId,
  base: h.base.map((b) => ({ desde: b.desde, hasta: b.hasta, modalidad: b.modalidad, bajoSolicitud: b.bajoSolicitud, neto: b.neto })),
  noches: h.noches.map((t) => ({ desde: t.desde, hasta: t.hasta, unidad: t.unidad, neto: t.neto })),
});
