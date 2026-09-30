// Uso de un destino por el resto del catálogo (Producto → Destinos).
//
// Módulo PURO y sin imports: lo usan el listado de destinos (cliente), el
// modal de eliminación (cliente) y la Server Action que cuenta el uso.
//
// Fuente autoritativa de REFERENCIAS_DESTINO: las llaves foráneas a
// `destinos(id)` declaradas en las migraciones —
//   004 hoteles, temporadas, itinerarios, inclusiones
//   013 paquetes
//   016 servicios_adicionales
//   018 bloqueos_vuelo, armado_paquetes, tarifario_resultado
//   156 empaquetados
// Ninguna declara ON DELETE, así que UNA sola fila que apunte al destino hace
// fallar el DELETE (23503). Y `fn_fusionar_destino` (migración 112) re-apunta
// exactamente esas columnas (todas las FK a destinos) antes de borrar: nada
// más. `pruebas/usoDestino.test.ts` falla si aparece una FK nueva a destinos
// que no esté en esta lista.

export const REFERENCIAS_DESTINO = [
  { tabla: "hoteles", singular: "hotel", plural: "hoteles" },
  { tabla: "servicios_adicionales", singular: "servicio adicional", plural: "servicios adicionales" },
  { tabla: "armado_paquetes", singular: "paquete", plural: "paquetes" },
  { tabla: "tarifario_resultado", singular: "fila del tarifario generado", plural: "filas del tarifario generado" },
  { tabla: "bloqueos_vuelo", singular: "bloqueo de vuelo", plural: "bloqueos de vuelo" },
  { tabla: "empaquetados", singular: "empaquetado", plural: "empaquetados" },
  // Tablas del esquema inicial (migraciones 004/013). Siguen existiendo y
  // siguen bloqueando el borrado aunque la app actual ya no las llene.
  { tabla: "paquetes", singular: "paquete del esquema anterior", plural: "paquetes del esquema anterior" },
  { tabla: "temporadas", singular: "temporada del esquema anterior", plural: "temporadas del esquema anterior" },
  { tabla: "itinerarios", singular: "itinerario del esquema anterior", plural: "itinerarios del esquema anterior" },
  { tabla: "inclusiones", singular: "inclusión del esquema anterior", plural: "inclusiones del esquema anterior" },
] as const;

export type TablaReferenciaDestino = (typeof REFERENCIAS_DESTINO)[number]["tabla"];

/** Conteo por tabla. `null` = no se pudo contar (error de consulta). */
export type ConteosUsoDestino = Record<TablaReferenciaDestino, number | null>;

/**
 * ¿El rol del usuario puede eliminar/fusionar destinos? Mismo set que la
 * policy de escritura de `destinos` y que `fn_fusionar_destino` (migración 112).
 * "desconocido" = no se pudo resolver el rol: nunca se trata como "si" ni "no".
 */
export type PermisoDestino = "si" | "no" | "desconocido";

/**
 * Respuesta de la Server Action `usoDestino`. `alcanceCompleto` = el rol del
 * usuario ve TODAS las filas de estas tablas (solo los roles que pueden
 * borrar destinos); si es false, un 0 puede deberse a RLS y no a ausencia.
 * Equivale a `permiso === "si"`.
 */
export type UsoDestino = { conteos: ConteosUsoDestino; alcanceCompleto: boolean; permiso: PermisoDestino };

/** "1 hotel" / "0 hoteles" / "3 hoteles". */
export function etiquetaConteo(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export type ResumenUsoDestino = {
  /** Solo las tablas con al menos una fila, en el orden de REFERENCIAS_DESTINO. */
  items: { tabla: TablaReferenciaDestino; cantidad: number; texto: string }[];
  /** Etiquetas (plural) de las tablas que no se pudieron contar. */
  sinVerificar: string[];
  /** Suma de las filas contadas (las no verificadas no suman). */
  total: number;
};

export function resumirUsoDestino(conteos: Partial<ConteosUsoDestino>): ResumenUsoDestino {
  const items: ResumenUsoDestino["items"] = [];
  const sinVerificar: string[] = [];
  let total = 0;
  for (const ref of REFERENCIAS_DESTINO) {
    const n = conteos[ref.tabla];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      sinVerificar.push(ref.plural);
      continue;
    }
    if (n === 0) continue;
    items.push({ tabla: ref.tabla, cantidad: n, texto: etiquetaConteo(n, ref.singular, ref.plural) });
    total += n;
  }
  return { items, sinVerificar, total };
}

/**
 * Qué ofrece el modal de eliminación, según lo VERIFICADO (nunca por la
 * cantidad de hoteles):
 *   · "sin_permiso"     — el rol no puede eliminar destinos: ninguna acción.
 *   · "borrado_directo" — verificado sin contenido (rol autorizado, las 10
 *                         tablas contadas, total 0).
 *   · "fusion"          — tiene contenido (alguna tabla con filas): hay que
 *                         elegir a qué destino moverlo (fn_fusionar_destino).
 *   · "no_verificado"   — no se pudo verificar (rol desconocido o alguna
 *                         tabla sin contar) y no se vio contenido: se ofrece
 *                         la fusión, NUNCA un borrado basado en un 0 supuesto.
 */
export type ModoEliminacion = "sin_permiso" | "borrado_directo" | "fusion" | "no_verificado";

export function modoEliminacion(uso: UsoDestino): ModoEliminacion {
  if (uso.permiso === "no") return "sin_permiso";
  const r = resumirUsoDestino(uso.conteos);
  if (r.total > 0) return "fusion";
  if (uso.permiso === "si" && uso.alcanceCompleto && r.sinVerificar.length === 0) return "borrado_directo";
  return "no_verificado";
}
