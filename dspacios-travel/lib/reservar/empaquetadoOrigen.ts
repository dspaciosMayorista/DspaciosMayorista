// ─────────────────────────────────────────────────────────────────────────
// Datos de vuelo del ORIGEN resuelto de una reserva (`OrigenVuelo` de
// `lib/reservar/origen.ts`) — bloqueo negociado, empaquetado (Sistema) o
// salida dinámica, normalizados al MISMO shape para que `reservar/actions.ts`
// arme el tramo del contrato / el costo aéreo sin repetir el SELECT+cast por
// cada tipo de origen.
//
// FALLO CERRADO (revisión de PR #268, defecto 5): antes, `datosVueloEmpaquetado`
// destructuraba `{ data }` de la respuesta de Supabase y descartaba `error`
// en silencio — un fallo de lectura (RLS, red, timeout) se veía IGUAL que
// "el empaquetado no existe", y los call sites (`if (eq) {...}`, sin rama de
// error) simplemente omitían el vuelo del contrato/costo sin decir nada.
// Ahora cada función devuelve un resultado discriminado (`ok`/`error`) y el
// error de Supabase, si lo hay, SIEMPRE se propaga como fallo — nunca se
// confunde con "no encontrado".
//
// VIGENCIA (defecto 2): `datosVueloEmpaquetado` valida `activo` y la
// vigencia de compra (`compra_inicio`/`compra_fin`, inclusivas, zona
// America/Bogota) en el momento exacto de resolver la reserva — el mismo
// checkpoint que usan `crearCotizacion`/`reservarDesdeTarifarioInterno` (los
// dos pasan por `computarReserva`, que llama esta función). Un empaquetado
// desactivado o fuera de vigencia DESPUÉS de que el tarifario ya se generó
// bloquea la reserva aquí, aunque la fila de `tarifario_resultado` siga
// publicada (esa es una caché, no la fuente de verdad de vigencia).
//
// Un empaquetado NUNCA tiene sillas ni cupo negociado — a diferencia de
// `bloqueos_vuelo`, el caller jamás debe intentar reservar/decrementar
// `sillas` para el resultado que devuelve esta función.
//
// COSTO FINANCIERO (revisión posterior al PR #268, hallazgo 1): el
// formulario de Empaquetados pide DOS tarifas — `tarifa_proveedor`
// ("Tarifa proveedor/sistema (neto)") y `tarifa_para_empaquetar` ("Tarifa
// para empaquetar (reventa)") — pero esta función solo devolvía la segunda,
// y `reservar/actions.ts` la usaba tanto para `ventas.costo_aereo` como
// para la CxP al proveedor. Con tarifa_proveedor=200.000 y
// tarifa_para_empaquetar=242.022 (2 pax), el costo/CxP quedaba en $484.044
// en vez de los $400.000 que realmente se le deben al proveedor — se le
// estaba pagando (en el registro contable) la reventa, no el neto.
// `costo_neto` es ahora el campo AUTORITATIVO para costo_aereo/CxP en TODOS
// los orígenes: para bloqueo/salida, que no tienen un campo "neto" separado
// del "para empaquetar"/"tiquete", `costo_neto` es el mismo valor de
// siempre (sin cambio de comportamiento ahí). `tarifa_para_empaquetar` se
// CONSERVA en el tipo — sigue siendo la base de la que se deriva el PVP del
// vuelo en `generarTarifario()` (`aporteVuelo()`, decisión de negocio
// confirmada: el margen del paquete SÍ se aplica de nuevo sobre la reventa
// tecleada a mano — ver el comentario de `paquetes/actions.ts`), pero en
// este flujo (reservar) queda como dato informativo, no se usa para costear.
// ─────────────────────────────────────────────────────────────────────────

import type { OrigenVuelo } from "@/lib/reservar/origen";
import { empaquetadoVigente, hoyBogota } from "@/lib/reservar/origen";

export type ProveedorVuelo = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;

export type DatosVueloOrigen = {
  aerolinea: string | null;
  record: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  vuelo_ida: string | null;
  vuelo_regreso: string | null;
  hora_salida_ida: string | null;
  hora_llegada_ida: string | null;
  hora_salida_reg: string | null;
  hora_llegada_reg: string | null;
  // Costo NETO real (lo que se le paga al proveedor) — única fuente para
  // ventas.costo_aereo y la CxP aérea. NUNCA usar tarifa_para_empaquetar
  // para esto.
  costo_neto: number;
  // Reventa (informativa en este flujo) — bloqueo/salida no tienen un
  // campo "neto" separado, así que aquí queda igual a costo_neto.
  tarifa_para_empaquetar: number;
  fee_infante: number;
  proveedor: ProveedorVuelo;
};

export type ResultadoDatosVuelo =
  | { ok: true; data: DatosVueloOrigen }
  | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSb = any;

export async function datosVueloBloqueo(sb: ClienteSb, bloqueoId: number): Promise<ResultadoDatosVuelo> {
  const { data: b, error } = await sb
    .from("bloqueos_vuelo")
    .select(
      "aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_para_empaquetar, proveedores(nombre, aplica_retencion, pct_retencion)"
    )
    .eq("id", bloqueoId)
    .maybeSingle();
  if (error) return { ok: false, error: `No se pudo leer el vuelo negociado: ${error.message}` };
  if (!b) return { ok: false, error: "El vuelo negociado seleccionado ya no existe." };
  return {
    ok: true,
    data: {
      aerolinea: b.aerolinea, record: b.record, ruta: b.ruta,
      fecha_ida: b.fecha_ida, fecha_regreso: b.fecha_regreso,
      vuelo_ida: b.vuelo_ida, vuelo_regreso: b.vuelo_regreso,
      hora_salida_ida: b.hora_salida_ida, hora_llegada_ida: b.hora_llegada_ida,
      hora_salida_reg: b.hora_salida_reg, hora_llegada_reg: b.hora_llegada_reg,
      // bloqueos_vuelo no tiene un campo "neto" separado del "para
      // empaquetar" — el mismo valor de siempre sirve para ambos.
      costo_neto: Number(b.tarifa_para_empaquetar) || 0,
      tarifa_para_empaquetar: Number(b.tarifa_para_empaquetar) || 0,
      fee_infante: 0, // bloqueos_vuelo no tiene fee_infante propio — el infante no ocupa silla.
      proveedor: b.proveedores as unknown as ProveedorVuelo,
    },
  };
}

/**
 * Trae y VALIDA los datos de vuelo de un `empaquetado`: si la lectura falla,
 * si el empaquetado ya no existe, si está desactivado, o si la fecha de hoy
 * (America/Bogota) queda fuera de `compra_inicio`/`compra_fin`, devuelve
 * `ok:false` — nunca `null` silencioso.
 */
export async function datosVueloEmpaquetado(sb: ClienteSb, empaquetadoId: number): Promise<ResultadoDatosVuelo> {
  const { data: e, error } = await sb
    .from("empaquetados")
    .select(
      "aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, compra_inicio, compra_fin, proveedores(nombre, aplica_retencion, pct_retencion)"
    )
    .eq("id", empaquetadoId)
    .maybeSingle();
  if (error) return { ok: false, error: `No se pudo leer el empaquetado: ${error.message}` };
  if (!e) return { ok: false, error: "El empaquetado seleccionado ya no existe." };
  if (!e.activo) return { ok: false, error: "Este empaquetado fue desactivado y ya no se puede reservar." };
  if (!empaquetadoVigente(e.compra_inicio, e.compra_fin, hoyBogota(new Date())))
    return { ok: false, error: "Este empaquetado está fuera de su vigencia de compra." };
  return {
    ok: true,
    data: {
      aerolinea: e.aerolinea, record: e.record, ruta: e.ruta,
      fecha_ida: e.fecha_ida, fecha_regreso: e.fecha_regreso,
      vuelo_ida: e.vuelo_ida, vuelo_regreso: e.vuelo_regreso,
      hora_salida_ida: e.hora_salida_ida, hora_llegada_ida: e.hora_llegada_ida,
      hora_salida_reg: e.hora_salida_reg, hora_llegada_reg: e.hora_llegada_reg,
      // El PROVEEDOR (neto) es lo que se le paga — nunca la reventa.
      costo_neto: Number(e.tarifa_proveedor) || 0,
      tarifa_para_empaquetar: Number(e.tarifa_para_empaquetar) || 0,
      fee_infante: Number(e.fee_infante) || 0,
      proveedor: e.proveedores as unknown as ProveedorVuelo,
    },
  };
}

export async function datosVueloSalida(sb: ClienteSb, salidaId: number): Promise<ResultadoDatosVuelo> {
  const { data: s, error } = await sb
    .from("salidas_dinamicas")
    .select("aerolinea, ruta, fecha_ida, fecha_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, valor_tiquete, fee_infante")
    .eq("id", salidaId)
    .maybeSingle();
  if (error) return { ok: false, error: `No se pudo leer la salida: ${error.message}` };
  if (!s) return { ok: false, error: "La salida seleccionada ya no existe." };
  return {
    ok: true,
    data: {
      aerolinea: s.aerolinea, record: null, ruta: s.ruta,
      fecha_ida: s.fecha_ida, fecha_regreso: s.fecha_regreso,
      vuelo_ida: null, vuelo_regreso: null,
      hora_salida_ida: s.hora_salida_ida, hora_llegada_ida: s.hora_llegada_ida,
      hora_salida_reg: s.hora_salida_reg, hora_llegada_reg: s.hora_llegada_reg,
      // salidas_dinamicas tampoco tiene un campo "neto" separado.
      costo_neto: Number(s.valor_tiquete) || 0,
      tarifa_para_empaquetar: Number(s.valor_tiquete) || 0,
      fee_infante: Number(s.fee_infante) || 0,
      proveedor: null,
    },
  };
}

/**
 * Resuelve los datos de vuelo del `OrigenVuelo` YA VALIDADO por
 * `resolverOrigenVuelo` — único punto de entrada que usan
 * `computarReserva`/`reservarDesdeTarifarioInterno`. `data: null` únicamente
 * cuando `origen.tipo === "ninguno"` (paquete sin vuelo) — cualquier otro
 * caso sin datos es un `ok:false`, nunca un `null` silencioso.
 */
export async function resolverDatosVuelo(
  sb: ClienteSb,
  origen: OrigenVuelo
): Promise<{ ok: true; data: DatosVueloOrigen | null } | { ok: false; error: string }> {
  if (origen.tipo === "ninguno") return { ok: true, data: null };
  const r =
    origen.tipo === "bloqueo" ? await datosVueloBloqueo(sb, origen.id) :
    origen.tipo === "empaquetado" ? await datosVueloEmpaquetado(sb, origen.id) :
    await datosVueloSalida(sb, origen.id);
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}
