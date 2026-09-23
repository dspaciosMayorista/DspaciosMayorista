"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { MapPin, CalendarDays, Users, Baby, BedDouble } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type HotelCartItemPersona } from "@/lib/cart/CartContext";
import { buscarHoteles } from "@/app/(dashboard)/dashboard/reservar/actions";
import { buscarAlojamientosUnidadPorFechas, type DisponibilidadUnidadHotel, type ResultadoBusquedaUnidad } from "./busquedaUnidadActions";
import { type BusquedaResultado, type SugerenciaFecha } from "@/lib/reservar/cotizar";
import { CondicionHotelBadges } from "@/components/cotizacion/CondicionHotelBadges";
import { EDAD_MENOR_MAX, MAX_MENORES_POR_CONSULTA, ajustarCantidadEdades, parseEdadMenor } from "@/lib/reservar/edadesMenores";
import type { DestinoPorcionOpcion } from "@/lib/tarifario/destinosPorcion";
import type { ComboPersonaElegido } from "@/lib/tarifario/filtrosBusqueda";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import {
  Categoria, EtiquetasHotel, DescripcionHotelExpandible, UbicacionHotel, SeccionesIncluye, AddonsPaquete, ReceptivoModal,
  type Receptivo, type ReceptivoModalInfo,
} from "./tarjetaHotelCompartida";
import type { DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";
import { EtiquetaOferta } from "./EtiquetaOferta";

// Veredicto POSITIVO del servidor sobre un hotel por unidad para las fechas y
// la ocupación declaradas (`buscarAlojamientosUnidadPorFechas`). Se deriva del
// tipo de la acción en vez de declararlo de nuevo: así el filtro del cliente
// ("solo lo confirmado disponible") y lo que la acción puede devolver no
// pueden divergir sin que el build lo note.
export type AlojamientoUnidadDisponible = Extract<DisponibilidadUnidadHotel, { estado: "disponible" }>;

// Lo que este buscador comunica HACIA ARRIBA (`VistaBooking`) cuando una
// búsqueda se ejecutó con éxito — y `null` cuando se limpia o los criterios
// dejan de corresponder a los resultados mostrados.
//
// Por qué sube TODO: este buscador ya NO pinta resultados. Antes renderizaba
// su propia lista de filas persona y `VistaBooking` volvía a renderizar su
// grilla de tarjetas (unidad + exploración) DEBAJO: dos listas visuales, dos
// contadores y dos estados vacíos para una sola búsqueda. Ahora hay una única
// colección y `VistaBooking` la pinta en una única grilla.
export type EstadoBusquedaPorcion = {
  /** Destino efectivamente buscado. Siempre una cadena con contenido: este
   * buscador NO busca "todos los destinos" — el destino es obligatorio (ver
   * `buscar()`), así que no existe un estado con `""` que `VistaBooking` tenga
   * que interpretar como "sin filtro". Con esto `VistaBooking` cierra la grilla
   * al destino buscado. */
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  /** Filas persona devueltas por `buscarHoteles` — EXCLUSIVAMENTE las que el
   * motor validó contra fechas, ocupación y tarifa. Nunca se completa con la
   * grilla precargada de exploración: por eso un hotel que el motor rechazó no
   * puede reaparecer acá. */
  resultados: BusquedaResultado[];
  /** Motivo real por el que el motor no devolvió filas (ver
   * `lib/reservar/cotizar.ts`), o `null` si no aplica. */
  diagnostico: string | null;
  /** Fechas alternativas con tarifa. Solo llegan cuando el motor no alcanzó a
   * evaluar ningún hotel (motivo de fechas), nunca por un problema de
   * composición — cambiar de fecha no resuelve un problema de capacidad. */
  sugerenciasFecha: SugerenciaFecha[];
  /** Alojamientos por unidad (Bernalo) del destino que el servidor CONFIRMÓ
   * disponibles. Los `sin_disponibilidad` NO entran acá (no son un resultado
   * disponible) y un estado desconocido por error técnico tampoco se anuncia
   * — ver `MOTIVOS_SIN_DISPONIBILIDAD` en `evaluarDisponibilidadUnidad.ts`. */
  unidad: AlojamientoUnidadDisponible[];
  /** Aviso NO bloqueante cuando la mitad "unidad" de la búsqueda no se pudo
   * completar con confianza — fallo técnico real (`ok:false`) o evaluación
   * parcial (`incompleto:true`, al menos un hotel quedó inconcluyente). Los
   * resultados PERSONA (`resultados`) siguen siendo válidos y se muestran
   * igual: un fallo de la mitad unidad nunca oculta la mitad persona ni se
   * disfraza de "no hay alojamientos por unidad en este destino" (fallo
   * estructural corregido — ver `busquedaUnidadActions.ts`). `null` = la
   * búsqueda unidad se completó con confianza (o no había nada que evaluar). */
  avisoUnidad: string | null;
};

// Huella de los criterios de una búsqueda — sirve para detectar que el usuario
// cambió un campo DESPUÉS de buscar y que, por lo tanto, los resultados ya
// mostrados no corresponden a lo que está en pantalla.
function huellaBusqueda(a: {
  destino: string; destinoId: number | null; fIda: string; fReg: string; adultos: string;
  habs: AcomRoom[]; cantidadMenores: number; edadesTxt: string[];
}): string {
  return [a.destino, a.destinoId ?? "", a.fIda, a.fReg, a.adultos, a.habs.join(","), a.cantidadMenores, a.edadesTxt.join(",")].join("|");
}

export function BuscadorBooking({
  destinos = [], onBusqueda, sugerenciaPedida = null, onPendingChange,
}: {
  /** Destinos ofrecibles: la UNIÓN real de Porción terrestre (persona +
   * unidad, deduplicada y ordenada — `destinosPorcionPublica`). Es la lista
   * que hace que un destino que solo existe por hoteles unidad sea
   * SELECCIONABLE y, por lo tanto, buscable desde acá: el motor
   * (`buscarHoteles` + `buscarAlojamientosUnidadPorFechas`) ya sabe
   * resolverlo, pero con la lista vieja solo-persona ese destino ni siquiera
   * aparecía en el desplegable. Cada opción trae su `id` (`destinos.id`)
   * cuando se conoce — la búsqueda unidad lo manda tal cual a la Server
   * Action, que ya no tiene que re-resolverlo por texto (cierre del hallazgo
   * de identidad de destino: dos registros de `destinos` pueden diferir por
   * mayúsculas/espacios, y una resolución por nombre dentro de la acción
   * podía no encontrar el id correcto). */
  destinos?: DestinoPorcionOpcion[];
  /** Canal hacia `VistaBooking` — ver `EstadoBusquedaPorcion`. */
  onBusqueda?: (estado: EstadoBusquedaPorcion | null) => void;
  /** Sugerencia de fecha elegida por el usuario. Los chips viven en
   * `VistaBooking` (junto al estado vacío unificado) y bajan por acá con un
   * `nonce` que se incrementa en cada clic: el efecto de abajo aplica la fecha
   * y repite la búsqueda UNA vez por clic, nunca en cada render. */
  sugerenciaPedida?: (SugerenciaFecha & { nonce: number }) | null;
  /** Notifica a `VistaBooking` cada vez que `buscando` cambia — así puede
   * mostrar el isotipo de carga sobre el área de resultados en vez de dejar
   * visible la grilla de exploración mientras esta búsqueda está en curso.
   * Puramente de presentación: nunca decide qué respuesta se publica (eso
   * sigue siendo `generacionBusquedaRef`, ver la nota junto a `buscando`). */
  onPendingChange?: (buscando: boolean) => void;
}) {
  const idBase = useId();
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState(hoy);
  const [fReg, setFReg] = useState("");
  const [adultos, setAdultos] = useState("2");
  const [destino, setDestino] = useState("");
  // Identidad ESTABLE del destino elegido (`destinos.id`) — viaja junto al
  // nombre, nunca en su lugar: `buscarHoteles` (persona) solo conoce nombre
  // (`tarifario_resultado` no tiene `destino_id`, ver `destinosPorcion.ts`),
  // así que el nombre sigue siendo obligatorio. `null` cuando la opción
  // elegida no trae id (destino solo-persona) — la búsqueda unidad cae
  // entonces a su camino legado por nombre dentro de la Server Action.
  const [destinoId, setDestinoId] = useState<number | null>(null);
  const [nHab, setNHab] = useState("1");
  const [habs, setHabs] = useState<AcomRoom[]>(["doble"]);
  const [cantidadMenores, setCantidadMenoresState] = useState(0);
  const [edadesTxt, setEdadesTxt] = useState<string[]>([]);
  const [, start] = useTransition();
  // `buscando`: señal de "hay una búsqueda en curso" que gobierna el
  // isotipo de carga en `VistaBooking` (via `onPendingChange`). Deliberadamente
  // NO es el `pending`/`isPending` de `useTransition`: ese solo se apaga
  // cuando la promesa en vuelo se ASIENTA (resuelve o rechaza), y no hay forma
  // de cancelarla desde afuera — si el usuario cambia un criterio o pulsa
  // "Limpiar resultados" mientras una búsqueda sigue en curso, esta señal debe
  // apagarse DE INMEDIATO (ver `limpiarResultados`), sin esperar a que la
  // respuesta obsoleta llegue. La protección real contra publicar esa
  // respuesta tardía sigue siendo `generacionBusquedaRef` — esta bandera es
  // solo de presentación, nunca decide qué se publica.
  const [buscando, setBuscando] = useState(false);
  const [err, setErr] = useState("");
  const [avisoHab, setAvisoHab] = useState("");
  // Huella de los criterios con los que se ejecutó la ÚLTIMA búsqueda (`null`
  // = no hay búsqueda vigente). Gobierna la visibilidad de "Limpiar
  // resultados": el botón sólo tiene sentido mientras lo pintado provenga de
  // una búsqueda. Identifica criterios (ver `buscar`), pero NO es la
  // protección contra respuestas fuera de orden (ver `generacionBusquedaRef`).
  // Los resultados en sí NO se guardan acá — se suben a `VistaBooking` (ver
  // `EstadoBusquedaPorcion`).
  const [huellaBuscada, setHuellaBuscada] = useState<string | null>(null);

  // Generación de solicitud: la protección REAL contra respuestas fuera de
  // orden. Se incrementa de forma SÍNCRONA, dentro del mismo evento que
  // invalida lo vigente — nunca desde un `useEffect` posterior que sincronice
  // una huella. Esa vía (la que este mecanismo reemplaza) tenía una ventana:
  // el evento que cambia un criterio limpia resultados y programa el cambio
  // de estado, pero el efecto que actualizaba la huella "viva" solo corría en
  // el render SIGUIENTE — una respuesta que llegaba justo entre medio todavía
  // veía la huella vieja y se publicaba igual.
  //
  // Cada búsqueda captura su propia generación (`miGeneracion`) al arrancar
  // (`buscar()`); al resolver, solo publica si `generacionBusquedaRef.current`
  // sigue siendo esa MISMA generación — no "la más reciente vista", sino la
  // exacta, así que el orden de llegada de las respuestas no importa: solo
  // importa cuál fue la ÚLTIMA en arrancar. Toda invalidación pasa por acá:
  // `limpiarResultados()` incrementa (limpiar sin volver a buscar también
  // debe invalidar lo que esté en vuelo), y `buscar()` incrementa la suya
  // propia al iniciar — incluida la búsqueda que dispara una sugerencia de
  // fecha (`aplicarSugerenciaFecha` llama `buscar()` sin atajos), así que se
  // invalidan entre sí sin depender de comparar criterios.
  const generacionBusquedaRef = useRef(0);

  // Este componente se desmontó (el usuario cambió de pestaña) mientras la
  // búsqueda estaba en vuelo. `onBusqueda`/`setErr` seguirían siendo llamadas
  // VÁLIDAS (son funciones del padre o de este mismo componente, no lanzan
  // por sí solas), pero resucitarían el modo búsqueda con una respuesta que
  // ya no corresponde a lo que el usuario está viendo. Se marca en el cleanup
  // del efecto — la única señal confiable de desmontaje — y se revisa ANTES
  // de cualquier `onBusqueda`/`setState` en el callback asíncrono de `buscar()`.
  const montadoRef = useRef(true);
  useEffect(() => () => { montadoRef.current = false; }, []);

  // Sube `buscando` al padre en cada cambio. Efecto SEPARADO del de abajo (no
  // "cleanup" del mismo useEffect): el cleanup de un efecto corre en TODA
  // reejecución por cambio de dependencia, no solo al desmontar — ponerlo ahí
  // dispararía un `onPendingChange(false)` espurio en CADA transición
  // false→true (el cleanup de la ejecución anterior, con `buscando` todavía
  // false, se dispara antes de la nueva con `buscando` true). Inofensivo en
  // producción (mismo valor, React lo descarta sin re-render) pero hace
  // ruido innecesario y una prueba de interacción que cuenta invocaciones sí
  // lo nota.
  useEffect(() => {
    onPendingChange?.(buscando);
  }, [buscando, onPendingChange]);

  // Señal de desmontaje aparte, vía ref para no depender de la identidad de
  // `onPendingChange` (evita que este efecto de solo-montaje/desmontaje
  // tuviera que declarar esa dependencia): el usuario cambió de sub-pestaña
  // con una búsqueda en curso — sin esto, `VistaBooking` seguiría mostrando
  // el isotipo con el buscador ya desaparecido, hasta que su propio efecto
  // de limpieza de `cambiarSub` corra (que ya lo hace, pero esta notificación
  // es la señal directa e inmediata del propio componente que se retira).
  const onPendingChangeRef = useRef(onPendingChange);
  useEffect(() => { onPendingChangeRef.current = onPendingChange; });
  useEffect(() => () => onPendingChangeRef.current?.(false), []);

  // Salir del modo búsqueda desde este componente: limpiar es UNA sola
  // decisión (deja de haber búsqueda vigente y los resultados unificados de
  // `VistaBooking` se retiran), nunca dos actualizaciones que puedan quedar
  // desincronizadas.
  //
  // La usan DOS caminos, y en los dos significa lo mismo —"lo que hay pintado
  // dejó de corresponder"—: el botón "Limpiar resultados" y CADA evento que
  // cambia un criterio de la búsqueda (destino, fechas, adultos, habitaciones,
  // menores y sus edades). Que la invalidación viva en esos eventos —y no en
  // un efecto que compare huellas— es deliberado: un `setState` dentro de un
  // `useEffect` provoca renders en cascada, y además una huella derivada no
  // alcanzaría, porque el botón debe OLVIDAR la búsqueda aunque el usuario
  // vuelva a escribir los mismos criterios.
  function limpiarResultados() {
    // Invalida cualquier búsqueda en vuelo ANTES de tocar estado — ver
    // `generacionBusquedaRef`. Sin esto, limpiar y no volver a buscar dejaría
    // una respuesta tardía con la generación vieja todavía "vigente".
    generacionBusquedaRef.current += 1;
    setHuellaBuscada(null);
    onBusqueda?.(null);
    // Apaga el isotipo YA, sin esperar a que la búsqueda invalidada arriba
    // se asiente — cambiar un criterio o pulsar "Limpiar resultados" debe
    // retirar la señal de carga de inmediato (ver la nota en `buscando`).
    setBuscando(false);
  }

  // Ajusta el nº de filas de habitación (tope de 8; 9+ requiere asesor).
  function setCantidad(n: number) {
    const pedido = Math.trunc(n) || 1;
    limpiarResultados();
    setAvisoHab(pedido > 8 ? "A partir de 9 habitaciones, contacta a un asesor." : "");
    const cant = Math.max(1, Math.min(8, pedido));
    setNHab(String(cant));
    setHabs((prev) => {
      const next = [...prev];
      while (next.length < cant) next.push("doble");
      next.length = cant;
      return next;
    });
  }
  const setHab = (i: number, acom: AcomRoom) => {
    limpiarResultados();
    setHabs((p) => p.map((h, n) => (n === i ? acom : h)));
  };

  // Cantidad de menores: agrega campos de edad vacíos al final o quita solo
  // los sobrantes del final — las edades ya escritas nunca se pierden/reordenan.
  function setCantidadMenores(nRaw: number) {
    limpiarResultados();
    setCantidadMenoresState(Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nRaw) || 0)));
    setEdadesTxt((prev) => ajustarCantidadEdades(prev, nRaw));
  }
  const setEdadAt = (i: number, v: string) => {
    limpiarResultados();
    setEdadesTxt((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  };

  const edadesParsed = edadesTxt.map(parseEdadMenor);
  const edadesValidas = edadesParsed.every((p) => p.error == null);
  const edadesFaltantes = edadesParsed.filter((p) => p.valor == null).length;
  const edades = edadesParsed.map((p) => p.valor).filter((v): v is number => v != null);
  const menoresListos = cantidadMenores === 0 || edadesValidas;

  // "Adultos" es un campo real de la consulta: se valida y se envía al motor
  // (antes quedaba en el estado sin usarse). Entero ≥ 1, nunca decimal/texto/
  // negativo — el servidor vuelve a validar esto mismo, este parseo es solo
  // para dar feedback inmediato y no bloquear con un valor a medio escribir.
  const adultosTrim = adultos.trim();
  const adultosParsed = /^\d+$/.test(adultosTrim) ? Number(adultosTrim) : null;
  const adultosValido = adultosParsed != null && adultosParsed >= 1;

  function buscar(overrideIda?: string, overrideRegreso?: string) {
    setErr("");
    // Arranca una búsqueda nueva: se retira la vigente ANTES de pedir nada, e
    // incrementa la generación de una vez — invalida SINCRÓNICAMENTE
    // cualquier búsqueda anterior en vuelo (o una sugerencia de fecha que
    // dispare esta misma llamada), sin esperar a que la generación vieja
    // resuelva para descubrir que quedó obsoleta. `miGeneracion` es la que
    // esta búsqueda concreta debe ver intacta en `generacionBusquedaRef` para
    // poder publicar (ver el chequeo tras el `Promise.all`).
    const miGeneracion = (generacionBusquedaRef.current += 1);
    // Los resultados de la anterior no pueden seguir a la vista como si
    // fueran los de esta búsqueda (y menos con un contador que ya dice
    // "Resultados de tu búsqueda").
    setHuellaBuscada(null);
    onBusqueda?.(null);
    const idaUsada = overrideIda ?? fIda;
    const regresoUsada = overrideRegreso ?? fReg;
    // DESTINO OBLIGATORIO. Sin esto, "todos los destinos" significa evaluar
    // TODOS los hoteles y TODAS sus combinaciones de tarifa para descubrir que
    // ninguna aplica — una consulta pública capaz de recorrer el catálogo
    // entero, que es justo el costo que no se quiere exponer. Acotar a un
    // destino concreto (y validarlo también en la Server Action, que es la
    // frontera real) deja la evaluación completa pero acotada.
    //
    // `trim()` y no sólo `!destino`: un destino de puros espacios no es una
    // selección, es el placeholder disfrazado — el servidor aplica el mismo
    // criterio sobre el mismo valor.
    if (!destino.trim()) { setErr("Selecciona un destino para buscar."); onBusqueda?.(null); return; }
    if (!idaUsada || !regresoUsada) { setErr("Indica fecha de ida y de regreso."); onBusqueda?.(null); return; }
    if (!adultosValido) { setErr("La cantidad de adultos debe ser un entero mayor o igual a 1."); onBusqueda?.(null); return; }
    if (!menoresListos) { setErr(`Falta la edad de ${edadesFaltantes} menor(es).`); onBusqueda?.(null); return; }
    // Los criterios de ESTA búsqueda quedan fijados de una vez — la huella
    // sirve para identificarlos (botón "Limpiar resultados"), no para
    // invalidar: eso ya lo hace `miGeneracion` de forma síncrona.
    const huella = huellaBusqueda({ destino, destinoId, fIda: idaUsada, fReg: regresoUsada, adultos, habs, cantidadMenores, edadesTxt });
    setHuellaBuscada(huella);
    setBuscando(true);
    start(async () => {
      // DOS llamadas por búsqueda, SIEMPRE en paralelo y NUNCA una por
      // tarjeta: `buscarHoteles` (las filas persona, que son la mitad persona
      // de la lista unificada) y la disponibilidad real de los hoteles por
      // unidad del destino (la otra mitad). La segunda es auxiliar: si falla,
      // la mitad persona se muestra igual, solo sin la unidad.
      const [r, unidadRes] = await Promise.all([
        buscarHoteles({
          fechaIda: idaUsada, fechaRegreso: regresoUsada,
          habitaciones: habs.map((acom) => ({ acom })),
          adultos: adultosParsed,
          cantidadMenores, edadesMenores: edades,
          destino,
        }),
        buscarAlojamientosUnidadPorFechas({
          fechaIda: idaUsada, fechaRegreso: regresoUsada,
          destino, destinoId,
          habitaciones: habs.map((acom) => ({ acom })),
          adultos: adultosParsed,
          cantidadMenores, edadesMenores: edades,
        }).catch((e): ResultadoBusquedaUnidad => ({
          ok: false,
          error: e instanceof Error ? e.message : "No se pudo completar la búsqueda de alojamientos por unidad.",
        })),
      ]);
      // Esta búsqueda quedó obsoleta: algo (otro `buscar()`, una sugerencia
      // de fecha que dispara otro `buscar()`, o `limpiarResultados()` — botón
      // "Limpiar" o cualquier evento que cambió un criterio) incrementó la
      // generación DESPUÉS de que esta arrancó. No importa si esa invalidación
      // ocurrió antes o después de que ESTA respuesta llegara: lo único que
      // habilita publicar es que la generación siga siendo exactamente la que
      // esta búsqueda capturó al iniciar — así una respuesta tardía nunca
      // puede pisar a una más nueva, sin importar el orden de llegada.
      if (generacionBusquedaRef.current !== miGeneracion) return;
      // Este componente se desmontó (el usuario cambió de pestaña) mientras
      // la búsqueda estaba en vuelo — cambiar de pestaña no incrementa la
      // generación (no toca ningún campo del formulario ni llama
      // `limpiarResultados`/`buscar`). `onBusqueda`/`setErr` seguirían siendo
      // llamadas VÁLIDAS (son funciones del padre o de este mismo componente,
      // no lanzan por sí solas), pero resucitarían el modo búsqueda con una
      // respuesta que ya no corresponde a lo que el usuario está viendo — se
      // ignora por completo.
      if (!montadoRef.current) return;
      // Respuesta autoritativa (ni obsoleta ni post-desmontaje) — la búsqueda
      // terminó, con éxito o con error; cualquiera de los dos retira el
      // isotipo.
      setBuscando(false);
      if (!r.ok) { setErr(r.error); onBusqueda?.(null); return; }
      // Solo lo CONFIRMADO disponible entra al resultado: `sin_disponibilidad`
      // no es un resultado disponible (y un hotel sobre el que el servidor no
      // pudo concluir no llegó hasta acá — ver `evaluarDisponibilidadUnidad.ts`).
      // Se filtra acá, en el borde, para que la lista unificada de
      // `VistaBooking` no tenga que saber de estados.
      //
      // Fallo estructural corregido: antes un `unidadRes.ok === false` (o una
      // excepción, con el `.catch(() => null)` de antes) se volvía
      // SILENCIOSAMENTE un arreglo `unidad` vacío — indistinguible de "este
      // destino no tiene hoteles por unidad". Ahora SIEMPRE se distingue con
      // `avisoUnidad`: los resultados PERSONA (`r.resultados`) se muestran
      // igual (nunca dependen de que la mitad unidad haya funcionado), pero
      // el aviso deja claro que la búsqueda unidad no se pudo completar (o se
      // completó solo parcialmente — `incompleto`) en vez de dar a entender
      // que se agotó el universo de hoteles del destino.
      let unidad: AlojamientoUnidadDisponible[] = [];
      let avisoUnidad: string | null = null;
      if (unidadRes.ok) {
        unidad = unidadRes.disponibilidad.filter((d): d is AlojamientoUnidadDisponible => d.estado === "disponible");
        if (unidadRes.incompleto) {
          avisoUnidad = "No pudimos confirmar la disponibilidad de todos los alojamientos por unidad de este destino — algunos podrían faltar. Los resultados por persona sí están completos.";
        }
      } else {
        console.error(`[BuscadorBooking] búsqueda unidad falló: ${unidadRes.error}`);
        avisoUnidad = "No pudimos completar la búsqueda de alojamientos por unidad para este destino. Los resultados por persona sí se muestran.";
      }
      onBusqueda?.({
        destino, fechaIda: idaUsada, fechaRegreso: regresoUsada,
        resultados: r.resultados,
        diagnostico: r.diagnostico ?? null,
        sugerenciasFecha: r.sugerenciasFecha ?? [],
        unidad,
        avisoUnidad,
      });
    });
  }

  // Pulsar una sugerencia: actualiza ida/regreso (conserva destino,
  // habitaciones, adultos y edades — todo el resto de la composición ya
  // capturada) y repite la búsqueda. Nunca agrega nada al carrito.
  function aplicarSugerenciaFecha(s: SugerenciaFecha) {
    setFIda(s.fechaIda);
    setFReg(s.fechaRegreso);
    buscar(s.fechaIda, s.fechaRegreso);
  }

  // Un clic en un chip de sugerencia (que vive en `VistaBooking`, junto al
  // estado vacío unificado) baja por prop con un `nonce` nuevo. El ref guarda
  // el último nonce aplicado: el efecto vuelve a correr en cada render, pero
  // solo dispara la búsqueda UNA vez por clic — nunca en bucle.
  //
  // `aplicarSugerenciaFecha` se llama a través de un ref "último valor" en vez
  // de listarla como dependencia: se re-crea en cada render (no es un
  // `useCallback`, y no puede serlo sin tocar `buscar`, que los wiring tests
  // verifican por nombre de función), así que como dependencia haría correr el
  // efecto en cada render — justo lo que el guardia por `nonce` tiene que
  // evitar. El ref mantiene el efecto dependiendo SÓLO del pedido.
  const aplicarSugerenciaRef = useRef(aplicarSugerenciaFecha);
  useEffect(() => { aplicarSugerenciaRef.current = aplicarSugerenciaFecha; });

  const nonceSugerenciaRef = useRef(0);
  useEffect(() => {
    if (!sugerenciaPedida) return;
    if (nonceSugerenciaRef.current === sugerenciaPedida.nonce) return;
    nonceSugerenciaRef.current = sugerenciaPedida.nonce;
    aplicarSugerenciaRef.current(sugerenciaPedida);
  }, [sugerenciaPedida]);

  const sel = "w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs font-medium text-slate-800 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]";
  const lbl = "mb-1 block text-xs font-semibold text-slate-700";
  const iconoCls = "pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400";
  // Destino sí tiene un estado neutro real ("Selecciona un destino",
  // placeholder del Select accesible) — al elegir uno, el control se pone
  // verde (mismo acento de "valor concreto elegido" que el resto del shell,
  // ver el <Select> más abajo). Los demás campos de esta fila (fechas/
  // adultos/menores/habitaciones) son obligatorios sin equivalente a
  // "Todos", así que solo llevan ícono.

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_25px_-5px_rgba(29,124,154,0.08),0_8px_10px_-6px_rgba(29,124,154,0.04)] sm:p-5">
        <p className="mb-3 text-sm font-bold text-slate-900">Buscar alojamiento</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {/* El selector se pinta SIEMPRE (aunque el catálogo esté vacío) y su
              opción inicial es un placeholder DESHABILITADO: el destino es
              obligatorio para buscar, así que una opción "sin destino" elegible
              sólo ofrecería el valor que el motor rechaza. */}
          <div className="col-span-2 sm:col-span-1"><label id={`${idBase}-destino-label`} className={lbl}>Destino</label>
            {/* Base UI (`components/ui/select.tsx`) en vez del `<select>`
                nativo — el menú del navegador (con su franja azul de
                sistema operativo) no se podía llevar a los colores de marca.
                Mismo comportamiento: `value`/`onValueChange` controlado
                (equivalente a `value`/`onChange`), sin ítem "Selecciona un
                destino" en la lista (es un placeholder real vía `SelectValue`,
                nunca una opción elegible que pudiera devolver "" por
                accidente) y teclado completo (Base UI trae roving
                focus/typeahead de fábrica).
                Cierre de accesibilidad: el <label> "Destino" quedaba
                huérfano — `SelectTrigger` renderiza un <button role=
                "combobox"> cuyo nombre accesible, sin nada más, sale del
                placeholder/valor mostrado (`SelectValue`), nunca del
                <label> visual de arriba. Se asocian explícitamente con
                `aria-labelledby` (el id del <label>, generado con el mismo
                `idBase` del resto del formulario): el propio `SelectTrigger`
                (`components/ui/select.tsx`) ya intenta resolver un
                `aria-labelledby` interno desde contexto de Field/Select-label
                (vacío acá, no se usa esa API) — el nuestro se pasa como
                prop de elemento y gana en el merge de props de Base UI
                (el último valor no-manejador escribe encima), así que el
                nombre accesible del trigger queda en, exactamente,
                "Destino". */}
            <Select
              items={destinos.map((d) => ({ value: d.nombre, label: d.nombre }))}
              value={destino || null}
              onValueChange={(nombre) => {
                if (!nombre) return;
                // El id viaja junto al nombre elegido — se busca en la MISMA
                // lista que armó las opciones, nunca se adivina ni se vuelve
                // a resolver por texto en otro lugar.
                const opcion = destinos.find((d) => d.nombre === nombre);
                setDestino(nombre);
                setDestinoId(opcion?.id ?? null);
                limpiarResultados();
              }}
            >
              <SelectTrigger
                aria-labelledby={`${idBase}-destino-label`}
                className={`h-auto w-full justify-start gap-2 rounded-lg border py-2 pl-3 pr-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] data-[popup-open]:ring-2 data-[popup-open]:ring-[var(--brand-accent)] ${destino ? "border-[var(--brand-success)] bg-[var(--brand-success)]/10 text-slate-900 font-semibold" : "border-slate-200 bg-slate-50 text-slate-800"}`}
              >
                <MapPin className={`h-4 w-4 shrink-0 ${destino ? "text-[var(--brand-success)]" : "text-slate-400"}`} aria-hidden />
                <SelectValue placeholder="Selecciona un destino" />
              </SelectTrigger>
              <SelectContent>
                {destinos.map((d) => (
                  <SelectItem
                    key={d.nombre}
                    value={d.nombre}
                    // Contraste de la opción resaltada (fix): el componente
                    // compartido (components/ui/select.tsx) ya trae
                    // `focus:bg-accent focus:text-accent-foreground` — y
                    // Base UI mueve el foco DOM real al ítem resaltado tanto
                    // con mouse como con teclado (`focusItemOnHover` en
                    // `SelectRoot`), así que ese `:focus` (mismo elemento,
                    // misma propiedad `background-color`) compite con
                    // `data-[highlighted]:bg-*` de acá — misma especificidad,
                    // así que gana el que Tailwind emita último en la hoja
                    // (no depende del orden en que se escriben las clases).
                    // Con `--accent`/`--accent-foreground` de esta marca
                    // (Scooter pálido + texto casi blanco) el resultado,
                    // cuando ganaba `focus:*`, era texto blanco sobre azul
                    // pálido, casi ilegible. Fix LOCAL (sin tocar el Select
                    // compartido): pisar el fondo de `focus:*` con `!`
                    // (fuerza `!important`, gana SIEMPRE sin depender del
                    // orden) usando azul D'Spacios oscuro (--brand-primary,
                    // ya usado con texto blanco en los botones principales
                    // de la marca, ~4.8:1 de contraste — cumple AA). El
                    // texto en sí no hace falta forzarlo por esta vía: el
                    // propio `focus:**:text-accent-foreground` del Select
                    // compartido YA pinta el texto (casi) blanco en todos
                    // los descendientes durante el foco — resultado
                    // legible por accidente feliz, reforzado acá con
                    // `data-[highlighted]:text-white` explícito por si ese
                    // detalle interno cambia. "Seleccionada" sigue en verde
                    // (--brand-success-dark) en su estado normal; se apaga
                    // SOLO mientras además está resaltada (verde oscuro
                    // sobre azul oscuro sería igual de ilegible) — el check
                    // ✓ (hereda el color de texto) sigue marcando cuál es
                    // la opción elegida en ese instante.
                    className="data-[highlighted]:bg-[var(--brand-primary)] data-[highlighted]:text-white focus:!bg-[var(--brand-primary)] data-[selected]:not-data-[highlighted]:text-[var(--brand-success-dark)] data-[selected]:not-data-[highlighted]:font-semibold"
                  >
                    {d.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><label className={lbl}>Ida</label>
            <div className="relative">
              <CalendarDays className={iconoCls} aria-hidden />
              <input type="date" min={hoy} value={fIda} onChange={(e) => { const nueva = e.target.value; limpiarResultados(); setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }} className={sel} />
            </div>
          </div>
          <div><label className={lbl}>Regreso</label>
            <div className="relative">
              <CalendarDays className={iconoCls} aria-hidden />
              <input type="date" min={fIda} value={fReg} onChange={(e) => { limpiarResultados(); setFReg(e.target.value); }} className={sel} />
            </div>
          </div>
          <div><label className={lbl}>Adultos (12+)</label>
            <div className="relative">
              <Users className={iconoCls} aria-hidden />
              <input type="number" min={1} value={adultos} onChange={(e) => { limpiarResultados(); setAdultos(e.target.value); }}
                className={`${sel} ${!adultosValido ? "border-red-400" : ""}`} aria-invalid={!adultosValido ? true : undefined} />
            </div>
          </div>
          <div><label htmlFor={`${idBase}-cant`} className={lbl}>Cantidad de menores</label>
            <div className="relative">
              <Baby className={iconoCls} aria-hidden />
              <input id={`${idBase}-cant`} type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA} value={cantidadMenores}
                onChange={(e) => setCantidadMenores(Number(e.target.value))} className={sel} />
            </div>
          </div>
          <div><label className={lbl}>Habitaciones</label>
            <div className="relative">
              <BedDouble className={iconoCls} aria-hidden />
              <input type="number" min={1} max={8} value={nHab} onChange={(e) => setCantidad(Number(e.target.value))} className={sel} />
            </div>
          </div>
        </div>

        {/* Una fila por habitación: solo el tipo de acomodación (los menores se
            declaran aparte, por edad exacta — no por habitación). */}
        <div className="mt-3 space-y-2">
          {habs.map((acom, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-slate-500">Habitación {i + 1}</span>
              <div className="relative">
                <BedDouble className={iconoCls} aria-hidden />
                <select value={acom} onChange={(e) => setHab(i, e.target.value as AcomRoom)} className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs font-medium text-slate-800 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]">
                  {ACOM_ROOMS.map((a) => <option key={a} value={a}>{ACOM_ROOM_LABEL[a]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        {cantidadMenores > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Edad de cada menor</p>
            <div className="flex flex-wrap gap-3">
              {edadesTxt.map((v, i) => {
                const errP = edadesParsed[i]?.error;
                const mostrarError = v.trim() !== "" && errP;
                return (
                  <div key={i}>
                    <label htmlFor={`${idBase}-edad-${i}`} className="mb-1 block text-xs text-slate-500">Edad menor {i + 1}</label>
                    <input
                      id={`${idBase}-edad-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={EDAD_MENOR_MAX}
                      value={v}
                      onChange={(e) => setEdadAt(i, e.target.value)}
                      className={`w-16 rounded-lg border px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] ${mostrarError ? "border-red-400" : "border-slate-200 bg-slate-50"}`}
                      aria-invalid={mostrarError ? true : undefined}
                    />
                    {mostrarError && <p className="mt-0.5 text-[10px] text-red-600">{errP}</p>}
                  </div>
                );
              })}
            </div>
            {!edadesValidas && edadesFaltantes > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">Falta la edad de {edadesFaltantes} menor(es).</p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => buscar()} disabled={buscando || !menoresListos || !adultosValido} className="rounded-lg bg-[var(--brand-primary)] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-accent)] disabled:opacity-50">
            {buscando ? "Buscando…" : "Buscar hoteles"}
          </button>
          {huellaBuscada !== null && <button type="button" onClick={limpiarResultados} className="text-xs font-semibold text-slate-400 hover:text-slate-700">Limpiar resultados</button>}
        </div>
        {avisoHab && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{avisoHab}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}

// Tarjeta de un resultado PERSONA ya liquidado por el motor. Sigue viviendo
// acá (y no en `VistaBooking`) porque es la única que conoce el carrito por
// `HotelCartItemPersona`; `VistaBooking` la importa para pintar la rama
// `tipo: "busqueda"` de la lista unificada.
//
// Tarjeta completa (auditoría de alcance): antes solo mostraba foto, nombre,
// etiquetas, descripción, categoría/alimentación, precio y botón — perdiendo
// video, ubicación/mapa e Incluye/No incluye/add-on aunque `r.paqueteId` sea
// un `paqueteId` ÚNICO Y CIERTO para este resultado (`buscarHoteles` agrupa
// por par hotel+paquete — `lib/reservar/cotizar.ts` — nunca mezcla combos de
// paquetes distintos bajo el mismo resultado). `info` ahora recibe el shape
// COMPLETO de `infoPorHotel` (ubicación/video/condición incluidos, no solo un
// subconjunto) y `descripcionPorPaquete`/`addonsPorPaquete` llegan iguales
// que a los modales de exploración — nunca una fuente nueva de datos.
export function Resultado({ r, recomendada = false, foto, info, descripcionPorPaquete, addonsPorPaquete, catInicial, regInicial, combosPermitidos }: {
  r: BusquedaResultado;
  /** ¿Esta oferta es una de las recomendadas del paquete coincidente? Solo
   * cambia la etiqueta de la tarjeta ("Recomendado · <paquete>" vs
   * "<paquete>") — nunca qué se muestra ni qué se cobra. */
  recomendada?: boolean;
  foto: string | null;
  info?: {
    estrellas: number | null; clasificacion: string | null; descripcion?: string | null;
    ubicacion?: string | null; video_url?: string | null;
    adultsOnly?: boolean; petFriendly?: boolean; tieneCondicion?: boolean;
  };
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  addonsPorPaquete: Map<number, Receptivo[]>;
  /** Preselección forzada por los filtros generales de arriba (Categoría/
   * Alimentación, `lib/tarifario/filtrosBusqueda.ts`, aplicado en
   * `VistaBooking.tsx`) cuando el combo más barato (default, `r.categoria`/
   * `r.regimen`) no los cumple pero otro sí. `undefined` = sin filtro activo
   * o el default ya cumple — se preselecciona el más barato, como siempre. */
  catInicial?: string;
  regInicial?: string;
  /** Contrato explícito (decisión de diseño): con Categoría/Alimentación
   * activos, estos filtros no solo deciden qué hoteles aparecen — también
   * ACOTAN qué puede ofrecer el selector interno de la tarjeta. Presente =
   * el usuario NO puede, dentro de la tarjeta, volver a un combo que el
   * filtro de arriba ya descartó (sería una contradicción visual: filtro
   * "Superior" arriba, "Estándar" seleccionable adentro — y el precio/
   * carrito resultante quedarían fuera de lo que el filtro pidió).
   * `undefined` = sin filtro activo, el selector sigue ofreciendo TODOS los
   * `r.combos` (comportamiento de siempre, el usuario elige libremente). */
  combosPermitidos?: ComboPersonaElegido[];
}) {
  const { items, add, remove } = useCart();
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);
  // `r.paqueteId` es FIJO para este resultado (una fila = un par hotel+
  // paquete) — nunca cambia con la categoría/alimentación elegida, a
  // diferencia de la tarjeta unidad (`TarjetaUnidadBusqueda`), donde distintos
  // combos SÍ pueden pertenecer a paquetes distintos.
  const descripcionPaquete = descripcionPorPaquete[r.paqueteId];
  const addons: Receptivo[] = addonsPorPaquete.get(r.paqueteId) ?? [];

  // `combosEfectivos`: la fuente ÚNICA de la que salen categorías/
  // regímenes/precio/carrito cuando hay un filtro general activo — el resto
  // del componente no vuelve a leer `r.combos` directamente para nada que el
  // usuario pueda cambiar con los selectores de abajo (el más barato de ESTE
  // subconjunto viene por defecto, igual criterio que sin filtro).
  const combosEfectivos = combosPermitidos ?? r.combos;
  const categorias = useMemo(() => [...new Set(combosEfectivos.map((c) => c.categoria))], [combosEfectivos]);
  const [cat, setCat] = useState(catInicial ?? r.categoria);
  const [reg, setReg] = useState(regInicial ?? r.regimen);
  // Si la categoría elegida (manual o de un montaje previo) queda fuera del
  // subconjunto vigente — ej. el usuario eligió "Superior" a mano y luego un
  // filtro nuevo (Niño 1/Niño 2) deja SOLO "Estandar" como permitida — cae a
  // la primera categoría que sigue siendo válida. Sin este fallback, `cat`
  // quedaba apuntando a un valor sin <option> correspondiente: el <select>
  // mostraba un valor fantasma y `regimenes` (filtrado por esa `cat` obsoleta)
  // podía quedar vacío, arrastrando a `combo` a caer en `r.combos[0]` — que
  // puede ser justo el combo que el filtro de arriba ya excluyó. Mismo
  // patrón que ya usa `TarjetaUnidadBusqueda` (VistaBooking.tsx) para su
  // propia categoría/alimentación.
  const catEff = categorias.includes(cat) ? cat : (categorias[0] ?? cat);
  const regimenes = useMemo(
    () => [...new Set(combosEfectivos.filter((c) => c.categoria === catEff).map((c) => c.regimen))],
    [combosEfectivos, catEff]
  );
  // Si el régimen elegido no aplica a la categoría, cae al más barato de esa categoría.
  const regEff = regimenes.includes(reg) ? reg : (regimenes[0] ?? reg);
  // La búsqueda del combo completo (con `pax`/`menores`, que `combosEfectivos`
  // no lleva — es solo la vista recortada de categoría/régimen/total para el
  // selector) sigue viviendo en `r.combos`: `catEff`/`regEff` solo pueden
  // tomar valores presentes en `categorias`/`regimenes` (derivados de
  // `combosEfectivos`, un subconjunto REAL de `r.combos`), así que el combo
  // encontrado aquí es siempre uno de los permitidos — nunca uno excluido.
  const combo = r.combos.find((c) => c.categoria === catEff && c.regimen === regEff) ?? r.combos[0];

  // La clasificación (infante/Niño 1/Niño 2) ya viene resuelta por edad real
  // desde la búsqueda (misma para todos los combos de este hotel — depende
  // del umbral del hotel, no de la categoría/régimen elegidos).
  const item: Omit<HotelCartItemPersona, "id"> = {
    tipo: "hotel",
    modulo: "porcion_terrestre", paqueteId: r.paqueteId, hotelId: r.hotelId, bloqueoId: null,
    hotelNombre: r.hotelNombre ?? "", destino: r.destino, fotoUrl: foto,
    categoria: combo.categoria, regimen: combo.regimen, fechaIda: r.fechaIda, fechaRegreso: r.fechaRegreso, noches: r.noches,
    habitaciones: r.habitaciones, ninos: combo.menores.nino, ninos2: combo.menores.nino2, infantes: combo.menores.infantes,
    pax: combo.pax, precio: combo.total, edadesMenores: r.edadesMenores, condicion: r.condicion,
  };
  // El estado del botón se deriva del carrito real: si se quita del carrito,
  // vuelve a estar disponible para agregar.
  const enCarrito = items.find((i) =>
    i.tipo === "hotel" && i.modeloTarifario !== "unidad" && i.hotelId === item.hotelId && i.paqueteId === item.paqueteId &&
    i.fechaIda === item.fechaIda && i.fechaRegreso === item.fechaRegreso &&
    i.categoria === item.categoria && i.regimen === item.regimen);
  const selCls = "rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs";
  return (
    <>
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="relative aspect-[16/10] w-full bg-gray-100">
        {info?.video_url ? (
          <BackgroundVideo url={info.video_url} overlay={0} />
        ) : foto ? (
          <Image src={foto} alt={r.hotelNombre ?? ""} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
        )}
        {/* Etiqueta de OFERTA (hallazgo 2): `r.paqueteId` es FIJO para este
            resultado (una fila = un par hotel+paquete), así que el nombre del
            paquete es cierto para toda la tarjeta — y va SIEMPRE, recomendada
            o no, porque el mismo hotel puede venir en dos paquetes distintos
            (ej. normal + 3x2) y cada tarjeta debe leerse como una oferta. */}
        <EtiquetaOferta paqueteNombre={r.paqueteNombre} recomendada={recomendada} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-800">{r.hotelNombre}</span>
            <Categoria estrellas={info?.estrellas ?? null} clasificacion={info?.clasificacion ?? null} className="text-sm" />
            <EtiquetasHotel adultsOnly={info?.adultsOnly ?? false} petFriendly={info?.petFriendly ?? false} />
          </div>
          <div className="mt-1"><CondicionHotelBadges condicion={r.condicion} /></div>
          <div className="text-xs text-gray-500">{r.destino ?? ""} · {r.noches}N</div>
          <DescripcionHotelExpandible texto={info?.descripcion} className="mt-1" textClassName="text-xs text-gray-400" />
        </div>

        <UbicacionHotel hotelNombre={r.hotelNombre ?? ""} ubicacion={info?.ubicacion} />

        {/* Selectores de categoría y alimentación */}
        <div className="grid grid-cols-1 gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Categoría</span>
            <select value={catEff} onChange={(e) => setCat(e.target.value)} className={`${selCls} flex-1`}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Alimentación</span>
            <select value={regEff} onChange={(e) => setReg(e.target.value)} className={`${selCls} flex-1`}>
              {regimenes.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">total {combo.pax} pax</div>
            <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(combo.total)}</div>
          </div>
          <button type="button" onClick={() => (enCarrito ? remove(enCarrito.id) : add(item))}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: enCarrito ? "var(--brand-success)" : "var(--brand-primary)" }}>
            {enCarrito ? "✓ En el carrito · quitar" : "Agregar al carrito"}
          </button>
        </div>

        {/* Incluye/No incluye y add-on del paquete de ESTE resultado — nunca
            fuente de precio/disponibilidad (eso sigue siendo `combo.total`,
            resuelto por `buscarHoteles` arriba). */}
        <SeccionesIncluye descripcion={descripcionPaquete} />
        <AddonsPaquete addons={addons} onAbrir={setAddonAbierto} paqueteId={r.paqueteId} />
      </div>
    </div>
    {addonAbierto && (
      <ReceptivoModal receptivo={addonAbierto} onClose={() => setAddonAbierto(null)} />
    )}
    </>
  );
}
