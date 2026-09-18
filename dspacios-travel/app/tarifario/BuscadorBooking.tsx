"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type HotelCartItemPersona } from "@/lib/cart/CartContext";
import { buscarHoteles } from "@/app/(dashboard)/dashboard/reservar/actions";
import { buscarAlojamientosUnidadPorFechas, type DisponibilidadUnidadHotel, type ResultadoBusquedaUnidad } from "./busquedaUnidadActions";
import { type BusquedaResultado, type SugerenciaFecha } from "@/lib/reservar/cotizar";
import { CondicionHotelBadges } from "@/components/cotizacion/CondicionHotelBadges";
import { EDAD_MENOR_MAX, MAX_MENORES_POR_CONSULTA, ajustarCantidadEdades, parseEdadMenor } from "@/lib/reservar/edadesMenores";
import type { DestinoPorcionOpcion } from "@/lib/tarifario/destinosPorcion";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import {
  Categoria, EtiquetasHotel, DescripcionHotelExpandible, UbicacionHotel, SeccionesIncluye, AddonsPaquete, ReceptivoModal,
  type Receptivo, type ReceptivoModalInfo,
} from "./tarjetaHotelCompartida";
import type { DescripcionPaqueteRaw } from "@/lib/tarifario/descripcionPaquete";

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
  destinos = [], onBusqueda, sugerenciaPedida = null,
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
  const [pending, start] = useTransition();
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

  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar alojamiento</p>
        <div className="flex flex-wrap items-end gap-3">
          {/* El selector se pinta SIEMPRE (aunque el catálogo esté vacío) y su
              opción inicial es un placeholder DESHABILITADO: el destino es
              obligatorio para buscar, así que una opción "sin destino" elegible
              sólo ofrecería el valor que el motor rechaza. */}
          <div><label className="mb-1 block text-xs text-gray-500">Destino</label>
            <select
              value={destino}
              onChange={(e) => {
                const nombre = e.target.value;
                // El id viaja junto al nombre elegido — se busca en la MISMA
                // lista que armó las opciones, nunca se adivina ni se vuelve
                // a resolver por texto en otro lugar.
                const opcion = destinos.find((d) => d.nombre === nombre);
                setDestino(nombre);
                setDestinoId(opcion?.id ?? null);
                limpiarResultados();
              }}
              className={sel}
            >
              <option value="" disabled>Selecciona un destino</option>
              {destinos.map((d) => <option key={d.nombre} value={d.nombre}>{d.nombre}</option>)}
            </select>
          </div>
          <div><label className="mb-1 block text-xs text-gray-500">Ida</label><input type="date" min={hoy} value={fIda} onChange={(e) => { const nueva = e.target.value; limpiarResultados(); setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Regreso</label><input type="date" min={fIda} value={fReg} onChange={(e) => { limpiarResultados(); setFReg(e.target.value); }} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Adultos (12+)</label>
            <input type="number" min={1} value={adultos} onChange={(e) => { limpiarResultados(); setAdultos(e.target.value); }}
              className={`${sel} w-20 ${!adultosValido ? "border-red-400" : ""}`} aria-invalid={!adultosValido ? true : undefined} />
          </div>
          <div><label htmlFor={`${idBase}-cant`} className="mb-1 block text-xs text-gray-500">Cantidad de menores</label>
            <input id={`${idBase}-cant`} type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA} value={cantidadMenores}
              onChange={(e) => setCantidadMenores(Number(e.target.value))} className={`${sel} w-20`} />
          </div>
          <div><label className="mb-1 block text-xs text-gray-500">Habitaciones</label><input type="number" min={1} max={8} value={nHab} onChange={(e) => setCantidad(Number(e.target.value))} className={`${sel} w-20`} /></div>
        </div>

        {/* Una fila por habitación: solo el tipo de acomodación (los menores se
            declaran aparte, por edad exacta — no por habitación). */}
        <div className="mt-3 space-y-2">
          {habs.map((acom, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-gray-500">Habitación {i + 1}</span>
              <select value={acom} onChange={(e) => setHab(i, e.target.value as AcomRoom)} className={sel}>
                {ACOM_ROOMS.map((a) => <option key={a} value={a}>{ACOM_ROOM_LABEL[a]}</option>)}
              </select>
            </div>
          ))}
        </div>

        {cantidadMenores > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Edad de cada menor</p>
            <div className="flex flex-wrap gap-3">
              {edadesTxt.map((v, i) => {
                const errP = edadesParsed[i]?.error;
                const mostrarError = v.trim() !== "" && errP;
                return (
                  <div key={i}>
                    <label htmlFor={`${idBase}-edad-${i}`} className="mb-1 block text-xs text-gray-500">Edad menor {i + 1}</label>
                    <input
                      id={`${idBase}-edad-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={EDAD_MENOR_MAX}
                      value={v}
                      onChange={(e) => setEdadAt(i, e.target.value)}
                      className={`w-16 rounded-lg border px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] ${mostrarError ? "border-red-400" : "border-gray-300"}`}
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

        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => buscar()} disabled={pending || !menoresListos || !adultosValido} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Buscando…" : "Buscar hoteles"}
          </button>
          {huellaBuscada !== null && <button type="button" onClick={limpiarResultados} className="text-xs text-gray-400 hover:text-gray-700">Limpiar resultados</button>}
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
export function Resultado({ r, foto, info, descripcionPorPaquete, addonsPorPaquete }: {
  r: BusquedaResultado;
  foto: string | null;
  info?: {
    estrellas: number | null; clasificacion: string | null; descripcion?: string | null;
    ubicacion?: string | null; video_url?: string | null;
    adultsOnly?: boolean; petFriendly?: boolean; tieneCondicion?: boolean;
  };
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;
  addonsPorPaquete: Map<number, Receptivo[]>;
}) {
  const { items, add, remove } = useCart();
  const [addonAbierto, setAddonAbierto] = useState<ReceptivoModalInfo | null>(null);
  // `r.paqueteId` es FIJO para este resultado (una fila = un par hotel+
  // paquete) — nunca cambia con la categoría/alimentación elegida, a
  // diferencia de la tarjeta unidad (`TarjetaUnidadBusqueda`), donde distintos
  // combos SÍ pueden pertenecer a paquetes distintos.
  const descripcionPaquete = descripcionPorPaquete[r.paqueteId];
  const addons: Receptivo[] = addonsPorPaquete.get(r.paqueteId) ?? [];

  // Combos disponibles → selectores de categoría y alimentación (el más barato
  // viene por defecto). El precio y lo que va al carrito siguen al combo elegido.
  const categorias = useMemo(() => [...new Set(r.combos.map((c) => c.categoria))], [r.combos]);
  const [cat, setCat] = useState(r.categoria);
  const [reg, setReg] = useState(r.regimen);
  const regimenes = useMemo(
    () => [...new Set(r.combos.filter((c) => c.categoria === cat).map((c) => c.regimen))],
    [r.combos, cat]
  );
  // Si el régimen elegido no aplica a la categoría, cae al más barato de esa categoría.
  const regEff = regimenes.includes(reg) ? reg : (regimenes[0] ?? reg);
  const combo = r.combos.find((c) => c.categoria === cat && c.regimen === regEff) ?? r.combos[0];

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
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${selCls} flex-1`}>
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
