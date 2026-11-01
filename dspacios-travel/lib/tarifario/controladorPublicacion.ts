// ─────────────────────────────────────────────────────────────────────────────
// Controlador de la publicación del tarifario por lotes (migración 260: ver docs/tecnico/publicador-tarifario-lotes.md).
//
// Calcular ≠ hacer visible. Una publicación grande no cabe en una petición: este controlador la reparte SIN perder trabajo y SIN mostrar nunca algo a medias.
//   1. Manifiesto fijado en el servidor ANTES de cargar (lotes, filas, huella SHA-256 del texto exacto de cada lote; composición de la 258, diagnóstico de la 256, modo 63).
//   2. PREPARAR: cada lote calculado se deja «en espera» dentro de la base (una sola vez; verificado contra su huella). Es lo único que exige que el cálculo siga en memoria.
//   3. ENCOLAR: con todos los lotes en la base, la publicación queda en la cola y puede continuar SIN navegador (pg_cron o la ruta /api/cron/publicacion-tarifario).
//   4. AVANZAR: pasos cortos (un lote, la activación o una tanda de limpieza) hasta agotar el presupuesto de esta petición; lo que quede lo termina el trabajador de la base.
//   · Si el cálculo cambió entre peticiones, el manifiesto no coincide (`conflicto`): se descarta, nunca se mezclan lotes de dos cálculos.
//   · Se activa SOLO con todos los lotes cargados; lo publicado antes sigue visible e intacto hasta ese instante (un solo UPDATE del puntero).
// Módulo puro (sin acceso a base de datos): habla con la base por un `PuertoPublicacion` inyectado (Supabase en la app, PostgREST en las pruebas, un falso en las unitarias).
// ─────────────────────────────────────────────────────────────────────────────

import { FILAS_POR_LOTE_DEFECTO, lotesPendientes, manifiestoDe, prepararLotes, type EntradaManifiesto } from "./publicacionPorLotes.ts";

/** Ventana de UNA petición = duración máxima de la acción (`export const maxDuration` de la página que la usa; la prueba de cableado exige que coincidan). 60 s es válido en
 * TODA configuración de Vercel (Hobby sin Fluid 60 s; con Fluid Hobby 300 s, Pro 800 s): no depende de un plan que no está verificado. Ver la doc. */
export const VENTANA_PETICION_MS = 60_000;
/** Reserva para la respuesta y la variación de red; se resta de la ventana. */
export const HOLGURA_PETICION_MS = 6_000;
/** Estimaciones ANTES de haber medido nada en esta petición (peor caso medido con la CPU estrangulada: lote de 1.000 filas 5,5 s; activación 2,8 s; tanda de limpieza de 250 filas ~5 s;
 * dejar un lote en espera 1,2 s). Una vez medido un paso se usa lo observado × FACTOR_SEGURIDAD. */
export const ESTIMACION_LOTE_MS = 8_000;
export const ESTIMACION_ACTIVACION_MS = 3_000;
export const ESTIMACION_LIMPIEZA_MS = 11_000;
export const ESTIMACION_ESPERA_MS = 2_500;
export const FACTOR_SEGURIDAD = 1.3;

export type EstadoPublicacionServidor = {
  existe: boolean; vigente?: boolean; publicada?: boolean; pendientes?: number[]; enEspera?: number[]; totalLotes?: number; revisionCapturada?: number;
  enCola?: boolean; colaEstado?: string | null; colaIntentos?: number; colaError?: string | null;
};

export type ArgsManifiesto = {
  paqueteId: number; generacion: number; revision: number; moneda: "COP" | "USD";
  lotes: EntradaManifiesto[]; composicion: readonly unknown[]; regla: number; modo: string | null; trm: number | null; diagnostico: string | null;
};

export interface PuertoPublicacion {
  manifiesto(a: ArgsManifiesto): Promise<string>;
  estado(paqueteId: number, generacion: number): Promise<EstadoPublicacionServidor>;
  /** Deja un lote calculado en espera (no lo carga). */
  espera(paqueteId: number, generacion: number, lote: number, texto: string): Promise<string>;
  encolar(paqueteId: number, generacion: number): Promise<string>;
  /** UN paso: cargar el siguiente lote, activar o limpiar. */
  avanzar(paqueteId: number, generacion: number): Promise<string>;
}

export type EntradaPublicacion = {
  paqueteId: number; generacion: number; revision: number; moneda: "COP" | "USD";
  filas: readonly unknown[];
  composicion?: readonly unknown[]; regla?: number; modo?: string | null; trm?: number | null; diagnostico?: string | null;
  tamLote?: number; reloj?: () => number;
  /** Instante (según `reloj`) en que EMPEZÓ la acción: la ventana se cuenta desde ahí, no desde esta llamada (antes ya se leyeron y calcularon las fuentes). */
  inicioMs?: number; ventanaMs?: number; holguraMs?: number;
};

export type MotivoDescarte = "obsoleta" | "fuente_cambio" | "modo_cambio";
export type ResultadoPublicacion =
  /** Visible. Si `limpiezaPendiente`, el trabajador termina de retirar las generaciones superadas (invisibles). */
  | { estado: "publicada"; lotes: number; filas: number; pasos: number; limpiezaPendiente: boolean }
  /** `automatica`: todos los lotes ya están en la base y la publicación avanza sola (sin navegador). Si es false faltan lotes por PREPARAR y otra petición debe volver a calcular y subirlos. */
  | { estado: "pendiente"; faltan: number; total: number; automatica: boolean }
  | { estado: "descartada"; motivo: MotivoDescarte }
  | { estado: "conflicto" }
  | { estado: "rechazada"; motivo: string };

const descarte = (r: string): MotivoDescarte | null => (r === "obsoleta" ? "obsoleta" : r === "fuente_cambio" ? "fuente_cambio" : r === "modo_cambio" ? "modo_cambio" : null);

/** Una «petición» de publicación. Las excepciones del puerto (errores reales de la base, p. ej. una FK inválida) se propagan: el llamador decide cómo reportarlas. */
export async function publicarPorLotes(puerto: PuertoPublicacion, e: EntradaPublicacion): Promise<ResultadoPublicacion> {
  const reloj = e.reloj ?? (() => Date.now());
  const t0 = e.inicioMs ?? reloj();
  const limite = t0 + (e.ventanaMs ?? VENTANA_PETICION_MS) - (e.holguraMs ?? HOLGURA_PETICION_MS);
  // Lo que cuesta cada tipo de llamada: lo observado en ESTA petición (× margen) o, mientras no se haya medido, la estimación del peor caso.
  const peor = { espera: 0, lote: 0, limpieza: 0 };
  const estEspera = () => (peor.espera ? peor.espera * FACTOR_SEGURIDAD : ESTIMACION_ESPERA_MS);
  const estLote = () => (peor.lote ? peor.lote * FACTOR_SEGURIDAD : ESTIMACION_LOTE_MS);
  const estLimpieza = () => (peor.limpieza ? peor.limpieza * FACTOR_SEGURIDAD : ESTIMACION_LIMPIEZA_MS);
  const lotes = prepararLotes(e.filas, e.tamLote ?? FILAS_POR_LOTE_DEFECTO);
  if (!lotes.length) return { estado: "rechazada", motivo: "sin_filas" };

  const m = await puerto.manifiesto({
    paqueteId: e.paqueteId, generacion: e.generacion, revision: e.revision, moneda: e.moneda, lotes: manifiestoDe(lotes),
    composicion: e.composicion ?? [], regla: e.regla ?? 1, modo: e.modo ?? null, trm: e.trm ?? null, diagnostico: e.diagnostico ?? null,
  });
  if (m === "conflicto") return { estado: "conflicto" };
  const dm = descarte(m);
  if (dm) return { estado: "descartada", motivo: dm };
  if (m !== "ok") return { estado: "rechazada", motivo: m };

  const est = await puerto.estado(e.paqueteId, e.generacion);
  if (!est.existe) return { estado: "rechazada", motivo: "sin_manifiesto" };
  const sinCargar = lotesPendientes(lotes, est.pendientes ?? []);
  const yaEnEspera = new Set(est.enEspera ?? []);

  // 2. PREPARAR: lo único que necesita el cálculo en memoria. Si el presupuesto se agota aquí NO puede continuar solo: otra petición vuelve a calcular las mismas filas y sube las que faltan.
  const porPreparar = sinCargar.filter((l) => !yaEnEspera.has(l.lote));
  for (let i = 0; i < porPreparar.length; i++) {
    if (reloj() + estEspera() > limite) return { estado: "pendiente", faltan: sinCargar.length, total: lotes.length, automatica: false };
    const ini = reloj();
    const r = await puerto.espera(e.paqueteId, e.generacion, porPreparar[i].lote, porPreparar[i].texto);
    peor.espera = Math.max(peor.espera, reloj() - ini);
    if (r === "ok") continue;
    const d = descarte(r);
    return d ? { estado: "descartada", motivo: d } : { estado: "rechazada", motivo: r };
  }

  // 3. ENCOLAR: desde aquí la publicación puede terminar sin esta petición ni el navegador.
  const q = await puerto.encolar(e.paqueteId, e.generacion);
  if (q !== "ok") {
    const d = descarte(q);
    return d ? { estado: "descartada", motivo: d } : { estado: "rechazada", motivo: q };
  }

  // 4. AVANZAR con el presupuesto que quede.
  let faltan = sinCargar.length;
  let activada = false;
  let pasos = 0;
  for (;;) {
    // Se mira ANTES de cada paso: no se empieza uno que (con lo que costó el peor hasta ahora) no deje sitio para terminar él Y la activación dentro de la ventana.
    const costo = activada ? estLimpieza() : estLote() + ESTIMACION_ACTIVACION_MS;
    if (reloj() + costo > limite) break;
    const ini = reloj();
    const r = await puerto.avanzar(e.paqueteId, e.generacion);
    pasos++;
    if (r.startsWith("lote:")) { peor.lote = Math.max(peor.lote, reloj() - ini); faltan = Math.max(0, faltan - 1); continue; }
    if (r === "activada") { activada = true; faltan = 0; continue; }
    if (r.startsWith("limpieza:")) { peor.limpieza = Math.max(peor.limpieza, reloj() - ini); continue; }
    if (r === "listo") return { estado: "publicada", lotes: lotes.length, filas: e.filas.length, pasos, limpiezaPendiente: false };
    // Otro trabajador tiene la publicación en este instante, o un paso falló y la base lo reintenta con espera creciente: no es un fallo, sigue sola.
    if (r === "ocupada" || r.startsWith("error:")) break;
    const d = descarte(r);
    if (d) return { estado: "descartada", motivo: d };
    if (r === "sin_cola") { if (activada) return { estado: "publicada", lotes: lotes.length, filas: e.filas.length, pasos, limpiezaPendiente: false }; break; }
    return { estado: "rechazada", motivo: r };   // fallida · detenida:<motivo> · otra_generacion
  }
  if (activada) return { estado: "publicada", lotes: lotes.length, filas: e.filas.length, pasos, limpiezaPendiente: true };
  return { estado: "pendiente", faltan, total: lotes.length, automatica: true };
}
