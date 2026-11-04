// Selección del cliente en la tarjeta del paquete dinámico (#82) y su paso al checkout. PURO. La selección viaja en la URL (el checkout la
// vuelve a validar en el servidor) y se guarda en sessionStorage para que «Volver» desde el checkout la conserve. Nada de esto es de confianza:
// quien la recibe revalida cada campo.
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";

export type SeleccionUI = {
  paqueteId: number; hotelId: number | null; vueloId: number | null;
  habitaciones: Record<AcomRoom, number>;
  /** Edades de los menores que viajan ([] = no viajan menores). */
  edades: number[];
  /** Ids de los servicios elegidos; null = todos los del paquete. */
  servicios: string[] | null;
  fechaIda: string; fechaRegreso: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CLAVE = { sencilla: "hs", doble: "hd", triple: "ht", multiple: "hm" } as const;
const ent = (v: unknown, max: number): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN; return Number.isInteger(n) && n >= 0 && n <= max ? n : null; };
const id = (v: unknown): number | null => { const n = ent(v, 2_000_000_000); return n != null && n > 0 ? n : null; };

export function seleccionVacia(paqueteId: number, hotelId: number | null, vueloId: number | null): SeleccionUI {
  return { paqueteId, hotelId, vueloId, habitaciones: { sencilla: 0, doble: 1, triple: 0, multiple: 0 }, edades: [], servicios: null, fechaIda: "", fechaRegreso: "" };
}

export function aQuery(s: SeleccionUI): URLSearchParams {
  const q = new URLSearchParams({ p: String(s.paqueteId), ida: s.fechaIda, reg: s.fechaRegreso });
  for (const a of ACOM_ROOMS) q.set(CLAVE[a], String(s.habitaciones[a]));
  if (s.hotelId != null) q.set("h", String(s.hotelId));
  if (s.vueloId != null) q.set("v", String(s.vueloId));
  if (s.edades.length) q.set("e", s.edades.join(","));
  if (s.servicios) q.set("s", s.servicios.join(","));
  return q;
}

type Q = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Lee la selección de la URL; null si algo no es válido (el checkout pide volver a elegir). */
export function deQuery(q: Q): SeleccionUI | null {
  const paqueteId = id(uno(q.p));
  const ida = uno(q.ida) ?? "", reg = uno(q.reg) ?? "";
  if (!paqueteId || !ISO.test(ida) || !ISO.test(reg)) return null;
  const habitaciones = {} as Record<AcomRoom, number>;
  for (const a of ACOM_ROOMS) { const n = ent(uno(q[CLAVE[a]]) ?? "0", 20); if (n == null) return null; habitaciones[a] = n; }
  let edades: number[] = [];
  const e = uno(q.e);
  if (e) {
    edades = e.split(",").map((x) => ent(x, 17) as number);
    if (edades.length > 10 || edades.some((x) => x == null)) return null;
  }
  const sRaw = uno(q.s);
  const servicios = sRaw === undefined ? null : sRaw === "" ? [] : sRaw.split(",").filter((x) => /^\d+$/.test(x));
  const hotelId = uno(q.h) === undefined ? null : id(uno(q.h));
  const vueloId = uno(q.v) === undefined ? null : id(uno(q.v));
  if ((uno(q.h) !== undefined && hotelId == null) || (uno(q.v) !== undefined && vueloId == null)) return null;
  return { paqueteId, hotelId, vueloId, habitaciones, edades, servicios, fechaIda: ida, fechaRegreso: reg };
}

/** Estado de la tarjeta tal como se guarda en sessionStorage (los campos de edad como texto, para poder dejarlos vacíos mientras se escribe). */
export type EstadoTarjeta = { habitaciones: Record<AcomRoom, number>; viajanMenores: boolean; edades: string[]; vueloId: number | null; fechaIda: string; fechaRegreso: string; servicios: string[] | null };

export function restaurarEstado(json: unknown, vuelosValidos: number[], serviciosValidos: string[]): EstadoTarjeta | null {
  if (!json || typeof json !== "object") return null;
  const x = json as Record<string, unknown>;
  const hab = x.habitaciones as Record<string, unknown> | undefined;
  if (!hab || typeof hab !== "object") return null;
  const habitaciones = {} as Record<AcomRoom, number>;
  for (const a of ACOM_ROOMS) { const n = ent(hab[a], 20); if (n == null) return null; habitaciones[a] = n; }
  if (!Array.isArray(x.edades) || x.edades.length > 10 || !x.edades.every((e) => typeof e === "string" && e.length <= 3)) return null;
  const vueloId = x.vueloId == null ? null : id(x.vueloId);
  const servicios = x.servicios == null ? null : Array.isArray(x.servicios) ? x.servicios.filter((s): s is string => typeof s === "string" && serviciosValidos.includes(s)) : null;
  const iso = (v: unknown) => (typeof v === "string" && (v === "" || ISO.test(v)) ? v : "");
  return {
    habitaciones, viajanMenores: x.viajanMenores === true, edades: x.edades as string[],
    vueloId: vueloId != null && vuelosValidos.includes(vueloId) ? vueloId : null, fechaIda: iso(x.fechaIda), fechaRegreso: iso(x.fechaRegreso), servicios,
  };
}
