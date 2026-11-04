// ─────────────────────────────────────────────────────────────────────────
// Construcción de la entrada de `hotelesSnap` (rama PERSONA, la que pasa por
// `computarReserva`) para el snapshot de la cotización (`cotizaciones.
// detalle.hoteles[]`) — extraída TEXTUALMENTE de
// `app/tarifario/checkout/actions.ts::crearCotizacionCarrito` (bloque
// `hotelesSnap.push({...})` de la rama persona) a un módulo PURO, para que
// `crearCotizacionCarrito` y las pruebas de ejecución real usen EXACTAMENTE
// la misma función — nunca una copia fabricada a mano en el test.
//
// Import de tipo SOLO (`import type`, se elimina por completo con
// `--experimental-strip-types` — nunca dispara el import en tiempo de
// ejecución de `computo.ts`, que sí usa el alias `@/`): este módulo sigue
// siendo 100% puro y testeable con `node --test` sin loader de alias.
// ─────────────────────────────────────────────────────────────────────────
import { ACOM_ROOM_LABEL, type AcomRoom } from "../acomodaciones.ts";
import type { ComputoReserva } from "./computo.ts";

/** Forma de la entrada que `crearCotizacionCarrito` acumula en `hotelesSnap`
 * para persistir en `cotizaciones.detalle.hoteles[]` — mismos campos que ya
 * escribía el `.push({...})` inline, sin agregar ni quitar ninguno. */
export type HotelSnapPersona = {
  id: number;
  ref: string;
  nombre: string | null;
  categoria: string;
  ciudad: string | null;
  proveedor: null;
  alimentacion: string;
  acomodacion: string;
  detalle_acomodacion: string;
  fecha_ingreso: string | null;
  fecha_salida: string | null;
  edades_menores: number[];
  menores_clasificados: { infantes: number; nino: number; nino2: number };
  distribucion_menores: ComputoReserva["distribucionMenores"];
  condiciones_tarifa: ComputoReserva["condicionesTarifa"];
  foto_url: string | null;
  nota_regimen: null;
};

/**
 * Construye la entrada de `hotelesSnap` para un hotel PERSONA — a partir de
 * `comp` (la salida REAL de `computarReserva`, nunca inventada), más los
 * pocos datos que `comp.data` no conoce (id de secuencia, `ref` estable del
 * ítem, categoría/régimen/destino tal como los pidió el carrito, y la foto
 * de portada, resuelta aparte por `crearCotizacionCarrito` con
 * `hotel_fotos`). `edadesMenoresConfirmadas` se pide aparte porque el
 * llamador ya valida que `comp.data.edadesMenoresUsadas` no sea `null`
 * (inconsistencia interna que aborta la cotización) ANTES de llamar acá —
 * esta función nunca decide ese caso de error, solo arma el snapshot del
 * caso feliz.
 */
export function construirHotelSnapPersona(args: {
  id: number;
  ref: string;
  comp: ComputoReserva;
  categoria: string;
  regimen: string;
  destinoFallback: string | null;
  hotelNombreFallback: string;
  fotoUrl: string | null;
  edadesMenoresConfirmadas: number[];
}): HotelSnapPersona {
  const { id, ref, comp, categoria, regimen, destinoFallback, hotelNombreFallback, fotoUrl, edadesMenoresConfirmadas } = args;
  const { meta, lineasHab, numNinos, numNinos2, numInfantes, distribucionMenores, condicionesTarifa } = comp;

  const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom as AcomRoom]} (${l.pax} pax)`);
  if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
  if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
  if (numInfantes > 0) partes.push(`${numInfantes} Infante(s)`);

  return {
    id, ref, nombre: meta.hotel_nombre ?? hotelNombreFallback, categoria, ciudad: meta.destino_nombre ?? destinoFallback,
    proveedor: null, alimentacion: regimen, acomodacion: categoria, detalle_acomodacion: partes.join(", "),
    fecha_ingreso: meta.fecha_ida, fecha_salida: meta.fecha_regreso, nota_regimen: null, foto_url: fotoUrl,
    edades_menores: edadesMenoresConfirmadas,
    menores_clasificados: { infantes: numInfantes, nino: numNinos, nino2: numNinos2 },
    distribucion_menores: distribucionMenores,
    condiciones_tarifa: condicionesTarifa,
  };
}
