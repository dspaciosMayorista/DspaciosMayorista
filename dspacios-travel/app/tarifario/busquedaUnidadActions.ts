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
//   · NO calcula un precio. Devuelve la IDENTIDAD de la oferta que realmente
//     pasó `computarReservaBernalo` (hotel, paquete, categoría, alimentación,
//     fechas y la ocupación con la que se confirmó) más el veredicto
//     `disponible`/`sin_disponibilidad` — nunca pvp, snapshot, costos netos,
//     proveedor ni ningún dato interno. El precio real sigue saliendo, bajo
//     demanda y con su propia frontera saneada, de
//     `cotizarAlojamientoBernaloPublico`.
//   · NO inventa un "desde": la evaluación SÍ recorre las combinaciones
//     categoría×alimentación de TODOS los hoteles del destino hasta el
//     PRIMER éxito por hotel (para poder afirmar con fundamento — nunca hace
//     falta agotar las demás combinaciones una vez que una ya confirmó al
//     hotel), pero el resultado que sale de acá es un VEREDICTO de
//     disponibilidad con la identidad exacta que lo produjo, nunca un
//     número. Publicar un mínimo exigiría exponer la liquidación completa
//     detrás de la vitrina; el precio real sigue saliendo, bajo demanda y
//     con su propia frontera saneada, de `cotizarAlojamientoBernaloPublico`.
//   · NO hace N+1 desde el navegador: es UNA acción por búsqueda (el
//     buscador la llama UNA vez, junto con `buscarHoteles`), nunca una por
//     tarjeta. El fan-out interno cubre TODOS los hoteles del destino (nadie
//     queda sin evaluar) y solo acota la concurrencia — ver
//     `CONCURRENCIA_HOTELES_UNIDAD`. Dentro de cada hotel, la evaluación SÍ
//     se corta en el primer éxito (ver `evaluarHotel`).
//   · NO vuelve a traer hoteles de otros destinos: el descubrimiento se
//     acota por destino ANTES de leer por `paquete_id`
//     (`cargarHotelesBernaloDescubiertos({ destino })`).
//   · NO cambia el cálculo financiero: reutiliza tal cual
//     `computarReservaBernalo`, la única fuente de verdad del cálculo.
//
// Es una Server Action PÚBLICA: el body se trata como `unknown` y se
// revalida en forma con los MISMOS validadores que usa el resto del flujo
// público (`lib/reservar/edadesMenores.ts`), antes de tocar la base de
// datos o el motor.
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
import { defaultAcomConfig, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";
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
import { validarHabitacionesOcupacion, type HabitacionOcupacionValidada } from "@/lib/reservar/ocupacionPorHabitacion";
import { repartirMenoresEnHabitaciones } from "@/lib/reservar/repartoMenoresBusqueda";
import { computarReservaBernalo } from "@/lib/reservar/computoReservaBernalo";
import { cargarHotelesBernaloDescubiertos, type HotelBernaloDescubierto } from "@/lib/tarifario/datosBernalo";

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

// ÚNICAS razones por las que se AFIRMA "sin_disponibilidad": el motor dijo
// que esa oferta no cubre las fechas pedidas o que no pudo componer una
// cotización para esa ocupación. Cualquier otro código
// (`configuracion_incompleta`, `moneda_no_determinable`, `error_interno`,
// drift de datos como `hotel_no_vinculado`/`paquete_no_disponible`) NO
// autoriza la afirmación: significa "no pudimos determinarlo", y lo honesto
// es no decir nada (la tarjeta queda como estaba, sin badge).
const MOTIVOS_SIN_DISPONIBILIDAD = new Set<string>(["fechas_fuera_de_ventana", "no_cotizable"]);

export type EstadoDisponibilidadUnidad = "disponible" | "sin_disponibilidad";

/**
 * Identidad pública MÍNIMA de la combinación que REALMENTE pasó
 * `computarReservaBernalo` — nunca el catálogo completo del hotel
 * (`HotelBernaloDescubierto` trae categorías/regímenes/salidas de TODAS sus
 * ofertas; acá solo viajan los campos escalares de la UNA combinación que se
 * confirmó). Deliberadamente NO reutiliza `HotelBernaloDescubierto` como
 * shape de salida por esto mismo.
 *
 * `ocupacion` es la asociación habitación↔edades con la que se confirmó
 * (misma forma que exige el Caso C del adaptador, `HabitacionOcupacionValidada`)
 * — permite precargar el modal de cotización sin ambigüedad (mismos ids
 * posicionales que ya usa `construirHabitacionesUI`), pero es solo un
 * PREFILL: el modal vuelve a validar/cotizar todo contra el servidor antes
 * de poder agregar al carrito (regla de la tarea — el prefill nunca
 * reemplaza esa validación).
 *
 * Nunca lleva pvp/costo/neto/snapshot/proveedor/comisión.
 */
export type OfertaUnidadConfirmada = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  destinoNombre: string | null;
  categoria: string;
  alimentacion: string;
  moneda: "COP" | "USD" | null;
  fechaIda: string;
  fechaRegreso: string;
  ocupacion: { id: string; acom: AcomRoom; adultos: number; edadesMenores: number[] }[];
};

/**
 * Veredicto por hotel. La rama `"disponible"` lleva ÚNICAMENTE la oferta
 * confirmada (`oferta`, singular) — nunca todas las ofertas del hotel como si
 * todas estuvieran verificadas: la evaluación se corta en el primer combo
 * (paqueteId × categoría × alimentación) que produce `computarReservaBernalo`
 * con éxito, así que solo ESE combo tiene fundamento para presentarse como
 * disponible (ver `evaluarHotel`).
 *
 * Un hotel que NO se pudo concluir no aparece en esta lista: la ausencia de
 * dato no es un dato.
 */
export type DisponibilidadUnidadHotel =
  | { hotelId: number; estado: "disponible"; oferta: OfertaUnidadConfirmada }
  | { hotelId: number; estado: "sin_disponibilidad" };

export type ResultadoBusquedaUnidad =
  | { ok: true; disponibilidad: DisponibilidadUnidadHotel[] }
  | { ok: false; error: string };

export type EntradaBuscarAlojamientosUnidad = {
  fechaIda: string;
  fechaRegreso: string;
  destino: string;
  habitaciones: { acom: string }[];
  adultos: number;
  cantidadMenores: number;
  edadesMenores: number[];
};

type FilaHotelBusqueda = {
  id: number;
  edad_infante_max: number | null;
  edad_nino_max: number | null;
  adults_only: boolean | null;
};

/** Descubrimiento Bernalo del destino, acotado a porción terrestre (sin vuelo). */
function ofertasPorHotelDe(
  hoteles: HotelBernaloDescubierto[]
): Map<number, HotelBernaloDescubierto[]> {
  const mapa = new Map<number, HotelBernaloDescubierto[]>();
  for (const h of hoteles) {
    // Solo paquetes de porción terrestre: la búsqueda que alimenta esta
    // acción es la de esa pestaña, y solo estos pueden resolverse con
    // `salida: sin_vuelo` (un paquete con vuelo exige elegir una salida y
    // el motor lo bloquea — se evita la llamada en vez de gastarla).
    if (h.tipo !== "porcion_terrestre") continue;
    const arr = mapa.get(h.hotelId) ?? [];
    arr.push(h);
    mapa.set(h.hotelId, arr);
  }
  return mapa;
}

/**
 * Combinaciones (oferta, categoría, alimentación) de un hotel, en orden
 * determinista y "index-major" entre ofertas: la k-ésima combinación de cada
 * oferta del hotel se evalúa antes de pasar a la k+1. Todas se recorren
 * (la evaluación es completa), así que este orden ya no decide QUÉ se
 * evalúa: decide solo cuál se prueba primero — un hotel disponible sale por
 * el primer acierto, y así ese acierto no queda sesgado siempre hacia la
 * misma oferta cuando hay varias.
 */
function combinacionesDe(ofertas: HotelBernaloDescubierto[]): { oferta: HotelBernaloDescubierto; categoria: string; alimentacion: string }[] {
  const porOferta = ofertas.map((oferta) => {
    const pares: { categoria: string; alimentacion: string }[] = [];
    for (const categoria of oferta.categorias) {
      for (const alimentacion of oferta.regimenes) pares.push({ categoria, alimentacion });
    }
    return pares;
  });
  const maxPares = porOferta.reduce((m, p) => Math.max(m, p.length), 0);
  const out: { oferta: HotelBernaloDescubierto; categoria: string; alimentacion: string }[] = [];
  for (let k = 0; k < maxPares; k++) {
    for (let o = 0; o < ofertas.length; o++) {
      const par = porOferta[o][k];
      if (par) out.push({ oferta: ofertas[o], categoria: par.categoria, alimentacion: par.alimentacion });
    }
  }
  return out;
}

/**
 * Determina, para los hoteles por unidad del destino buscado, si alguno de
 * sus paquetes de porción terrestre puede atender las fechas y la ocupación
 * declaradas. Best-effort y de solo lectura: NUNCA escribe nada, nunca
 * cotiza hacia el carrito y nunca devuelve un precio.
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
  // DESTINO OBLIGATORIO — y acá, en la frontera, es donde de verdad se exige:
  // el chequeo del cliente es sólo una comodidad, la acción es pública y se
  // puede invocar directo. `validarDestinoConsulta` acepta "" a propósito
  // (otros flujos públicos lo usan como "todos los destinos"), así que este
  // rechazo vive ACÁ y no allá: cambiarlo en el validador compartido cambiaría
  // también esos otros flujos, que no se tocan.
  //
  // Sin esta guarda, un destino vacío haría que el descubrimiento barriera el
  // catálogo entero (todas las ofertas `porcion_terrestre`, todos sus hoteles
  // y todas sus combinaciones) para responder por algo que nadie pidió — un
  // trabajo público sin cota de tamaño. `trim()`: un destino de puros espacios
  // no es una selección, es el placeholder disfrazado.
  if (vDestino.destino.trim() === "") {
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
  // del descubrimiento, antes de las lecturas por `paquete_id`.
  const descubrimiento = await cargarHotelesBernaloDescubiertos({ destino: vDestino.destino });
  if (!descubrimiento.ok) {
    console.error(`[buscarAlojamientosUnidadPorFechas] etapa=descubrimiento detalle=${descubrimiento.error}`);
    return { ok: true, disponibilidad: [] }; // auxiliar: un fallo acá nunca rompe la búsqueda
  }

  const ofertasPorHotel = ofertasPorHotelDe(descubrimiento.hoteles);
  if (!ofertasPorHotel.size) return { ok: true, disponibilidad: [] };

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
    return { ok: true, disponibilidad: [] }; // fail-closed: sin reglas confiables no se afirma nada
  }

  const reglasPorHotel = new Map<number, AcomConfig[]>();
  for (const r of (acomCfg ?? []) as (AcomConfig & { hotel_id: number })[]) {
    const arr = reglasPorHotel.get(r.hotel_id) ?? [];
    arr.push(r);
    reglasPorHotel.set(r.hotel_id, arr);
  }
  const filaPorHotel = new Map<number, FilaHotelBusqueda>();
  for (const h of (hotelRows ?? []) as FilaHotelBusqueda[]) filaPorHotel.set(h.id, h);

  // ── 4) Evaluación COMPLETA, con concurrencia acotada ──────────────────
  // Un veredicto por hotel, o `null` cuando no se pudo concluir (y entonces
  // no se afirma nada). La cobertura no se recorta: cada hotel que entra acá
  // agota TODAS sus ofertas y combinaciones antes de arriesgar un "no".
  async function evaluarHotel(hotelId: number): Promise<DisponibilidadUnidadHotel | null> {
    const ofertas = ofertasPorHotel.get(hotelId) ?? [];
    const fila = filaPorHotel.get(hotelId);
    // Sin fila maestra no se INVENTAN umbrales de edad ni "no es Adults
    // Only" (mismo criterio fail-closed que el motor persona): este hotel no
    // participa de la afirmación.
    if (!fila) return null;

    // Restricción propia del hotel, ajena a fechas/ocupación de habitación:
    // un Adults Only no puede atender una búsqueda con menores declarados.
    if (edades.length > 0 && fila.adults_only) return { hotelId, estado: "sin_disponibilidad" };

    const reglas = reglasPorHotel.get(hotelId) ?? [];
    const configDe = (a: AcomRoom): AcomConfig => reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);

    const reparto = repartirMenoresEnHabitaciones({
      habitaciones: habitacionesValidadas.map((h) => ({ acom: h.acom, config: configDe(h.acom) })),
      adultosDeclarados: adultos,
      edades,
      infanteMax: fila.edad_infante_max ?? 2,
      ninoMax: fila.edad_nino_max ?? 10,
    });
    if (!reparto.ok) {
      // La SELECCIÓN no cabe en este hotel (habitaciones/adultos/menores):
      // es una razón honesta de "no disponible para tu búsqueda". Un rechazo
      // por CONFIGURACIÓN del hotel o por una edad que el hotel clasifica
      // como adulto no autoriza la afirmación — no se dice nada.
      return reparto.tipo === "seleccion_invalida" ? { hotelId, estado: "sin_disponibilidad" } : null;
    }

    // Reenvío por la MISMA frontera de validación que usa la cotización
    // pública (nunca se salta): la asociación habitación↔edades que produce
    // el reparto se revalida como si viniera del navegador.
    const vOcupacion = validarHabitacionesOcupacion(reparto.habitaciones);
    if (!vOcupacion.ok) {
      console.error(`[buscarAlojamientosUnidadPorFechas] etapa=ocupacion hotelId=${hotelId} detalle=reparto interno rechazado por el validador`);
      return null;
    }
    const ocupacion: HabitacionOcupacionValidada[] = vOcupacion.habitaciones;

    // Decisión acotada (auditoría independiente): basta el PRIMER combo que
    // confirme al hotel — no hace falta agotar las demás combinaciones solo
    // para "llenar opciones" en la respuesta pública. En modo búsqueda se
    // presenta exclusivamente esa combinación confirmada; "Explorar" (fuera
    // del modo búsqueda) sigue mostrando todas las demás ofertas del hotel
    // por su cuenta, sin relación con este veredicto.
    const combos = combinacionesDe(ofertas);
    let motivoNoConcluyente = false;

    for (const combo of combos) {
      const resultado = await computarReservaBernalo({
        paqueteId: combo.oferta.paqueteId,
        hotelId,
        categoria: combo.categoria,
        alimentacion: combo.alimentacion,
        salida: { tipo: "sin_vuelo", fechaIda, fechaRegreso },
        habitaciones: ocupacion,
      });
      if (resultado.ok) {
        // Identidad EXACTA de la combinación que funcionó — nunca el
        // catálogo completo del hotel (ver `OfertaUnidadConfirmada`).
        return {
          hotelId,
          estado: "disponible",
          oferta: {
            hotelId,
            hotelNombre: combo.oferta.hotelNombre,
            paqueteId: combo.oferta.paqueteId,
            paqueteNombre: combo.oferta.paqueteNombre,
            destinoNombre: combo.oferta.destinoNombre,
            categoria: combo.categoria,
            alimentacion: combo.alimentacion,
            moneda: combo.oferta.moneda,
            fechaIda,
            fechaRegreso,
            ocupacion,
          },
        };
      }
      // El resultado interno NUNCA se guarda ni se reenvía — solo su código.
      if (!MOTIVOS_SIN_DISPONIBILIDAD.has(resultado.codigo)) motivoNoConcluyente = true;
    }

    // Recién acá —agotadas todas las combinaciones, con al menos una que
    // evaluar, y sin ningún fallo que el motor no pueda concluir— se afirma
    // que el hotel no cubre las fechas/ocupación. Si quedó alguna sin
    // evaluar o alguna falló por un motivo técnico, NO se afirma nada.
    if (combos.length > 0 && !motivoNoConcluyente) return { hotelId, estado: "sin_disponibilidad" };
    return null;
  }

  // Pool de trabajadores sobre el MISMO índice compartido: cada uno toma el
  // siguiente hotel libre y nadie evalúa dos veces el mismo. `siguiente++` es
  // seguro porque entre la lectura y la escritura no hay `await` (JavaScript
  // es de un solo hilo), así que no se pierde ni se repite ningún índice.
  const veredictos: (DisponibilidadUnidadHotel | null)[] = new Array(idsAevaluar.length).fill(null);
  let siguiente = 0;
  const trabajador = async () => {
    while (true) {
      const i = siguiente++;
      if (i >= idsAevaluar.length) return;
      veredictos[i] = await evaluarHotel(idsAevaluar[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA_HOTELES_UNIDAD, idsAevaluar.length) }, () => trabajador())
  );

  // "No evaluado" se cae acá: nunca entra a la lista como si fuera un
  // veredicto.
  return { ok: true, disponibilidad: veredictos.filter((v): v is DisponibilidadUnidadHotel => v !== null) };
}
