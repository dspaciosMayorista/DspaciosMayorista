"use server";

// ─────────────────────────────────────────────────────────────────────────
// Búsqueda general de Porción terrestre — disponibilidad REAL de los hoteles
// con `modelo_tarifario = "unidad"` para las fechas/ocupación que el
// visitante escribió en `BuscadorBooking`.
//
// Problema que resuelve: el buscador general (`buscarHoteles`) solo conoce
// las filas de `tarifario_resultado`, que EXCLUYE a propósito los hoteles
// por unidad. Sin esta acción, un hotel unidad del destino buscado no tenía
// forma de decir si sirve o no para esas fechas: aparecía en la vitrina
// "O explora todos los alojamientos" mezclado con otros destinos, sin
// ninguna relación con la búsqueda.
//
// Qué hace y qué NO hace (reglas del encargo):
//   · SÍ calcula/expone un precio PÚBLICO SANEADO por combinación confirmada
//     (`OpcionUnidadConfirmada.precioVenta`/`moneda`/`paxTotal`) — construido
//     CAMPO A CAMPO desde el `ok:true` de `computarReservaBernalo`, nunca el
//     objeto interno completo (costoNeto, proveedor, comisión, snapshot por
//     habitación NUNCA cruzan esta frontera). Cierre de UX (ronda posterior):
//     antes solo viajaba la identidad de la ÚNICA combinación en la que se
//     cortaba la evaluación, así que la tarjeta no podía mostrar precio/pax
//     sin volver a cotizar — obligaba a abrir un modal y repetir fechas/
//     ocupación que el buscador YA tenía. La revalidación real de precio al
//     momento de comprar sigue siendo, bajo demanda, `cotizarAlojamientoBernaloPublico`
//     (nunca se agrega al carrito confiando en el precio que mostró la
//     tarjeta — ver `VistaBooking.tsx`, `TarjetaUnidadBusqueda`).
//   · Evalúa TODAS las combinaciones categoría×alimentación de cada hotel del
//     destino — ya NO se corta en el primer éxito (eso era una "decisión
//     acotada" válida cuando solo hacía falta un veredicto binario; ahora la
//     tarjeta necesita CADA combinación cotizable para sus selectores, nunca
//     el producto cartesiano completo si alguna no es cotizable). Ver
//     `evaluarDisponibilidadHotelUnidad`, `lib/tarifario/
//     evaluarDisponibilidadUnidad.ts` — clasifica: ningún éxito con todos los
//     códigos "sin disponibilidad" real → `sin_disponibilidad`; algún éxito →
//     `disponible` con las opciones confirmadas (ordenadas, la más barata
//     primero); algún éxito + algún código TÉCNICO → `disponible` igual, pero
//     `parcial` (ver más abajo); ningún éxito + algún código técnico →
//     inconcluyente.
//   · NO hace N+1 desde el navegador: es UNA acción por búsqueda (el
//     buscador la llama UNA vez, junto con `buscarHoteles`), nunca una por
//     tarjeta. El fan-out interno cubre TODOS los hoteles del destino (nadie
//     queda sin evaluar) y solo acota la concurrencia — ver
//     `CONCURRENCIA_HOTELES_UNIDAD`.
//   · NO vuelve a traer hoteles de otros destinos: el descubrimiento se
//     acota por destino ANTES de leer por `paquete_id`
//     (`cargarHotelesBernaloDescubiertos({ destinoId })` — ver más abajo).
//   · NO cambia el cálculo financiero: reutiliza tal cual
//     `computarReservaBernalo`, la única fuente de verdad del cálculo.
//
// Es una Server Action PÚBLICA: el body se trata como `unknown` y se
// revalida en forma con los MISMOS validadores que usa el resto del flujo
// público (`lib/reservar/edadesMenores.ts`), antes de tocar la base de
// datos o el motor.
//
// ⚠️ CAUSA RAÍZ CONFIRMADA POR EJECUCIÓN REAL (hallazgo: "Hotel Prueba
// Odair" —`hotel_id=216`, `modelo_tarifario='unidad'`, con paquete de
// porción terrestre activo, categorías/regímenes configurados y tarifa
// PUBLICADA en `hotel_tarifas_unidad`— no aparecía en el buscador general de
// su destino, pese a poder cotizarse desde su modal y aparecer en la
// exploración). No fue una hipótesis: se confirmó extrayendo la decisión por
// hotel a una función PURA e inyectable —
// `evaluarDisponibilidadHotelUnidad` (`lib/tarifario/
// evaluarDisponibilidadUnidad.ts`)— y EJECUTÁNDOLA de verdad bajo `node
// --test` (`pruebas/evaluarDisponibilidadUnidad.test.ts`, no inspección de
// fuente): el primer intento, con un `computar` de prueba que SIEMPRE
// confirma (`{ ok: true }`), igual devolvía "inconcluyente" en vez de
// "disponible".
//
// La causa: `validarHabitacionesOcupacion` (frontera que revalida la
// ocupación antes de llamar a `computarReservaBernalo`) exige
// `HabitacionOcupacionEntrada`, que incluye `cantidadMenores: number`. Pero
// `repartirMenoresEnHabitaciones` (el reparto que arma esa ocupación para el
// buscador) devuelve `HabitacionRepartida[]` — SOLO `id/acom/adultos/
// edadesMenores`, SIN `cantidadMenores`. El código original pasaba
// `reparto.habitaciones` DIRECTO al validador, así que
// `typeof fila.cantidadMenores !== "number"` era SIEMPRE verdadero →
// `vOcupacion.ok` daba `false` para TODO hotel, en TODA búsqueda, desde que
// existe este código — no un caso puntual de `hotel_id=216`: la búsqueda
// general de "unidad" en Porción terrestre NUNCA pudo confirmar un solo
// hotel disponible. Corregido derivando `cantidadMenores` de
// `edadesMenores.length` (mismo criterio que ya usa
// `construirPayloadHabitaciones` para el flujo del modal) antes de validar
// — ver el comentario junto a esa línea en `evaluarDisponibilidadUnidad.ts`.
//
// Ese defecto por sí solo ya explica el caso reportado. Además, tres puntos
// de esta acción convertían cualquier OTRO error TÉCNICO en "cero
// resultados" silencioso, indistinguible de "sin disponibilidad real" —
// corregidos igual, como defensa en profundidad (un fallo técnico futuro,
// de cualquier causa, tampoco debe desaparecer en silencio):
//   1) `cargarHotelesBernaloDescubiertos` fallando → `{ ok: true,
//      disponibilidad: [] }`. Ahora: `{ ok: false, error }`.
//   2) La consulta por lote de `hotel_acomodaciones`/`hoteles` fallando →
//      igual, `{ ok: true, disponibilidad: [] }`. Ahora: `{ ok: false,
//      error }`.
//   3) `evaluarHotel` probando cada combinación categoría×alimentación
//      contra `computarReservaBernalo` y, cuando el motor rechazaba TODAS
//      con un código que no es "sin disponibilidad real"
//      (`fechas_fuera_de_ventana`/`no_cotizable`) — por ejemplo
//      `moneda_no_determinable`, `salida_no_vinculada`,
//      `configuracion_incompleta`, `error_interno`, o un drift de datos como
//      `hotel_no_vinculado` — devolvía `return null`, y ese hotel
//      simplemente desaparecía del arreglo `disponibilidad`, sin ningún
//      rastro del código real. Ahora `evaluarDisponibilidadHotelUnidad`
//      devuelve un `VeredictoHotelUnidad` de TRES formas: `veredicto`
//      (disponible/sin_disponibilidad, con fundamento) o `inconcluyente`
//      (con el código técnico REAL en `motivo`, para diagnosticar en los
//      logs de Vercel — ver el `console.error` de más abajo). Un hotel
//      inconcluyente NUNCA se afirma disponible ni sin_disponibilidad —
//      simplemente no entra al arreglo, igual que antes en ESE aspecto—,
//      pero ahora su motivo se REGISTRA y el llamador se entera de que la
//      búsqueda quedó INCOMPLETA (`incompleto: true`) en vez de creer que
//      vio el universo completo de hoteles del destino.
// `ResultadoBusquedaUnidad` gana `incompleto: boolean` en la rama `ok:true`:
// `BuscadorBooking` lo usa para mostrar un aviso ("no pudimos confirmar
// todos los alojamientos") sin descartar los resultados persona ni los
// hoteles unidad que SÍ se pudieron confirmar.
//
// ⚠️ Costo/abuso (hallazgo confirmado, auditoría independiente): destino
// obligatorio acota el universo a evaluar, pero NO hay tope de hoteles ni de
// combinaciones dentro de un destino con catálogo grande, y cada combinación
// evaluada cuesta varias consultas dentro de `computarReservaBernalo`. No
// existe en este repositorio ningún mecanismo reutilizable de caché o rate
// limiting para Server Actions públicas (sin Redis/Upstash, sin
// `unstable_cache` en uso real — se auditó antes de esta ronda). Agregar un
// `Map` en memoria de proceso NO protegería nada en Vercel (cada invocación
// puede caer en una instancia serverless distinta, o una fría sin el mapa
// poblado) — sería una falsa sensación de protección, así que se decidió NO
// inventarlo. Se conserva `CONCURRENCIA_HOTELES_UNIDAD = 4` (acota paralelismo,
// no el trabajo total) y el destino obligatorio (acota el universo, no el
// costo por destino grande). Este riesgo de costo por repetición de búsquedas
// IDÉNTICAS sigue SIN mitigar — requiere infraestructura de caché/rate
// limiting real (p. ej. Upstash Redis) antes de exponer este endpoint a
// tráfico público de alto volumen. No se presenta como resuelto.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { AcomConfig } from "@/lib/acomodaciones";
import {
  validarAdultosDeclarados,
  validarCantidadMenores,
  validarDestinoConsulta,
  validarEdadesMenores,
  validarHabitacionesConsultadas,
  validarPaxTotalConsulta,
  validarRangoFechasConsulta,
  type HabitacionInputValidada,
} from "@/lib/reservar/edadesMenores";
import { computarReservaBernalo } from "@/lib/reservar/computoReservaBernalo";
import { cargarHotelesBernaloDescubiertos } from "@/lib/tarifario/datosBernalo";
import {
  evaluarDisponibilidadHotelUnidad,
  ofertasPorHotelDe,
  type DisponibilidadUnidadHotel,
  type FilaHotelBusquedaUnidad,
  type OpcionUnidadConfirmada,
  type VeredictoHotelUnidad,
} from "@/lib/tarifario/evaluarDisponibilidadUnidad";

// Reexportados: `VistaBooking.tsx`/`BuscadorBooking.tsx` los importan desde
// ESTE archivo (es la frontera pública) — viven físicamente en el módulo
// puro para que `evaluarDisponibilidadHotelUnidad` los pueda construir sin
// depender de un archivo `"use server"`.
export type { DisponibilidadUnidadHotel, OpcionUnidadConfirmada };

// ── Concurrencia del fan-out interno ─────────────────────────────────────
// La evaluación es COMPLETA: TODOS los hoteles por unidad del destino
// buscado, y TODAS las combinaciones (oferta × categoría × alimentación) de
// cada uno antes de poder afirmar que no cubre las fechas/ocupación. No hay
// tope de hoteles ni de intentos por hotel — recortar la lista dejaba
// hoteles del destino fuera de la búsqueda sin decirlo, y cortar las
// combinaciones convertía "no evaluado" en "sin disponibilidad" (ver el
// informe de la tarea).
//
// Lo ÚNICO acotado es cuántas evaluaciones corren a la vez: bajar este
// número solo hace la búsqueda más lenta, nunca cambia su resultado (el
// veredicto de un hotel no depende de cuándo se lo evalúe ni de quién lo
// haga en paralelo).
// ⚠️ NO se exporta: un archivo `"use server"` solo puede exportar funciones
// async y tipos — una constante exportada rompe el build de Next. Las
// pruebas de wiring la verifican por texto fuente (convención del proyecto
// para este tipo de archivos).
const CONCURRENCIA_HOTELES_UNIDAD = 4;

export type EstadoDisponibilidadUnidad = "disponible" | "sin_disponibilidad";

/**
 * Resultado de la búsqueda. `ok: false` es un fallo TÉCNICO real (nunca "no
 * hay resultados" disfrazado — ver el fallo estructural corregido en la
 * cabecera del archivo). Con `ok: true`, `incompleto: true` avisa que al
 * menos un hotel del destino no se pudo evaluar con fundamento (fallo
 * técnico puntual, código no clasificado, o drift de datos) — la lista
 * `disponibilidad` sigue siendo válida para lo que SÍ se concluyó, pero no es
 * necesariamente el universo completo de hoteles unidad del destino.
 */
export type ResultadoBusquedaUnidad =
  | { ok: true; disponibilidad: DisponibilidadUnidadHotel[]; incompleto: boolean }
  | { ok: false; error: string };

export type EntradaBuscarAlojamientosUnidad = {
  fechaIda: string;
  fechaRegreso: string;
  destino: string;
  /** Identidad ESTABLE del destino (`destinos.id`) — cuando llega, se usa
   * DIRECTO y `destino` (nombre) queda solo para mensajes/compatibilidad; ver
   * `lib/tarifario/destinosPorcion.ts` y `OpcionesDescubrimientoBernalo`. */
  destinoId?: number | null;
  habitaciones: { acom: string }[];
  adultos: number;
  cantidadMenores: number;
  edadesMenores: number[];
};

/** `destinoId` es un número entero positivo, o no participa — nunca se
 * confía en un valor no numérico/negativo/decimal mandado por el navegador
 * (Server Action pública). */
function validarDestinoIdConsulta(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
  return v;
}

/**
 * Determina, para los hoteles por unidad del destino buscado, si alguno de
 * sus paquetes de porción terrestre puede atender las fechas y la ocupación
 * declaradas. Best-effort SOLO en lo que es legítimamente best-effort (ver la
 * cabecera): NUNCA escribe nada, nunca cotiza hacia el carrito y nunca
 * devuelve un precio.
 */
export async function buscarAlojamientosUnidadPorFechas(
  input: unknown
): Promise<ResultadoBusquedaUnidad> {
  // ── 1) Forma — el navegador no es autoridad (Server Action pública) ────
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "La búsqueda debe venir como un objeto." };
  }
  const datos = input as Record<string, unknown>;

  const vRango = validarRangoFechasConsulta(datos.fechaIda, datos.fechaRegreso);
  if (!vRango.ok) return { ok: false, error: vRango.error };
  const vDestino = validarDestinoConsulta(datos.destino);
  if (!vDestino.ok) return { ok: false, error: vDestino.error };
  const destinoId = validarDestinoIdConsulta(datos.destinoId);
  // DESTINO OBLIGATORIO — y acá, en la frontera, es donde de verdad se exige:
  // el chequeo del cliente es sólo una comodidad, la acción es pública y se
  // puede invocar directo. `validarDestinoConsulta` acepta "" a propósito
  // (otros flujos públicos lo usan como "todos los destinos"), así que este
  // rechazo vive ACÁ y no allá: cambiarlo en el validador compartido cambiaría
  // también esos otros flujos, que no se tocan. Un `destinoId` válido también
  // cuenta como destino elegido (el nombre puede llegar vacío si el llamador
  // solo tiene el id — no debería pasar desde `BuscadorBooking`, que siempre
  // manda los dos, pero no se exige el nombre si el id ya identifica el
  // destino sin ambigüedad).
  //
  // Sin esta guarda, un destino vacío haría que el descubrimiento barriera el
  // catálogo entero (todas las ofertas `porcion_terrestre`, todos sus hoteles
  // y todas sus combinaciones) para responder por algo que nadie pidió — un
  // trabajo público sin cota de tamaño. `trim()`: un destino de puros espacios
  // no es una selección, es el placeholder disfrazado.
  if (vDestino.destino.trim() === "" && destinoId == null) {
    return { ok: false, error: "Selecciona un destino para buscar." };
  }
  const vHabitaciones = validarHabitacionesConsultadas(datos.habitaciones);
  if (!vHabitaciones.ok) return { ok: false, error: vHabitaciones.error };
  // Se copia a una `const` propia: `evaluarHotel` es un cierre y ahí adentro
  // TypeScript no conserva el estrechamiento del guard de arriba.
  const habitacionesValidadas: HabitacionInputValidada[] = vHabitaciones.habitaciones;
  const vAdultos = validarAdultosDeclarados(datos.adultos);
  if (!vAdultos.ok) return { ok: false, error: vAdultos.error };
  const vCantidad = validarCantidadMenores(datos.cantidadMenores);
  if (!vCantidad.ok) return { ok: false, error: vCantidad.error };
  const vEdades = validarEdadesMenores(datos.edadesMenores, vCantidad.cantidad);
  if (!vEdades.ok) return { ok: false, error: vEdades.error };
  const vPax = validarPaxTotalConsulta(vAdultos.adultos, vCantidad.cantidad);
  if (!vPax.ok) return { ok: false, error: vPax.error };

  const { fechaIda, fechaRegreso } = vRango;
  const adultos = vAdultos.adultos;
  const edades = vEdades.edades;

  // ── 2) Descubrimiento ACOTADO POR DESTINO ─────────────────────────────
  // Ni se leen ni se evalúan hoteles de otros destinos: el filtro va dentro
  // del descubrimiento, antes de las lecturas por `paquete_id`. `destinoId`
  // (cuando llega) evita la consulta `destinos.nombre → id` por completo —
  // ver `OpcionesDescubrimientoBernalo` en `lib/tarifario/datosBernalo.ts`.
  const descubrimiento = await cargarHotelesBernaloDescubiertos({ destino: vDestino.destino, destinoId });
  if (!descubrimiento.ok) {
    console.error(`[buscarAlojamientosUnidadPorFechas] etapa=descubrimiento detalle=${descubrimiento.error}`);
    // Fallo TÉCNICO real — nunca se disfraza de "sin resultados" (ver la
    // cabecera del archivo, fallo estructural corregido).
    return { ok: false, error: "No se pudo consultar la disponibilidad de alojamientos por unidad." };
  }

  const ofertasPorHotel = ofertasPorHotelDe(descubrimiento.hoteles);
  if (!ofertasPorHotel.size) return { ok: true, disponibilidad: [], incompleto: false };

  // Orden determinista (ascendente). SIN tope: recortar la lista dejaría
  // hoteles por unidad del destino buscado fuera de la búsqueda sin decirlo.
  const idsAevaluar = [...ofertasPorHotel.keys()].sort((a, b) => a - b);

  // ── 3) Reglas de ocupación de cada hotel, en UNA lectura por lote ──────
  // Mismo patrón y mismas columnas que el motor persona
  // (`lib/reservar/cotizar.ts`) — nunca una consulta por hotel.
  const admin = createAdminClient();
  const [{ data: acomCfg, error: eAcom }, { data: hotelRows, error: eHoteles }] = await Promise.all([
    admin
      .from("hotel_acomodaciones")
      .select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
      .in("hotel_id", idsAevaluar),
    admin.from("hoteles").select("id, edad_infante_max, edad_nino_max, adults_only").in("id", idsAevaluar),
  ]);
  if (eAcom || eHoteles) {
    console.error(`[buscarAlojamientosUnidadPorFechas] etapa=hotel_acomodaciones_o_hoteles detalle=${eAcom?.message ?? eHoteles?.message}`);
    // Fallo TÉCNICO real — sin reglas confiables no se afirma nada, pero
    // tampoco se disfraza de "cero hoteles disponibles" (fallo estructural
    // corregido, ver la cabecera).
    return { ok: false, error: "No se pudieron consultar las reglas de ocupación de los hoteles." };
  }

  const reglasPorHotel = new Map<number, AcomConfig[]>();
  for (const r of (acomCfg ?? []) as (AcomConfig & { hotel_id: number })[]) {
    const arr = reglasPorHotel.get(r.hotel_id) ?? [];
    arr.push(r);
    reglasPorHotel.set(r.hotel_id, arr);
  }
  const filaPorHotel = new Map<number, FilaHotelBusquedaUnidad>();
  for (const h of (hotelRows ?? []) as FilaHotelBusquedaUnidad[]) filaPorHotel.set(h.id, h);

  // ── 4) Evaluación COMPLETA, con concurrencia acotada ──────────────────
  // Cada hotel produce un `VeredictoHotelUnidad` (veredicto con fundamento, o
  // inconcluyente con el motivo real — ver `lib/tarifario/
  // evaluarDisponibilidadUnidad.ts`). La cobertura no se recorta: cada hotel
  // que entra acá agota TODAS sus ofertas y combinaciones antes de arriesgar
  // un "no".
  const veredictos = new Array<VeredictoHotelUnidad | null>(idsAevaluar.length).fill(null);
  let siguiente = 0;
  const trabajador = async () => {
    while (true) {
      const i = siguiente++;
      if (i >= idsAevaluar.length) return;
      const hotelId = idsAevaluar[i];
      veredictos[i] = await evaluarDisponibilidadHotelUnidad({
        hotelId,
        ofertas: ofertasPorHotel.get(hotelId) ?? [],
        fila: filaPorHotel.get(hotelId),
        reglas: reglasPorHotel.get(hotelId) ?? [],
        habitacionesConsultadas: habitacionesValidadas.map((h) => ({ acom: h.acom })),
        adultosDeclarados: adultos,
        edadesMenores: edades,
        fechaIda,
        fechaRegreso,
        computar: computarReservaBernalo,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA_HOTELES_UNIDAD, idsAevaluar.length) }, () => trabajador())
  );

  // Separa veredictos con fundamento de inconcluyentes — un hotel
  // inconcluyente NUNCA entra a `disponibilidad` (ni disponible ni
  // sin_disponibilidad sin fundamento), pero SÍ marca la búsqueda como
  // incompleta y deja su motivo real en los logs — nunca en silencio. Un
  // hotel `disponible` con `parcial: true` SÍ entra a `disponibilidad` (sus
  // opciones confirmadas son válidas), pero TAMBIÉN marca `incompleto`: no
  // todas sus combinaciones se pudieron evaluar con confianza.
  const disponibilidad: DisponibilidadUnidadHotel[] = [];
  let incompleto = false;
  for (const v of veredictos) {
    if (!v) continue; // no debería pasar (todo índice se llena), defensivo
    if (v.tipo === "veredicto") {
      disponibilidad.push(v.valor);
      if (v.parcial) {
        incompleto = true;
        console.error(`[buscarAlojamientosUnidadPorFechas] etapa=evaluacion hotelId=${v.valor.hotelId} motivo=parcial_algunas_combinaciones_no_concluyeron`);
      }
      continue;
    }
    incompleto = true;
    console.error(`[buscarAlojamientosUnidadPorFechas] etapa=evaluacion hotelId=${v.hotelId} motivo=${v.motivo}`);
  }

  return { ok: true, disponibilidad, incompleto };
}
