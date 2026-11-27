// B95-13/14/15/20 — preparación AUTORITATIVA (servidor) de una cotización dinámica / comparativa / contrato manual antes de crear nada:
// destino del catálogo (por id; su nombre canónico pisa el texto), orden de fechas, hoteles del catálogo leídos de la base por id (nunca lo que mande el navegador),
// compra directa/plataforma → proveedor a pagar, y acomodación estructurada. Sin escribir nada: devuelve los servicios ya resueltos o el primer error.
import { validarFechasViaje } from "@/lib/reglas/duracionViaje";
import type { AcomConfig, AcomRoom } from "@/lib/acomodaciones";
import { evaluarHotel, evaluarHoteles, type FilaHotel, type HotelDb, type HotelResuelto } from "@/lib/catalogo/evaluarHoteles";
import { calcularEdad } from "@/lib/utils";
import { clasificarPorEdad } from "@/lib/acomodaciones";
import { contarEntero, errorInfantesSinAdulto } from "@/lib/catalogo/validacionManual";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteLectura = { from: (t: string) => any };

/** Lee los hoteles del catálogo elegidos (por id) con su proveedor configurado y sus reglas de acomodación. Un fallo de lectura se devuelve como error (falla cerrado). */
export async function leerHotelesDb(cliente: ClienteLectura, ids: readonly number[]): Promise<{ ok: true; db: Map<number, HotelDb> } | { ok: false; error: string }> {
  const lista = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const db = new Map<number, HotelDb>();
  if (!lista.length) return { ok: true, db };
  const [h, a] = await Promise.all([
    cliente.from("hoteles").select("id, nombre, destino_id, adults_only, pax_min, pax_max, edad_infante_max, edad_nino_max, proveedores(nombre)").in("id", lista),
    cliente.from("hotel_acomodaciones").select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").in("hotel_id", lista),
  ]);
  if (h.error || a.error) return { ok: false, error: "No se pudieron verificar los hoteles elegidos del catálogo. No se creó nada. Inténtalo de nuevo." };
  const reglas = new Map<number, AcomConfig[]>();
  for (const r of (a.data ?? []) as Record<string, unknown>[]) {
    const n = (k: string) => Number(r[k]) || 0;
    const id = Number(r.hotel_id);
    reglas.set(id, [...(reglas.get(id) ?? []), { acomodacion: r.acomodacion as AcomRoom, pax_tarifa: n("pax_tarifa"), pax_max: n("pax_max"), adt_min: n("adt_min"), adt_max: n("adt_max"), chd_min: n("chd_min"), chd_max: n("chd_max"), inf_min: n("inf_min"), inf_max: n("inf_max") }]);
  }
  for (const r of (h.data ?? []) as Record<string, unknown>[]) {
    const id = Number(r.id);
    const prov = (r.proveedores as { nombre?: string } | null)?.nombre;
    db.set(id, {
      id, nombre: String(r.nombre ?? ""), destinoId: r.destino_id != null ? Number(r.destino_id) : null, proveedor: prov?.trim() ? prov.trim() : null,
      adultsOnly: r.adults_only === true, paxMin: r.pax_min != null ? Number(r.pax_min) : null, paxMax: r.pax_max != null ? Number(r.pax_max) : null, reglas: reglas.get(id) ?? [],
      edadInfanteMax: r.edad_infante_max != null ? Number(r.edad_infante_max) : null, edadNinoMax: r.edad_nino_max != null ? Number(r.edad_nino_max) : null,
    });
  }
  return { ok: true, db };
}

/** Destino del catálogo por id: devuelve su nombre canónico (el que se guarda y se imprime). */
export async function leerDestino(cliente: ClienteLectura, destinoId: unknown): Promise<{ ok: true; id: number; nombre: string } | { ok: false; error: string }> {
  const id = Number(destinoId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Elige el destino de la lista del catálogo." };
  const { data, error } = await cliente.from("destinos").select("id, nombre").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: "No se pudo verificar el destino. No se creó nada. Inténtalo de nuevo." };
  if (!data?.nombre) return { ok: false, error: "El destino elegido ya no existe en el catálogo." };
  return { ok: true, id, nombre: String(data.nombre) };
}

type ServicioConHotel = { tipo: string; nombre: string; plataforma: string; proveedor: string; costoNeto: number; catalogoId?: number | null; acomodacion?: string; compra?: unknown; habitaciones?: unknown };

/** Mismo criterio de «fila con contenido» que el armado (costo, nombre o plataforma): las filas vacías las descarta el armado y aquí tampoco se validan. */
const conContenido = (s: { costoNeto: number; nombre: string; plataforma: string }) => (Number(s.costoNeto) || 0) > 0 || (s.nombre ?? "").trim() !== "" || (s.plataforma ?? "").trim() !== "";

export type EntradaPreparar<S extends ServicioConHotel> = {
  destinoId?: unknown; fechaIda: string; fechaRegreso: string; pax: number; ninos?: number; infantes?: number; servicios: S[];
};

/**
 * Valida y resuelve. Devuelve los servicios con el proveedor a pagar, la plataforma y la acomodación DERIVADOS de la estructura (el texto libre del navegador no se confía),
 * más el destino canónico. Primer error = mensaje claro; no se escribe nada.
 */
export async function prepararServiciosManual<S extends ServicioConHotel>(cliente: ClienteLectura, input: EntradaPreparar<S>):
  Promise<{ ok: true; destino: string; destinoId: number; servicios: S[] } | { ok: false; error: string }> {
  const fechas = validarFechasViaje(input.fechaIda, input.fechaRegreso);
  if (!fechas.ok) return fechas;
  const dest = await leerDestino(cliente, input.destinoId);
  if (!dest.ok) return dest;
  const adultos = contarEntero(input.pax), ninos = contarEntero(input.ninos), infantes = contarEntero(input.infantes);
  if (adultos == null || ninos == null || infantes == null) return { ok: false, error: "Adultos, niños e infantes deben ser números enteros (0 o más)." };
  const sinAdulto = errorInfantesSinAdulto(adultos, infantes);
  if (sinAdulto) return { ok: false, error: sinAdulto };

  const hoteles = input.servicios.map((s, i) => ({ s, i })).filter(({ s }) => s.tipo === "hotel" && conContenido(s));
  const lectura = await leerHotelesDb(cliente, hoteles.map(({ s }) => Number(s.catalogoId)).filter((n) => Number.isInteger(n) && n > 0));
  if (!lectura.ok) return lectura;
  const filas: FilaHotel[] = hoteles.map(({ s }) => ({ nombre: s.nombre, catalogoId: s.catalogoId ?? null, compra: s.compra, plataforma: s.plataforma, proveedor: s.proveedor, habitaciones: s.habitaciones }));
  const ev = evaluarHoteles(filas, { destinoId: dest.id, ocupacion: { adultos, ninos, infantes }, db: lectura.db });
  if (!ev.ok) return ev;
  const servicios = input.servicios.slice();
  hoteles.forEach(({ i }, k) => {
    const r = ev.filas[k];
    servicios[i] = { ...servicios[i], proveedor: r.proveedor, plataforma: r.plataforma ?? "", acomodacion: r.acomodacion };
  });
  return { ok: true, destino: dest.nombre, destinoId: dest.id, servicios };
}

// ── Contrato manual (dinámico / empaquetado): los pasajeros SON la ocupación ────────────────────────────────────────────────────────────────────
type HotelContrato = { nombre: string; catalogoHotelId?: number | null; compra?: unknown; plataforma?: string | null; proveedor: string; habitaciones?: unknown };
const EDAD_INFANTE_HOTEL_DEFECTO = 2, EDAD_NINO_HOTEL_DEFECTO = 10; // los DEFAULT de hoteles.edad_infante_max / edad_nino_max (migración 016); no son umbrales nuevos

/**
 * Hoteles de un contrato manual NUEVO. El destino del catálogo es obligatorio; cada hotel se evalúa con la ocupación REAL (edad de cada pasajero a la fecha de salida, con los umbrales
 * del hotel del catálogo o los de la tabla). Sin pasajeros cargados solo se exige la estructura de habitaciones. Devuelve los hoteles con proveedor/plataforma/acomodación resueltos.
 */
export async function prepararHotelesContrato<H extends HotelContrato>(cliente: ClienteLectura, input: {
  destinoId?: unknown; fechaSalida: string; fechaRegreso: string; negociado: boolean;
  pasajeros: { fechaNacimiento?: string | null; esInfante?: boolean }[]; hoteles: H[];
}): Promise<{ ok: true; destino: string | null; hoteles: (H & { acomodacion: string; compraOrigen: string | null; plataformaCompra: string | null; aviso: string | null })[] } | { ok: false; error: string }> {
  const fechas = validarFechasViaje(input.fechaSalida, input.fechaRegreso);
  if (!fechas.ok) return fechas;
  let destino: string | null = null, destinoId: number | null = null;
  if (!input.negociado || input.destinoId != null) {
    const d = await leerDestino(cliente, input.destinoId);
    if (!d.ok) return d;
    destino = d.nombre; destinoId = d.id;
  }
  if (input.negociado) return { ok: true, destino, hoteles: input.hoteles.map((h) => ({ ...h, acomodacion: "", compraOrigen: null, plataformaCompra: null, aviso: null })) };
  const filas = input.hoteles.map((h, i) => ({ h, i })).filter(({ h }) => (h.nombre ?? "").trim() !== "");
  const lectura = await leerHotelesDb(cliente, filas.map(({ h }) => Number(h.catalogoHotelId)).filter((n) => Number.isInteger(n) && n > 0));
  if (!lectura.ok) return lectura;
  // Lo que el navegador mande en estas columnas no se confía: parten en null y solo las llena la evaluación del servidor.
  const salida = input.hoteles.map((h) => ({ ...h, acomodacion: (h as { acomodacion?: string }).acomodacion ?? "", compraOrigen: null, plataformaCompra: null, aviso: null })) as (H & { acomodacion: string; compraOrigen: string | null; plataformaCompra: string | null; aviso: string | null })[];
  const errores: string[] = [];
  for (const { h, i } of filas) {
    const hotel = h.catalogoHotelId != null ? lectura.db.get(Number(h.catalogoHotelId)) ?? null : null;
    let ocupacion = null as { adultos: number; ninos: number; infantes: number } | null;
    if (input.pasajeros.length) {
      const edades = input.pasajeros.map((p) => (p.fechaNacimiento ? calcularEdad(p.fechaNacimiento, input.fechaSalida || null) : p.esInfante ? 0 : null));
      const c = clasificarPorEdad(edades, hotel?.edadInfanteMax ?? EDAD_INFANTE_HOTEL_DEFECTO, hotel?.edadNinoMax ?? EDAD_NINO_HOTEL_DEFECTO);
      ocupacion = { adultos: c.adultos + c.sinFecha, ninos: c.ninos, infantes: c.infantes };
    }
    const r: HotelResuelto = evaluarHotel({ nombre: h.nombre, catalogoId: h.catalogoHotelId ?? null, compra: h.compra, plataforma: h.plataforma, proveedor: h.proveedor, habitaciones: h.habitaciones }, { destinoId, ocupacion, db: lectura.db });
    errores.push(...r.errores);
    salida[i] = { ...h, proveedor: r.proveedor, acomodacion: r.acomodacion, compraOrigen: r.compra, plataformaCompra: r.plataforma, aviso: r.aviso };
  }
  return errores.length ? { ok: false, error: errores[0] } : { ok: true, destino, hoteles: salida };
}
