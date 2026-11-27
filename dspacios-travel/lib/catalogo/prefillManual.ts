// #95 — precarga EDITABLE de información general del catálogo en los formularios manuales (contrato y cotización).
// PURO (sin I/O). Reglas del dueño: se precarga solo información general (nombre, proveedor, acomodaciones, categorías de habitación, regímenes);
// NUNCA precios, tarifas ni vigencias; lo precargado es una COPIA editable de esa operación (editarla no toca el catálogo); y se distingue el texto libre
// de una elección real del catálogo. La precarga solo llena campos VACÍOS: jamás pisa lo que el asesor ya escribió.
// B95-3: una elección real se identifica por el ID del catálogo, nunca por coincidencia de nombre: dos hoteles con el mismo nombre se ofrecen con una etiqueta que los distingue
// y, mientras el asesor no elija uno, no se precarga nada ni se afirma ningún vínculo. Editar el texto de la copia rompe el vínculo (queda como texto libre).

import type { AcomConfig } from "@/lib/acomodaciones";

export type HotelCatalogoManual = {
  id: number;
  nombre: string;
  /** Destino del hotel (solo para distinguir homónimos en la lista). */
  destino: string | null;
  proveedor: string | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  categorias: string[];
  regimenes: string[];
  acomodaciones: string[];
  /** B95-13: destino guardado del hotel (id): decide qué hoteles se ofrecen para el destino elegido. */
  destinoId?: number | null;
  /** B95-20: configuración de acomodaciones y rango de pax del hotel (hotel_acomodaciones / hoteles.pax_min,pax_max) y umbrales de edad: validan la ocupación sin reglas nuevas. */
  reglasAcom?: AcomConfig[];
  paxMin?: number | null;
  paxMax?: number | null;
  edadInfanteMax?: number | null;
  edadNinoMax?: number | null;
};

export type TipoServicioManual = "asistencia" | "traslado" | "tour" | "otro";
export type ServicioCatalogoManual = { id: number; nombre: string; categoria: string; proveedor: string | null };

/** Normaliza para comparar (minúsculas, sin tildes, espacios recortados y colapsados). */
export const normalizarCatalogo = (s: string | null | undefined): string => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ── Elección real del catálogo (por id) ────────────────────────────────────
export type EntradaCatalogo = { id: number; nombre: string; detalle?: string | null };

/** Texto que se ofrece en la lista para cada entrada: el nombre solo si es único; con homónimos, «nombre — detalle (#id)» (siempre distinto). */
export function etiquetasCatalogo(lista: readonly EntradaCatalogo[]): Map<number, string> {
  const porNombre = new Map<string, number>();
  for (const e of lista) porNombre.set(normalizarCatalogo(e.nombre), (porNombre.get(normalizarCatalogo(e.nombre)) ?? 0) + 1);
  const out = new Map<number, string>();
  for (const e of lista) {
    const repetido = (porNombre.get(normalizarCatalogo(e.nombre)) ?? 0) > 1;
    out.set(e.id, repetido ? `${e.nombre}${e.detalle?.trim() ? ` — ${e.detalle.trim()}` : ""} (#${e.id})` : e.nombre);
  }
  return out;
}

export type Seleccion = {
  /** Texto que debe quedar en el campo (si se eligió una opción con etiqueta de homónimo, el nombre real de esa entrada). */
  texto: string;
  /** Id del catálogo elegido, o null (vacío, texto libre o ambiguo). */
  id: number | null;
  estado: "vacio" | "libre" | "catalogo" | "ambiguo";
};

/**
 * Resuelve lo que el asesor escribió/eligió en un campo con lista del catálogo.
 *  · coincide con la ETIQUETA de una entrada → esa entrada (única forma de elegir entre homónimos);
 *  · coincide con el nombre de UNA sola entrada → esa entrada; con varias → «ambiguo»: no se precarga ni se afirma vínculo hasta que elija una;
 *  · el id previo se conserva mientras el texto siga siendo el nombre de esa misma entrada (re-escribir no lo cambia);
 *  · cualquier otro texto = texto libre (sin id).
 */
export function seleccionarCatalogo(lista: readonly EntradaCatalogo[], texto: string, idPrevio: number | null): Seleccion {
  const t = normalizarCatalogo(texto);
  if (!t) return { texto, id: null, estado: "vacio" };
  const etiquetas = etiquetasCatalogo(lista);
  const porEtiqueta = lista.find((e) => normalizarCatalogo(etiquetas.get(e.id)) === t && normalizarCatalogo(e.nombre) !== t);
  if (porEtiqueta) return { texto: porEtiqueta.nombre, id: porEtiqueta.id, estado: "catalogo" };
  const candidatos = lista.filter((e) => normalizarCatalogo(e.nombre) === t);
  if (!candidatos.length) return { texto, id: null, estado: "libre" };
  if (idPrevio != null && candidatos.some((e) => e.id === idPrevio)) return { texto, id: idPrevio, estado: "catalogo" };
  if (candidatos.length === 1) return { texto, id: candidatos[0].id, estado: "catalogo" };
  return { texto, id: null, estado: "ambiguo" };
}

export const hotelPorId = (lista: readonly HotelCatalogoManual[], id: number | null | undefined): HotelCatalogoManual | null =>
  id == null ? null : lista.find((h) => h.id === id) ?? null;
export const servicioPorId = (lista: readonly ServicioCatalogoManual[], id: number | null | undefined): ServicioCatalogoManual | null =>
  id == null ? null : lista.find((s) => s.id === id) ?? null;

export const entradasHoteles = (lista: readonly HotelCatalogoManual[]): EntradaCatalogo[] => lista.map((h) => ({ id: h.id, nombre: h.nombre, detalle: h.destino }));
export const entradasServicios = (lista: readonly ServicioCatalogoManual[]): EntradaCatalogo[] => lista.map((s) => ({ id: s.id, nombre: s.nombre, detalle: s.categoria }));

export type FilaHotelManual = { nombre: string; categoria: string; proveedor: string; alimentacion: string; acomodacion: string };

/**
 * Qué campos VACÍOS de una fila de hotel se llenan al elegir un hotel del catálogo. Proveedor siempre que el catálogo lo tenga; categoría, régimen y acomodación solo
 * cuando el hotel tiene exactamente UNA opción (con varias, se ofrecen como sugerencias y el asesor elige; no se adivina). Devuelve solo los campos a cambiar.
 */
export function prefillHotelManual(fila: FilaHotelManual, hotel: HotelCatalogoManual | null): Partial<Pick<FilaHotelManual, "proveedor" | "categoria" | "alimentacion" | "acomodacion">> {
  if (!hotel) return {};
  const patch: Partial<Pick<FilaHotelManual, "proveedor" | "categoria" | "alimentacion" | "acomodacion">> = {};
  if (!fila.proveedor.trim() && hotel.proveedor?.trim()) patch.proveedor = hotel.proveedor.trim();
  if (!fila.categoria.trim() && hotel.categorias.length === 1) patch.categoria = hotel.categorias[0];
  if (!fila.alimentacion.trim() && hotel.regimenes.length === 1) patch.alimentacion = hotel.regimenes[0];
  if (!fila.acomodacion.trim() && hotel.acomodaciones.length === 1) patch.acomodacion = hotel.acomodaciones[0];
  return patch;
}

/** Categorías del catálogo de servicios que corresponden a cada tipo de la fila (sin adivinar: «otro» ve todo el catálogo). */
export function categoriasDeTipo(tipo: TipoServicioManual): string[] | null {
  if (tipo === "asistencia") return ["asistencia"];
  if (tipo === "traslado" || tipo === "tour") return ["tour_traslado"];
  return null; // otro = sin filtro
}

/** Servicios del catálogo que se ofrecen para ese tipo de fila. */
export function serviciosParaTipo(lista: ServicioCatalogoManual[], tipo: TipoServicioManual): ServicioCatalogoManual[] {
  const cats = categoriasDeTipo(tipo);
  return cats ? lista.filter((s) => cats.includes(s.categoria)) : lista;
}

/** Al elegir un servicio del catálogo: solo el proveedor, y solo si estaba vacío. Nunca el precio. */
export function prefillServicioManual(proveedorActual: string, servicio: ServicioCatalogoManual | null): { proveedor?: string } {
  if (!servicio) return {};
  return !proveedorActual.trim() && servicio.proveedor?.trim() ? { proveedor: servicio.proveedor.trim() } : {};
}

/** ¿El texto es una elección real del catálogo o texto libre? Solo para PROVEEDORES (se guardan por nombre, sin id). */
export function vinculoDeTexto(lista: { nombre: string }[], texto: string | null | undefined): "catalogo" | "libre" | "vacio" {
  const t = normalizarCatalogo(texto);
  if (!t) return "vacio";
  return lista.some((x) => normalizarCatalogo(x.nombre) === t) ? "catalogo" : "libre";
}

/** Etiqueta de un proveedor por nombre contra el catálogo de proveedores. */
export function vinculoProveedor(nombres: string[], texto: string | null | undefined): "catalogo" | "libre" | "vacio" {
  return vinculoDeTexto(nombres.map((nombre) => ({ nombre })), texto);
}

/** Etiquetas de restricciones de un hotel del catálogo (se muestran junto al hotel elegido). */
export function restriccionesHotel(h: HotelCatalogoManual | null): string[] {
  if (!h) return [];
  return [...(h.adultsOnly ? ["Solo adultos (Adults Only)"] : []), ...(h.petFriendly ? ["Acepta mascotas"] : [])];
}

// ── Cotización manual: una fila = un servicio (hotel, aéreo, traslado, asistencia, otro) con «Nombre del servicio» y «Proveedor» en texto ──
export type CatalogoCotizacion = { hoteles: HotelCatalogoManual[]; servicios: ServicioCatalogoManual[]; aerolineas: string[]; proveedores: string[] };
export type FuenteNombre = { id: number | null; nombre: string; detalle: string | null; proveedor: string | null };

/** Qué catálogo busca el campo «Nombre del servicio» según el tipo de fila (aéreo = aerolíneas, sin id; hotel = hoteles; el resto, servicios filtrados por categoría; sin adivinar). */
export function fuenteNombreCotizacion(tipo: string, c: CatalogoCotizacion): FuenteNombre[] {
  if (tipo === "hotel") return c.hoteles.map((h) => ({ id: h.id, nombre: h.nombre, detalle: h.destino, proveedor: h.proveedor }));
  if (tipo === "aereo") return c.aerolineas.map((nombre) => ({ id: null, nombre, detalle: null, proveedor: null }));
  const t: TipoServicioManual = tipo === "asistencia" || tipo === "traslado" ? tipo : "otro";
  return serviciosParaTipo(c.servicios, t).map((s) => ({ id: s.id, nombre: s.nombre, detalle: s.categoria, proveedor: s.proveedor }));
}

/** Entradas con id de la fuente (las aerolíneas, sin id, se resuelven por nombre único y no llevan vínculo con id). */
export function entradasFuente(f: FuenteNombre[]): EntradaCatalogo[] {
  return f.filter((x) => x.id != null).map((x) => ({ id: x.id as number, nombre: x.nombre, detalle: x.detalle }));
}

/** Al elegir una entrada (por id) y con el proveedor vacío, se precarga el proveedor (nunca precios). Todo sigue editable. */
export function prefillFilaCotizacion(fuente: FuenteNombre[], id: number | null, proveedorActual: string): { proveedor?: string } {
  if (id == null || proveedorActual.trim()) return {};
  const m = fuente.find((f) => f.id === id);
  return m?.proveedor?.trim() ? { proveedor: m.proveedor.trim() } : {};
}
