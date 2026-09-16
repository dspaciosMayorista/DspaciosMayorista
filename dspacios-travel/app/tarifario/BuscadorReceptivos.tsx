"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { formatMoneda } from "@/lib/utils";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { ResultadoServicio } from "@/lib/reservar/cotizar";
import type { TourCartItem } from "@/lib/cart/CartContext";

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
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [resultados, setResultados] = useState<ResultadoServicio[] | null>(null);

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
    setErr(""); setResultados(null);
    if (!fIdaQ || !fRegQ) { setErr("Indica fecha de ida y de regreso."); return; }
    const paxNum = Number(paxQ) || 0;
    if (paxNum <= 0) { setErr("Indica cuántos pax."); return; }
    start(async () => {
      const r = await buscarReceptivos({ fechaIda: fIdaQ, fechaRegreso: fRegQ, pax: paxNum, destino: destinoQ, paqueteId: paqueteIdQ ?? undefined });
      // Esta búsqueda quedó obsoleta (otra búsqueda más nueva arrancó, o se
      // pulsó "Limpiar resultados") — no importa si eso ocurrió antes o
      // después de que ESTA respuesta llegara: solo la ÚLTIMA búsqueda
      // iniciada está autorizada a publicar.
      if (generacionBusquedaRef.current !== miGeneracion) return;
      if (!montadoRef.current) return;
      if (r.ok) setResultados(r.resultados);
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
    setErr("");
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

  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar receptivo</p>
        <div className="flex flex-wrap items-end gap-3">
          {destinos.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Destino</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={sel}>
                <option value="">Todos</option>
                {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Ida</label>
            <input type="date" min={hoy} value={fIda}
              onChange={(e) => { const nueva = e.target.value; setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }}
              className={sel} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Regreso</label>
            <input type="date" min={fIda || hoy} value={fReg} onChange={(e) => setFReg(e.target.value)} className={sel} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Pax</label>
            <input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} className={`${sel} w-20`} />
          </div>
          <button type="button" onClick={() => buscar()} disabled={pending}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Buscando…" : "Buscar receptivos"}
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
              className="text-xs text-gray-400 hover:text-gray-700"
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

      {resultados && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-gray-500">{resultados.length} receptivo(s) disponibles para tu búsqueda</p>
          {resultados.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
              No hay receptivos disponibles para ese destino/fechas/pax.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultados.map((r) => (
                <div
                  key={`${r.paqueteId}-${r.servicioId}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                >
                  <button type="button" onClick={() => onVerDetalle(r)} className="flex-1 text-left">
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
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">total</div>
                      <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.total, r.moneda)}</div>
                      <div className="text-[10px] text-gray-400">{r.pax} pax</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onVerDetalle(r)} className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                        Ver más
                      </button>
                      {onAgregar && (
                        <button
                          type="button"
                          onClick={() => onAgregar({
                            tipo: "tour",
                            paqueteId: r.paqueteId,
                            servicioId: r.servicioId,
                            nombre: r.nombre,
                            destino: r.destino,
                            fotoUrl: r.servicioId != null ? (fotosPorServicio[r.servicioId] ?? null) : null,
                            fechaIda: fIda, fechaRegreso: fReg, noches: r.noches,
                            pax: r.pax, precio: r.total, moneda: r.moneda,
                          })}
                          className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
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
        </div>
      )}
    </div>
  );
}
