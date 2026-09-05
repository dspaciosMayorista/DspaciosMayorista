// ─────────────────────────────────────────────────────────────────────────
// Generador de payload para la prueba de integración de B15 (ronda 6):
// reproduce EXACTAMENTE lo que `convertirCotizacionCarrito` arma para el RPC
// `crear_pasajeros_contrato_multi`, usando las funciones puras REALES del
// código de producción (nunca reescribe el piso a mano). Emite por stdout el
// JSON `{ pasajeros, reservas }` que `test_b15_consolidacion_rpc.sh` pasa
// tal cual al RPC de verdad — así la prueba conecta la SALIDA REAL del helper
// con el RPC, cerrando el hueco que dejaba la prueba anterior (que enviaba
// `holdersMin` a mano).
//
// Uso: node --experimental-strip-types _b15_gen_payload.ts '<specJSON>'
//   spec = { pasajeros: [{nombre, fechaNacimiento, responsableOrden?}], items: [{bloqueoId, posicionesGlobal}], fechaRef }
// ─────────────────────────────────────────────────────────────────────────
import {
  posicionesUnicasDeGrupo,
  reindexarGrupoLocal,
  consolidarReservasSillasPorBloqueo,
} from "../../lib/reservar/carritoAsignaciones.ts";
import { normalizarResponsablesPorGrupo } from "../../lib/reservar/pasajerosFilas.ts";
import { esInfantePorEdad, pasajeroConsumeSilla } from "../../lib/reservar/pasajeros.ts";

type PaxSpec = { nombre: string; fechaNacimiento: string; responsableOrden?: number };
type ItemSpec = { bloqueoId: number; posicionesGlobal: number[] };
type Spec = { pasajeros: PaxSpec[]; items: ItemSpec[]; fechaRef: string | null };

const spec: Spec = JSON.parse(process.argv[2]);
// `responsableIndex` (0-based) desde `responsableOrden` (1-based) para reusar el módulo puro.
const pasajerosGlobales = spec.pasajeros.map((p) => ({
  ...p,
  responsableIndex: p.responsableOrden != null ? p.responsableOrden - 1 : null,
}));

const universoGrupo = posicionesUnicasDeGrupo(spec.items.map((it) => it.posicionesGlobal), spec.items.map((_, i) => i));
const pasajerosNorm = normalizarResponsablesPorGrupo(pasajerosGlobales, spec.fechaRef);
const { pasajerosLocal, mapaGlobalALocal } = reindexarGrupoLocal(pasajerosNorm, universoGrupo);

const itemsBloqueoLocal = spec.items.map((it) => ({
  bloqueoId: it.bloqueoId,
  posiciones: it.posicionesGlobal.map((g) => mapaGlobalALocal.get(g)! + 1),
  posicionesConSilla: it.posicionesGlobal
    .filter((g) => pasajeroConsumeSilla(esInfantePorEdad(pasajerosNorm[g - 1].fechaNacimiento, spec.fechaRef)))
    .map((g) => mapaGlobalALocal.get(g)! + 1),
}));
const reservas = consolidarReservasSillasPorBloqueo(itemsBloqueoLocal);

// El payload de pasajeros va en el orden LOCAL (mismo que envía el servidor).
const pasajeros = pasajerosLocal.map((p, i) => ({
  nombre: p.nombre,
  tipoId: pasajeroConsumeSilla(esInfantePorEdad(p.fechaNacimiento, spec.fechaRef)) ? "CC" : "RC",
  identificacion: String(900000100 + i),
  fechaNacimiento: p.fechaNacimiento,
  ...(p.responsableIndex != null ? { responsableOrden: p.responsableIndex + 1 } : {}),
}));

process.stdout.write(JSON.stringify({ pasajeros, reservas }));
