// ─────────────────────────────────────────────────────────────────────────
// Descripción manual del paquete (migración 169) — reemplaza la generación
// automática de "Incluye" (armada antes a partir de `armado_servicios.
// incluido=true` + líneas fijas de "Tiquete aéreo"/"Hospedaje en <hotel>").
//
// El contenido pertenece al PAQUETE (`armado_paquetes`), nunca al hotel: los
// 4 campos son texto libre configurado UNA sola vez y compartido por todos
// los hoteles/opciones de ese mismo paquete. Cada campo es un elemento por
// línea, sin HTML ni encabezados embebidos — la UI pone el encabezado fijo y
// convierte cada línea no vacía en un ítem de lista (nunca Markdown, nunca
// dangerouslySetInnerHTML).
// ─────────────────────────────────────────────────────────────────────────

import { presentarIncluye, type ServicioIncluidoRef } from "./incluyePorSalida.ts";

/**
 * Servicios incluidos del paquete y en qué salidas se OMITEN (sin tarifa vigente en la fecha de ida). Sirve para derivar el «Incluye» de cada salida sin tocar el texto
 * guardado. `omitidosPorFecha` solo conoce las salidas fijas (bloqueo/dinámico); sin fecha conocida (porción por fechas) se resuelve en vivo con la búsqueda.
 */
export type ComposicionIncluidos = {
  servicios: ServicioIncluidoRef[];
  omitidosPorFecha: Record<string, number[]>;
};

export type DescripcionPaqueteRaw = {
  incluye: string | null;
  noIncluye: string | null;
  tarifasEspeciales: string | null;
  condicionesComerciales: string | null;
  /** Presente cuando el paquete tiene servicios incluidos y se calculó su composición por salida. */
  composicion?: ComposicionIncluidos;
  /** El cálculo de la composición falló: el texto «Incluye» no se puede validar contra lo que se cobra y NO se presenta (falla cerrado). */
  composicionNoDisponible?: boolean;
};

export type SeccionDescripcion = { titulo: string; items: string[] };

/**
 * Un elemento por línea → array de líneas NO vacías, en el orden en que se
 * escribieron. Solo recorta espacios al inicio/fin de cada línea para decidir
 * si está vacía; nunca toca tildes ni caracteres del contenido. Acepta \r\n o
 * \n indistintamente (textarea de navegador).
 */
export function lineasDeTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Descripción para UNA salida: el texto «Incluye» guardado se conserva, pero se presenta sin afirmar lo que esa salida no incluye ni cobra (ver incluyePorSalida.ts).
 * `omitidos`/`efectivos` salen de la composición del paquete para `fechaIda`; sin fecha (vista general) se retira todo servicio omitido en ALGUNA salida, para no prometerlo
 * donde falta. Devuelve además el aviso para el operador (el cliente no lo ve).
 */
export function descripcionParaSalida(
  d: DescripcionPaqueteRaw | undefined | null, fechaIda?: string | null,
): { descripcion: DescripcionPaqueteRaw | undefined; aviso: string | null } {
  if (!d) return { descripcion: undefined, aviso: null };
  if (d.composicionNoDisponible) return { descripcion: { ...d, incluye: null, composicion: undefined }, aviso: "No se pudo validar el «Incluye» contra los servicios cobrados: no se presenta." };
  const c = d.composicion;
  if (!c) return { descripcion: d, aviso: null };
  const idsOmitidos = new Set<number>(fechaIda && c.omitidosPorFecha[fechaIda] ? c.omitidosPorFecha[fechaIda] : fechaIda ? [] : Object.values(c.omitidosPorFecha).flat());
  return descripcionConServicios(d, c.servicios.filter((s) => !idsOmitidos.has(s.servicioId)), c.servicios.filter((s) => idsOmitidos.has(s.servicioId)));
}

/** Igual que `descripcionParaSalida` pero con la composición ya resuelta (búsqueda en vivo por fechas). */
export function descripcionConServicios(
  d: DescripcionPaqueteRaw, efectivos: readonly ServicioIncluidoRef[], omitidos: readonly ServicioIncluidoRef[],
): { descripcion: DescripcionPaqueteRaw; aviso: string | null } {
  const { composicion: _c, composicionNoDisponible: _n, ...base } = d;
  void _c; void _n;
  if (!omitidos.length) return { descripcion: base, aviso: null };
  const pres = presentarIncluye({ lineas: lineasDeTexto(d.incluye), efectivos, omitidos });
  return { descripcion: { ...base, incluye: pres.lineas.length ? pres.lineas.join("\n") : null }, aviso: pres.aviso };
}

/** Las 4 secciones a renderizar, en orden fijo, SOLO las que tienen contenido. */
export function seccionesDescripcion(d: DescripcionPaqueteRaw | undefined | null): SeccionDescripcion[] {
  const candidatas: SeccionDescripcion[] = [
    { titulo: "El programa incluye", items: lineasDeTexto(d?.incluye) },
    { titulo: "El programa no incluye", items: lineasDeTexto(d?.noIncluye) },
    { titulo: "Tarifas especiales", items: lineasDeTexto(d?.tarifasEspeciales) },
    { titulo: "Condiciones comerciales", items: lineasDeTexto(d?.condicionesComerciales) },
  ];
  return candidatas.filter((s) => s.items.length > 0);
}

/** true si las 4 secciones están vacías (nada configurado todavía). */
export function descripcionVacia(d: DescripcionPaqueteRaw | undefined | null): boolean {
  return seccionesDescripcion(d).length === 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers PUROS del hueco de descripción para paquetes Bernalo (auditoría
// posterior a la tarjeta completa del motor externo): un hotel
// `modelo_tarifario='unidad'` nunca genera filas `bloqueo`/`porcion_
// terrestre` en `tarifario_resumen`, así que `descripcionPorPaquete` (cargado
// SOLO para esos paqueteId en `lib/tarifario/resumen.ts`) puede no cubrir un
// paquete cuyo único hotel es unidad. `app/tarifario/page.tsx` completa ese
// hueco consultando server-side SOLO los `paqueteId` faltantes
// (`lib/tarifario/datosBernalo.ts`, `cargarDescripcionPaquetesBernalo`) y
// fusionando el resultado.
//
// Factorizados aquí (sin I/O, sin Supabase, sin Next) para poder probarse con
// ejecución real bajo `node --test` — antes esta lógica vivía inline en
// page.tsx/datosBernalo.ts y solo se podía verificar por inspección de texto
// del código fuente (wiring), nunca corriéndola de verdad.
// ─────────────────────────────────────────────────────────────────────────

/**
 * `paqueteId` reales de `hotelesBernalo` que TODAVÍA no tienen descripción
 * cargada (por el flujo persona o por una fusión previa) — deduplicados y en
 * el mismo orden de primera aparición. Nunca devuelve el catálogo completo:
 * solo lo que de verdad falta, para que el llamador consulte lo mínimo.
 */
export function idsPaqueteBernaloFaltantes(
  hotelesBernalo: readonly { paqueteId: number }[],
  yaCargados: Readonly<Record<number, unknown>>
): number[] {
  const vistos = new Set<number>();
  const faltantes: number[] = [];
  for (const h of hotelesBernalo) {
    if (yaCargados[h.paqueteId] !== undefined) continue;
    if (vistos.has(h.paqueteId)) continue;
    vistos.add(h.paqueteId);
    faltantes.push(h.paqueteId);
  }
  return faltantes;
}

/** Una fila cruda de `armado_paquetes` (solo las 4 columnas `programa_*` + id). */
export type FilaArmadoPaqueteDescripcion = {
  id: number;
  programa_incluye: string | null;
  programa_no_incluye: string | null;
  programa_tarifas_especiales: string | null;
  programa_condiciones_comerciales: string | null;
};

/** Mapea UNA fila cruda de `armado_paquetes` al shape `DescripcionPaqueteRaw`. */
export function filaArmadoPaqueteADescripcion(fila: FilaArmadoPaqueteDescripcion): DescripcionPaqueteRaw {
  return {
    incluye: fila.programa_incluye,
    noIncluye: fila.programa_no_incluye,
    tarifasEspeciales: fila.programa_tarifas_especiales,
    condicionesComerciales: fila.programa_condiciones_comerciales,
  };
}

/** Mapea varias filas crudas de `armado_paquetes` a `Record<paqueteId, DescripcionPaqueteRaw>`. */
export function filasArmadoPaqueteADescripcionPorPaquete(
  filas: readonly FilaArmadoPaqueteDescripcion[]
): Record<number, DescripcionPaqueteRaw> {
  const out: Record<number, DescripcionPaqueteRaw> = {};
  for (const f of filas) out[f.id] = filaArmadoPaqueteADescripcion(f);
  return out;
}

/**
 * Fusiona la descripción recién consultada para paquetes Bernalo con la ya
 * cargada por el flujo persona — `legacy` SIEMPRE gana (nunca debería
 * coincidir un id, ya que `idsPaqueteBernaloFaltantes` los excluye de
 * antemano, pero esto es la defensa en profundidad explícita). Nunca muta
 * ninguno de los dos argumentos — devuelve SIEMPRE un objeto nuevo.
 */
export function fusionarDescripcionPaquete(
  nuevas: Readonly<Record<number, DescripcionPaqueteRaw>>,
  legacy: Readonly<Record<number, DescripcionPaqueteRaw>>
): Record<number, DescripcionPaqueteRaw> {
  return { ...nuevas, ...legacy };
}
