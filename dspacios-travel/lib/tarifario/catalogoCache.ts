import { unstable_cache, updateTag } from "next/cache";
import { crearCatalogoCompartido, TAG_TARIFARIO_CATALOGO } from "./catalogoCompartidoFabrica.ts";

// Capa fina de wiring real de Next.js sobre `catalogoCompartidoFabrica.ts`
// (la lógica pura, sin importar `next/cache` — ver la nota grande en ese
// archivo sobre por qué está separado). Este archivo es el que importan
// las 3 páginas y las Server Actions; no se prueba directamente con
// `node --test` (mismo criterio que el resto del código dependiente del
// runtime de Next en este repo) — lo que sí se prueba con ejecución real es
// el CONTRATO de `crearCatalogoCompartido()` en
// pruebas/tarifarioCatalogoCache.test.ts, inyectando un cacheador falso con
// el mismo comportamiento observable que `unstable_cache` real.
export { TAG_TARIFARIO_CATALOGO };

const catalogoCompartidoReal = crearCatalogoCompartido({ cachear: unstable_cache });
export const cargarDatosTarifarioCompartido = catalogoCompartidoReal.cargarDatosTarifarioCompartido;
export const cargarFilasTarifarioLivianoCompartido = catalogoCompartidoReal.cargarFilasTarifarioLivianoCompartido;
export const getProgramasResumenCompartido = catalogoCompartidoReal.getProgramasResumenCompartido;

/**
 * Invalida TODO el catálogo tarifario cacheado (los 3 fetchers de arriba
 * comparten esta única etiqueta). Llamar SOLO después de una escritura
 * EXITOSA en cualquiera de las tablas que alimentan el catálogo — tarifas,
 * temporadas, vigencias, empaquetados, fotos/capacidades de hotel,
 * servicios (foto), planes de alimentación, programas. NUNCA se llama si
 * la escritura falló (revisa el `error`/`ok:false` de la Server Action
 * ANTES de invalidar — buscar `invalidarCatalogoTarifario()` en el código
 * muestra cada punto exacto donde esto se cumple).
 *
 * NO cubre `sillas`/`cupos_por_bloqueo`/`bloqueos_vuelo` (origen): esos se
 * refrescan en vivo en cada llamada (ver auditoría de volatilidad en
 * catalogoCompartidoFabrica.ts), así que reservar/confirmar/liberar una
 * silla NUNCA necesita invalidar esta etiqueta.
 *
 * Usa `updateTag()` (no `revalidateTag()`): en Next 16 esta última exige un
 * segundo argumento de perfil (`cacheLife`, el sistema NUEVO de `'use
 * cache'`, que este módulo no usa) y solo garantiza la purga en la SIGUIENTE
 * request. `updateTag()` es la construida para el caso de uso exacto de
 * este archivo — invalidar desde dentro de una Server Action, con semántica
 * "read-your-own-writes": quien acaba de guardar ve el catálogo actualizado
 * de inmediato, sin esperar a que expire por su cuenta.
 */
export function invalidarCatalogoTarifario(): void {
  updateTag(TAG_TARIFARIO_CATALOGO);
}
