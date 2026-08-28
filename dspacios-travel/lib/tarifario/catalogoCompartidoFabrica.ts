import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
// Import RELATIVO con extensión `.ts` para los que son de VALOR — mismo
// motivo que en lib/tarifario/datos.ts/vigencia.ts: `@/` es un alias que
// solo resuelve Next.js/TypeScript en build; bajo `node --test` plano
// revienta con `ERR_MODULE_NOT_FOUND`. `FilaTarifario` es solo TIPO, así
// que ese sí puede quedar con el alias (se elimina con
// `--experimental-strip-types`, nunca se resuelve en runtime de prueba).
//
// ⚠️ Este archivo NO importa `next/cache` a propósito (a diferencia de
// catalogoCache.ts, que sí lo hace): bajo `node --test` plano, `import {
// unstable_cache } from "next/cache"` revienta con `ERR_MODULE_NOT_FOUND`
// ("Did you mean to import next/cache.js") porque el paquete `next` no
// declara un `exports` map — Node exige la extensión exacta para
// resolución ESM nativa, algo que solo el bundler de Next.js resuelve. Ese
// error ocurre al CARGAR el módulo (import estático), sin importar si el
// código luego usa el valor o no — así que la única forma de mantener este
// archivo testeable con ejecución real es que NUNCA importe `next/cache`.
// `catalogoCache.ts` (el que sí importa Next) es la capa fina que las
// páginas/Server Actions reales consumen; este archivo es la lógica pura.
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import { createAdminClient } from "../supabase/admin.ts";
import {
  cargarDatosTarifario, obtenerCuposYOrigen, MSG_ERROR_CARGAR_TARIFARIO,
  type ResultadoDatosTarifario, type DatosTarifario, type CuposYOrigen,
} from "./datos.ts";
import { getProgramasResumen, type ResultadoProgramasResumen } from "../programas.ts";
import { cargarFilasTarifarioPaginado } from "./paginacion.ts";
import { filtrarTarifarioVencidas } from "./vigencia.ts";
import { registrarErrorTecnico } from "../observabilidad/medicion.ts";

// ═════════════════════════════════════════════════════════════════════════
// CACHÉ COMPARTIDA DEL CATÁLOGO TARIFARIO — /tarifario, /dashboard/tarifario
// y /dashboard/reservar leen el MISMO catálogo costoso (paginación de
// `tarifario_resultado` + filtro de vigencia + enriquecimiento de hotel/
// servicio/programas). El diagnóstico de producción midió ~5.6s de
// preparación de servidor, ~4.4s de paginación (18 consultas, 17.197 filas)
// y ~1s de filtro de vigencia — y las 3 rutas repiten ese costo en CADA
// visita, aunque el catálogo no haya cambiado entre una y otra.
//
// AUDITORÍA (qué es global vs. qué es de usuario) — hecha ANTES de cachear:
//   - `tarifario_resultado`: RLS "lectura para todos" (`using (true)`,
//     migración 018) — el resultado es IDÉNTICO para anónimo, agencia,
//     admin, cualquier tenant. No hay columna `tenant` en esta tabla ni en
//     ninguna de las que lee `cargarDatosTarifario()`/`getProgramasResumen()`
//     (`hotel_temporadas`, `tarifa_hotel`, `hoteles`, `hotel_fotos`,
//     `hotel_acomodaciones`, `servicios_adicionales`, `planes_alimentacion`,
//     `armado_paquetes`, `armado_servicios`, `empaquetados`, `programas` y
//     sus tablas hijas) — la columna `tenant` (migración 107) solo se agregó
//     a `ventas/abonos/cuentas_por_pagar/facturacion/aliados_b2b/
//     liquidacion_comisiones/pe_empleados/pe_costos/contabilidad_movimientos/
//     conciliacion/usuarios`, NUNCA al catálogo de producto — de hecho
//     minorista NO TIENE tarifario/reservar (`CLAUDE.md`), así que el
//     catálogo es exclusivamente de mayorista, sin ambigüedad de tenant.
//   - `app/tarifario/page.tsx` ya documentaba esto EXPLÍCITAMENTE antes de
//     esta ronda: "el tarifario/programas/config_sitio son los mismos para
//     cualquiera" — la sesión (`resolverSesion`) solo decide `esAgencia`/
//     `puedeReservar` para el RENDER, nunca qué datos pedir.
//   - EXCEPCIÓN encontrada en la auditoría: `cupos_por_bloqueo` (VISTA sobre
//     `sillas`) y el origen de `bloqueos_vuelo` SÍ son "globales" en el
//     sentido de no depender de usuario/sesión/tenant, pero son VOLÁTILES —
//     cambian en cada reserva/confirmación/liberación de silla, mucho más
//     frecuente que cualquier edición de catálogo. Cachearlos con el mismo
//     TTL/etiqueta que el resto arriesgaría mostrar una salida como
//     disponible/agotada de forma incorrecta durante minutos. Por eso NUNCA
//     entran al bloque cacheado: `cargarDatosTarifarioCompartido()` los
//     refresca EN VIVO en cada llamada (hit o miss del resto del catálogo),
//     vía `obtenerCuposYOrigen()` (lib/tarifario/datos.ts) — 2 consultas
//     acotadas por `bloqueoIds`, no las 18 de la paginación completa.
//   - Autenticación/perfil/rol/tenant/`esAgencia`/`puedeReservar` NUNCA
//     entran aquí — siguen resolviéndose por request en cada page.tsx (ver
//     `resolverSesion` en app/tarifario/page.tsx), fuera de este módulo.
// ═════════════════════════════════════════════════════════════════════════

/** Etiqueta única de invalidación — un solo `updateTag()` limpia los 3 fetchers de abajo. */
export const TAG_TARIFARIO_CATALOGO = "tarifario-catalogo";
/** Vigencia de respaldo: si nadie invalida a tiempo, el catálogo igual se refresca solo. */
export const REVALIDATE_SEGUNDOS_CATALOGO = 300;

const COLUMNAS_LIVIANAS_CATALOGO =
  "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp, moneda";

export type ResultadoFilasLivianas = { ok: true; filas: FilaTarifario[] } | { ok: false };

// Firma de `unstable_cache` de Next, copiada aquí SIN importar `next/cache`
// (ver nota de arriba) — así el tipo del parámetro inyectable sigue siendo
// exacto (misma forma que Next espera) sin forzar la resolución del módulo.
// `any` en la constricción del genérico es DELIBERADO: es exactamente como
// Next tipa `Callback` en su propio `.d.ts` (`(...args: any[]) => Promise<any>`)
// — usar `never`/`unknown` aquí rompe la asignabilidad genérica al pasar la
// `unstable_cache` real como valor de este tipo (variancia de funciones
// genéricas), que es justo lo que este tipo necesita permitir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cacheador = <T extends (...args: any[]) => Promise<any>>(
  cb: T, keyParts?: string[], opciones?: { revalidate?: number | false; tags?: string[] }
) => T;

async function catalogoCompletoCrudoReal(): Promise<DatosTarifario> {
  const admin = createAdminClient();
  // flujo/flujoId neutros: esta ejecución no pertenece a una sola visita de
  // página — su resultado se comparte entre TODAS las que pidan el
  // catálogo mientras la caché siga vigente, así que no tiene sentido
  // atribuirla a un flujoId de una sola request. Sus propias etapas
  // internas (carga_paginada/filtro_vigencia/datos_auxiliares) quedan
  // visibles en los logs bajo este flujo, separadas de las del page.tsx.
  const r = await cargarDatosTarifario(admin, "cache_catalogo_tarifario", "n/a", admin);
  if (!r.ok) throw new Error(r.error); // nunca cachear un fallo técnico
  return r.datos;
}

async function filasLivianasCrudoReal(): Promise<FilaTarifario[]> {
  const admin = createAdminClient();
  const pag = await cargarFilasTarifarioPaginado<FilaTarifario>(admin, COLUMNAS_LIVIANAS_CATALOGO);
  if (!pag.ok) throw new Error("error_paginacion_tarifario_liviano");
  const resVig = await filtrarTarifarioVencidas(admin, pag.filas);
  if (resVig.error) throw new Error("error_vigencia_tarifario_liviano");
  return resVig.filas;
}

async function programasResumenCrudoReal(soloPublicados: boolean): Promise<ResultadoProgramasResumen> {
  const admin = createAdminClient();
  const r = await getProgramasResumen(admin, soloPublicados);
  if (r.error) throw new Error("error_programas_resumen_cacheado");
  return r;
}

export type FuncionesCatalogoCompartido = {
  cargarDatosTarifarioCompartido: (sb: SupabaseClient<Database>, flujo: string, flujoId: string) => Promise<ResultadoDatosTarifario>;
  cargarFilasTarifarioLivianoCompartido: (sb: SupabaseClient<Database>) => Promise<ResultadoFilasLivianas>;
  getProgramasResumenCompartido: (sb: SupabaseClient<Database>, soloPublicados: boolean) => Promise<ResultadoProgramasResumen>;
};

export type DependenciasCatalogoCompartido = {
  /** SIN default aquí (a propósito, ver nota de arriba) — `catalogoCache.ts` lo pasa como `unstable_cache` real. */
  cachear: Cacheador;
  catalogoCrudo?: () => Promise<DatosTarifario>;
  filasLivianasCrudo?: () => Promise<FilaTarifario[]>;
  programasResumenCrudo?: (soloPublicados: boolean) => Promise<ResultadoProgramasResumen>;
  obtenerCupos?: (admin: SupabaseClient<Database>, bloqueoIds: number[]) => Promise<CuposYOrigen>;
  admin?: SupabaseClient<Database>;
};

/**
 * Fábrica de las 3 versiones "compartidas" (cacheadas) del catálogo
 * tarifario. Cada dependencia tiene el MISMO comportamiento real por
 * default (`createAdminClient()`, las funciones ya existentes de
 * `datos.ts`/`programas.ts`) EXCEPTO `cachear`, que no tiene default aquí
 * (ver nota de imports arriba) — `catalogoCache.ts` la provee como
 * `unstable_cache` real; las pruebas de ejecución real
 * (pruebas/tarifarioCatalogoCache.test.ts) la proveen como un cacheador
 * FALSO en memoria con el MISMO contrato observable, sin depender de
 * Next.js en ejecución ni de una base de datos real.
 */
export function crearCatalogoCompartido(deps: DependenciasCatalogoCompartido): FuncionesCatalogoCompartido {
  const {
    cachear,
    catalogoCrudo = catalogoCompletoCrudoReal,
    filasLivianasCrudo = filasLivianasCrudoReal,
    programasResumenCrudo = programasResumenCrudoReal,
    obtenerCupos = obtenerCuposYOrigen,
    admin = undefined,
  } = deps;

  const catalogoCacheado = cachear(catalogoCrudo, ["tarifario-datos-completo"], {
    tags: [TAG_TARIFARIO_CATALOGO], revalidate: REVALIDATE_SEGUNDOS_CATALOGO,
  });
  const filasLivianasCacheadas = cachear(filasLivianasCrudo, ["tarifario-filas-livianas"], {
    tags: [TAG_TARIFARIO_CATALOGO], revalidate: REVALIDATE_SEGUNDOS_CATALOGO,
  });
  const programasResumenCacheado = cachear(programasResumenCrudo, ["tarifario-programas-resumen"], {
    tags: [TAG_TARIFARIO_CATALOGO], revalidate: REVALIDATE_SEGUNDOS_CATALOGO,
  });

  async function cargarDatosTarifarioCompartido(
    sb: SupabaseClient<Database>, flujo: string, flujoId: string
  ): Promise<ResultadoDatosTarifario> {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Sin service role no hay cliente independiente de cookies para leer
      // el catálogo de forma cacheable (ver auditoría arriba) — mismo
      // camino de siempre, sin caché, como si esta función no existiera.
      return cargarDatosTarifario(sb, flujo, flujoId, null);
    }
    let base: DatosTarifario;
    try {
      base = await catalogoCacheado();
    } catch (e) {
      registrarErrorTecnico(flujo, flujoId, "carga_paginada", "error_catalogo_tarifario_cacheado", e);
      return { ok: false, error: MSG_ERROR_CARGAR_TARIFARIO };
    }
    // Cupos/origen SIEMPRE en vivo (ver auditoría de volatilidad arriba),
    // nunca desde el bloque cacheado — se derivan de `bloqueoIds` de las
    // filas YA visibles (después de vigencia/empaquetados/servicios), que
    // es exactamente el mismo set que consumen VistaBooking/TarifarioPublic.
    const adminVivo = admin ?? createAdminClient();
    const bloqueoIds = [...new Set(
      base.filasVisibles.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id != null).map((f) => f.bloqueo_id as number)
    )];
    const cupos = await obtenerCupos(adminVivo, bloqueoIds);
    if (cupos.error1) registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_cupos_por_bloqueo", cupos.error1);
    if (cupos.error2) registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_bloqueos_vuelo_origen", cupos.error2);
    return {
      ok: true,
      datos: { ...base, cuposPorBloqueo: cupos.cuposPorBloqueo, origenPorBloqueo: cupos.origenPorBloqueo },
    };
  }

  async function cargarFilasTarifarioLivianoCompartido(
    sb: SupabaseClient<Database>
  ): Promise<ResultadoFilasLivianas> {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const pag = await cargarFilasTarifarioPaginado<FilaTarifario>(sb, COLUMNAS_LIVIANAS_CATALOGO);
      return pag.ok ? { ok: true, filas: pag.filas } : { ok: false };
    }
    try {
      return { ok: true, filas: await filasLivianasCacheadas() };
    } catch {
      return { ok: false };
    }
  }

  async function getProgramasResumenCompartido(
    sb: SupabaseClient<Database>, soloPublicados: boolean
  ): Promise<ResultadoProgramasResumen> {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return getProgramasResumen(sb, soloPublicados);
    }
    try {
      return await programasResumenCacheado(soloPublicados);
    } catch (e) {
      return { programas: [], error: e };
    }
  }

  return { cargarDatosTarifarioCompartido, cargarFilasTarifarioLivianoCompartido, getProgramasResumenCompartido };
}
