"use client";

import { HoraInput24 } from "@/components/ui/HoraInput24";
import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { MapPin, Users } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ALCANCE_BUSQUEDA_POR_DEFECTO, ALCANCES_VENTA, ROTULO_ALCANCE_VENTA, ROTULO_TIPO_RECEPTIVO, TIPOS_RECEPTIVO, type AlcanceVenta, type TipoReceptivo } from "@/lib/calc/servicioAlcance";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { ResultadoServicio } from "@/lib/reservar/cotizar";
import type { TourCartItem } from "@/lib/cart/CartContext";
import { LoadingScreen } from "@/components/LoadingScreen";

// `nonce` identifica CADA vez que el carrito pide precargar (un clic en
// "+ Agregar servicios / tours") — necesario para consumir el intent aunque
// este componente YA esté montado (el `useEffect([])` de solo-montaje no
// vuelve a correr si el usuario ya estaba en Receptivos y hace clic de
// nuevo, o desde otro hotel). Mismo patrón que `sugerenciaPedida` en
// `BuscadorBooking.tsx`.
//
// `paqueteId` (fix "add-ons propios reemplazados por el catálogo general del
// destino"): identidad del paquete de origen — cuando llega, la búsqueda
// queda ACOTADA a los servicios opcionales de ESE paquete (ver
// `lib/cart/addonsIntent.ts`). Siempre un entero positivo real: un ítem del
// carrito sin paquete válido nunca produce un `AddonsIntent`.
export type ReceptivosPrefill = { paqueteId: number; destino: string | null; fechaIda: string | null; fechaRegreso: string | null; pax: number; nonce: number };

// Motor de búsqueda de receptivos: destino + fechas + pax → liquida EN VIVO
// cada tour publicado (temporada de la fecha elegida, tarifa por persona o
// por grupo según el pax) — mismo criterio que el buscador de porción terrestre.
export function BuscadorReceptivos({
  destinos = [], fotosPorServicio = {}, onVerDetalle, initial = null, onConsumedInitial, onAgregar, onModoAcotado,
}: {
  destinos?: string[];
  fotosPorServicio?: Record<number, string>;
  onVerDetalle: (r: ResultadoServicio) => void;
  // Llega desde el carrito ("+ Agregar servicios/tours" con un hotel ya elegido):
  // precarga destino/fechas/pax y busca sola, para no repetir la búsqueda a mano.
  initial?: ReceptivosPrefill | null;
  onConsumedInitial?: () => void;
  onAgregar?: (item: Omit<TourCartItem, "id">) => void;
  // Notifica al padre (VistaBooking) el MODO ACOTADO vigente — un `paqueteId`
  // cuando la búsqueda quedó atada al paquete de origen, `null` cuando se
  // abandona ese alcance ("Limpiar resultados") o nunca se entró por el
  // carrito (entrada directa a Receptivos, comportamiento general de
  // siempre). El padre lo usa para no mostrar debajo el catálogo estático
  // general como si formara parte de los resultados del paquete.
  onModoAcotado?: (paqueteId: number | null) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState(initial?.fechaIda ?? "");
  const [fReg, setFReg] = useState(initial?.fechaRegreso ?? "");
  const [pax, setPax] = useState(initial?.pax ? String(initial.pax) : "2");
  const [destino, setDestino] = useState(initial?.destino ?? "");
  // Alcance de paquete vigente: `null` = búsqueda general (comportamiento de
  // siempre). Se activa al consumir un intent del carrito y se abandona
  // EXPLÍCITAMENTE con "Limpiar resultados" — nunca por editar un campo del
  // formulario a mano (mientras esté activo, "Buscar receptivos" lo conserva).
  const [paqueteAcotado, setPaqueteAcotado] = useState<number | null>(initial?.paqueteId ?? null);
  const [, start] = useTransition();
  // `buscando`: señal de "hay una búsqueda en curso" que gobierna el isotipo
  // de carga sobre el área de resultados. Deliberadamente NO es el
  // `pending`/`isPending` de `useTransition` (mismo criterio que
  // `BuscadorBooking.tsx`): ese solo se apaga cuando la promesa en vuelo se
  // ASIENTA, y no hay forma de cancelarla desde afuera — "Limpiar resultados"
  // pulsado mientras una búsqueda sigue en curso debe apagar esta señal DE
  // INMEDIATO (ver `limpiarTodo`), sin esperar la respuesta obsoleta. La
  // protección real contra publicarla sigue siendo `generacionBusquedaRef`.
  const [buscando, setBuscando] = useState(false);
  const [err, setErr] = useState("");
  const [resultados, setResultados] = useState<ResultadoServicio[] | null>(null);
  // Hora prevista del traslado (opcional): solo cambia el precio de los traslados con suplementos por franja horaria.
  const [hLlegada, setHLlegada] = useState("");
  const [hSalida, setHSalida] = useState("");
  // 262: filtro por tipo de receptivo y modalidad del traslado (llegada | salida | ida y regreso). La modalidad viaja a la búsqueda: cada traslado se cotiza con SU precio propio.
  // Orden del formulario: tipo → modalidad → horas → buscar. Modalidad y horas solo existen con el tipo «Traslado»; ida y regreso es la modalidad por defecto.
  const [tipoFiltro, setTipoFiltro] = useState<TipoReceptivo | "">("");
  const [alcance, setAlcance] = useState<AlcanceVenta>(ALCANCE_BUSQUEDA_POR_DEFECTO);
  const esTraslado = tipoFiltro === "traslado";
  // Llegada: solo la hora de llegada; salida: solo la de salida; ida y regreso: ambas. Una hora oculta no se envía ni afecta el precio.
  const pideLlegada = esTraslado && alcance !== "salida";
  const pideSalida = esTraslado && alcance !== "llegada";
  // Los filtros con que se hizo la búsqueda VIGENTE (no los del formulario, que pueden haber cambiado después): resumen de «Tu búsqueda».
  const [busquedaHecha, setBusquedaHecha] = useState<BusquedaHecha | null>(null);

  function cambiarTipo(v: TipoReceptivo | "") {
    setTipoFiltro(v);
    if (v === "traslado") setAlcance(ALCANCE_BUSQUEDA_POR_DEFECTO);
    else { setHLlegada(""); setHSalida(""); } // las horas ocultas se descartan: no se conservan para un uso posterior
  }
  function cambiarModalidad(v: AlcanceVenta) {
    setAlcance(v);
    if (v === "llegada") setHSalida("");
    if (v === "salida") setHLlegada("");
  }

  // Generación de solicitud: protección REAL contra respuestas fuera de orden
  // — mismo patrón que `generacionBusquedaRef` en `BuscadorBooking.tsx`. Cada
  // `buscar()` captura su propia generación (`miGeneracion`) de forma
  // SÍNCRONA al arrancar; al resolver, solo publica si
  // `generacionBusquedaRef.current` sigue siendo exactamente esa generación.
  // Sin esto, una búsqueda del paquete A que tarda más que una búsqueda
  // posterior del paquete B podía resolver DESPUÉS y sobrescribir los
  // resultados de B con los de A — el usuario vería servicios de otro
  // paquete bajo el alcance visible equivocado. Toda invalidación pasa por
  // acá: `buscar()` incrementa la suya al iniciar (éxito o fallo de
  // validación, igual criterio que BuscadorBooking) y `limpiarTodo()` (botón
  // "Limpiar resultados") también incrementa, para que una respuesta en
  // vuelo nunca "resucite" tras limpiar sin volver a buscar.
  const generacionBusquedaRef = useRef(0);

  // El componente se desmontó (cambio de pestaña/submódulo) mientras una
  // búsqueda estaba en vuelo — `setResultados`/`setErr` seguirían siendo
  // llamadas válidas (funciones de este mismo componente, no lanzan por sí
  // solas) pero resucitarían un resultado que ya no corresponde a lo que el
  // usuario está viendo. Se marca en el cleanup del efecto y se revisa antes
  // de publicar cualquier respuesta asíncrona.
  const montadoRef = useRef(true);
  // El setup RESTABLECE `true` (no basta con inicializar el ref en `true` una
  // sola vez): en React Strict Mode (desarrollo) un componente se monta,
  // desmonta y vuelve a montar de inmediato para exponer efectos no
  // idempotentes — la secuencia real es setup → cleanup → setup. Sin este
  // restablecimiento, el cleanup del primer ciclo deja `montadoRef.current`
  // en `false` para SIEMPRE (nada lo vuelve a poner en `true`), así que el
  // segundo montaje (el que el usuario realmente ve) descartaría toda
  // respuesta como si el componente nunca hubiera estado montado.
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  function buscar(destinoQ = destino, fIdaQ = fIda, fRegQ = fReg, paxQ = pax, paqueteIdQ = paqueteAcotado) {
    // Invalida SINCRÓNICAMENTE cualquier búsqueda anterior en vuelo — antes
    // de pedir nada, no después de que la nueva resuelva. `miGeneracion` es
    // la que esta búsqueda concreta debe seguir viendo intacta para poder
    // publicar (ver el chequeo tras el `await`).
    const miGeneracion = (generacionBusquedaRef.current += 1);
    setErr(""); setResultados(null); setBusquedaHecha(null);
    if (!fIdaQ || !fRegQ) { setErr("Indica fecha de ida y de regreso."); return; }
    const paxNum = Number(paxQ) || 0;
    if (paxNum <= 0) { setErr("Indica cuántos pax."); return; }
    setBuscando(true);
    // Solo se envía lo VISIBLE: sin el tipo «Traslado» no hay horas ni modalidad (el servidor cotiza los traslados como ida y regreso); con él, solo las horas del tramo elegido.
    const horasEnviadas = { llegada: pideLlegada ? hLlegada : "", salida: pideSalida ? hSalida : "" };
    const hecha: BusquedaHecha = { destino: destinoQ, fechaIda: fIdaQ, fechaRegreso: fRegQ, pax: paxNum, tipo: tipoFiltro, alcance: esTraslado ? alcance : null, horas: horasEnviadas };
    start(async () => {
      const r = await buscarReceptivos({ fechaIda: fIdaQ, fechaRegreso: fRegQ, pax: paxNum, destino: destinoQ, paqueteId: paqueteIdQ ?? undefined, horas: horasEnviadas, ...(esTraslado ? { alcance } : {}) });
      // Esta búsqueda quedó obsoleta (otra búsqueda más nueva arrancó, o se
      // pulsó "Limpiar resultados") — no importa si eso ocurrió antes o
      // después de que ESTA respuesta llegara: solo la ÚLTIMA búsqueda
      // iniciada está autorizada a publicar.
      if (generacionBusquedaRef.current !== miGeneracion) return;
      if (!montadoRef.current) return;
      // Respuesta autoritativa — la búsqueda terminó, con éxito o con error;
      // cualquiera de los dos retira el isotipo.
      setBuscando(false);
      if (r.ok) { setResultados(r.resultados); setBusquedaHecha(hecha); }
      else setErr(r.error);
    });
  }

  // Salir del modo acotado / limpiar la búsqueda vigente — SIEMPRE la misma
  // decisión completa, sin importar si lo que hay pintado es un resultado
  // real o un error: invalida cualquier solicitud en vuelo ANTES de tocar
  // estado (si no, una respuesta tardía con la generación vieja quedaría
  // "vigente" y podría publicarse igual), borra resultados y error, y suelta
  // el alcance de paquete avisando al padre.
  function limpiarTodo() {
    generacionBusquedaRef.current += 1;
    setResultados(null);
    setBusquedaHecha(null);
    setErr("");
    // Apaga el isotipo YA, sin esperar a que una búsqueda invalidada arriba
    // se asiente (ver la nota junto a `buscando`).
    setBuscando(false);
    setPaqueteAcotado(null);
    onModoAcotado?.(null);
  }

  // Aplica un intent: actualiza los campos visibles y dispara la búsqueda.
  // Vive fuera del efecto (llamada vía ref "último valor" — ver abajo) para
  // no violar `react-hooks/set-state-in-effect`: un `setState` (o una
  // función que lo haga, como `buscar`) escrito DIRECTO dentro de un
  // `useEffect` dispara ese lint incondicionalmente, sin importar que esté
  // guardado por el chequeo de `nonce`. Mismo patrón ya usado en este mismo
  // archivo/proyecto para `aplicarSugerenciaFecha` (`BuscadorBooking.tsx`).
  function aplicarPrefill(p: ReceptivosPrefill) {
    setDestino(p.destino ?? "");
    setFIda(p.fechaIda ?? "");
    setFReg(p.fechaRegreso ?? "");
    setPax(p.pax ? String(p.pax) : "2");
    setPaqueteAcotado(p.paqueteId);
    onModoAcotado?.(p.paqueteId);
    if (p.fechaIda && p.fechaRegreso) buscar(p.destino ?? "", p.fechaIda, p.fechaRegreso, String(p.pax || 2), p.paqueteId);
    onConsumedInitial?.();
  }
  // `aplicarPrefill` se re-crea en cada render (no es un `useCallback`, y no
  // puede serlo sin tocar `buscar`) — se llama a través de un ref "último
  // valor" para que el efecto de abajo pueda depender SOLO de `initial`.
  const aplicarPrefillRef = useRef(aplicarPrefill);
  useEffect(() => { aplicarPrefillRef.current = aplicarPrefill; });

  // Consume CADA intent nuevo (identificado por `nonce`) — no solo el que
  // llega al montar. Antes esto corría en un `useEffect([])` (solo montaje):
  // si el usuario pulsaba "Agregar servicios" estando YA en la pestaña
  // Receptivos (el componente ya montado), el efecto de montaje no volvía a
  // correr y el segundo intent se perdía en silencio. `nonceConsumidoRef`
  // guarda el ÚLTIMO nonce ya procesado (mismo patrón que
  // `nonceSugerenciaRef` en `BuscadorBooking.tsx`): el efecto corre en CADA
  // render donde `initial` cambia de referencia, pero solo actualiza
  // destino/fechas/pax y dispara la búsqueda cuando el nonce es REALMENTE
  // nuevo — así cada intent se consume EXACTAMENTE una vez, nunca en bucle.
  //
  // Cuando el llamador limpia el intent tras consumirlo
  // (`onConsumedInitial` → `setAddonsIntent(null)`), `initial` pasa a
  // `null` y este efecto vuelve a correr (cambió de referencia) — pero
  // `if (!initial) return;` sale de inmediato SIN tocar `resultados`: los
  // resultados de la búsqueda que el intent disparó siguen visibles.
  const nonceConsumidoRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initial) return;
    if (nonceConsumidoRef.current === initial.nonce) return;
    nonceConsumidoRef.current = initial.nonce;
    aplicarPrefillRef.current(initial);
  }, [initial]);

  const sel = "w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs font-medium text-slate-800 focus:border-[var(--brand-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]";
  const iconoCls = "pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400";
  // Destino sí tiene un estado neutro real ("Todos") — al elegir uno
  // concreto, el control se pone verde (mismo acento de "valor elegido" que
  // el resto del shell). Ida/Regreso/Pax son obligatorios sin equivalente a
  // "Todos", así que solo llevan ícono.
  const selDestino = `w-full rounded-lg border py-2 pl-8 pr-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] ${destino ? "border-[var(--brand-success)] bg-[var(--brand-success)]/10 text-slate-900 font-semibold" : "border-slate-200 bg-slate-50 text-slate-800"}`;
  const iconoDestinoCls = `pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${destino ? "text-[var(--brand-success)]" : "text-slate-400"}`;

  const visibles = (resultados ?? []).filter((r) => !tipoFiltro || r.tipoReceptivo === tipoFiltro);

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_25px_-5px_rgba(29,124,154,0.08),0_8px_10px_-6px_rgba(29,124,154,0.04)] sm:p-5">
        <p className="mb-3 text-sm font-bold text-slate-900">Buscar receptivo</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {destinos.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Destino</label>
              <div className="relative">
                <MapPin className={iconoDestinoCls} aria-hidden />
                <select value={destino} onChange={(e) => setDestino(e.target.value)} className={selDestino}>
                  <option value="">Todos</option>
                  {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Ida</label>
            <div className="relative">
              <DateInput aria-label="Ida" type="date" min={hoy} value={fIda}
                onValueChange={(dateValue) => { const nueva = dateValue; setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }}
                className={`${sel} pl-3`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Regreso</label>
            <div className="relative">
              <DateInput aria-label="Regreso" type="date" min={fIda || hoy} value={fReg} onValueChange={(dateValue) => setFReg(dateValue)} className={`${sel} pl-3`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Pax</label>
            <div className="relative">
              <Users className={iconoCls} aria-hidden />
              <input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} className={sel} />
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="filtros-receptivo">
          <div>
            <label htmlFor="filtro-tipo-receptivo" className="mb-1 block text-xs font-semibold text-slate-700">Tipo de receptivo</label>
            <select id="filtro-tipo-receptivo" aria-label="Tipo de receptivo" value={tipoFiltro} onChange={(e) => cambiarTipo(e.target.value as TipoReceptivo | "")} className={sel}>
              <option value="">Todos</option>
              {TIPOS_RECEPTIVO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_RECEPTIVO[t]}</option>)}
            </select>
          </div>
          {esTraslado && (
            <div>
              <label htmlFor="modalidad-traslado" className="mb-1 block text-xs font-semibold text-slate-700">Modalidad del traslado</label>
              <select id="modalidad-traslado" aria-label="Modalidad del traslado" value={alcance} onChange={(e) => cambiarModalidad(e.target.value as AlcanceVenta)} className={sel}>
                {ALCANCES_VENTA.map((a) => <option key={a} value={a}>{ROTULO_ALCANCE_VENTA[a]}</option>)}
              </select>
            </div>
          )}
          {pideLlegada && (
            <div data-testid="hora-llegada">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Hora de llegada</span>
              <HoraInput24 opcional etiqueta="Hora de llegada del traslado" value={hLlegada} onChange={setHLlegada} />
            </div>
          )}
          {pideSalida && (
            <div data-testid="hora-salida">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Hora de salida</span>
              <HoraInput24 opcional etiqueta="Hora de salida del traslado" value={hSalida} onChange={setHSalida} />
            </div>
          )}
          {esTraslado ? (
            <p className="col-span-2 text-[11px] text-slate-400 sm:col-span-4" data-testid="ayuda-traslado">
              Ida y regreso es la modalidad por defecto; un solo trayecto se vende únicamente si tiene precio propio. La hora es opcional: algunos traslados cuestan más en ciertos horarios, indícala para ver el precio final.
            </p>
          ) : tipoFiltro === "" ? (
            <p className="col-span-2 text-[11px] text-slate-400 sm:col-span-3" data-testid="nota-traslados-por-defecto">
              Los traslados se muestran con precio de {ROTULO_ALCANCE_VENTA[ALCANCE_BUSQUEDA_POR_DEFECTO].toLowerCase()}. Elige el tipo «Traslado» para cambiar la modalidad o indicar la hora.
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <button type="button" onClick={() => buscar()} disabled={buscando}
            className="rounded-lg bg-[var(--brand-primary)] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-accent)] disabled:opacity-50">
            {buscando ? "Buscando…" : "Buscar receptivos"}
          </button>
          {/* Visible con resultados O con el modo acotado activo (aunque la
              búsqueda haya fallado): si `buscarReceptivos` devuelve error
              mientras `paqueteAcotado` sigue activo, el usuario debe poder
              salir igual — de lo contrario queda atrapado sin el botón,
              con el catálogo general oculto (ver VistaBooking). */}
          {(resultados != null || paqueteAcotado != null) && (
            <button
              type="button"
              onClick={limpiarTodo}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700"
            >
              Limpiar resultados
            </button>
          )}
        </div>
        {paqueteAcotado != null && (
          <p className="mt-2 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>
            Mostrando solo los servicios opcionales de tu paquete. Usa &quot;Limpiar resultados&quot; para ver el catálogo general del destino.
          </p>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      {buscando && (
        <div className="relative mt-4 min-h-[240px]">
          <LoadingScreen fullScreen={false} label="Buscando receptivos…" />
        </div>
      )}

      {resultados && (
        <section aria-labelledby="titulo-tu-busqueda" data-testid="tu-busqueda" className="mt-6 rounded-2xl border-2 border-[var(--brand-accent)]/50 bg-white p-4 shadow-sm sm:p-5">
          <h2 id="titulo-tu-busqueda" className="text-base font-bold text-slate-900">Tu búsqueda</h2>
          {busquedaHecha && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Filtros de tu búsqueda" data-testid="filtros-aplicados">
              {resumenBusqueda(busquedaHecha).map((c) => <li key={c} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">{c}</li>)}
            </ul>
          )}
          <p className="mb-3 mt-2 text-sm text-gray-500">{visibles.length} receptivo(s) para estos filtros</p>
          {visibles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400" data-testid="sin-resultados">
              No hay receptivos disponibles para ese destino, fechas, pasajeros y tipo.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibles.map((r) => (
                <div
                  key={`${r.paqueteId}-${r.servicioId}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                >
                  <button type="button" onClick={() => onVerDetalle(r)} className="flex flex-1 flex-col justify-start text-left">
                    <div className="relative aspect-[16/10] w-full bg-gray-100">
                      {fotosPorServicio[r.servicioId] ? (
                        <Image src={fotosPorServicio[r.servicioId]} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                      )}
                    </div>
                    <div className="p-4 pb-0">
                      <div className="font-semibold text-gray-800">{r.nombre}</div>
                      {r.destino && <div className="text-xs text-gray-500">{r.destino}</div>}
                      {r.descripcion?.trim() && (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                      )}
                    </div>
                  </button>
                  <div className="p-4 pt-3">
                    <div className="mb-2">
                      {r.requiereAlcance ? (
                        <div className="text-xs font-medium text-amber-700" data-testid="requiere-alcance">Elige el tipo «Traslado» y su modalidad (llegada, salida o ida y regreso) y busca de nuevo para ver su precio.</div>
                      ) : r.sinTarifaAlcance ? (
                        <div className="text-xs font-medium text-red-600" data-testid="sin-tarifa-alcance">Sin tarifa propia para {r.alcance ? ROTULO_ALCANCE_VENTA[r.alcance].toLowerCase() : "ese alcance"} con {r.pax} pasajero{r.pax === 1 ? "" : "s"}: no se puede vender.</div>
                      ) : (<>
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">total{r.alcance ? ` · ${ROTULO_ALCANCE_VENTA[r.alcance].toLowerCase()}` : ""}</div>
                      <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.total, r.moneda)}</div>
                      <div className="text-[10px] text-gray-400">{r.pax} pax</div>
                      </>)}
                      {r.requiereHora?.length ? (
                        <div className="mt-1 text-[11px] font-medium text-amber-700">
                          Precio base. {busquedaHecha?.tipo === "traslado" ? "Indica" : "Elige el tipo «Traslado» e indica"} la hora {r.requiereHora.length === 2 ? "de llegada y de salida" : r.requiereHora[0] === "salida" ? "de salida" : "de llegada"} {busquedaHecha?.tipo === "traslado" ? "arriba " : ""}y busca de nuevo para ver el precio final.
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onVerDetalle(r)} className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        Ver más
                      </button>
                      {onAgregar && (
                        <button
                          type="button"
                          disabled={!!r.requiereHora?.length || !!r.requiereAlcance || !!r.sinTarifaAlcance}
                          onClick={() => onAgregar({
                            tipo: "tour",
                            paqueteId: r.paqueteId,
                            servicioId: r.servicioId,
                            nombre: r.nombre,
                            destino: r.destino,
                            fotoUrl: r.servicioId != null ? (fotosPorServicio[r.servicioId] ?? null) : null,
                            fechaIda: fIda, fechaRegreso: fReg, noches: r.noches,
                            pax: r.pax, precio: r.total, moneda: r.moneda,
                            ...(r.horasCotizadas ? { horas: r.horasCotizadas } : {}),
                            ...(r.alcance ? { alcance: r.alcance } : {}),
                          })}
                          className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
                          style={{ backgroundColor: "var(--brand-accent)" }}
                        >
                          Agregar al carrito
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

type BusquedaHecha = { destino: string; fechaIda: string; fechaRegreso: string; pax: number; tipo: TipoReceptivo | ""; alcance: AlcanceVenta | null; horas: { llegada: string; salida: string } };
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
/** Filtros con que se hizo la búsqueda, en lenguaje de pantalla. Sin tipo «Traslado» no hay modalidad elegida: se dice que los traslados van como la modalidad por defecto. */
export function resumenBusqueda(b: BusquedaHecha): string[] {
  const chips = [b.destino || "Todos los destinos", `${fechaCorta(b.fechaIda)} → ${fechaCorta(b.fechaRegreso)}`, `${b.pax} pax`, b.tipo ? ROTULO_TIPO_RECEPTIVO[b.tipo] : "Todos los tipos"];
  chips.push(b.alcance ? `Modalidad: ${ROTULO_ALCANCE_VENTA[b.alcance]}` : `Traslados: ${ROTULO_ALCANCE_VENTA[ALCANCE_BUSQUEDA_POR_DEFECTO]}`);
  if (b.horas.llegada) chips.push(`Llegada ${b.horas.llegada}`);
  if (b.horas.salida) chips.push(`Salida ${b.horas.salida}`);
  return chips;
}
