"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import { formatMoneda } from "@/lib/utils";
import {
  Categoria, EtiquetasHotel, DescripcionHotelExpandible, UbicacionHotel, SeccionesIncluye, AddonsPaquete, ReceptivoModal,
  type Receptivo, type ReceptivoModalInfo,
} from "./tarjetaHotelCompartida";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, defaultAcomConfig, textoEdadesHotel, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import { useCart, type HotelCartItemPersona } from "@/lib/cart/CartContext";
import { cotizarPorFechas } from "@/app/(dashboard)/dashboard/reservar/actions";
import { type BusquedaResultado, type ComboCotizado, type SugerenciaFecha } from "@/lib/reservar/cotizar";
import { CondicionHotelBadges, CondicionCompacta, type CondicionHotelBadgeData } from "@/components/cotizacion/CondicionHotelBadges";
import {
  EDAD_MENOR_MAX,
  MAX_MENORES_POR_CONSULTA,
  ajustarCantidadEdades,
  parseEdadMenor,
  clasificarMenoresPorEdad,
  verificarTarifasMenoresDisponibles,
} from "@/lib/reservar/edadesMenores";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "@/lib/reservar/distribucionHabitaciones";
import {
  construirHabitacionesUI,
  idsHabitacionesPorConteo,
  sincronizarHabitaciones,
  ajustarCantidadEdadesHabitacion,
  establecerEdad,
  construirPayloadHabitaciones,
  validarHabitacionesOcupacion,
  type EdadesPorHabitacion,
  type HabitacionOcupacionEntrada,
} from "@/lib/reservar/ocupacionPorHabitacion";
import {
  cotizarAlojamientoBernaloPublico,
  type ResultadoCotizarAlojamientoBernaloPublico,
  type SalidaSeleccionadaBernaloEntrada,
} from "./cotizacionBernaloActions";
import type { HotelBernaloDescubierto, SalidaAereaBernalo } from "@/lib/tarifario/datosBernalo";
import { obtenerDetalleHotel } from "./detalle-actions";
import { conCacheDetalle, claveDetalleHotel, type EstadoDetalle } from "@/lib/tarifario/detalleCliente";
import { RegimenInfo, type PlanesInfo } from "./RegimenInfo";
import { BuscadorBooking, Resultado, type EstadoBusquedaPorcion } from "./BuscadorBooking";
import type { OpcionUnidadConfirmada } from "./busquedaUnidadActions";
import { claveBusquedaUnidad, claveReservaUnidad, revalidarReservaUnidad } from "@/lib/tarifario/identidadReservaUnidad";
import { BuscadorReceptivos } from "./BuscadorReceptivos";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import type { FilaTarifario, CapHotel } from "./TarifarioPublic";
import type { FilaResumen } from "@/lib/tarifario/resumen";
import { minRoomPvpResumen, tieneAcomodacionResumen } from "@/lib/tarifario/resumenCliente";
import type { DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";
import { destinosPorcionPublica } from "@/lib/tarifario/destinosPorcion";
import { EtiquetaOferta } from "./EtiquetaOferta";
import {
  seleccionarRecomendadosGlobalInicial, seleccionarRecomendadosPorDestino, claveOferta,
  agruparOpcionesUnidadPorOferta, ofertasConPrioridad,
  type OfertaPrioridad, type GrupoOfertaUnidad,
} from "@/lib/tarifario/recomendados";

const CAP_VACIA = { paxMin: null as number | null, paxMax: null as number | null, acom: [] as AcomConfig[] };

const MSG_ERROR_DETALLE_HOTEL = "No fue posible cargar el detalle en este momento. Intenta nuevamente en unos segundos.";

// ── Modelo de la vista dinámica: tarjetas por hotel, detalle con opciones ────
// `filas` de cada tarjeta son de RESUMEN (Tier 1, `FilaResumen[]`) — traen el
// precio por acomodación ya agregado (sencilla/doble/triple/multiple/nino/
// nino2), suficiente para "desde" y para el filtro de acomodación de la
// grilla. La matriz completa (con niño/niño2/infante fila por fila,
// descripción, recargo) solo llega al abrir el modal ("Ver opciones"), vía
// `obtenerDetalleHotel()` (Tier 2) — ver `abrirHotel`/`HotelModal` abajo.
type HotelCard = {
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  foto: string | null;
  desde: number | null;
  estrellas: number | null;
  clasificacion: string | null;
  descripcion: string | null;
  ubicacion: string | null;
  video_url: string | null;
  ninoMin: number | null; ninoMax: number | null; infMin: number | null; infMax: number | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  // Badge compacto "Con condiciones" (lib/tarifario/resumen.ts) — solo para
  // esta tarjeta de exploración; el detalle completo vive en modal/resultado/
  // carrito (ver CondicionCompacta).
  tieneCondicion: boolean;
  filas: FilaResumen[];
  moneda?: string | null;
  // Identidad de OFERTA (hotel+paquete) — siempre presentes: `filas` queda
  // acotada a ESE paquete (nunca un merge entre paquetes), así que
  // "Incluye/No incluye"/add-ons/condiciones de esta card son siempre del
  // paquete correcto, y el nombre del paquete se puede etiquetar en la
  // tarjeta aunque la oferta NO sea recomendada. El estado de recomendación
  // (`recomendada`, una MARCA BOOLEANA) vive en la `Tarjeta`, no acá: es una
  // propiedad de la SELECCIÓN, no de la card. Nunca un consecutivo: la
  // prioridad es un namespace por paquete y su valor autoritativo es el de
  // `armado_hoteles` para el par (paqueteId, hotelId).
  paqueteId?: number;
  paqueteNombre?: string | null;
};

// Corrección posterior (auditoría): antes se agrupaba SIEMPRE por `hotelId`
// (P1-2 original) — un mismo hotel unidad en dos paquetes distintos
// terminaba en UNA sola tarjeta con `ofertas` mezclando ambos paquetes, lo
// que impedía que "hoteles recomendados" (por paquete, migración 183)
// tratara cada oferta como independiente. Ahora `HotelUnidadCard` es, igual
// que `HotelCard`, UNA tarjeta por (hotelId, paqueteId) — `ofertas` sigue
// siendo un arreglo (compatibilidad con `HotelBernaloCotizarModal`, que ya
// soporta `ofertas.length === 1`) pero en la práctica trae SIEMPRE una sola
// entrada: la de ESE paquete. `paqueteId`/`paqueteNombre` espejan
// `HotelCard` — mismo criterio de identidad, misma etiqueta de oferta.
type HotelUnidadCard = {
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  ofertas: HotelBernaloDescubierto[];
  paqueteId?: number;
  paqueteNombre?: string | null;
  // Cierre de UX de la tarjeta unidad en modo búsqueda: SOLO presente ahí —
  // TODAS las combinaciones que el servidor CONFIRMÓ disponibles
  // (`buscarAlojamientosUnidadPorFechas`), ordenadas (la más barata primero,
  // la preseleccionada por defecto). Cuando está presente, la tarjeta se
  // pinta INLINE (`TarjetaUnidadBusqueda`: selectores + precio + "Agregar al
  // carrito", sin abrir modal ni volver a pedir fechas/ocupación). En
  // exploración queda `undefined` y la tarjeta sigue abriendo el modal de
  // siempre (ahí todavía no hay fechas/ocupación que reutilizar). Los
  // `precioVenta` que trae NUNCA son autoridad para el carrito — "Agregar al
  // carrito" revalida con `cotizarAlojamientoBernaloPublico` antes de
  // agregar (ver `TarjetaUnidadBusqueda`).
  opcionesBusqueda?: OpcionUnidadConfirmada[];
};

// Una sola lista visible en la grilla — para el cliente, un hotel por unidad
// (Bernalo) no es otro tipo de producto, solo cambia su forma interna de
// cálculo. `key` es la identidad estable de React (evita colisiones entre
// las dos fuentes); el resto de la lógica (abrir el modal correcto) discrimina
// por `tipo`.
//
// La tercera rama ("busqueda") es la MISMA lista en modo búsqueda: una fila
// persona ya liquidada por el motor (`buscarHoteles`) en vez de una tarjeta de
// exploración. Antes esa fila la pintaba `BuscadorBooking` en SU propia grilla
// y esta vista volvía a pintar la suya DEBAJO — dos listas para una sola
// búsqueda. Ahora hay una sola colección y un solo lugar donde se pinta.
type Tarjeta =
  | { tipo: "persona"; key: string; card: HotelCard; recomendada?: boolean }
  | { tipo: "unidad"; key: string; hotel: HotelUnidadCard; recomendada?: boolean }
  | { tipo: "busqueda"; key: string; r: BusquedaResultado; recomendada?: boolean };

// Marca de recomendación que reciben los builders de tarjeta. Va en un OBJETO a
// propósito: un `.map(tarjetaPersona)` accidental le pasaría el ÍNDICE como
// segundo argumento, y con un objeto la marca queda `undefined` (falsa) en vez
// de convertirse en "recomendado" por el número. La prioridad autoritativa es
// la de `armado_hoteles` para el par (paqueteId, hotelId) — acá solo viaja el
// booleano de si ESA oferta quedó seleccionada.
type MarcaOferta = { recomendada?: boolean };

// Nombre visible de una tarjeta, sin importar de cuál de las tres fuentes
// venga — lo necesita el orden alfabético de la colección única.
function nombreTarjeta(t: Tarjeta): string {
  if (t.tipo === "persona") return t.card.hotelNombre;
  if (t.tipo === "unidad") return t.hotel.hotelNombre;
  return t.r.hotelNombre ?? "—";
}

// P2 (hallazgo confirmado): tarjeta ÚNICA compartida por hoteles persona y
// unidad — antes cada rama de `tarjetas.map(...)` tenía su propia copia
// visual (JSX duplicado), con el riesgo real de que las dos divergieran con
// el tiempo (ya había divergido: la tarjeta unidad ignoraba foto/estrellas/
// descripción/etiquetas reales y mostraba "Sin foto" siempre). Un solo
// componente, con los datos ya resueltos por el llamador — nunca lógica de
// "cuál modelo es" adentro de la tarjeta misma.
function TarjetaHotelCard({
  onClick, foto, hotelNombre, destino, estrellas = null, clasificacion = null,
  adultsOnly = false, petFriendly = false, tieneCondicion, descripcion, desde = null, moneda,
  badgeEsquina,
}: {
  onClick: () => void;
  foto: string | null;
  hotelNombre: string;
  destino: string | null;
  estrellas?: number | null;
  clasificacion?: string | null;
  adultsOnly?: boolean;
  petFriendly?: boolean;
  tieneCondicion?: boolean;
  descripcion?: string | null;
  desde?: number | null;
  moneda?: string | null;
  badgeEsquina?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
    >
      <div className="relative aspect-[16/10] w-full bg-gray-100">
        {foto ? (
          <Image src={foto} alt={hotelNombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
        )}
        {badgeEsquina}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-800">{hotelNombre}</span>
          <Categoria estrellas={estrellas} clasificacion={clasificacion} className="text-sm" />
          <EtiquetasHotel adultsOnly={adultsOnly} petFriendly={petFriendly} />
          {tieneCondicion !== undefined && <CondicionCompacta activo={tieneCondicion} />}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">{destino ?? ""}</div>
        {descripcion?.trim() && (
          <p className="mt-1 line-clamp-2 text-xs text-gray-400">{descripcion}</p>
        )}
        <div className="mt-3 flex items-end justify-between">
          {desde != null ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
              <div className="text-xl font-extrabold tracking-tight" style={{ color: "var(--brand-primary)" }}>{formatMoneda(desde, moneda)}</div>
              <div className="text-[10px] text-gray-400">por persona</div>
            </div>
          ) : <span className="text-sm text-gray-400">Consultar</span>}
          <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
            Ver opciones →
          </span>
        </div>
      </div>
    </button>
  );
}

type Opcion = {
  key: string;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  bloqueoId: number | null;
  label: string;
  destino: string | null;
  origen: string | null;
  cupos: number | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  filas: FilaTarifario[];
};

function fmtFecha(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function calcNoches(ida: string, regreso: string): number {
  const a = new Date(`${ida}T00:00:00`).getTime();
  const b = new Date(`${regreso}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// `minRoomPvp`: alias local de `minRoomPvpResumen` (lib/tarifario/
// resumenCliente.ts) — factorizada ahí (junto con `tieneAcomodacionResumen`)
// para poder testearla con ejecución real, sin depender de importar este
// componente cliente (React/Next) bajo `node --test`.
const minRoomPvp = minRoomPvpResumen;

export function VistaBooking({
  filas,
  fotosPorHotel = {},
  fotosPorServicio = {},
  cuposPorBloqueo = {},
  origenPorBloqueo = {},
  puedeReservar = false,
  ventanaPorPaquete = {},
  infoPorHotel = {},
  planesInfo = {},
  capPorHotel = {},
  soloAcom = null,
  descripcionPorPaquete = {},
  filasAddon = [],
  hotelesBernalo = [],
  hotelIdsUnidadAutoritativos = [],
  prioridadesRecomendados = {},
}: {
  filas: FilaResumen[];
  fotosPorHotel?: Record<number, string>;
  fotosPorServicio?: Record<number, string>;
  cuposPorBloqueo?: Record<number, number>;
  origenPorBloqueo?: Record<number, string>;
  puedeReservar?: boolean;
  ventanaPorPaquete?: Record<number, { min: string | null; max: string | null }>;
  infoPorHotel?: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null; video_url?: string | null; ninoMin?: number | null; ninoMax?: number | null; infMin?: number | null; infMax?: number | null; adultsOnly?: boolean; petFriendly?: boolean; tieneCondicion?: boolean }>;
  planesInfo?: PlanesInfo;
  capPorHotel?: CapHotel;
  soloAcom?: string | null;
  // Descripción manual del paquete (migración 169): incluye/no incluye/
  // tarifas especiales/condiciones comerciales — texto libre configurado UNA
  // sola vez en el paquete y compartido por todos sus hoteles/opciones.
  descripcionPorPaquete?: Record<number, DescripcionPaqueteRaw>;
  // Add-ons (modulo="servicios") de TODOS los paquetes de hotel, sin el
  // recorte que aplica `filas` para la vitrina plana de Servicios — de acá
  // sale `addonsPorPaquete`, scoped al hotel que se está viendo.
  filasAddon?: FilaResumen[];
  // Fase 3E Bernalo — descubrimiento PARALELO (regla 6 del encargo): hoteles
  // `modelo_tarifario = 'unidad'` de paquetes activos, sin precio (nunca
  // pasan por `tarifario_resultado`/`filas` de arriba). Se muestran en su
  // propia sección, con "Consultar tarifa" en vez de un precio.
  hotelesBernalo?: HotelBernaloDescubierto[];
  // Hallazgo confirmado (validación final): identidad AUTORITATIVA de "este
  // hotel es modelo unidad ahora mismo" (`lib/tarifario/datosBernalo.ts`) —
  // canal SEPARADO de `hotelesBernalo`, que en TarifarioPublic se filtra por
  // acomodación/categoría/régimen/texto antes de llegar aquí. Se usa
  // EXCLUSIVAMENTE para excluir tarjetas persona obsoletas (ver `tarjetas`
  // más abajo) — nunca para decidir qué tarjeta unidad mostrar (eso lo
  // sigue haciendo `hotelesUnidadVisibles`, derivado de `hotelesBernalo`).
  hotelIdsUnidadAutoritativos?: number[];
  // Hoteles recomendados (migración 183) — `claveOferta(hotelId,paqueteId) ->
  // prioridad`. Cubre las DOS fuentes de oferta: hoteles persona (carga de
  // `lib/tarifario/resumen.ts`) y hoteles unidad/Bernalo (carga de
  // `cargarPrioridadesRecomendadosBernalo`, fusionada en `page.tsx` — mismo
  // espacio de claves, así que combinan sin colisión). Decide la sección de
  // recomendados del estado global inicial y de la búsqueda por destino.
  prioridadesRecomendados?: Record<string, number>;
}) {
  // Submódulos de la vista Booking.
  const [sub, setSub] = useState<"bloqueo" | "porcion_terrestre" | "receptivos">("bloqueo");
  // Fase 3E Bernalo: hotel (con TODAS sus ofertas — P1-2) cuyo modal de
  // cotización está abierto.
  const [modalBernalo, setModalBernalo] = useState<HotelUnidadCard | null>(null);
  // Buscador de bloqueos: origen → destino → salida (vuelo).
  const [origenSel, setOrigenSel] = useState("");
  const [destinoSel, setDestinoSel] = useState("");
  const [salidaSel, setSalidaSel] = useState<number | "">("");
  // El filtro de destino de la grilla de Porción terrestre se ELIMINÓ: era un
  // `<select>` de exploración que solo podía OCULTAR tarjetas, y con hoteles
  // recomendados por paquete eso contradecía la regla del estado global
  // inicial (top 2 de CADA paquete antes de buscar). Quien elige destino en
  // Porción terrestre es el BUSCADOR (`BuscadorBooking`), que ejecuta una
  // búsqueda real y acota el universo a lo que el motor devolvió.
  // MODO BÚSQUEDA de Porción terrestre: lo que el buscador (`BuscadorBooking`)
  // comunica hacia arriba cuando ejecuta una búsqueda con éxito, y `null`
  // cuando la limpia o cuando los criterios mostrados dejan de corresponder a
  // los resultados. Mientras está activo, esta vista NO es un catálogo de
  // exploración: la grilla queda CERRADA al destino buscado (persona + unidad
  // por igual) y se deja de ofrecer "O explora todos los alojamientos" — que
  // era exactamente lo que mezclaba un hotel unidad del destino buscado con
  // hoteles de otros destinos, por debajo de los resultados (ver el informe
  // de la tarea).
  const [busquedaPorcion, setBusquedaPorcion] = useState<EstadoBusquedaPorcion | null>(null);
  // Destino que ACOTA la grilla de Porción terrestre: **solo el de una
  // búsqueda EJECUTADA** (`busquedaPorcion`), "" si no hay ninguna.
  //
  // Hallazgo 1 (corrección): antes este valor era "efectivo" — caía a un
  // selector de exploración local cuando no había búsqueda, y los dos memos de
  // candidatos (persona y unidad) filtraban por él. Eso hacía que ELEGIR un
  // destino sin pulsar Buscar ya recortara el universo: los recomendados de
  // paquetes de otros destinos desaparecían antes de que existiera una
  // búsqueda, justo lo contrario de la regla del estado global inicial (top 2
  // recomendados de CADA paquete). Ese selector se ELIMINÓ (ya no quedaba
  // ningún control honesto que pudiera hacer): el universo de candidatos solo
  // cambia al ejecutar una búsqueda (estado B) o al limpiarla (vuelve al
  // estado A). Quien elige destino es el buscador real (`BuscadorBooking`).
  const destinoPorcionBusqueda = busquedaPorcion ? busquedaPorcion.destino : "";
  const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;
  // Sugerencia de fecha pedida por el usuario desde los chips del estado vacío
  // (que ahora viven acá, junto a la lista unificada). El `nonce` se
  // incrementa en cada clic: baja al buscador, que la aplica UNA vez por clic
  // (ver `sugerenciaPedida` en `BuscadorBooking`).
  const [sugerenciaPedida, setSugerenciaPedida] = useState<(SugerenciaFecha & { nonce: number }) | null>(null);

  // MODO ACOTADO de Receptivos (fix "add-ons propios reemplazados por el
  // catálogo general del destino"): `paqueteId` cuando la búsqueda de
  // `BuscadorReceptivos` quedó atada al paquete de origen (abierta desde
  // "+ Agregar servicios / tours" del carrito), `null` en cualquier otro caso
  // (entrada directa a Receptivos, o tras "Limpiar resultados"). Solo se usa
  // para decidir si se muestra debajo la vitrina estática "O explora todos
  // los receptivos" — nunca para filtrar nada por su cuenta (el filtrado real
  // vive en el servidor, ver `buscarReceptivos`/`lib/reservar/cotizar.ts`).
  const [receptivosAcotado, setReceptivosAcotado] = useState<number | null>(null);

  // Hallazgo confirmado (auditoría independiente): `BuscadorBooking` se
  // desmonta al abandonar Porción terrestre (solo se renderiza cuando
  // `sub === "porcion_terrestre"`, más abajo), pero `busquedaPorcion`/
  // `sugerenciaPedida` viven ACÁ, en el padre — nada los limpiaba al cambiar
  // de pestaña. Volver a Porción terrestre remontaba un formulario en blanco
  // (perdía su propio estado interno) mientras la grilla seguía "congelada"
  // en modo búsqueda (encabezado, contador y estado vacío de la búsqueda
  // anterior), sin el botón "Limpiar resultados" a la vista (vive dentro del
  // `BuscadorBooking` recién montado, gateado por SU propio estado, que
  // volvió a nacer en `null`).
  //
  // Único punto de cambio de `sub`: centraliza la limpieza en el HANDLER que
  // cambia de pestaña (nunca en un `useEffect` que compare `sub` — sería un
  // `setState` síncrono dentro de un efecto, exactamente lo que se pidió
  // evitar cuando el handler ya puede resolverlo). Lee `sub` del cierre del
  // render actual (nunca queda obsoleto: se llama de forma síncrona desde un
  // clic, no desde un efecto), así que siempre compara contra el valor
  // vigente.
  function cambiarSub(next: typeof sub) {
    if (sub === "porcion_terrestre" && next !== "porcion_terrestre") {
      setBusquedaPorcion(null);
      setSugerenciaPedida(null);
    }
    // `BuscadorReceptivos` se desmonta al salir de "receptivos" (solo se
    // renderiza cuando `sub === "receptivos"`, más abajo) — su estado local
    // (incl. `paqueteAcotado`) se pierde con él. `receptivosAcotado` vive ACÁ
    // (en el padre, que no se desmonta) para poder ocultar la vitrina general
    // mientras dura el modo acotado — se limpia al salir de la pestaña para
    // que un regreso posterior sin un intent nuevo no arrastre un acotado ya
    // huérfano (su fuente real ya no existe).
    if (sub === "receptivos" && next !== "receptivos") {
      setReceptivosAcotado(null);
    }
    setSub(next);
  }

  // Filtros de la grilla de hoteles: pet friendly / adults only.
  const [soloPetFriendly, setSoloPetFriendly] = useState(false);
  const [soloAdultsOnly, setSoloAdultsOnly] = useState(false);

  // Cuántos ALOJAMIENTOS trajo la búsqueda vigente ANTES de los filtros del
  // usuario. Sirve para que el estado vacío diga la verdad: "tus filtros
  // ocultaron lo que la búsqueda sí encontró" es un problema DISTINTO (y con
  // otra salida) que "la búsqueda no encontró nada" — y confundirlos mandaría
  // al usuario a cambiar fechas cuando el problema es un checkbox.
  // Cuenta ALOJAMIENTOS, no filas: `buscarHoteles` devuelve una fila por
  // (paquete, hotel), así que un mismo hotel en dos paquetes del destino
  // inflaría el número por encima de lo que la grilla realmente pinta (una
  // tarjeta por hotel — ver `tarjetas`).
  const resultadosBusquedaVisibles = useMemo(() => {
    if (!busquedaPorcion) return 0;
    const idsUnidad = new Set(hotelIdsUnidadAutoritativos);
    const hotelesPersona = new Set<number>();
    for (const r of busquedaPorcion.resultados) {
      if (!idsUnidad.has(r.hotelId)) hotelesPersona.add(r.hotelId);
    }
    return hotelesPersona.size + busquedaPorcion.unidad.length;
  }, [busquedaPorcion, hotelIdsUnidadAutoritativos]);

  const { add, openDrawer, addonsIntent, setAddonsIntent } = useCart();
  // `cambiarSub` no es un `useState` setter (React no lo reconoce como
  // referencia estable) — se re-crea en cada render porque lee `sub` del
  // cierre. Pasarlo directo como dependencia del efecto de abajo dispararía
  // el efecto en CADA render mientras `addonsIntent` siga activo (bucle). Se
  // llama a través de un ref "último valor" — mismo patrón ya usado para
  // `aplicarSugerenciaFecha` en `BuscadorBooking.tsx` — así el efecto solo
  // depende de `addonsIntent`.
  const cambiarSubRef = useRef(cambiarSub);
  useEffect(() => { cambiarSubRef.current = cambiarSub; });
  // Señal del carrito ("+ Agregar servicios/tours" con un hotel ya elegido):
  // salta directo a Receptivos con destino/fechas/pax ya puestos.
  useEffect(() => {
    if (addonsIntent) cambiarSubRef.current("receptivos");
  }, [addonsIntent]);

  // Salidas (bloqueos) con cupos > 0, con su origen/destino/fechas/cupos.
  const salidasBloqueo = useMemo(() => {
    const map = new Map<number, { id: number; origen: string; destino: string; label: string; fechaIda: string | null; fechaRegreso: string | null; noches: number | null; cupos: number }>();
    for (const f of filas) {
      if (f.modulo !== "bloqueo" || f.bloqueo_id == null) continue;
      const cupos = cuposPorBloqueo[f.bloqueo_id];
      if (cupos !== undefined && cupos <= 0) continue;
      if (map.has(f.bloqueo_id)) continue;
      map.set(f.bloqueo_id, {
        id: f.bloqueo_id,
        origen: origenPorBloqueo[f.bloqueo_id] ?? "",
        destino: f.destino_nombre ?? "",
        label: f.bloqueo_label ?? "Salida",
        fechaIda: f.fecha_ida, fechaRegreso: f.fecha_regreso, noches: f.noches,
        cupos: cupos ?? 0,
      });
    }
    // De la salida más cercana a la más lejana; sin fecha, al final.
    return [...map.values()].sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99"));
  }, [filas, cuposPorBloqueo, origenPorBloqueo]);

  const origenes = useMemo(() => [...new Set(salidasBloqueo.map((s) => s.origen).filter(Boolean))].sort(), [salidasBloqueo]);
  // P3 (hallazgo confirmado, validación final): los destinos del selector
  // salían SOLO de `salidasBloqueo` (derivada de `filas`, hoteles persona) —
  // un destino que solo existe en un hotel por unidad (`hotelesBernalo`)
  // nunca aparecía como opción, así que ese hotel quedaba inalcanzable desde
  // el selector aunque `hotelesUnidadVisibles` SÍ sepa filtrar por
  // `destinoSel` cuando coincide (ver más abajo). Se agregan los destinos de
  // ofertas `tipo: "bloqueo"`, deduplicados y ordenados junto con los
  // legacy. Nunca se filtran por `origenSel`: un hotel unidad no tiene
  // concepto de origen/salida aérea (esa integración no existe todavía, ver
  // `hotelesUnidadVisibles`) — filtrar su destino por el origen elegido
  // sería inventar un dato que no se tiene.
  const destinosBloqueo = useMemo(() => {
    const legacy = salidasBloqueo.filter((s) => !origenSel || s.origen === origenSel).map((s) => s.destino);
    const unidad = hotelesBernalo.filter((h) => h.tipo === "bloqueo" && h.destinoNombre).map((h) => h.destinoNombre as string);
    return [...new Set([...legacy, ...unidad])].filter(Boolean).sort();
  }, [salidasBloqueo, origenSel, hotelesBernalo]);
  const salidasFiltradas = useMemo(
    () => salidasBloqueo.filter((s) => (!origenSel || s.origen === origenSel) && (!destinoSel || s.destino === destinoSel)),
    [salidasBloqueo, origenSel, destinoSel]
  );

  // Destino/búsqueda EFECTIVOS del submódulo activo — gobiernan el estado A
  // (global inicial) vs B (después de buscar) de "hoteles recomendados".
  //   · Bloqueo no tiene un paso de "ejecutar búsqueda" separado — el
  //     selector de destino ES la única interacción, así que sigue siendo el
  //     gatillo (sin cambios respecto a la ronda anterior).
  //   · Porción terrestre SÍ lo tiene (`BuscadorBooking`/`busquedaPorcion`) —
  //     el gatillo es `busquedaPorcion` en sí (una búsqueda REALMENTE
  //     ejecutada y vigente). Mientras no exista, sigue siendo estado A
  //     (top 2 de cada paquete, sin resto) sin importar qué tenga el selector
  //     de exploración, que ya no acota nada (ver hallazgo 1 arriba). Limpiar
  //     resultados (`setBusquedaPorcion(null)`, ver `BuscadorBooking`) vuelve
  //     a dejar esto vacío → estado A de nuevo.
  const destinoActivoSub = sub === "bloqueo"
    ? destinoSel
    : sub === "porcion_terrestre"
      ? destinoPorcionBusqueda
      : "";

  // Tarjetas CANDIDATAS de hotel persona del submódulo activo — SIEMPRE UNA
  // por (hotelId, paqueteId), NUNCA fusionadas por hotel_id.
  //
  // Corrección posterior (auditoría): la versión anterior fusionaba el
  // "resto del inventario" por `hotel_id` (un mismo hotel en dos paquetes
  // distintos terminaba en UNA sola tarjeta, con "desde"/Incluye/add-ons de
  // AMBOS paquetes mezclados) — la identidad hotelId+paqueteId solo se
  // preservaba para las recomendadas. Ahora TODA oferta persona (recomendada
  // o no) es una tarjeta independiente por (hotelId, paqueteId) — la
  // selección de CUÁLES son recomendadas y CUÁLES son "resto" (y la
  // combinación con hoteles unidad/Bernalo, hallazgo 3) se resuelve en
  // `tarjetas` más abajo, que es quien conoce ambas fuentes.
  const hoteles = useMemo<HotelCard[]>(() => {
    const mod = sub === "receptivos" ? null : sub;
    const conHotel = filas.filter((f) => {
      if (mod == null || f.modulo !== mod || f.hotel_id == null) return false;
      if (mod === "bloqueo" && f.bloqueo_id != null) {
        const c = cuposPorBloqueo[f.bloqueo_id];
        if (c !== undefined && c <= 0) return false; // sin cupos: no se muestra
        if (origenSel && origenPorBloqueo[f.bloqueo_id] !== origenSel) return false;
        if (destinoSel && (f.destino_nombre ?? "") !== destinoSel) return false;
        if (salidaSel !== "" && f.bloqueo_id !== salidaSel) return false;
      }
      if (mod === "porcion_terrestre" && destinoPorcionBusqueda && (f.destino_nombre ?? "") !== destinoPorcionBusqueda) return false;
      return true;
    });

    const porOferta = new Map<string, HotelCard>();
    for (const f of conHotel) {
      const id = f.hotel_id as number;
      const paqueteId = f.paquete_id as number;
      const clave = claveOferta(id, paqueteId);
      let c = porOferta.get(clave);
      if (!c) {
        const info = infoPorHotel[id];
        c = {
          hotelId: id, hotelNombre: f.hotel_nombre ?? "—", destino: f.destino_nombre,
          foto: fotosPorHotel[id] ?? null, desde: null,
          estrellas: info?.estrellas ?? null, clasificacion: info?.clasificacion ?? null, descripcion: info?.descripcion ?? null,
          ubicacion: info?.ubicacion ?? null, video_url: info?.video_url ?? null,
          ninoMin: info?.ninoMin ?? null, ninoMax: info?.ninoMax ?? null, infMin: info?.infMin ?? null, infMax: info?.infMax ?? null,
          adultsOnly: info?.adultsOnly ?? false, petFriendly: info?.petFriendly ?? false,
          tieneCondicion: info?.tieneCondicion ?? false,
          filas: [], moneda: f.moneda ?? "COP",
          paqueteId, paqueteNombre: f.paquete_nombre ?? null,
        };
        porOferta.set(clave, c);
      }
      c.filas.push(f);
    }
    let arr = [...porOferta.values()];
    // Filtro de acomodación (de la barra superior): el hotel se muestra solo si
    // tiene tarifa para esa acomodación. Incluye Chd1/Chd2 (revisión
    // posterior, defecto "los filtros Chd1/Chd2 no devolvían los mismos
    // hoteles que antes" — el resumen ahora trae precio_nino/precio_nino2
    // por combo, así que este filtro ya no depende de una expansión
    // sintética que nunca incluía niños).
    if (soloAcom) arr = arr.filter((c) => c.filas.some((f) => tieneAcomodacionResumen(f, soloAcom)));
    if (soloPetFriendly) arr = arr.filter((c) => c.petFriendly);
    if (soloAdultsOnly) arr = arr.filter((c) => c.adultsOnly);
    for (const c of arr) c.desde = minRoomPvp(c.filas);
    return arr;
  }, [filas, fotosPorHotel, infoPorHotel, sub, cuposPorBloqueo, origenPorBloqueo, origenSel, destinoSel, destinoPorcionBusqueda, salidaSel, soloAcom, soloPetFriendly, soloAdultsOnly]);

  // Hoteles por unidad (Bernalo) visibles en el submódulo/filtros ACTIVOS —
  // para el cliente son hoteles normales, así que responden a la misma
  // pestaña (Paquetes/Porción terrestre, por `h.tipo`, el tipo real del
  // paquete al que pertenecen) y al destino de su propia pestaña
  // (`destinoSel` en Bloqueo — el selector que SÍ acota, porque en Bloqueo
  // elegir un destino es la única interacción; `destinoPorcionBusqueda` en
  // Porción terrestre, que solo existe cuando hay una búsqueda EJECUTADA y es
  // "" mientras no la haya — hallazgo 1: en Porción terrestre NO existe ningún
  // control de destino sobre la grilla; el único es el buscador real).
  // Nunca aparecen en Receptivos (no son un servicio).
  //
  // P2 (hallazgo confirmado): Pet friendly/Adults Only antes ocultaban TODOS
  // los hoteles unidad incondicionalmente ("no están configurados hoy para
  // este modelo") — pero SÍ están configurados: son atributos del HOTEL
  // (`hoteles.pet_friendly`/`adults_only`), no del modelo tarifario, y ya
  // llegan enriquecidos en `infoPorHotel` (ver `page.tsx`, que ahora
  // consulta `hoteles` también para los hotelId unidad). Se filtra con el
  // valor REAL — nunca se afirma "no cumple" por falta de dato: si
  // `infoPorHotel[h.hotelId]` no llegó a cargar, el hotel queda fuera del
  // filtro activo (mismo criterio conservador que persona, que también
  // exige `=== true`, ver `hoteles` arriba).
  const hotelesUnidadVisibles = useMemo(() => {
    if (sub === "receptivos") return [];
    let arr = hotelesBernalo.filter((h) => h.tipo === sub);
    if (sub === "bloqueo" && destinoSel) arr = arr.filter((h) => (h.destinoNombre ?? "") === destinoSel);
    if (sub === "porcion_terrestre" && destinoPorcionBusqueda) arr = arr.filter((h) => (h.destinoNombre ?? "") === destinoPorcionBusqueda);
    if (soloPetFriendly) arr = arr.filter((h) => infoPorHotel[h.hotelId]?.petFriendly === true);
    if (soloAdultsOnly) arr = arr.filter((h) => infoPorHotel[h.hotelId]?.adultsOnly === true);
    return arr;
  }, [hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda, soloPetFriendly, soloAdultsOnly, infoPorHotel]);

  // Una sola colección para la grilla — persona y unidad mezclados, sin
  // sección aparte (el usuario ve hoteles, no "modelos de cálculo"). Clave
  // estable por tipo + OFERTA (hotelId + paqueteId).
  //
  // P1-2 quedó SUPERADO por el hallazgo 3 de la auditoría: la versión vieja
  // agrupaba las ofertas unidad por `hotelId` (una tarjeta por hotel con
  // TODAS sus ofertas) — justamente lo que impedía tratar cada oferta
  // hotel+paquete como independiente, que es lo que exige "hoteles
  // recomendados" (migración 183, la recomendación es POR PAQUETE). Ahora cada
  // entrada de `hotelesUnidadVisibles` (que ya es una oferta, un row por
  // hotel+paquete) arma su PROPIA tarjeta, y `ofertas` queda con ESE único
  // elemento (compatibilidad con `HotelBernaloCotizarModal`, que ya soporta
  // `ofertas.length === 1`) — ver `HotelUnidadCard`.
  //
  // P1 (hallazgo confirmado, validación final): `modelo_tarifario` es
  // exclusivo por hotel — un hotel NO puede ser persona y unidad a la vez.
  // Pero `tarifario_resultado` es una CACHÉ escrita por `generarTarifario`,
  // que puede quedar desactualizada: si un hotel pasó de persona a unidad
  // (`hoteles.modelo_tarifario = 'unidad'`) y su paquete no se ha vuelto a
  // generar, su fila persona sigue viva en `tarifario_resultado`/`filas`
  // aunque ya sea obsoleta. Se elimina del conjunto PERSONA todo `hotelId`
  // presente en `hotelIdsUnidadAutoritativos` — nunca al revés — así la
  // oferta unidad vigente siempre prevalece sobre una tarjeta persona
  // obsoleta del mismo hotel. Un hotel realmente persona (su hotelId no
  // aparece ahí) sigue su camino normal, sin cambios.
  //
  // ⚠️ Hallazgo confirmado (validación real, ronda 2): la primera versión de
  // esta corrección derivaba el set de exclusión de `hotelesBernalo` (el
  // prop tal cual llega a este componente) — pero en TarifarioPublic ese
  // prop YA es `hotelesBernaloFiltrados`/`fAcom ? [] : ...` (filtrado por
  // acomodación/categoría/régimen/texto antes de bajar hasta acá). Con un
  // filtro activo, un hotel unidad podía desaparecer de `hotelesBernalo` y
  // su tarjeta persona obsoleta REAPARECÍA — el bug seguía presente, solo
  // que condicionado a los filtros. `hotelIdsUnidadAutoritativos` es un
  // canal aparte que viaja SIN pasar por ningún filtro de visibilidad
  // (`lib/tarifario/datosBernalo.ts` → `page.tsx` → `TarifarioPublic.tsx` →
  // acá) — la única fuente correcta para esta exclusión.
  const tarjetas = useMemo<Tarjeta[]>(() => {
    const idsUnidadAutoritativa = new Set(hotelIdsUnidadAutoritativos);
    const porFiltros = (hotelId: number) => {
      const info = infoPorHotel[hotelId];
      if (soloPetFriendly && !info?.petFriendly) return false;
      if (soloAdultsOnly && !info?.adultsOnly) return false;
      return true;
    };

    // ── Modo búsqueda: UNA sola lista, la de la búsqueda ──────────────────
    // Cuando hay una búsqueda vigente, la grilla deja de ser el catálogo de
    // exploración y pasa a ser EXACTAMENTE lo que esa búsqueda produjo:
    //   · persona → las filas que devolvió `buscarHoteles`
    //     (`busquedaPorcion.resultados`), que ya validó fechas, ocupación y
    //     tarifa. NUNCA se completa con la grilla precargada: por eso un hotel
    //     que el motor rechazó no puede reaparecer acá por estar en el
    //     catálogo del destino.
    //   · unidad → los alojamientos que el servidor CONFIRMÓ disponibles
    //     (`busquedaPorcion.unidad`, ya filtrado a `estado === "disponible"`).
    //     Un `sin_disponibilidad` no es un resultado disponible y no llega
    //     hasta acá; un estado desconocido por error técnico tampoco.
    // Los filtros de Pet friendly / Adults Only SÍ aplican (son del usuario);
    // `soloAcom` no — la búsqueda ya resolvió la composición que se pidió.
    // Igual que en exploración, la fila persona de un hotel que hoy es unidad
    // se excluye por el canal autoritativo: sería la caché obsoleta de
    // `tarifario_resultado`, no una oferta vigente.
    //
    // Corrección posterior (auditoría) — hoteles recomendados TAMBIÉN
    // ordenan los resultados REALES de la búsqueda: hasta 6 por paquete
    // coincidente (prioridad 1→6), después el resto de lo que el motor
    // devolvió — NUNCA se reintroduce una oferta que la búsqueda rechazó (la
    // selección de recomendados se construye ÚNICAMENTE a partir de
    // `resultadosPersona`/`gruposUnidadBusqueda`, ambos ya acotados a lo que
    // el motor confirmó). Identidad SIEMPRE (hotelId, paqueteId): antes se
    // deduplicaba persona por `hotelId` a secas (`vistos.has(r.hotelId)`),
    // descartando ofertas reales del mismo hotel en un paquete distinto
    // (ej. paquete normal + paquete 3x2) — ya no hay ningún dedup por
    // hotelId, solo por (hotelId,paqueteId), defensivo (`buscarHoteles` ya
    // entrega como máximo una fila por esa combinación).
    if (enBusquedaPorcion && busquedaPorcion) {
      const vistasPersona = new Set<string>();
      const resultadosPersona: BusquedaResultado[] = [];
      for (const r of busquedaPorcion.resultados) {
        if (idsUnidadAutoritativa.has(r.hotelId) || !porFiltros(r.hotelId)) continue;
        const clave = claveOferta(r.hotelId, r.paqueteId);
        if (vistasPersona.has(clave)) continue;
        vistasPersona.add(clave);
        resultadosPersona.push(r);
      }

      // Unidad: `busquedaPorcion.unidad` trae UNA entrada por hotelId con
      // TODAS sus opciones confirmadas — que pueden pertenecer a paquetes
      // DISTINTOS. `agruparOpcionesUnidadPorOferta` (función pura, probada en
      // pruebas/recomendados.test.ts) las reparte por (hotelId,paqueteId):
      // cada grupo conserva EXCLUSIVAMENTE las opciones cotizadas de ESE
      // paquete, nunca las de otro (antes una sola tarjeta mezclaba
      // categorías/alimentaciones de paquetes distintos bajo el mismo hotel).
      // La fuente de precio/disponibilidad (`opcionSel.precioVenta`, ya
      // confirmado por `computarReservaBernalo`) NO cambia — solo se reparte el
      // MISMO arreglo `opciones`, ya autoritativo, por paquete.
      const gruposUnidadBusqueda = agruparOpcionesUnidadPorOferta(
        busquedaPorcion.unidad.filter((u) => porFiltros(u.hotelId)).flatMap((u) => u.opciones)
      );
      const gruposUnidadPorClave = new Map(
        gruposUnidadBusqueda.map((g) => [claveOferta(g.hotelId, g.paqueteId), g])
      );

      const ofertasPersonaBusqueda = ofertasConPrioridad(resultadosPersona, prioridadesRecomendados);
      const ofertasUnidadBusqueda = ofertasConPrioridad(gruposUnidadBusqueda, prioridadesRecomendados);
      // Una búsqueda siempre está acotada a UN destino — regla de "hasta 6"
      // (nunca la de "top 2", esa es exclusiva del estado global sin búsqueda).
      const paqueteIdsBusqueda = new Set<number>([
        ...resultadosPersona.map((r) => r.paqueteId),
        ...gruposUnidadBusqueda.map((g) => g.paqueteId),
      ]);
      const recomendadasBusqueda = seleccionarRecomendadosPorDestino(
        [...ofertasPersonaBusqueda, ...ofertasUnidadBusqueda],
        paqueteIdsBusqueda
      );
      const clavesRecomendadasBusqueda = new Set(recomendadasBusqueda.map((o) => claveOferta(o.hotelId, o.paqueteId)));

      const tarjetaPersona = (r: BusquedaResultado, marca: MarcaOferta = {}): Tarjeta =>
        ({ tipo: "busqueda" as const, key: `b-${r.paqueteId}-${r.hotelId}`, r, recomendada: marca.recomendada });
      // Cierre de UX de la tarjeta unidad: `g.opciones` trae TODAS las
      // combinaciones confirmadas DE ESE PAQUETE (nunca de otro), cada una
      // con su precio público ya saneado — la tarjeta las pinta INLINE
      // (`opcionesBusqueda`, ver `TarjetaUnidadBusqueda`) sin abrir ningún
      // modal ni volver a pedir nada. `ofertas` queda vacío a propósito: esa
      // lista solo la usa el modal de EXPLORACIÓN, que esta tarjeta nunca abre.
      const tarjetaUnidad = (g: GrupoOfertaUnidad<OpcionUnidadConfirmada>, marca: MarcaOferta = {}): Tarjeta => ({
        tipo: "unidad" as const,
        recomendada: marca.recomendada,
        // La `key` incluye paqueteId + la identidad de la BÚSQUEDA vigente
        // (fechas + ocupación + combinaciones confirmadas) — nunca solo
        // `hotelId`: dos ofertas del mismo hotel en paquetes distintos deben
        // tener claves DISTINTAS (antes colisionaban en `u-${hotelId}-...`,
        // aunque en la práctica solo existía una tarjeta por hotel).
        key: `u-${g.hotelId}-${g.paqueteId}-${claveBusquedaUnidad(g.opciones)}`,
        hotel: {
          hotelId: g.hotelId, hotelNombre: g.opciones[0].hotelNombre, destino: g.opciones[0].destinoNombre,
          ofertas: [], opcionesBusqueda: g.opciones, paqueteId: g.paqueteId, paqueteNombre: g.opciones[0].paqueteNombre,
        },
      });

      const tarjetasRecomendadas: Tarjeta[] = [];
      for (const o of recomendadasBusqueda) {
        const clave = claveOferta(o.hotelId, o.paqueteId);
        const r = resultadosPersona.find((x) => x.hotelId === o.hotelId && x.paqueteId === o.paqueteId);
        if (r) { tarjetasRecomendadas.push(tarjetaPersona(r, { recomendada: true })); continue; }
        const g = gruposUnidadPorClave.get(clave);
        if (g) tarjetasRecomendadas.push(tarjetaUnidad(g, { recomendada: true }));
      }
      // ⚠️ Defecto 2 (corregido): estas dos líneas pasaban la FUNCIÓN directo a
      // `Array.map` (`.map(tarjetaPersona)`), así que JS le entregaba
      // `(elemento, índice, arreglo)` y el ÍNDICE entraba como la marca de
      // recomendación — TODA oferta del resto quedaba marcada como recomendada
      // ("Recomendado · paquete") sin estarlo. Los callbacks explícitos pasan UN
      // solo argumento: la marca `recomendada` solo se pone en el bucle de
      // arriba, y solo a las ofertas que realmente están en
      // `recomendadasBusqueda`. Además la marca ahora viaja en un OBJETO
      // (`{ recomendada: true }`), así que un `.map(fn)` accidental pasaría el
      // índice como ese objeto y la marca seguiría quedando falsa — el índice
      // ya no puede convertirse en "recomendado" ni por accidente.
      const resto: Tarjeta[] = [
        ...resultadosPersona.filter((r) => !clavesRecomendadasBusqueda.has(claveOferta(r.hotelId, r.paqueteId))).map((r) => tarjetaPersona(r)),
        ...gruposUnidadBusqueda.filter((g) => !clavesRecomendadasBusqueda.has(claveOferta(g.hotelId, g.paqueteId))).map((g) => tarjetaUnidad(g)),
      ].sort((x, y) => nombreTarjeta(x).localeCompare(nombreTarjeta(y)));
      return [...tarjetasRecomendadas, ...resto];
    }

    // ── Exploración (sin búsqueda vigente): recomendados (persona + unidad
    // combinados, hallazgo 3) + resto ──────────────────────────────────────
    const cardsPersona = hoteles.filter((c) => !idsUnidadAutoritativa.has(c.hotelId));
    const claveCardPersona = (c: HotelCard) => `p-${c.hotelId}-${c.paqueteId}`;
    const claveCardUnidad = (h: HotelBernaloDescubierto) => `u-${h.hotelId}-${h.paqueteId}`;

    const ofertasPersona = ofertasConPrioridad(cardsPersona, prioridadesRecomendados);
    const ofertasUnidad = ofertasConPrioridad(hotelesUnidadVisibles, prioridadesRecomendados);
    const recomendadas: OfertaPrioridad[] = destinoActivoSub
      ? seleccionarRecomendadosPorDestino(
          [...ofertasPersona, ...ofertasUnidad],
          new Set([...cardsPersona.map((c) => c.paqueteId).filter((p): p is number => p != null), ...hotelesUnidadVisibles.map((h) => h.paqueteId)])
        )
      : seleccionarRecomendadosGlobalInicial([...ofertasPersona, ...ofertasUnidad]);
    const clavesRecomendadas = new Set(recomendadas.map((o) => claveOferta(o.hotelId, o.paqueteId)));
    const esRecomendada = (hotelId: number, paqueteId: number | undefined | null) =>
      paqueteId != null && clavesRecomendadas.has(claveOferta(hotelId, paqueteId));

    const tarjetasRecomendadas: Tarjeta[] = [];
    for (const o of recomendadas) {
      const cPersona = cardsPersona.find((c) => c.hotelId === o.hotelId && c.paqueteId === o.paqueteId);
      if (cPersona) {
        tarjetasRecomendadas.push({
          tipo: "persona" as const, key: claveCardPersona(cPersona), card: cPersona,
          recomendada: true,
        });
        continue;
      }
      const hUnidad = hotelesUnidadVisibles.find((h) => h.hotelId === o.hotelId && h.paqueteId === o.paqueteId);
      if (hUnidad) {
        tarjetasRecomendadas.push({
          tipo: "unidad" as const,
          key: claveCardUnidad(hUnidad),
          recomendada: true,
          hotel: {
            hotelId: hUnidad.hotelId, hotelNombre: hUnidad.hotelNombre, destino: hUnidad.destinoNombre,
            ofertas: [hUnidad], paqueteId: hUnidad.paqueteId, paqueteNombre: hUnidad.paqueteNombre,
          },
        });
      }
    }

    // Estado global inicial (A): SIN búsqueda/destino activo, el resto del
    // inventario NO se muestra — solo recomendados (si hay). Con destino/
    // búsqueda (B): recomendados + resto (persona Y unidad, cada oferta por
    // su propia identidad hotelId+paqueteId — nunca fusionada), excluyendo
    // cualquier oferta ya mostrada como recomendada, alfabetizado (criterio
    // histórico sin cambios).
    let resto: Tarjeta[] = [];
    if (destinoActivoSub) {
      const restoPersona: Tarjeta[] = cardsPersona
        .filter((c) => !esRecomendada(c.hotelId, c.paqueteId))
        .map((c) => ({ tipo: "persona" as const, key: claveCardPersona(c), card: c }));
      const restoUnidad: Tarjeta[] = hotelesUnidadVisibles
        .filter((h) => !esRecomendada(h.hotelId, h.paqueteId))
        .map((h) => ({
          tipo: "unidad" as const,
          key: claveCardUnidad(h),
          hotel: { hotelId: h.hotelId, hotelNombre: h.hotelNombre, destino: h.destinoNombre, ofertas: [h], paqueteId: h.paqueteId, paqueteNombre: h.paqueteNombre },
        }));
      resto = [...restoPersona, ...restoUnidad].sort((x, y) => nombreTarjeta(x).localeCompare(nombreTarjeta(y)));
    }
    return [...tarjetasRecomendadas, ...resto];
  }, [hoteles, hotelesUnidadVisibles, hotelIdsUnidadAutoritativos, enBusquedaPorcion, busquedaPorcion, infoPorHotel, soloPetFriendly, soloAdultsOnly, destinoActivoSub, prioridadesRecomendados]);

  const [abierto, setAbierto] = useState<HotelCard | null>(null);
  const [detalleHotel, setDetalleHotel] = useState<EstadoDetalle<FilaTarifario> | null>(null);
  const [receptivoAbierto, setReceptivoAbierto] = useState<ReceptivoModalInfo | null>(null);
  // Clave del hotel/módulo actualmente abierto — se lee dentro del `.then()`
  // para descartar una respuesta que ya no corresponde a lo que el usuario
  // tiene abierto AHORA (carrera: abrir el hotel A, cerrarlo y abrir el hotel
  // B antes de que la respuesta de A llegue). Un `ref` (no el estado
  // `abierto`) porque el cierre del `.then` capturaría el valor de `abierto`
  // en el momento en que se llamó `abrirHotel`, no en el momento en que la
  // respuesta realmente llega.
  const claveAbiertaRef = useRef<string | null>(null);

  // Abrir un hotel dispara el detalle bajo demanda (Tier 2) — la tarjeta y el
  // resto de la grilla YA están pintadas (vienen del resumen); un error acá
  // NUNCA las borra ni las altera, solo afecta lo que se ve DENTRO del modal
  // (ver `HotelModal` más abajo). `conCacheDetalle` deduplica si el mismo
  // hotel/módulo/ALCANCE ya está en vuelo y reutiliza un detalle ya resuelto
  // durante esta visita, sin volver a pedirlo.
  //
  // ⚠️ Alcance activo (ronda 6, ítem 2 — endurece la revisión anterior, que
  // solo usaba `salidasFiltradas.map(s => s.id)` como `bloqueoIds`): eso
  // dejaba fuera `salidaSel` (`salidasFiltradas` solo aplica origen/destino,
  // no la salida puntual elegida en el tercer selector — ver más arriba) y
  // no cubría categoría/régimen/búsqueda ni el submódulo Porción terrestre
  // (que no tenía NINGÚN alcance). `h.filas` (las filas de resumen de ESTA
  // tarjeta, ya armadas por el `useMemo` de `hoteles` de arriba) es la
  // fuente correcta: ya refleja TODOS los filtros activos en cascada — los
  // de TarifarioPublic.tsx (búsqueda/categoría/régimen, aplicados ANTES de
  // que `filas` llegue como prop a este componente) Y los propios de esta
  // vista (submódulo/cupos/origen/destino/salidaSel, aplicados al construir
  // `conHotel`/`hoteles`). Cada `FilaResumen` de `h.filas` ya trae los 10
  // campos de `ComboIdentidad` (módulo/paquete/bloqueo/salida/hotel/
  // categoría/régimen/fechas/moneda) — se pasa TAL CUAL como alcance, sin
  // transformar. Los combos entran en la CLAVE de caché (`claveDetalleHotel`)
  // Y como allow-list autoritativo en el servidor (`obtenerDetalleHotel`,
  // post-filtra ahí, no solo usa el alcance como hint de consulta): cambiar
  // CUALQUIER filtro y volver a abrir el MISMO hotel nunca reutiliza el
  // detalle cacheado de un alcance distinto, y el servidor nunca devuelve un
  // combo que el usuario ya no tiene visible.
  function abrirHotel(h: HotelCard) {
    setAbierto(h);
    setDetalleHotel({ estado: "cargando" });
    const esBloqueo = sub === "bloqueo";
    const clave = claveDetalleHotel(esBloqueo ? "bloqueo" : "porcion_terrestre", h.hotelId, h.filas);
    claveAbiertaRef.current = clave;
    const args = esBloqueo
      ? { modulo: "bloqueo" as const, hotelId: h.hotelId, combos: h.filas }
      : { modulo: "porcion_terrestre" as const, hotelId: h.hotelId, combos: h.filas };
    conCacheDetalle(clave, () => obtenerDetalleHotel(args))
      .then((r) => {
        if (claveAbiertaRef.current !== clave) return; // otro hotel/alcance se abrió mientras tanto
        setDetalleHotel(r.ok ? { estado: "ok", filas: r.filas } : { estado: "error", mensaje: r.error });
      })
      .catch(() => {
        if (claveAbiertaRef.current !== clave) return;
        setDetalleHotel({ estado: "error", mensaje: MSG_ERROR_DETALLE_HOTEL });
      });
  }

  function cerrarHotel() {
    claveAbiertaRef.current = null;
    setAbierto(null);
    setDetalleHotel(null);
  }

  // Receptivos (servicios) para su submódulo: agrupados por nombre con su
  // "desde", y luego por destino (una sección por destino) para no mezclarlos.
  const SIN_DESTINO = "Otros / todo destino";
  const receptivosPorDestino = useMemo(() => {
    const map = new Map<string, Receptivo>();
    for (const f of filas.filter((f) => f.modulo === "servicios" && f.servicio_nombre)) {
      const k = `${f.servicio_nombre}|${f.destino_nombre ?? ""}`;
      const prev = map.get(k);
      // `desde_general` = ya es el mínimo agregado de ese servicio (sin
      // acomodación, calculado en SQL) — el resumen NO trae `precio_pvp` por
      // fila (esa columna solo existe en el detalle completo, bajo demanda).
      const p = Number(f.desde_general) || 0;
      if (!prev) {
        map.set(k, {
          servicioId: f.servicio_id ?? null, paqueteId: f.paquete_id ?? null, nombre: f.servicio_nombre as string, destino: f.destino_nombre,
          descripcion: f.descripcion ?? null, foto: f.servicio_id != null ? (fotosPorServicio[f.servicio_id] ?? null) : null,
          desde: p, moneda: f.moneda,
        });
      } else if (p > 0 && p < prev.desde) prev.desde = p;
    }
    const porDestino = new Map<string, Receptivo[]>();
    for (const r of map.values()) {
      const key = r.destino ?? SIN_DESTINO;
      const arr = porDestino.get(key) ?? [];
      arr.push(r);
      porDestino.set(key, arr);
    }
    for (const arr of porDestino.values()) arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return [...porDestino.entries()].sort(([a], [b]) => (a === SIN_DESTINO ? 1 : b === SIN_DESTINO ? -1 : a.localeCompare(b)));
  }, [filas, fotosPorServicio]);

  // Servicios opcionales (add-on) de CADA paquete puntual — de `filasAddon`
  // (sin el recorte que aplica `filas`/`filasVisibles` para la vitrina plana
  // de Servicios), agrupados por paquete_id en vez de por destino, para
  // ofrecer en el modal del hotel SOLO los add-on de su propio paquete (nunca
  // los de otros destinos, a diferencia de la pestaña Receptivos).
  const addonsPorPaquete = useMemo(() => {
    const map = new Map<number, Map<string, Receptivo>>();
    for (const f of filasAddon) {
      if (f.modulo !== "servicios" || !f.servicio_nombre || f.paquete_id == null) continue;
      let porNombre = map.get(f.paquete_id);
      if (!porNombre) { porNombre = new Map(); map.set(f.paquete_id, porNombre); }
      const prev = porNombre.get(f.servicio_nombre);
      const p = Number(f.desde_general) || 0;
      if (!prev) {
        porNombre.set(f.servicio_nombre, {
          servicioId: f.servicio_id ?? null, paqueteId: f.paquete_id, nombre: f.servicio_nombre, destino: f.destino_nombre,
          descripcion: f.descripcion ?? null, foto: f.servicio_id != null ? (fotosPorServicio[f.servicio_id] ?? null) : null,
          desde: p, moneda: f.moneda,
        });
      } else if (p > 0 && p < prev.desde) prev.desde = p;
    }
    const out = new Map<number, Receptivo[]>();
    for (const [pid, porNombre] of map) out.set(pid, [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    return out;
  }, [filasAddon, fotosPorServicio]);

  const SUBTABS = [
    { key: "bloqueo", label: "Paquetes" },
    { key: "porcion_terrestre", label: "Porción terrestre" },
    { key: "receptivos", label: "Receptivos" },
  ] as const;

  // Destinos de Porción terrestre — la UNIÓN real (persona + unidad), y la
  // ÚNICA lista de destinos de esta pestaña: alimenta el selector de
  // exploración de la grilla Y el selector del motor de búsqueda
  // (`BuscadorBooking`).
  //
  // Antes había DOS listas, y la del motor se armaba SÓLO con filas persona:
  // un destino que existía únicamente por hoteles unidad quedaba fuera de su
  // desplegable, así que el motor —que desde `buscarAlojamientosUnidadPorFechas`
  // SÍ sabe resolver esos hoteles— no se podía invocar para ese destino desde la
  // UI. Un destino ofrecible que no se puede seleccionar es un destino que no se
  // puede buscar.
  //
  // La unión vive en `destinosPorcionPublica` (función pura) y no acá: así la
  // prueba la ejercita con un catálogo de fixture —incluido el caso
  // "sin ninguna fila persona y con un hotel unidad"— en vez de verificar su
  // forma por texto fuente.
  const destinosPorcion = useMemo(
    () => destinosPorcionPublica(filas, hotelesBernalo),
    [filas, hotelesBernalo]
  );
  // Destinos disponibles de RECEPTIVOS para el filtro de su mini-motor.
  const destinosServicios = useMemo(
    () => [...new Set(filas.filter((f) => f.modulo === "servicios" && f.destino_nombre).map((f) => f.destino_nombre as string))].sort((a, b) => a.localeCompare(b)),
    [filas]
  );

  return (
    <div>
      {/* Submódulos: Bloqueos · Porción terrestre · Receptivos */}
      <div className="mb-5 flex flex-wrap gap-2">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => cambiarSub(t.key)}
            className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            style={sub === t.key
              ? { backgroundColor: "var(--brand-primary)", color: "white" }
              : { backgroundColor: "white", color: "#4b5563", border: "1px solid #e5e7eb" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Buscador de BLOQUEOS: origen → destino → salida (vuelo) */}
      {sub === "bloqueo" && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar vuelo + hotel (paquete)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Origen</label>
              <select value={origenSel} onChange={(e) => { setOrigenSel(e.target.value); setDestinoSel(""); setSalidaSel(""); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todos</option>
                {origenes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Destino</label>
              <select value={destinoSel} onChange={(e) => { setDestinoSel(e.target.value); setSalidaSel(""); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todos</option>
                {destinosBloqueo.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Salida (vuelo)</label>
              <select value={salidaSel} onChange={(e) => setSalidaSel(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Todas las salidas</option>
                {salidasFiltradas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.origen} → {s.destino} · {fmtFecha(s.fechaIda)}–{fmtFecha(s.fechaRegreso)}{s.noches ? ` (${s.noches}N)` : ""} · {s.cupos} cupos
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Elige el origen y el destino; las fechas salen del vuelo (no son libres). El resto (habitaciones y acomodación) se elige en cada hotel.</p>
        </div>
      )}

      {sub === "receptivos" ? (
        <>
        <BuscadorReceptivos
          destinos={destinosServicios}
          fotosPorServicio={fotosPorServicio}
          initial={addonsIntent}
          onConsumedInitial={() => setAddonsIntent(null)}
          onModoAcotado={setReceptivosAcotado}
          onAgregar={(item) => { add(item); openDrawer(); }}
          onVerDetalle={(r) => setReceptivoAbierto({
            nombre: r.nombre, destino: r.destino, descripcion: r.descripcion,
            foto: fotosPorServicio[r.servicioId] ?? null, precio: r.total, moneda: r.moneda,
            notaPrecio: `total · ${r.pax} pax · ${r.noches} noche${r.noches === 1 ? "" : "s"}`,
            paqueteId: r.paqueteId ?? null,
          })}
        />
        {/* Modo acotado (abierto desde "+ Agregar servicios / tours" con un
            paquete de origen): la vitrina general del destino NO se muestra
            debajo — mostrarla ahí se leía como si esos ~100 servicios también
            fueran parte del paquete (la causa raíz del defecto reportado).
            Vuelve a aparecer solo tras "Limpiar resultados" (ver
            `BuscadorReceptivos`/`receptivosAcotado`) o en entrada directa a
            Receptivos, donde nunca estuvo acotada. */}
        {receptivosAcotado == null && (
          receptivosPorDestino.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No hay receptivos publicados.</p>
          ) : (
            <div className="space-y-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">O explora todos los receptivos</p>
              {receptivosPorDestino.map(([destino, items]) => (
                <div key={destino}>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {destino} <span className="ml-1 font-normal normal-case text-gray-400">({items.length})</span>
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setReceptivoAbierto({ nombre: r.nombre, destino: r.destino, descripcion: r.descripcion, foto: r.foto, precio: r.desde, moneda: r.moneda, notaPrecio: "desde · por persona", paqueteId: r.paqueteId })}
                        className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                      >
                        <div className="relative aspect-[16/10] w-full bg-gray-100">
                          {r.foto ? (
                            <Image src={r.foto} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-4">
                          <div className="font-semibold text-gray-800">{r.nombre}</div>
                          {r.descripcion?.trim() && (
                            <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                          )}
                          <div className="mt-3 flex items-end justify-between">
                            <div>
                              <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
                              <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.desde, r.moneda)}</div>
                              <div className="text-[10px] text-gray-400">por persona</div>
                            </div>
                            <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
                              Ver más →
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        </>
      ) : (
      <>
      {/* Mini-motor por fechas: solo en Porción terrestre (en bloqueo manda el
          vuelo). Recibe `destinosPorcion` — la unión persona + unidad —, no una
          lista propia: el motor resuelve las dos mitades, así que su selector
          tiene que ofrecer exactamente lo que el motor puede devolver. */}
      {sub === "porcion_terrestre" && (
        <BuscadorBooking destinos={destinosPorcion} onBusqueda={setBusquedaPorcion} sugerenciaPedida={sugerenciaPedida} />
      )}

      {/* Aviso NO bloqueante: la mitad "unidad" de la búsqueda vigente no se
          pudo completar con confianza (fallo técnico o evaluación parcial —
          ver `EstadoBusquedaPorcion.avisoUnidad`). Los resultados persona de
          abajo siguen siendo los completos; esto nunca los reemplaza ni los
          oculta, solo avisa que la mitad unidad puede estar incompleta. */}
      {enBusquedaPorcion && busquedaPorcion?.avisoUnidad && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {busquedaPorcion.avisoUnidad}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {sub === "bloqueo" ? (
            "Hoteles disponibles"
          ) : enBusquedaPorcion ? (
            // Modo búsqueda: la grilla de abajo ya no es el catálogo de
            // exploración sino el resultado de la búsqueda. Decirlo evita
            // que se lea como "y además hay todo esto" — y deja claro por
            // qué desaparecieron los hoteles de otros destinos.
            <>
              Resultados de tu búsqueda{` en ${busquedaPorcion.destino}`}
              <span className="ml-2 font-normal normal-case text-gray-400">
                {busquedaPorcion.fechaIda} → {busquedaPorcion.fechaRegreso}
              </span>
            </>
          ) : (
            "O explora todos los alojamientos"
          )}
          <span className="ml-2 font-normal normal-case text-gray-400">({tarjetas.length})</span>
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={soloPetFriendly} onChange={(e) => setSoloPetFriendly(e.target.checked)} />
            Pet friendly
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={soloAdultsOnly} onChange={(e) => setSoloAdultsOnly(e.target.checked)} />
            Adults Only
          </label>
        </div>
      </div>
      {/* Estado vacío de la GRILLA (exploración). En modo búsqueda NO se
          pinta: hay un estado vacío ÚNICO de búsqueda más abajo, junto a la
          lista unificada — dos mensajes vacíos para la misma grilla dirían lo
          mismo dos veces, y el de acá además invitaría a "quitar filtros", que
          no es el problema cuando el resultado está cerrado por destino. */}
      {!tarjetas.length && !enBusquedaPorcion && <p className="py-8 text-center text-sm text-gray-400">No hay alojamientos para los filtros aplicados. Prueba quitar filtros o cambiar de pestaña (Paquetes/Porción).</p>}
      {/* Estado vacío ÚNICO de la búsqueda — uno solo para persona y unidad,
          porque la lista es una sola. Distingue dos situaciones que NO son la
          misma y no se resuelven igual:
            · la búsqueda SÍ trajo resultados y fueron los filtros del usuario
              los que los ocultaron (salida: quitar un filtro);
            · la búsqueda no encontró nada (salida: el diagnóstico real y,
              solo si el motivo fue de fechas, las fechas alternativas con
              tarifa — cambiar de fecha no arregla un problema de capacidad). */}
      {enBusquedaPorcion && !tarjetas.length && (
        <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
          {resultadosBusquedaVisibles > 0 ? (
            <p className="text-sm text-gray-500">
              Tus filtros ocultaron los {resultadosBusquedaVisibles} resultado(s) de esta búsqueda. Quita un filtro para verlos de nuevo.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                {busquedaPorcion.diagnostico
                  ? busquedaPorcion.diagnostico
                  : "No hay hoteles que cumplan esa composición/fechas/filtros. Prueba otra acomodación, fechas o quita un filtro."}
              </p>
              {!!busquedaPorcion.sugerenciasFecha.length && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-500">Prueba estas fechas con tarifa</p>
                  <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                    {busquedaPorcion.sugerenciasFecha.map((s) => (
                      <button
                        key={s.fechaIda}
                        type="button"
                        onClick={() => setSugerenciaPedida({ ...s, nonce: (sugerenciaPedida?.nonce ?? 0) + 1 })}
                        className="rounded-full border border-gray-300 bg-transparent px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)]"
                      >
                        {s.etiqueta}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tarjetas.map((t) =>
          t.tipo === "busqueda" ? (
            // Fila persona ya liquidada por el motor para estas fechas y esta
            // ocupación — la MISMA lista que las tarjetas de exploración, en
            // modo búsqueda. El componente vive en `BuscadorBooking` porque es
            // el único que conoce el carrito por persona
            // (`HotelCartItemPersona`); acá solo se le da el lugar en la grilla.
            <Resultado
              key={t.key}
              r={t.r}
              recomendada={t.recomendada === true}
              foto={fotosPorHotel[t.r.hotelId] ?? null}
              info={infoPorHotel[t.r.hotelId]}
              descripcionPorPaquete={descripcionPorPaquete}
              addonsPorPaquete={addonsPorPaquete}
            />
          ) : t.tipo === "persona" ? (
            <TarjetaHotelCard
              key={t.key}
              onClick={() => abrirHotel(t.card)}
              foto={t.card.foto}
              hotelNombre={t.card.hotelNombre}
              destino={t.card.destino}
              estrellas={t.card.estrellas}
              clasificacion={t.card.clasificacion}
              adultsOnly={t.card.adultsOnly}
              petFriendly={t.card.petFriendly}
              tieneCondicion={t.card.tieneCondicion}
              descripcion={t.card.descripcion}
              desde={t.card.desde}
              moneda={t.card.moneda}
              badgeEsquina={(() => {
                // Cupos disponibles (solo para bloqueos con datos)
                const ids = [...new Set(t.card.filas.filter((f) => f.bloqueo_id != null).map((f) => f.bloqueo_id as number))];
                const vals = ids.map((id) => cuposPorBloqueo[id]).filter((c): c is number => c != null && c > 0);
                const min = vals.length ? Math.min(...vals) : null;
                return (
                  <>
                    {/* Etiqueta de OFERTA (hallazgo 2): el nombre del paquete
                        va SIEMPRE — recomendada o no — porque el mismo hotel
                        puede estar en dos paquetes (normal + 3x2) y cada
                        tarjeta debe leerse como una oferta distinta. La
                        recomendación solo cambia el prefijo y el color. */}
                    <EtiquetaOferta paqueteNombre={t.card.paqueteNombre} recomendada={t.recomendada === true} />
                    {min !== null && (
                      <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
                        {min} cupo{min !== 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                );
              })()}
            />
          ) : t.hotel.opcionesBusqueda ? (
            // Cierre de UX (ronda posterior): en modo búsqueda, un hotel
            // unidad se comporta EXACTAMENTE como uno persona — categoría,
            // alimentación, precio y "Agregar al carrito" directo, SIN abrir
            // modal ni repetir fechas/ocupación que el buscador ya tiene
            // (ver `TarjetaUnidadBusqueda`). Solo existe acá porque
            // `busquedaPorcion.unidad` ya viene filtrado a hoteles
            // CONFIRMADOS disponibles — nunca sin fundamento.
            <TarjetaUnidadBusqueda
              key={t.key}
              hotel={{ hotelId: t.hotel.hotelId, hotelNombre: t.hotel.hotelNombre, destino: t.hotel.destino }}
              opciones={t.hotel.opcionesBusqueda}
              recomendada={t.recomendada === true}
              foto={fotosPorHotel[t.hotel.hotelId] ?? null}
              videoUrl={infoPorHotel[t.hotel.hotelId]?.video_url ?? null}
              estrellas={infoPorHotel[t.hotel.hotelId]?.estrellas ?? null}
              clasificacion={infoPorHotel[t.hotel.hotelId]?.clasificacion ?? null}
              adultsOnly={infoPorHotel[t.hotel.hotelId]?.adultsOnly ?? false}
              petFriendly={infoPorHotel[t.hotel.hotelId]?.petFriendly ?? false}
              tieneCondicion={infoPorHotel[t.hotel.hotelId]?.tieneCondicion}
              descripcion={infoPorHotel[t.hotel.hotelId]?.descripcion ?? null}
              ubicacion={infoPorHotel[t.hotel.hotelId]?.ubicacion ?? null}
              descripcionPorPaquete={descripcionPorPaquete}
              addonsPorPaquete={addonsPorPaquete}
            />
          ) : (
            // P2 (hallazgo confirmado): hotel por unidad (Bernalo) EN
            // EXPLORACIÓN (sin `opcionesBusqueda` — acá todavía no hay
            // fechas/ocupación que reutilizar, así que sigue abriendo el
            // cotizador en vivo por modal) con la MISMA tarjeta que persona
            // — antes usaba "Sin foto" fijo y nunca leía estrellas/
            // descripción/Adults Only/Pet friendly reales, aunque el hotel
            // SÍ los tuviera configurados. Ahora lee `fotosPorHotel`/
            // `infoPorHotel` por `hotelId` — el mismo enriquecimiento que ya
            // recibe un hotel persona (ver `page.tsx`, que ahora también
            // consulta `hoteles`/`hotel_fotos` para los hotelId unidad). Sin
            // "desde $X" (el precio no está precargado — "Consultar" es el
            // mismo fallback que ya usa un hotel persona sin tarifa mínima
            // resuelta).
            <TarjetaHotelCard
              key={t.key}
              onClick={() => setModalBernalo(t.hotel)}
              foto={fotosPorHotel[t.hotel.hotelId] ?? null}
              hotelNombre={t.hotel.hotelNombre}
              destino={t.hotel.destino}
              estrellas={infoPorHotel[t.hotel.hotelId]?.estrellas ?? null}
              clasificacion={infoPorHotel[t.hotel.hotelId]?.clasificacion ?? null}
              adultsOnly={infoPorHotel[t.hotel.hotelId]?.adultsOnly ?? false}
              petFriendly={infoPorHotel[t.hotel.hotelId]?.petFriendly ?? false}
              tieneCondicion={infoPorHotel[t.hotel.hotelId]?.tieneCondicion}
              descripcion={infoPorHotel[t.hotel.hotelId]?.descripcion ?? null}
              desde={null}
              badgeEsquina={
                // Etiqueta de OFERTA (hallazgo 2) — mismo criterio que la
                // tarjeta persona: el nombre del paquete va SIEMPRE, para que
                // el mismo hotel unidad repetido en dos paquetes se lea como
                // dos ofertas distintas. `TarjetaHotelCard` ya envuelve el
                // badge en el contenedor relativo de la foto.
                <EtiquetaOferta paqueteNombre={t.hotel.paqueteNombre} recomendada={t.recomendada === true} />
              }
            />
          )
        )}
      </div>
      </>
      )}

      {abierto && (
        <HotelModal hotel={abierto} detalle={detalleHotel} onReintentar={() => abrirHotel(abierto)} cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo} puedeReservar={puedeReservar} ventanaPorPaquete={ventanaPorPaquete} planesInfo={planesInfo} cap={capPorHotel[abierto.hotelId] ?? CAP_VACIA} descripcionPorPaquete={descripcionPorPaquete} addonsPorPaquete={addonsPorPaquete} onClose={cerrarHotel} />
      )}

      {modalBernalo && (
        <HotelBernaloCotizarModal
          hotelGrupo={modalBernalo}
          foto={fotosPorHotel[modalBernalo.hotelId] ?? null}
          info={infoPorHotel[modalBernalo.hotelId]}
          descripcionPorPaquete={descripcionPorPaquete}
          addonsPorPaquete={addonsPorPaquete}
          onClose={() => setModalBernalo(null)}
        />
      )}

      {receptivoAbierto && (
        <ReceptivoModal receptivo={receptivoAbierto} onClose={() => setReceptivoAbierto(null)} />
      )}
    </div>
  );
}

// ── Modal de detalle: elige opción (salida/paquete), categoría/régimen y
//    habitaciones; calcula el precio y agrega al carrito ─────────────────────
function HotelModal({
  hotel, detalle, onReintentar, cuposPorBloqueo, origenPorBloqueo, puedeReservar, ventanaPorPaquete, planesInfo, cap, descripcionPorPaquete, addonsPorPaquete, onClose,
}: {
  hotel: HotelCard;
  // Detalle bajo demanda (Tier 2) — mientras no llegue en "ok", el modal ya
  // está ABIERTO (mismo diseño de siempre) pero sin opciones para elegir
  // todavía. Un error acá nunca toca la tarjeta/grilla de fuera.
  detalle: EstadoDetalle<FilaTarifario> | null;
  onReintentar: () => void;
  cuposPorBloqueo: Record<number, number>; origenPorBloqueo: Record<number, string>; puedeReservar: boolean;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>; addonsPorPaquete: Map<number, Receptivo[]>;
  onClose: () => void;
}) {
  const { add, openDrawer } = useCart();
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);

  const opciones = useMemo<Opcion[]>(() => {
    const filasDetalle = detalle?.estado === "ok" ? detalle.filas : [];
    const map = new Map<string, Opcion>();
    for (const f of filasDetalle) {
      // Bloqueo sin cupos → no se ofrece.
      if (f.modulo === "bloqueo" && f.bloqueo_id != null) {
        const c = cuposPorBloqueo[f.bloqueo_id];
        if (c !== undefined && c <= 0) continue;
      }
      const key = `${f.modulo}|${f.bloqueo_id ?? ""}|${f.paquete_id ?? ""}|${f.fecha_ida ?? ""}|${f.fecha_regreso ?? ""}`;
      let o = map.get(key);
      if (!o) {
        o = {
          key,
          modulo: f.modulo as "bloqueo" | "porcion_terrestre",
          paqueteId: f.paquete_id as number,
          bloqueoId: f.bloqueo_id ?? null,
          label: f.modulo === "bloqueo" ? (f.bloqueo_label ?? "Salida") : (f.paquete_nombre ?? "Paquete"),
          destino: f.destino_nombre,
          origen: f.modulo === "bloqueo" && f.bloqueo_id != null ? (origenPorBloqueo[f.bloqueo_id] ?? null) : null,
          cupos: f.modulo === "bloqueo" && f.bloqueo_id != null ? (cuposPorBloqueo[f.bloqueo_id] ?? null) : null,
          fechaIda: f.fecha_ida,
          fechaRegreso: f.fecha_regreso,
          noches: f.noches,
          filas: [],
        };
        map.set(key, o);
      }
      o.filas.push(f);
    }
    // De la salida más cercana a la más lejana; sin fecha, al final.
    return [...map.values()].sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99"));
  }, [detalle, cuposPorBloqueo, origenPorBloqueo]);

  // ⚠️ Estado asincrónico (revisión posterior, defecto "la primera opción no
  // se veía seleccionada"): `opciones` llega vacía en el primer render
  // (`detalle` todavía no resolvió) y se puebla asíncronamente cuando el
  // Tier 2 responde. Un `useState(opciones[0]?.key ?? "")` solo evalúa su
  // inicializador UNA vez — al llegar las opciones reales, `opKey` se
  // quedaba en `""` para siempre (nunca coincidía con ningún `o.key`), así
  // que la primera opción nunca se veía resaltada aunque `opcion` sí cayera
  // bien en ella por el `?? opciones[0]` de abajo. `opKeyEfectivo` se DERIVA
  // en cada render: si la clave elegida ya no existe en las opciones
  // actuales (llegaron opciones nuevas, o todavía no hay ninguna), cae a la
  // primera — sin depender de un efecto ni de cuándo se montó el componente.
  const [opKey, setOpKey] = useState("");
  const opKeyEfectivo = opciones.some((o) => o.key === opKey) ? opKey : (opciones[0]?.key ?? "");
  const opcion = opciones.find((o) => o.key === opKeyEfectivo);

  // Descripción manual del paquete (migración 169): incluye/no incluye/
  // tarifas especiales/condiciones comerciales — texto libre configurado UNA
  // sola vez en el paquete y compartido por TODOS sus hoteles/opciones (nunca
  // varía por `hotel`, a diferencia de la vieja línea "Hospedaje en <hotel>").
  // Renderizado con `SeccionesIncluye` (helper compartido).
  const descripcionOpcion = opcion ? descripcionPorPaquete[opcion.paqueteId] : undefined;
  // Servicios opcionales (add-on) de ESTE paquete puntual — nunca los de otro
  // destino (a diferencia de irse a la pestaña Receptivos general).
  const addons: Receptivo[] = opcion ? (addonsPorPaquete.get(opcion.paqueteId) ?? []) : [];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {hotel.video_url ? (
            <BackgroundVideo url={hotel.video_url} overlay={0} />
          ) : hotel.foto ? (
            <Image src={hotel.foto} alt={hotel.hotelNombre} fill sizes="640px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar ✕
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">{hotel.hotelNombre}</h2>
              <Categoria estrellas={hotel.estrellas} clasificacion={hotel.clasificacion} className="text-base" />
              <EtiquetasHotel adultsOnly={hotel.adultsOnly} petFriendly={hotel.petFriendly} />
            </div>
            <p className="text-sm text-gray-500">{hotel.destino ?? ""}</p>
            <DescripcionHotelExpandible texto={hotel.descripcion} />
          </div>

          <UbicacionHotel hotelNombre={hotel.hotelNombre} ubicacion={hotel.ubicacion} />

          {detalle === null || detalle.estado === "cargando" ? (
            <p className="py-4 text-center text-sm text-gray-400">Cargando opciones…</p>
          ) : detalle.estado === "error" ? (
            <div className="py-4 text-center">
              <p className="text-sm text-red-500">{detalle.mensaje}</p>
              <button type="button" onClick={onReintentar} className="mt-2 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
                Reintentar
              </button>
            </div>
          ) : !opcion ? (
            <p className="text-sm text-gray-400">Sin disponibilidad publicada.</p>
          ) : (
            <>
              {/* Opciones de salida / paquete */}
              {opciones.length > 1 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tu salida</p>
                  <div className="flex flex-wrap gap-2">
                    {opciones.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setOpKey(o.key)}
                        className="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        style={opKeyEfectivo === o.key
                          ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                          : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                      >
                        <span className="block font-medium text-gray-800">{o.label}</span>
                        {o.origen && <span className="block text-[11px] text-gray-500">Origen: {o.origen}{o.destino ? ` → ${o.destino}` : ""}</span>}
                        <span className="block text-xs text-gray-500">
                          {o.fechaIda ? `${fmtFecha(o.fechaIda)} → ${fmtFecha(o.fechaRegreso)}` : ""}{o.noches ? ` · ${o.noches}N` : ""}
                        </span>
                        {o.cupos != null && (
                          <span className="mt-0.5 block text-[11px] font-medium" style={{ color: o.cupos > 0 ? "var(--brand-success)" : "#C0392B" }}>
                            {o.cupos} cupo{o.cupos === 1 ? "" : "s"} disponible{o.cupos === 1 ? "" : "s"}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {opcion.modulo === "bloqueo" && opcion.cupos != null && (
                <p className="text-xs text-gray-500">
                  {opcion.origen ? <>Origen <b>{opcion.origen}</b>{opcion.destino ? <> → <b>{opcion.destino}</b></> : null} · </> : null}
                  <b style={{ color: opcion.cupos > 0 ? "var(--brand-success)" : "#C0392B" }}>{opcion.cupos} cupo{opcion.cupos === 1 ? "" : "s"} disponible{opcion.cupos === 1 ? "" : "s"}</b>
                </p>
              )}

              {/* Motor interno: selector de categoría/régimen/habitaciones y
                  cálculo del precio — antes de Incluye/add-on, justo después
                  de elegir la salida. */}
              {opcion.modulo === "porcion_terrestre" ? (
                <SelectorPorFechas
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  ventana={ventanaPorPaquete[opcion.paqueteId] ?? { min: null, max: null }}
                  planesInfo={planesInfo}
                  cap={cap}
                  onAgregar={(item) => {
                    add(item);
                    openDrawer();
                    onClose();
                  }}
                />
              ) : (
                <Selector
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  puedeReservar={puedeReservar}
                  planesInfo={planesInfo}
                  cap={cap}
                  onAgregar={(item) => {
                    add(item);
                    openDrawer();
                    onClose();
                  }}
                />
              )}

              {/* Descripción manual del paquete: encabezados fijos, un ítem de
                  lista por línea no vacía. Sección omitida por completo si no
                  tiene contenido (nunca un encabezado con lista vacía). */}
              <SeccionesIncluye descripcion={descripcionOpcion} />

              {/* Servicios opcionales (add-on) del MISMO paquete — nunca de otro destino */}
              <AddonsPaquete addons={addons} onAbrir={setAddonAbierto} paqueteId={opcion.paqueteId} />
            </>
          )}
        </div>
      </div>
    </div>
    {addonAbierto && (
      <ReceptivoModal receptivo={addonAbierto} onClose={() => setAddonAbierto(null)} />
    )}
    </>
  );
}

// ── Tarjeta unidad en MODO BÚSQUEDA: selectores + precio + "Agregar al
//    carrito" inline — sin modal, sin volver a pedir fechas/habitaciones/
//    adultos/edades (el buscador general ya las tiene). Para el usuario, un
//    hotel `modelo_tarifario = "unidad"` encontrado en la búsqueda se
//    comporta EXACTAMENTE como uno persona (`Resultado`, más arriba): la
//    diferencia tarifaria interna no lo convierte en otro tipo de producto
//    visual — mismo estilo, mismos controles, mismo botón.
//
// `opciones` viene de `busquedaPorcion.unidad` (ya sanada — ver
// `OpcionUnidadConfirmada`): SOLO combinaciones categoría×alimentación que
// REALMENTE pasaron `computarReservaBernalo`, ordenadas por precio ascendente
// (la primera es la preselección por defecto). Cambiar de categoría limita
// las alimentaciones a las válidas para esa categoría; si la alimentación
// elegida deja de ser válida, cae automáticamente a la primera que sí lo sea.
//
// "Agregar al carrito" NUNCA usa `opcionSel.precioVenta` como autoridad: por
// seguridad, revalida en servidor con la MISMA Server Action pública que ya
// usa el modal de exploración (`cotizarAlojamientoBernaloPublico`) antes de
// agregar — si la tarifa cambió o dejó de estar disponible, se muestra el
// mensaje real y la tarjeta se actualiza, nunca se agrega con un precio
// obsoleto. Esta revalidación es una llamada de servidor más, invisible para
// el usuario (estado de carga en el botón) — nunca una segunda pantalla de
// búsqueda ni un "Cotizar" aparte.
// Tarjeta completa (auditoría de alcance): recibe además `videoUrl`/
// `ubicacion` (mismo enriquecimiento por `hotelId` que ya usa `TarjetaHotelCard`/
// `HotelBernaloCotizarModal`, ver `infoPorHotel`) y `descripcionPorPaquete`/
// `addonsPorPaquete` — antes solo tenía foto/categoría/etiquetas/descripción,
// perdiendo ubicación/mapa e Incluye/No incluye/add-on aunque el resultado
// SÍ tenga un `paqueteId` inequívoco (`opcionSel.paqueteId`, la oferta
// confirmada por el combo categoría/alimentación elegido). Nunca fuente de
// precio/disponibilidad: eso sigue siendo EXCLUSIVO de `opcionSel.precioVenta`/
// `cotizarAlojamientoBernaloPublico` (revalidado en `agregar()`).
function TarjetaUnidadBusqueda({
  hotel, opciones, recomendada = false, foto, videoUrl, estrellas, clasificacion, adultsOnly, petFriendly, tieneCondicion, descripcion, ubicacion,
  descripcionPorPaquete, addonsPorPaquete,
}: {
  hotel: { hotelId: number; hotelNombre: string; destino: string | null };
  opciones: OpcionUnidadConfirmada[];
  /** ¿Esta oferta es una de las recomendadas del paquete coincidente? Solo
   * cambia la etiqueta de la tarjeta ("Recomendado · <paquete>" vs
   * "<paquete>") — nunca qué se muestra ni qué se cobra. */
  recomendada?: boolean;
  foto: string | null;
  videoUrl?: string | null;
  estrellas: number | null;
  clasificacion: string | null;
  adultsOnly: boolean;
  petFriendly: boolean;
  tieneCondicion?: boolean;
  descripcion?: string | null;
  ubicacion?: string | null;
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  addonsPorPaquete: Map<number, Receptivo[]>;
}) {
  const { items, add, remove, openDrawer } = useCart();
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);

  const categorias = useMemo(() => [...new Set(opciones.map((o) => o.categoria))], [opciones]);
  const [cat, setCat] = useState(opciones[0]?.categoria ?? "");
  const catEff = categorias.includes(cat) ? cat : (categorias[0] ?? "");
  const alimentaciones = useMemo(
    () => [...new Set(opciones.filter((o) => o.categoria === catEff).map((o) => o.alimentacion))],
    [opciones, catEff]
  );
  const [alim, setAlim] = useState(opciones[0]?.alimentacion ?? "");
  // La alimentación efectiva cae a la primera válida de la categoría actual
  // en cuanto la elegida deja de estarlo — nunca queda "colgada" de una
  // categoría anterior.
  const alimEff = alimentaciones.includes(alim) ? alim : (alimentaciones[0] ?? "");
  const opcionSel = opciones.find((o) => o.categoria === catEff && o.alimentacion === alimEff) ?? opciones[0];

  // Incluye/No incluye y add-ons son del PAQUETE de la oferta SELECCIONADA
  // (`opcionSel.paqueteId`) — nunca un paqueteId fijo. Dos ofertas del mismo
  // hotel pueden pertenecer a paquetes DISTINTOS (categorías/alimentaciones
  // repartidas entre varios `armado_hoteles`); cambiar de categoría/
  // alimentación puede cambiar de paqueteId, y este contenido debe cambiar
  // con él — nunca mezclar Incluye/add-on de una oferta con el precio de otra.
  const descripcionOpcion = descripcionPorPaquete[opcionSel.paqueteId];
  const addons: Receptivo[] = addonsPorPaquete.get(opcionSel.paqueteId) ?? [];

  // Precio EN VIVO local: nace del resultado ya calculado por el buscador
  // (`opcionSel.precioVenta`, ver el módulo puro) — cambiar de selector NUNCA
  // dispara una nueva búsqueda/consulta, solo relee `opciones`, que ya tiene
  // el precio de CADA combinación confirmada. Solo se actualiza si la
  // revalidación de "Agregar al carrito" trae un precio distinto (tarifa
  // cambiada entre la búsqueda y el clic) — nunca antes.
  const [precioActualizado, setPrecioActualizado] = useState<{ combo: string; precio: number; moneda: string } | null>(null);
  const claveCombo = `${opcionSel.paqueteId}|${opcionSel.categoria}|${opcionSel.alimentacion}`;
  const precioMostrado = precioActualizado?.combo === claveCombo ? precioActualizado.precio : opcionSel.precioVenta;
  const monedaMostrada = precioActualizado?.combo === claveCombo ? precioActualizado.moneda : opcionSel.moneda;

  const [agregando, setAgregando] = useState(false);
  const [errorAgregar, setErrorAgregar] = useState<string | null>(null);

  // Guarda contra setState tras desmontaje: una nueva búsqueda del mismo
  // hotel REMONTA esta tarjeta (la `key` incluye la búsqueda vigente — ver
  // `claveBusquedaUnidad`), así que una revalidación en vuelo puede resolver
  // cuando este componente ya no existe. Se marca en el cleanup y se revisa
  // antes de cualquier setState del callback asíncrono.
  const montadoRef = useRef(true);
  useEffect(() => () => { montadoRef.current = false; }, []);

  // `enCarrito` compara la identidad CANÓNICA COMPLETA de la reserva
  // (hotel + paquete + categoría + alimentación + salida/fechas + composición
  // de habitaciones: id/acomodación/adultos/edades) — no solo hotel+paquete+
  // categoría+alimentación. Así, una reserva del MISMO hotel para otras fechas
  // u ocupación NO se marca como agregada ni se elimina por error, y una
  // idéntica SÍ se encuentra. Ver `claveReservaUnidad`.
  const claveReserva = claveReservaUnidad({
    hotelId: opcionSel.hotelId,
    paqueteId: opcionSel.paqueteId,
    categoria: opcionSel.categoria,
    alimentacion: opcionSel.alimentacion,
    salida: { tipo: "sin_vuelo", fechaIda: opcionSel.fechaIda, fechaRegreso: opcionSel.fechaRegreso },
    habitaciones: opcionSel.ocupacion,
  });
  const enCarrito = items.find(
    (i) =>
      i.tipo === "hotel" &&
      i.modeloTarifario === "unidad" &&
      claveReservaUnidad({
        hotelId: i.hotelId,
        paqueteId: i.paqueteId,
        categoria: i.categoria,
        alimentacion: i.alimentacion,
        salida: i.salida,
        habitaciones: i.habitaciones,
      }) === claveReserva
  );

  async function agregar() {
    if (agregando) return; // nunca doble envío mientras revalida
    setErrorAgregar(null);
    setAgregando(true);
    const habitaciones: HabitacionOcupacionEntrada[] = opcionSel.ocupacion.map((h) => ({
      id: h.id, acom: h.acom, adultos: h.adultos, cantidadMenores: h.edadesMenores.length, edadesMenores: h.edadesMenores,
    }));
    const salida: SalidaSeleccionadaBernaloEntrada = { tipo: "sin_vuelo", fechaIda: opcionSel.fechaIda, fechaRegreso: opcionSel.fechaRegreso };
    // Revalidación OBLIGATORIA en servidor, con la Server Action pública que
    // YA existe (nunca se inventa una nueva): vuelve a validar pertenencia al
    // paquete, moneda y ventana de fechas, y recalcula el precio real en este
    // instante — el precio que mostraba la tarjeta nunca es autoridad.
    // `revalidarReservaUnidad` envuelve la llamada en try/catch y NUNCA lanza;
    // el `finally` de acá siempre libera `agregando` (aun ante excepción), y
    // el guard de montaje evita setState tras un remonte por nueva búsqueda.
    let rev: Awaited<ReturnType<typeof revalidarReservaUnidad>>;
    try {
      rev = await revalidarReservaUnidad(
        cotizarAlojamientoBernaloPublico,
        {
          paqueteId: opcionSel.paqueteId, hotelId: opcionSel.hotelId,
          categoria: opcionSel.categoria, alimentacion: opcionSel.alimentacion,
          salida, habitaciones,
        },
        opcionSel.precioVenta,
        opcionSel.moneda,
      );
    } finally {
      if (montadoRef.current) setAgregando(false);
    }
    if (!montadoRef.current) return;
    if (rev.estado !== "agregar") {
      // Rechazo del servidor (dejó de estar disponible) o error técnico —
      // mensaje REAL/entendible, NUNCA se agrega al carrito.
      setErrorAgregar(rev.mensaje);
      return;
    }
    if (rev.precioCambio) {
      // Cambió la tarifa entre la búsqueda y este clic — la tarjeta se
      // actualiza con el precio REAL revalidado; el carrito usa este mismo
      // precio, nunca el que mostraba antes.
      setPrecioActualizado({ combo: claveCombo, precio: rev.precio, moneda: rev.moneda });
    }
    add({
      tipo: "hotel",
      modeloTarifario: "unidad",
      paqueteId: opcionSel.paqueteId,
      hotelId: opcionSel.hotelId,
      hotelNombre: hotel.hotelNombre,
      destino: opcionSel.destinoNombre,
      fotoUrl: foto,
      categoria: opcionSel.categoria,
      alimentacion: opcionSel.alimentacion,
      salida,
      habitaciones,
      precio: rev.precio,
      moneda: rev.moneda,
      composicionHabitaciones: rev.composicionHabitaciones,
    });
    openDrawer();
  }

  const selCls = "rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs";

  return (
    <>
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="relative aspect-[16/10] w-full bg-gray-100">
        {videoUrl ? (
          <BackgroundVideo url={videoUrl} overlay={0} />
        ) : foto ? (
          <Image src={foto} alt={hotel.hotelNombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
        )}
        {/* Etiqueta de OFERTA (hallazgo 2) — el nombre del paquete va SIEMPRE,
            recomendada o no: `opcionesBusqueda` son solo las de ESTE paquete
            (la tarjeta es una oferta hotel+paquete), así que el nombre es
            cierto para toda la tarjeta. */}
        <EtiquetaOferta paqueteNombre={opcionSel.paqueteNombre} recomendada={recomendada} />
        <span
          className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: "var(--brand-success)" }}
        >
          Disponible para tus fechas
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-800">{hotel.hotelNombre}</span>
            <Categoria estrellas={estrellas} clasificacion={clasificacion} className="text-sm" />
            <EtiquetasHotel adultsOnly={adultsOnly} petFriendly={petFriendly} />
            {tieneCondicion !== undefined && <CondicionCompacta activo={tieneCondicion} />}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">{hotel.destino ?? ""}</div>
          <DescripcionHotelExpandible texto={descripcion} className="mt-1" textClassName="text-xs text-gray-400" />
        </div>

        <UbicacionHotel hotelNombre={hotel.hotelNombre} ubicacion={ubicacion} />

        <div className="grid grid-cols-1 gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Categoría</span>
            <select value={catEff} onChange={(e) => setCat(e.target.value)} className={`${selCls} flex-1`}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Alimentación</span>
            <select value={alimEff} onChange={(e) => setAlim(e.target.value)} className={`${selCls} flex-1`}>
              {alimentaciones.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>

        {errorAgregar && <p className="text-xs text-red-600">{errorAgregar}</p>}

        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">total {opcionSel.paxTotal} pax</div>
            <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(precioMostrado, monedaMostrada)}</div>
          </div>
          <button
            type="button"
            disabled={agregando}
            onClick={() => (enCarrito ? remove(enCarrito.id) : agregar())}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: enCarrito ? "var(--brand-success)" : "var(--brand-primary)" }}
          >
            {agregando ? "Confirmando…" : enCarrito ? "✓ En el carrito · quitar" : "Agregar al carrito"}
          </button>
        </div>

        {/* Incluye/No incluye y add-on de la OFERTA seleccionada — nunca
            fuente de precio/disponibilidad (eso sigue siendo exclusivo de
            opcionSel.precioVenta/cotizarAlojamientoBernaloPublico arriba). */}
        <SeccionesIncluye descripcion={descripcionOpcion} />
        <AddonsPaquete addons={addons} onAbrir={setAddonAbierto} paqueteId={opcionSel.paqueteId} />
      </div>
    </div>
    {addonAbierto && (
      <ReceptivoModal receptivo={addonAbierto} onClose={() => setAddonAbierto(null)} />
    )}
    </>
  );
}

// ── Fase 3E Bernalo — modal de cotización dinámica de un hotel descubierto
// (`hotelesBernalo`, ver `lib/tarifario/datosBernalo.ts`). A diferencia de
// `HotelModal` (hoteles "persona", con `tarifario_resultado` ya calculado),
// este modal no tiene ningún precio precargado — todo sale de `EditorPax`
// en modo Bernalo, que cotiza en vivo contra
// `cotizarAlojamientoBernaloPublico`. Sin "Agregar al carrito" (regla 19).
//
// P1-2 (hallazgo confirmado): recibe el GRUPO de ofertas del hotel (una por
// `paqueteId` en la que está vinculado) — nunca una sola oferta elegida de
// antemano. Si hay más de una, el usuario elige explícitamente ANTES de
// cotizar (mismo criterio fail-closed que la selección de salida dentro de
// `EditorPax`: nunca "toma la primera" en silencio); si hay solo una, no se
// añade ningún selector (nada que elegir). La oferta seleccionada es la
// ÚNICA fuente de `paqueteId`/categorías/alimentaciones/salidas que ve
// `EditorPax` — cotizar y agregar al carrito usan SIEMPRE el `paqueteId` de
// la oferta elegida.
// Contenido comercial de la tarjeta completa (foto/video, categoría,
// etiquetas Adults Only/Pet friendly, badge de condición, descripción,
// ubicación) para el mismo hotel FÍSICO que ya recibe `TarjetaHotelCard` y
// `HotelModal` (`fotosPorHotel`/`infoPorHotel`, por `hotelId`) — antes este
// modal solo recibía `hotelGrupo`/`onClose` y perdía todo esto, dejando una
// tarjeta genérica sin foto ni descripción mientras el motor interno sí la
// mostraba completa. Precio y disponibilidad siguen siendo EXCLUSIVAMENTE de
// `EditorPax`/`cotizarAlojamientoBernaloPublico` — estos props son solo
// contenido informativo, nunca una fuente alternativa de tarifa.
function HotelBernaloCotizarModal({
  hotelGrupo, foto, info, descripcionPorPaquete, addonsPorPaquete, onClose,
}: {
  hotelGrupo: HotelUnidadCard;
  foto: string | null;
  info?: { estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null; video_url?: string | null; adultsOnly?: boolean; petFriendly?: boolean; tieneCondicion?: boolean };
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  addonsPorPaquete: Map<number, Receptivo[]>;
  onClose: () => void;
}) {
  const { ofertas } = hotelGrupo;
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);
  // Identidad ESTABLE de la oferta elegida: `paqueteId`, nunca un índice de
  // arreglo — dos ofertas pueden compartir nombre de paquete (o incluso
  // rehacerse el orden si `hotelesBernalo` se recarga), pero `paqueteId` es
  // único por definición (`armado_hoteles` tiene una fila por (paquete_id,
  // hotel_id)).
  const [paqueteIdSel, setPaqueteIdSel] = useState<number | null>(ofertas.length === 1 ? ofertas[0].paqueteId : null);
  const ofertaSel = paqueteIdSel != null ? (ofertas.find((o) => o.paqueteId === paqueteIdSel) ?? null) : null;
  const hotel = ofertaSel;

  // B1.18: categorías/alimentación vacías = el hotel no es cotizable — mensaje
  // genérico de configuración incompleta, nunca texto libre ni un editor que
  // deje adivinar la clasificación.
  const configuracionIncompleta = !!hotel && (hotel.categorias.length === 0 || hotel.regimenes.length === 0);
  const { add, openDrawer } = useCart();

  // Incluye/No incluye y add-ons son del PAQUETE (`armado_paquetes.id` real,
  // igual identidad que usa `HotelModal`), no del hotel en abstracto — solo
  // se conocen una vez que hay una oferta elegida (`hotel`). Renderizado con
  // `SeccionesIncluye`/`AddonsPaquete` (helpers compartidos).
  const descripcionOferta = hotel ? descripcionPorPaquete[hotel.paqueteId] : undefined;
  const addons: Receptivo[] = hotel ? (addonsPorPaquete.get(hotel.paqueteId) ?? []) : [];

  // Fase 3F-4A: EditorPax ya cotizó en vivo (resultadoCotizacion.ok) y reporta
  // SOLO las decisiones + el PVP/moneda que mostró — la identidad del
  // hotel/paquete la completa este modal (ya la conoce de `hotel`, la
  // oferta elegida). Nunca se agrega neto/costos/comisión/snapshot al
  // carrito (regla A.5).
  function agregarBernalo(item: {
    categoria: string; alimentacion: string; salida: SalidaSeleccionadaBernaloEntrada;
    habitaciones: HabitacionOcupacionEntrada[]; precio: number; moneda: string;
    composicionHabitaciones: { habitacionId: string; adultos: number; ninos: number; infantes: number }[];
  }) {
    if (!hotel) return;
    add({
      tipo: "hotel",
      modeloTarifario: "unidad",
      paqueteId: hotel.paqueteId,
      hotelId: hotel.hotelId,
      hotelNombre: hotel.hotelNombre,
      destino: hotel.destinoNombre,
      fotoUrl: null,
      categoria: item.categoria,
      alimentacion: item.alimentacion,
      salida: item.salida,
      habitaciones: item.habitaciones,
      precio: item.precio,
      moneda: item.moneda,
      composicionHabitaciones: item.composicionHabitaciones,
    });
    openDrawer();
    onClose();
  }
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Identidad y contenido comercial del hotel FÍSICO — mismo bloque
            que `HotelModal` (foto/video, categoría, Adults Only/Pet friendly,
            descripción, ubicación); nunca fuente de precio/disponibilidad. */}
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {info?.video_url ? (
            <BackgroundVideo url={info.video_url} overlay={0} />
          ) : foto ? (
            <Image src={foto} alt={hotelGrupo.hotelNombre} fill sizes="640px" className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">Sin foto</div>
          )}
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-700 shadow">
            Cerrar ✕
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">{hotelGrupo.hotelNombre}</h2>
              <Categoria estrellas={info?.estrellas ?? null} clasificacion={info?.clasificacion ?? null} className="text-base" />
              <EtiquetasHotel adultsOnly={info?.adultsOnly ?? false} petFriendly={info?.petFriendly ?? false} />
              {info?.tieneCondicion !== undefined && <CondicionCompacta activo={info.tieneCondicion} />}
            </div>
            <p className="text-sm text-gray-500">{(hotel ?? ofertas[0])?.destinoNombre ?? ""}</p>
            <DescripcionHotelExpandible texto={info?.descripcion} />
          </div>

          <UbicacionHotel hotelNombre={hotelGrupo.hotelNombre} ubicacion={info?.ubicacion} />

          {ofertas.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige la oferta</p>
              <div className="flex flex-wrap gap-2">
                {ofertas.map((o) => (
                  <button
                    key={o.paqueteId}
                    type="button"
                    onClick={() => setPaqueteIdSel(o.paqueteId)}
                    className="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                    style={paqueteIdSel === o.paqueteId
                      ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                      : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                  >
                    <span className="block font-medium text-gray-800">{o.paqueteNombre}</span>
                    <span className="block text-[11px] text-gray-500">{o.destinoNombre ?? ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!hotel ? (
            <p className="py-4 text-center text-sm text-gray-400">Elige una oferta para continuar.</p>
          ) : configuracionIncompleta ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Este hotel todavía no tiene su configuración completa (categorías/alimentación) —
              no está disponible para cotizar en línea. Contacta a un asesor.
            </p>
          ) : (
            <EditorPax
              // `key` fuerza un componente NUEVO al cambiar de oferta — nunca
              // arrastra habitaciones/edades/categoría/resultado de cotización
              // de la oferta anterior (paquete distinto = cotización distinta).
              key={hotel.paqueteId}
              pvp={{}}
              moneda={hotel.moneda}
              modeloTarifario="unidad"
              hotelId={hotel.hotelId}
              paqueteId={hotel.paqueteId}
              categoriasDisponibles={hotel.categorias}
              alimentacionesDisponibles={hotel.regimenes}
              salidas={hotel.salidas}
              onAgregar={() => {}}
              onAgregarBernalo={agregarBernalo}
            />
          )}

          {/* Descripción manual del paquete: mismo criterio que `HotelModal`
              (encabezados fijos, un ítem por línea no vacía, sección omitida
              por completo si no tiene contenido) — depende de la oferta
              elegida, nunca de precio/disponibilidad. */}
          <SeccionesIncluye descripcion={descripcionOferta} />

          {/* Servicios opcionales (add-on) del MISMO paquete — nunca de otro
              destino; solo vista de información (mismo `ReceptivoModal` que
              `HotelModal`, sin agregar directo al carrito desde acá). */}
          <AddonsPaquete addons={addons} onAbrir={setAddonAbierto} paqueteId={hotel?.paqueteId ?? null} />
        </div>
      </div>
    </div>
    {addonAbierto && (
      <ReceptivoModal receptivo={addonAbierto} onClose={() => setAddonAbierto(null)} />
    )}
    </>
  );
}

function Selector({
  opcion, hotel, puedeReservar, planesInfo, cap, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; puedeReservar: boolean; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  onAgregar: (item: Omit<HotelCartItemPersona, "id">) => void;
}) {
  const cats = useMemo(() => [...new Set(opcion.filas.map((f) => f.categoria).filter((x): x is string => !!x))], [opcion]);
  const [cat, setCat] = useState(cats[0] ?? "");
  // catEff/regEff: valor efectivo válido aunque el seleccionado quede obsoleto.
  const catEff = cats.includes(cat) ? cat : (cats[0] ?? "");
  const regs = useMemo(
    () => [...new Set(opcion.filas.filter((f) => f.categoria === catEff).map((f) => f.regimen).filter((x): x is string => !!x))],
    [opcion, catEff]
  );
  const [reg, setReg] = useState(regs[0] ?? "");
  const regEff = regs.includes(reg) ? reg : (regs[0] ?? "");

  // Mapa de PVP por acomodación para la (categoría, régimen) elegidas.
  const pvp = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of opcion.filas) {
      if (f.categoria === catEff && f.regimen === regEff && f.acomodacion) m[f.acomodacion] = f.precio_pvp;
    }
    return m;
  }, [opcion, catEff, regEff]);

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) =>
    onAgregar({
      tipo: "hotel",
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: opcion.bloqueoId,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: opcion.fechaIda, fechaRegreso: opcion.fechaRegreso, noches: opcion.noches,
      habitaciones, ninos, ninos2, infantes, pax, precio, edadesMenores,
    });

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
          <select value={catEff} onChange={(e) => setCat(e.target.value)} className={selCls}>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Alimentación</label>
          <select value={regEff} onChange={(e) => setReg(e.target.value)} className={selCls}>
            {regs.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {regEff && (
            <div className="mt-1">
              <RegimenInfo codigo={regEff} info={planesInfo[regEff.trim().toUpperCase()]} variant="link" className="text-xs" />
            </div>
          )}
        </div>
      </div>

      <EditorPax pvp={pvp} acomConfig={cap.acom} paxMin={cap.paxMin} paxMax={cap.paxMax} moneda={hotel.moneda} edadesNota={textoEdadesHotel(hotel)} edadInfanteMax={hotel.infMax} edadNinoMax={hotel.ninoMax} nota={!puedeReservar ? "El valor es una estimación con tarifas publicadas; el precio final se confirma al generar la cotización." : undefined} onAgregar={agregarItem} />
    </div>
  );
}

// Editor de habitaciones/menores + total + botón. Recibe el PVP por acomodación y
// reporta la selección (no conoce fechas ni módulo). Reutilizado por bloqueo y porción.
// La edad de cada menor se pide EXACTA (nunca fecha de nacimiento — esa se
// diligencia después, en el listado real de pasajeros del contrato) y decide
// sola, contra las reglas reales del hotel, si liquida como infante, Niño 1 o
// Niño 2 (ver lib/reservar/edadesMenores.ts) — nunca un conteo manual por tarifa.
function EditorPax({
  pvp, acomConfig = [], paxMin = null, paxMax = null, nota, edadesNota,
  edadInfanteMax, edadNinoMax, onAgregar, onAgregarBernalo, btnLabel = "Agregar al carrito", moneda = "COP",
  modeloTarifario = null, hotelId, paqueteId, categoriasDisponibles = [], alimentacionesDisponibles = [], salidas = [],
}: {
  pvp: Record<string, number>;
  acomConfig?: AcomConfig[];
  paxMin?: number | null;
  paxMax?: number | null;
  nota?: string;
  edadesNota?: string | null;
  edadInfanteMax?: number | null;
  edadNinoMax?: number | null;
  onAgregar: (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) => void;
  // Fase 3F-4A: SOLO se usa cuando `modeloTarifario === "unidad"` — forma
  // completamente distinta a `onAgregar` (persona) porque Bernalo no tiene
  // conteos por acomodación ni niños/infantes agregados, sino habitaciones
  // físicas con sus propias edades (regla A.2 del encargo). Se dispara
  // únicamente tras una cotización exitosa (`resultadoCotizacion.ok`).
  onAgregarBernalo?: (item: {
    categoria: string; alimentacion: string; salida: SalidaSeleccionadaBernaloEntrada;
    habitaciones: HabitacionOcupacionEntrada[]; precio: number; moneda: string;
    composicionHabitaciones: { habitacionId: string; adultos: number; ninos: number; infantes: number }[];
  }) => void;
  btnLabel?: string;
  moneda?: string | null;
  // Fase 3D/3E Bernalo: cuando llega "unidad", esta habitación se captura
  // por HABITACIÓN FÍSICA (edades propias por habitación) y se cotiza en
  // vivo contra el servidor — en vez del flujo legado (cantidad total +
  // arreglo plano + `pvp` ya calculado). `null`/ausente = comportamiento
  // EXACTO de siempre (regla 9 del encargo: hoteles "persona" sin cambios).
  modeloTarifario?: string | null;
  // Identidad REAL — obligatorios cuando `modeloTarifario === "unidad"`
  // (nunca placeholders, regla 9 de Fase 3E): sin ellos no se puede llamar
  // `cotizarAlojamientoBernaloPublico`, que re-valida pertenencia al
  // paquete server-side.
  hotelId?: number;
  paqueteId?: number;
  // Categoría/alimentación REALES habilitadas para este hotel en este
  // paquete (`armado_hoteles.categorias`/`regimenes`) — nunca un valor
  // normalizado inventado como "estandar" cuando el real es "Estándar".
  categoriasDisponibles?: string[];
  alimentacionesDisponibles?: string[];
  // A1: salidas aéreas REALES del paquete (`lib/tarifario/datosBernalo.ts`) —
  // vacío = porción terrestre (fechas libres, validadas por el servidor
  // contra la ventana del paquete); una = se autoselecciona; varias = la UI
  // exige elegir explícitamente. Nunca se "toma la primera" en silencio.
  salidas?: SalidaAereaBernalo[];
}) {
  const idBase = useId();
  const esBernalo = modeloTarifario === "unidad";
  // Este editor solo se monta desde el modal de EXPLORACIÓN ahora (el modo
  // búsqueda dejó de abrir modal — ver `TarjetaUnidadBusqueda`): nunca hay
  // fechas/ocupación previas que precargar, arranca siempre en blanco.
  const [habs, setHabs] = useState<Record<string, number>>({});
  const [cantidadMenores, setCantidadMenoresState] = useState(0);
  const [edadesTxt, setEdadesTxt] = useState<string[]>([]);
  // Fase 3D — estado canónico SOLO para Bernalo: una entrada por habitación
  // FÍSICA (id estable), nunca un conteo aparte (regla 14: single source —
  // ver `lib/reservar/ocupacionPorHabitacion.ts`).
  const [edadesPorHabitacion, setEdadesPorHabitacion] = useState<EdadesPorHabitacion>({});
  // Fase 3E — clasificación y fechas REALES elegidas para esta cotización
  // (nunca placeholders): categoría/alimentación salen de las opciones
  // realmente vinculadas al hotel/paquete (`categoriasDisponibles`/
  // `alimentacionesDisponibles`); las fechas las escribe el usuario, dentro
  // de la ventana que el servidor vuelve a validar.
  const [categoriaSel, setCategoriaSel] = useState("");
  const [alimentacionSel, setAlimentacionSel] = useState("");
  const [fechaIdaBernalo, setFechaIdaBernalo] = useState("");
  const [fechaRegresoBernalo, setFechaRegresoBernalo] = useState("");
  // A1: identidad de la salida elegida cuando hay MÁS de una — clave
  // `"tipo:id"`; vacío hasta que el usuario elige explícitamente (nunca se
  // autocompleta con la primera).
  const [salidaElegidaKey, setSalidaElegidaKey] = useState("");
  const [resultadoCotizacion, setResultadoCotizacion] = useState<ResultadoCotizarAlojamientoBernaloPublico | null>(null);
  const [validando, setValidando] = useState(false);

  // Fase 3E: independiente de `pvp` (que en Bernalo no existe todavía —
  // el precio sale de cotizar, no de una tabla precalculada) — cuántas
  // habitaciones se eligieron, sin importar ninguna tarifa por columna.
  const totalHabBernalo = ACOM_ROOMS.reduce((s, a) => s + (habs[a] ?? 0), 0);
  const hayHabBernalo = totalHabBernalo > 0;

  const setHab = (a: AcomRoom, n: number) => {
    const next = { ...habs, [a]: Math.max(0, n) };
    setHabs(next);
    // Regla 5: cambiar la distribución NUNCA reasigna una edad ya escrita a
    // otra habitación — solo limpia las de las habitaciones que ya no
    // existen (mismo id ⇒ misma habitación, siempre).
    if (esBernalo) {
      setEdadesPorHabitacion((ep) => sincronizarHabitaciones(ep, idsHabitacionesPorConteo(next)));
      setResultadoCotizacion(null);
    }
  };

  // Al cambiar la cantidad: agrega campos vacíos al final o quita solo los
  // sobrantes del final — las edades ya escritas nunca se reordenan/pierden.
  function setCantidadMenores(nRaw: number) {
    setCantidadMenoresState(Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nRaw) || 0)));
    setEdadesTxt((prev) => ajustarCantidadEdades(prev, nRaw));
  }
  const setEdadAt = (i: number, v: string) => setEdadesTxt((prev) => prev.map((x, idx) => (idx === i ? v : x)));

  // Config de cada acomodación (la del hotel o el default si no está configurada).
  const cfg = (a: AcomRoom): AcomConfig => acomConfig.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);

  // Adultos (por pax_tarifa) y CAPACIDADES según las habitaciones elegidas.
  let adultosPrecio = 0;
  let adultos = 0;
  let capPax = 0;   // máx personas que admiten las habitaciones elegidas
  let capChd = 0;   // máx niños
  let capInf = 0;   // máx infantes
  for (const a of ACOM_ROOMS) {
    const rooms = habs[a] ?? 0;
    if (rooms > 0 && pvp[a] != null) {
      const c = cfg(a);
      adultos += rooms * c.pax_tarifa;
      adultosPrecio += rooms * c.pax_tarifa * pvp[a];
      capPax += rooms * c.pax_max;
      capChd += rooms * c.chd_max;
      capInf += rooms * c.inf_max;
    }
  }
  const hayHab = adultos > 0;

  // Umbrales reales del hotel (mismo default que el motor de reservas —
  // computo.ts — cuando el hotel no los configuró: 2 años infante, 10 niño).
  const infanteMax = edadInfanteMax ?? 2;
  const ninoMax = edadNinoMax ?? 10;

  const edadesParsed = edadesTxt.map(parseEdadMenor);
  const edadesValidas = edadesParsed.every((p) => p.error == null);
  const edadesFaltantes = edadesParsed.filter((p) => p.valor == null).length;
  const edades = edadesParsed.map((p) => p.valor).filter((v): v is number => v != null);

  // Clasifica primero por edad (infante/niño, contra el umbral real del
  // hotel) y luego reparte Niño 1/Niño 2 POR HABITACIÓN — cada habitación
  // admite máximo un Niño 1 y un Niño 2 (nunca un límite de 2 en toda la
  // reserva); con varias habitaciones caben más niños. Ver
  // lib/reservar/distribucionHabitaciones.ts.
  let clasifError: string | null = null;
  let ninos = 0, ninos2 = 0, infantes = 0;
  if (cantidadMenores > 0 && edadesValidas) {
    const rClas = clasificarMenoresPorEdad(edades, infanteMax, ninoMax);
    if (!rClas.ok) {
      clasifError = rClas.error;
    } else {
      const habitacionesConsultadas: HabitacionConsultada[] = [];
      for (const a of ACOM_ROOMS) {
        const rooms = habs[a] ?? 0;
        if (rooms > 0 && pvp[a] != null) {
          const c = cfg(a);
          for (let i = 0; i < rooms; i++) habitacionesConsultadas.push({ acom: a, config: c });
        }
      }
      const rDist = distribuirPorHabitaciones({
        adultosDeclarados: adultos, // ya = suma de pax_tarifa de las habitaciones elegidas
        ninos: rClas.c.ninos,
        infantes: rClas.c.infantes,
        habitaciones: habitacionesConsultadas,
      });
      if (!rDist.ok) {
        clasifError = rDist.error;
      } else {
        const totalesM = { infantes: rDist.totales.infantes, nino: rDist.totales.nino, nino2: rDist.totales.nino2 };
        const errTarifa = verificarTarifasMenoresDisponibles(totalesM, { nino: pvp["nino"] != null, nino2: pvp["nino2"] != null });
        if (errTarifa) clasifError = errTarifa;
        else ({ nino: ninos, nino2: ninos2, infantes } = totalesM);
      }
    }
  }

  let precio = adultosPrecio;
  if (ninos > 0 && pvp["nino"] != null) precio += ninos * pvp["nino"];
  if (ninos2 > 0 && pvp["nino2"] != null) precio += ninos2 * pvp["nino2"];
  const ninosTotal = ninos + ninos2;
  const pax = adultos + ninosTotal;

  // Topes efectivos (capacidad de habitaciones + límites del hotel).
  const maxPax = paxMax != null ? Math.min(capPax, paxMax) : capPax;

  const totalHab = ACOM_ROOMS.reduce((s, a) => s + (habs[a] ?? 0), 0);
  const muestraMenores = hayHab && (capChd > 0 || capInf > 0);

  const errores: string[] = [];
  if (totalHab > 8) errores.push("A partir de 9 habitaciones, contacta a un asesor.");
  if (hayHab) {
    if (ninosTotal > capChd) errores.push(`Las habitaciones elegidas admiten máximo ${capChd} niño(s).`);
    if (infantes > capInf) errores.push(`Las habitaciones elegidas admiten máximo ${capInf} infante(s).`);
    if (pax > maxPax) errores.push(`Las habitaciones elegidas admiten máximo ${maxPax} persona(s).`);
    if (paxMin != null && pax < paxMin) errores.push(`Este hotel exige un mínimo de ${paxMin} persona(s).`);
  }
  const menoresListos = cantidadMenores === 0 || (edadesValidas && !clasifError);
  const puede = adultosPrecio > 0 && errores.length === 0 && menoresListos;

  function agregar() {
    if (!puede) return;
    const habitaciones: Record<string, number> = {};
    for (const a of ACOM_ROOMS) if ((habs[a] ?? 0) > 0) habitaciones[a] = habs[a];
    onAgregar(habitaciones, ninos, ninos2, infantes, pax, precio, edades);
  }

  const inputCls = "w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
  const inputEdadCls = "w-14 rounded-lg border px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]";

  // ── Fase 3D/3E Bernalo — captura por habitación física + cotización real ─
  // Todo lo de abajo solo se usa cuando `esBernalo`; para hoteles "persona"
  // no se evalúa (habitacionesUI queda vacío) y el bloque JSX de siempre
  // (más abajo) no cambia una sola línea.
  const habitacionesUI = esBernalo ? construirHabitacionesUI(habs) : [];
  const paxTarifaPorTipo: Record<string, number> = {};
  if (esBernalo) for (const a of ACOM_ROOMS) paxTarifaPorTipo[a] = cfg(a).pax_tarifa;
  const payloadBernalo = esBernalo ? construirPayloadHabitaciones(habs, paxTarifaPorTipo, edadesPorHabitacion) : [];
  // Preview EN VIVO con la MISMA función que re-corre el servidor (regla 8:
  // "la UI no es autoridad" — esto es solo feedback inmediato, nunca la
  // validación que de verdad autoriza nada).
  const previewBernalo = esBernalo && habitacionesUI.length > 0 ? validarHabitacionesOcupacion(payloadBernalo) : null;
  const erroresPorHabitacion = new Map<string, string[]>();
  if (previewBernalo && !previewBernalo.ok) {
    for (const e of previewBernalo.errores) {
      if (!e.habitacionId) continue;
      const arr = erroresPorHabitacion.get(e.habitacionId) ?? [];
      arr.push(e.mensaje);
      erroresPorHabitacion.set(e.habitacionId, arr);
    }
  }

  function cambiarCantidadMenoresHab(habId: string, n: number) {
    setEdadesPorHabitacion((ep) => ajustarCantidadEdadesHabitacion(ep, habId, n));
    setResultadoCotizacion(null);
  }
  function cambiarEdadHab(habId: string, i: number, v: string) {
    setEdadesPorHabitacion((ep) => establecerEdad(ep, habId, i, v));
    setResultadoCotizacion(null);
  }

  // A1: identidad discriminada de la salida elegida — nunca `[0]`. Con una
  // sola salida real se autoselecciona (regla A1.2); con varias, EXIGE que
  // el usuario elija una explícitamente (regla A1.3 — `salidaElegidaKey`
  // queda vacío hasta que el usuario hace clic, así que
  // `salidaElegidaKeyEfectiva` no cae en ninguna por defecto); sin ninguna
  // salida real, el paquete es porción terrestre y se cotiza con las fechas
  // escritas a mano.
  const salidaElegidaKeyEfectiva = salidas.length === 1
    ? `${salidas[0].tipo}:${salidas[0].id}`
    : (salidas.some((s) => `${s.tipo}:${s.id}` === salidaElegidaKey) ? salidaElegidaKey : "");
  const salidaElegida = salidas.find((s) => `${s.tipo}:${s.id}` === salidaElegidaKeyEfectiva) ?? null;

  const salidaPayload: SalidaSeleccionadaBernaloEntrada | null =
    salidas.length > 0
      ? (salidaElegida ? { tipo: salidaElegida.tipo, id: salidaElegida.id } : null)
      : (fechaIdaBernalo && fechaRegresoBernalo ? { tipo: "sin_vuelo", fechaIda: fechaIdaBernalo, fechaRegreso: fechaRegresoBernalo } : null);

  const bernaloListoParaCotizar =
    hayHabBernalo && !!hotelId && !!paqueteId && !!categoriaSel && !!alimentacionSel && !!salidaPayload;

  // Regla A.1: SOLO se habilita después de una cotización Bernalo exitosa.
  // `resultadoCotizacion` ya se limpia (null) ante cualquier cambio de
  // salida/clasificación/ocupación (ver setHab/cambiarCantidadMenoresHab/
  // cambiarEdadHab/los onChange de categoría-alimentación-salida más abajo),
  // así que este botón se deshabilita solo con recotizar pendiente —
  // ninguna lógica de invalidación nueva hace falta acá.
  function agregarBernaloClick() {
    if (!onAgregarBernalo || !resultadoCotizacion?.ok || !salidaPayload) return;
    onAgregarBernalo({
      categoria: categoriaSel, alimentacion: alimentacionSel, salida: salidaPayload,
      habitaciones: payloadBernalo, precio: resultadoCotizacion.pvp, moneda: resultadoCotizacion.moneda,
      composicionHabitaciones: resultadoCotizacion.composicionHabitaciones,
    });
  }

  async function cotizarBernalo() {
    if (validando || !bernaloListoParaCotizar || !hotelId || !paqueteId || !salidaPayload) return;
    setValidando(true);
    setResultadoCotizacion(null);
    try {
      // El servidor vuelve a validar TODO (ocupación, pertenencia al
      // paquete, categoría/alimentación, salida real, ventana de fechas) —
      // nunca se confía en `previewBernalo` ni en nada calculado en el
      // navegador (reglas 2-3 de Fase 3E). La salida viaja como identidad
      // {tipo,id} (o "sin_vuelo" + fechas) — nunca un índice `[0]`.
      const r = await cotizarAlojamientoBernaloPublico({
        paqueteId, hotelId, categoria: categoriaSel, alimentacion: alimentacionSel,
        salida: salidaPayload,
        habitaciones: payloadBernalo,
      });
      setResultadoCotizacion(r);
    } finally {
      setValidando(false);
    }
  }

  return (
    <>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Habitaciones</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACOM_ROOMS.map((a) => {
            // Bernalo no tiene un PVP por columna precalculado (regla del
            // encargo: el precio sale de cotizar, no de una tabla) — todas
            // las acomodaciones quedan habilitadas; el servidor es quien
            // dice si esa categoría/habitación tiene tarifa publicada.
            const habilitada = esBernalo || pvp[a] != null;
            return (
              <div key={a} className={`rounded-lg border p-2 ${habilitada ? "" : "opacity-40"}`}>
                <div className="text-xs font-medium text-gray-700">{ACOM_ROOM_LABEL[a]}</div>
                <div className="text-[11px] text-gray-400">
                  {esBernalo ? "" : (pvp[a] != null ? `${formatMoneda(pvp[a], moneda)}/pers` : "No aplica")}
                </div>
                <input type="number" min={0} value={habs[a] ?? 0} disabled={!habilitada}
                  onChange={(e) => setHab(a, Number(e.target.value))} className={`${inputCls} mt-1`} />
              </div>
            );
          })}
        </div>
      </div>

      {esBernalo ? (
        // ── Fase 3D/3E: una fila compacta por habitación FÍSICA, cada una
        // con sus propias edades, más la clasificación/fechas REALES de
        // esta cotización — nunca un total + arreglo plano para toda la
        // solicitud, nunca un placeholder. Mismo contenedor/clases que el
        // resto del componente (sin tarjetas anidadas ni rediseño).
        hayHabBernalo && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={`${idBase}-categoria`} className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
                {/* B1: SOLO opciones reales vinculadas al hotel/paquete —
                    nunca texto libre. El gate de "configuración incompleta"
                    vive en HotelBernaloCotizarModal (no monta este editor si
                    no hay categorías/regímenes); por defensa en profundidad
                    el select queda deshabilitado y sin opciones en vez de
                    caer a un input de texto. */}
                <select id={`${idBase}-categoria`} value={categoriaSel} disabled={!categoriasDisponibles.length}
                  onChange={(e) => { setCategoriaSel(e.target.value); setResultadoCotizacion(null); }}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Elige…</option>
                  {categoriasDisponibles.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${idBase}-alimentacion`} className="mb-1 block text-xs font-medium text-gray-600">Alimentación</label>
                <select id={`${idBase}-alimentacion`} value={alimentacionSel} disabled={!alimentacionesDisponibles.length}
                  onChange={(e) => { setAlimentacionSel(e.target.value); setResultadoCotizacion(null); }}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Elige…</option>
                  {alimentacionesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {salidas.length === 0 ? (
                // A1.6: sin salidas reales configuradas → porción terrestre;
                // las fechas SÍ las escribe el usuario, y el servidor las
                // vuelve a validar contra la ventana de viaje del paquete.
                <>
                  <div>
                    <label htmlFor={`${idBase}-fecha-ida`} className="mb-1 block text-xs font-medium text-gray-600">Entrada</label>
                    <input id={`${idBase}-fecha-ida`} type="date" value={fechaIdaBernalo}
                      onChange={(e) => { setFechaIdaBernalo(e.target.value); setResultadoCotizacion(null); }}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label htmlFor={`${idBase}-fecha-regreso`} className="mb-1 block text-xs font-medium text-gray-600">Salida</label>
                    <input id={`${idBase}-fecha-regreso`} type="date" value={fechaRegresoBernalo}
                      onChange={(e) => { setFechaRegresoBernalo(e.target.value); setResultadoCotizacion(null); }}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                </>
              ) : salidas.length === 1 ? (
                // A1.2: una sola salida real — se autoselecciona; solo se
                // muestra como información (fechas AUTORITATIVAS de esa
                // salida, nunca editables aquí).
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-600">Salida</span>
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-700">
                    {salidas[0].etiqueta ? `${salidas[0].etiqueta} · ` : ""}{fmtFecha(salidas[0].fechaIda)} → {fmtFecha(salidas[0].fechaRegreso)}
                  </p>
                </div>
              ) : null}
            </div>
            {salidas.length > 1 && (
              // A1.3: varias salidas reales — la UI EXIGE una elección
              // explícita, nunca "toma la primera" en silencio.
              <div>
                <p className="mb-1 text-xs font-medium text-gray-600">Elige tu salida</p>
                <div className="flex flex-wrap gap-2">
                  {salidas.map((s) => {
                    const key = `${s.tipo}:${s.id}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setSalidaElegidaKey(key); setResultadoCotizacion(null); }}
                        className="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        style={salidaElegidaKeyEfectiva === key
                          ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                          : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                      >
                        <span className="block font-medium text-gray-800">{s.etiqueta || (s.tipo === "bloqueo" ? "Bloqueo" : "Empaquetado")}</span>
                        <span className="block text-xs text-gray-500">{fmtFecha(s.fechaIda)} → {fmtFecha(s.fechaRegreso)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Menores por habitación</span>
            </div>
            {edadesNota && <p className="mb-1 text-[11px] font-medium text-gray-500">{edadesNota}</p>}
            <div className="space-y-2">
              {habitacionesUI.map((h, idx) => {
                const edadesHab = edadesPorHabitacion[h.id] ?? [];
                const erroresHab = erroresPorHabitacion.get(h.id) ?? [];
                return (
                  <div key={h.id} className="rounded-lg border border-gray-200 p-2">
                    <div className="text-xs font-medium text-gray-700">
                      {ACOM_ROOM_LABEL[h.acom]} #{idx + 1}
                    </div>
                    <div className="mt-1 flex flex-wrap items-end gap-3">
                      <div>
                        <label htmlFor={`${idBase}-${h.id}-cant`} className="mb-1 block text-xs font-medium text-gray-600">
                          Cantidad de menores
                        </label>
                        <input
                          id={`${idBase}-${h.id}-cant`}
                          type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA}
                          value={edadesHab.length}
                          onChange={(e) => cambiarCantidadMenoresHab(h.id, Number(e.target.value))}
                          className={inputCls}
                        />
                      </div>
                      {edadesHab.map((v, i) => {
                        const err = parseEdadMenor(v).error;
                        const mostrarError = v.trim() !== "" && err;
                        return (
                          <div key={i}>
                            <label htmlFor={`${idBase}-${h.id}-edad-${i}`} className="mb-1 block text-xs font-medium text-gray-600">
                              Edad del menor {i + 1}
                            </label>
                            <input
                              id={`${idBase}-${h.id}-edad-${i}`}
                              type="number" inputMode="numeric" min={0} max={EDAD_MENOR_MAX}
                              value={v}
                              onChange={(e) => cambiarEdadHab(h.id, i, e.target.value)}
                              className={`${inputEdadCls} ${mostrarError ? "border-red-400" : "border-gray-300"}`}
                              aria-invalid={mostrarError ? true : undefined}
                            />
                            {mostrarError && <p className="mt-0.5 text-[10px] text-red-600">{err}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {erroresHab.length > 0 && (
                      <p className="mt-1 text-[11px] text-red-600">{erroresHab.join(" ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        muestraMenores && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={`${idBase}-cant`} className="text-xs font-semibold uppercase tracking-wide text-gray-400">Menores</label>
            </div>
            {edadesNota && <p className="mb-1 text-[11px] font-medium text-gray-500">{edadesNota}</p>}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={`${idBase}-cant`} className="mb-1 block text-xs font-medium text-gray-600">Cantidad de menores</label>
                <input id={`${idBase}-cant`} type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA}
                  value={cantidadMenores} disabled={!hayHab}
                  onChange={(e) => setCantidadMenores(Number(e.target.value))} className={inputCls} />
              </div>
              {edadesTxt.map((v, i) => {
                const err = edadesParsed[i]?.error;
                const mostrarError = v.trim() !== "" && err;
                return (
                  <div key={i}>
                    <label htmlFor={`${idBase}-edad-${i}`} className="mb-1 block text-xs font-medium text-gray-600">Edad menor {i + 1}</label>
                    <input
                      id={`${idBase}-edad-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={EDAD_MENOR_MAX}
                      value={v}
                      onChange={(e) => setEdadAt(i, e.target.value)}
                      className={`${inputEdadCls} ${mostrarError ? "border-red-400" : "border-gray-300"}`}
                      aria-invalid={mostrarError ? true : undefined}
                    />
                    {mostrarError && <p className="mt-0.5 text-[10px] text-red-600">{err}</p>}
                  </div>
                );
              })}
            </div>
            {cantidadMenores > 0 && edadesValidas === false && edadesFaltantes > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">Falta la edad de {edadesFaltantes} menor(es).</p>
            )}
            {clasifError && <p className="mt-1 text-[11px] text-red-600">{clasifError}</p>}
            {cantidadMenores > 0 && !clasifError && edadesValidas && (
              <p className="mt-1 text-[11px] text-gray-400">
                {[infantes > 0 ? `${infantes} infante(s)` : null, ninosTotal > 0 ? `${ninosTotal} niño(s)` : null].filter(Boolean).join(" · ") || "Todas las edades corresponden a adulto."}
              </p>
            )}
          </div>
        )
      )}

      {!esBernalo && errores.length > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{errores.join(" ")}</p>
      )}

      {esBernalo ? (
        // Fase 3F-4A: cotización dinámica real contra el servidor + "Agregar
        // al carrito" habilitado SOLO tras una cotización exitosa (regla
        // A.1). El TOTAL es la autoridad (regla 18); el promedio por viajero
        // es solo referencia visual, nunca el número que se resalta primero.
        <div className="space-y-2 border-t border-gray-100 pt-3">
          {resultadoCotizacion?.ok && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400">
                  Total solicitado{resultadoCotizacion.paxTotal > 0 ? ` · ${resultadoCotizacion.paxTotal} pax` : ""}
                </div>
                <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>
                  {formatMoneda(resultadoCotizacion.pvp, resultadoCotizacion.moneda)}
                </div>
                <div className="text-[11px] text-gray-400">
                  ≈ {formatMoneda(resultadoCotizacion.promedioPorViajero, resultadoCotizacion.moneda)} por viajero (referencia)
                </div>
              </div>
            </div>
          )}
          {resultadoCotizacion && !resultadoCotizacion.ok && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{resultadoCotizacion.mensaje}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={cotizarBernalo} disabled={!bernaloListoParaCotizar || validando}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-40">
              {validando ? "Cotizando…" : resultadoCotizacion?.ok ? "Recotizar" : "Cotizar"}
            </button>
            {onAgregarBernalo && (
              <button type="button" onClick={agregarBernaloClick} disabled={!resultadoCotizacion?.ok}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: "var(--brand-primary)" }}>
                Agregar al carrito
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <div>
            <div className="text-xs text-gray-400">Total estimado{pax > 0 ? ` · ${pax} pax` : ""}</div>
            <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(precio, moneda)}</div>
          </div>
          <button type="button" onClick={agregar} disabled={!puede}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "var(--brand-primary)" }}>
            {btnLabel}
          </button>
        </div>
      )}
      {nota && <p className="text-[11px] text-gray-400">{nota}</p>}
    </>
  );
}

// Motor por fechas (porción/dinámico): el usuario elige las fechas reales y se
// liquida la tarifa noche por noche (cotizarPorFechas, service-role, solo PVP).
function SelectorPorFechas({
  opcion, hotel, ventana, planesInfo, cap, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; ventana: { min: string | null; max: string | null }; planesInfo: PlanesInfo;
  cap: { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };
  onAgregar: (item: Omit<HotelCartItemPersona, "id">) => void;
}) {
  // No se permite check-in en el pasado: el mínimo es HOY (o el inicio del rango
  // del paquete si es posterior). Si el paquete empieza antes de hoy, arranca hoy.
  const hoy = new Date().toISOString().slice(0, 10);
  const minIda = ventana.min && ventana.min > hoy ? ventana.min : hoy;
  const base = opcion.fechaIda ?? ventana.min ?? hoy;
  const idaInicial = base < minIda ? minIda : base;
  const [fIda, setFIda] = useState(idaInicial);
  const [fReg, setFReg] = useState("");
  const [combos, setCombos] = useState<ComboCotizado[] | null>(null);
  const [nochesCot, setNochesCot] = useState<number | null>(null);
  // Badge de condición de pago/restricción (migración 164/165) — resuelto por
  // el servidor en `cotizarPorFechas`, a nivel de HOTEL+fechas (no por
  // categoría/régimen — ver limitación de `regimen_restringido` documentada
  // en `condicionHotelFechas`, lib/reservar/liquidacionHotel.ts). Solo
  // informativo: nunca participa en `pvp`/`precio`.
  const [condicion, setCondicion] = useState<CondicionHotelBadgeData>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [cat, setCat] = useState("");
  const [reg, setReg] = useState("");
  // Sugerencias de fecha cuando la cotización pedida no encontró tarifa —
  // siempre REALES (validadas por el mismo motor, ver
  // lib/reservar/liquidacionHotel.ts), nunca solo derivadas de límites de
  // temporada. `viaSugerencia` habilita el aviso "Tarifa cargada para esas
  // fechas..." solo cuando el resultado vino de pulsar una sugerencia (no de
  // una cotización manual normal). `sugerenciaAplicando` identifica cuál
  // botón está en curso, para su propio estado de carga.
  const [sugerencias, setSugerencias] = useState<SugerenciaFecha[]>([]);
  const [viaSugerencia, setViaSugerencia] = useState(false);
  const [sugerenciaAplicando, setSugerenciaAplicando] = useState<string | null>(null);
  // Servicios incluidos con cobro POR GRUPO: no caben en una tabla por
  // persona (su costo depende de cuántos viajen). Se nombran para avisar que
  // el precio mostrado no es el final — nunca se muestran como si fueran
  // gratis para cobrarlos después (decisión del dueño, revisión PR #294).
  const [serviciosGrupo, setServiciosGrupo] = useState<string[]>([]);

  function cotizar(overrideIda?: string, overrideRegreso?: string, desdeSugerencia = false) {
    setErr("");
    const idaUsada = overrideIda ?? fIda;
    const regresoUsada = overrideRegreso ?? fReg;
    if (!idaUsada || !regresoUsada) { setErr("Indica fecha de ida y de regreso."); return; }
    start(async () => {
      const r = await cotizarPorFechas({ paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, fechaIda: idaUsada, fechaRegreso: regresoUsada });
      if (r.ok) {
        setCombos(r.combos); setNochesCot(r.noches); setCondicion(r.condicion ?? null);
        setCat(r.combos[0]?.categoria ?? ""); setReg(r.combos[0]?.regimen ?? "");
        setSugerencias([]); setViaSugerencia(desdeSugerencia);
        setServiciosGrupo(r.serviciosGrupoPendientes ?? []);
      } else {
        setCombos(null); setCondicion(null); setErr(r.error); setSugerencias(r.sugerencias); setViaSugerencia(false);
        setServiciosGrupo([]);
      }
      setSugerenciaAplicando(null);
    });
  }

  // Pulsar una sugerencia: completa ida/regreso, conserva hotel (nada más
  // cambia de contexto — habitaciones/edades todavía no se han elegido en
  // este punto del flujo) y vuelve a cotizar. Nunca agrega nada al carrito.
  function aplicarSugerencia(s: SugerenciaFecha) {
    setFIda(s.fechaIda);
    setFReg(s.fechaRegreso);
    setSugerenciaAplicando(s.fechaIda);
    cotizar(s.fechaIda, s.fechaRegreso, true);
  }

  const cats = combos ? [...new Set(combos.map((c) => c.categoria))] : [];
  const catEff = cats.includes(cat) ? cat : (cats[0] ?? "");
  const regs = combos ? [...new Set(combos.filter((c) => c.categoria === catEff).map((c) => c.regimen))] : [];
  const regEff = regs.includes(reg) ? reg : (regs[0] ?? "");
  const pvp = combos?.find((c) => c.categoria === catEff && c.regimen === regEff)?.precios ?? {};

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const dateCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, infantes: number, pax: number, precio: number, edadesMenores: number[]) =>
    onAgregar({
      tipo: "hotel",
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: null,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: fIda, fechaRegreso: fReg, noches: nochesCot ?? calcNoches(fIda, fReg),
      habitaciones, ninos, ninos2, infantes, pax, precio, edadesMenores, condicion,
    });

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tus fechas</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ida</label>
            <input type="date" value={fIda} min={minIda} max={ventana.max ?? undefined}
              onChange={(e) => {
                const nueva = e.target.value;
                setFIda(nueva);
                // Sin auto-relleno de regreso: si deja de ser posterior a la
                // nueva ida, se limpia (el usuario elige la fecha real).
                if (nueva && fReg && fReg <= nueva) setFReg("");
                setCombos(null); setCondicion(null); setSugerencias([]); setViaSugerencia(false);
              }}
              className={dateCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Regreso</label>
            <input type="date" value={fReg} min={fIda || minIda} max={ventana.max ?? undefined}
              onChange={(e) => { setFReg(e.target.value); setCombos(null); setCondicion(null); setSugerencias([]); setViaSugerencia(false); }}
              className={dateCls} />
          </div>
          <button type="button" onClick={() => cotizar()} disabled={pending || !fIda || !fReg}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-accent)" }}>
            {pending && !sugerenciaAplicando ? "Cotizando…" : "Cotizar"}
          </button>
        </div>
        {(ventana.min || ventana.max) && (
          <p className="mt-1 text-[11px] text-gray-400">Rango del paquete: {ventana.min ?? "—"} → {ventana.max ?? "—"}</p>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {serviciosGrupo.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Este plan incluye {serviciosGrupo.join(", ")} con tarifa por grupo: su valor depende del
            número de viajeros, así que <strong>el precio de la tabla no es el total final</strong> —
            se calcula completo al elegir la composición.
          </p>
        )}
        {!!sugerencias.length && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-500">Fechas con tarifa para este hotel</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sugerencias.map((s) => (
                <button
                  key={s.fechaIda}
                  type="button"
                  onClick={() => aplicarSugerencia(s)}
                  disabled={pending}
                  className="rounded-full border border-gray-300 bg-transparent px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] disabled:opacity-50"
                >
                  {pending && sugerenciaAplicando === s.fechaIda ? "Cotizando…" : s.etiqueta}
                </button>
              ))}
            </div>
          </div>
        )}
        {viaSugerencia && combos && combos.length > 0 && (
          <p className="mt-2 text-xs font-medium" style={{ color: "var(--brand-success)" }}>Tarifa cargada para esas fechas. Cupo sujeto a confirmación.</p>
        )}
      </div>

      {combos && combos.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Categoría</label>
              <select value={catEff} onChange={(e) => setCat(e.target.value)} className={selCls}>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Alimentación</label>
              <select value={regEff} onChange={(e) => setReg(e.target.value)} className={selCls}>
                {regs.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {regEff && (
                <div className="mt-1">
                  <RegimenInfo codigo={regEff} info={planesInfo[regEff.trim().toUpperCase()]} variant="link" className="text-xs" />
                </div>
              )}
            </div>
            {nochesCot != null && <div className="self-end pb-2 text-xs text-gray-400">{nochesCot} noche(s)</div>}
          </div>
          <div className="mt-1"><CondicionHotelBadges condicion={condicion} /></div>
          <EditorPax pvp={pvp} acomConfig={cap.acom} paxMin={cap.paxMin} paxMax={cap.paxMax} moneda={hotel.moneda} edadesNota={textoEdadesHotel(hotel)} edadInfanteMax={hotel.infMax} edadNinoMax={hotel.ninoMax} onAgregar={agregarItem} />
        </>
      )}
    </div>
  );
}
