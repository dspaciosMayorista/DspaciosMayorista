"use client";

// #64 — Alta/edición/baja de un servicio MANUAL (vuelo libre u otro servicio) sobre el carrito actual, solo para personal interno (el servidor lo vuelve a exigir).
//
// Un VUELO es de ida, de regreso o de ida y regreso. Origen y destino son códigos IATA (CTG, BOG…): el del hotel sale del CATÁLOGO de destinos (si falta se pide corregirlo, no se
// infiere del nombre) y solo se escribe el de la otra ciudad. Las FECHAS salen del plan del hotel: ida y vuelta → ambas; solo ida → la ida; solo regreso → el regreso; si el plan cambia,
// el vuelo se actualiza. En una comparativa (`comun`) las alternativas se agrupan por destino IATA y fechas: un vuelo afecta a todos los hoteles de su grupo y nunca se suman los pasajeros
// de alternativas. Aquí NO se captura costo ni proveedor.

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { useCart, type ManualCartItem } from "@/lib/cart/CartContext";
import {
  agruparHotelesPorViaje, fechasDeVuelo, validarServicioManual, validarVueloContraHotel, vuelosComunesCompatibles,
  type HotelDeVuelo, type ServicioManual, type TramoVueloManual,
} from "@/lib/cart/servicioManual";
import { useIatasDestinos } from "@/lib/cart/useIatasDestinos";
import { monedaDeItem, preverCotizacion, formatImporte } from "@/lib/cart/monedaCarrito";

/** Marca heredada del vuelo común de una comparativa con un único grupo (el servidor la sigue aceptando). */
export const HOTEL_COMUN = "comun";

const ETIQUETA_TRAMO: Record<TramoVueloManual, string> = { ida: "Solo ida", regreso: "Solo regreso", ida_regreso: "Ida y regreso" };
const VACIO = { clase: "vuelo", tramo: "ida_regreso", hotelRef: "", nombre: "", otraCiudad: "", fechaIda: "", fechaRegreso: "", pax: "", precio: "", impuestoNoComisionable: "0", moneda: "COP" };
type Borrador = typeof VACIO;
type HotelPanel = HotelDeVuelo & { id: string; pax: number };

const corto = (f: string | null) => (f ? f.slice(5).replace("-", "/") : "—");

export function ServicioManualPanel({ comun = false }: { comun?: boolean }) {
  const { items, add, actualizarManual, remove } = useCart();
  const manuales = items.filter((i): i is ManualCartItem => i.tipo === "manual");
  const hotelesCarrito = items.filter((i) => i.tipo === "hotel");

  // Código IATA de cada destino: del catálogo (servidor); si falta, el destino queda sin código y se pide corregirlo.
  const iataDe = useIatasDestinos(hotelesCarrito.map((h) => h.destino));

  const hoteles: HotelPanel[] = hotelesCarrito.map((i) => ({
    id: i.id, ref: i.id, nombre: i.hotelNombre, destino: i.destino, destinoIata: iataDe(i.destino),
    fechaIda: "fechaIda" in i ? i.fechaIda : null, fechaRegreso: "fechaRegreso" in i ? i.fechaRegreso : null, pax: "pax" in i ? i.pax : 0,
  }));
  const { grupos, sinDato } = agruparHotelesPorViaje(hoteles);

  const [editando, setEditando] = useState<string | null>(null);
  const [b, setB] = useState<Borrador>(VACIO);
  const [err, setErr] = useState("");
  const [abierto, setAbierto] = useState(false);

  // Moneda ya fijada por el resto del carrito (sin contar el servicio que se edita): el manual se alinea a ella o se rechaza.
  const resto = items.filter((i) => i.id !== editando && i.tipo !== "manual");
  const monedaCarrito = preverCotizacion(resto).moneda ?? resto.map((i) => monedaDeItem(i)).find((m): m is string => !!m) ?? null;

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const lbl = "mb-1 block text-xs font-medium text-gray-600";
  const set = (k: keyof Borrador, v: string) => setB((p) => ({ ...p, [k]: v }));

  // ── A qué pertenece el vuelo ─────────────────────────────────────────────
  // Carrito normal: a UN hotel. Comparativa: a un GRUPO (destino IATA + fechas), que lleva a todos sus hoteles alternativos.
  const destinosDistintos = new Set(hoteles.map((h) => (h.destino ?? "").trim().toUpperCase())).size;
  const grupoDeHotel = (id: string) => grupos.find((g) => g.hoteles.some((h) => h.id === id)) ?? null;
  const grupoElegido = comun
    ? (grupos.length === 1 ? grupos[0] : (grupos.find((g) => g.clave === b.hotelRef) ?? grupoDeHotel(b.hotelRef)))
    : null;
  const hotelElegido: HotelPanel | null = comun ? null : (hoteles.length === 1 ? hoteles[0] : hoteles.find((h) => h.id === b.hotelRef) ?? null);
  // Referencia del plan: el hotel (carrito) o el grupo (comparativa).
  const plan = comun ? (grupoElegido ? { ida: grupoElegido.fechaIda, regreso: grupoElegido.fechaRegreso, iata: grupoElegido.destinoIata, destino: grupoElegido.hoteles[0].destino } : null)
    : (hotelElegido ? { ida: hotelElegido.fechaIda, regreso: hotelElegido.fechaRegreso, iata: hotelElegido.destinoIata ?? null, destino: hotelElegido.destino } : null);
  const tramo = b.tramo as TramoVueloManual;
  const fechas = plan ? fechasDeVuelo(tramo, { fechaIda: plan.ida, fechaRegreso: plan.regreso }) : { fechaIda: null, fechaRegreso: null };
  // Pasajeros: el carrito normal suma sus hoteles; en una comparativa las alternativas NO se suman (el vuelo propone los de una opción del grupo).
  const paxCarrito = hoteles.reduce((s, h) => s + (h.pax || 0), 0) || 1;
  const paxGrupo = grupoElegido ? Math.min(...grupoElegido.hoteles.map((h) => h.pax || 0).filter((n) => n > 0)) : 0;
  const paxPropuesto = comun ? (Number.isFinite(paxGrupo) && paxGrupo > 0 ? paxGrupo : (hoteles[0]?.pax || 1)) : paxCarrito;

  // Selector: hotel si hay más de un destino; si hay un destino con varias fechas, el grupo de fechas (sin exigir un hotel concreto).
  const selectorHotel = comun ? destinosDistintos > 1 : hoteles.length > 1;
  const selectorFechas = comun && destinosDistintos <= 1 && grupos.length > 1;

  // Mantiene las fechas del vuelo ligadas al plan: si el plan del hotel o del grupo cambió, el vuelo se actualiza solo.
  useEffect(() => {
    for (const m of manuales) {
      if (m.clase !== "vuelo" || !m.tramo || !m.hotelRef) continue;
      const g = grupos.find((x) => x.clave === m.hotelRef) ?? (comun && grupos.length === 1 && m.hotelRef === HOTEL_COMUN ? grupos[0] : null);
      const h = g ? g.hoteles[0] : hoteles.find((x) => x.id === m.hotelRef);
      if (!h) continue;
      const f = fechasDeVuelo(m.tramo, { fechaIda: g ? g.fechaIda : h.fechaIda, fechaRegreso: g ? g.fechaRegreso : h.fechaRegreso });
      if (f.fechaIda !== m.fechaIda || f.fechaRegreso !== m.fechaRegreso) {
        const { id: _i, tipo: _t, fotoUrl: _f, noches: _n, ...datos } = m;
        void _i; void _t; void _f; void _n;
        actualizarManual(m.id, { ...datos, ...f });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(hoteles.map((h) => [h.id, h.fechaIda, h.fechaRegreso])), manuales.map((m) => `${m.id}|${m.fechaIda}|${m.fechaRegreso}|${m.hotelRef}`).join(",")]);

  function limpiar() { setB(VACIO); setEditando(null); setErr(""); setAbierto(false); }
  function abrirNuevo() { setB({ ...VACIO, pax: String(comun ? (grupos.length === 1 && Number.isFinite(Math.min(...grupos[0].hoteles.map((h) => h.pax || 0))) ? Math.min(...grupos[0].hoteles.map((h) => h.pax || 0)) || 1 : (hoteles[0]?.pax || 1)) : paxCarrito) }); setAbierto(true); }

  function editar(m: ManualCartItem) {
    const esRegreso = m.tramo === "regreso";
    setEditando(m.id);
    setB({
      clase: m.clase, tramo: m.tramo ?? "ida_regreso", hotelRef: m.hotelRef ?? "", nombre: m.nombre, otraCiudad: (esRegreso ? m.destino : m.origen) ?? "",
      fechaIda: m.fechaIda ?? "", fechaRegreso: m.fechaRegreso ?? "", pax: String(m.pax), precio: String(m.precio),
      impuestoNoComisionable: String(m.impuestoNoComisionable), moneda: m.moneda,
    });
    setAbierto(true); setErr("");
  }

  function guardar() {
    const esVuelo = b.clase === "vuelo";
    if (esVuelo) {
      if (sinDato.length) {
        const h = sinDato[0];
        setErr(!h.destinoIata
          ? `El destino «${h.destino ?? "—"}» de «${h.nombre}» no tiene un código IATA confiable en el catálogo. Corrígelo en Producto → Destinos (no se infiere del nombre).`
          : `El hotel «${h.nombre}» no tiene fechas confirmadas: no se pueden asociar vuelos.`);
        return;
      }
      if (comun && !grupoElegido) { setErr("Elige a qué grupo de la comparativa (destino y fechas) pertenece el vuelo."); return; }
      if (!comun && !hotelElegido) { setErr("Elige el hotel o destino del carrito al que pertenece el vuelo."); return; }
      if (!plan?.iata) { setErr("El destino no tiene un código IATA confiable en el catálogo. Corrígelo en Producto → Destinos."); return; }
    }
    const otra = b.otraCiudad.trim().toUpperCase();
    const base = {
      clase: b.clase, nombre: b.nombre, pax: Number(b.pax),
      precio: Number(b.precio.replace(/[^\d.]/g, "")), impuestoNoComisionable: Number(b.impuestoNoComisionable.replace(/[^\d.]/g, "") || "0"), moneda: monedaCarrito ?? b.moneda,
    };
    const crudo = esVuelo
      ? {
        ...base, tramo, hotelRef: comun ? grupoElegido!.clave : hotelElegido!.id,
        origen: tramo === "regreso" ? plan!.iata : otra, destino: tramo === "regreso" ? otra : plan!.iata,
        fechaIda: fechas.fechaIda, fechaRegreso: fechas.fechaRegreso,
      }
      : { ...base, origen: null, destino: null, fechaIda: b.fechaIda, fechaRegreso: b.fechaRegreso };
    const r = validarServicioManual(crudo, monedaCarrito);
    if (!r.ok) { setErr(r.error); return; }
    // Mismas comprobaciones que el servidor: ciudad (IATA) y fechas del plan; en una comparativa, contra TODOS los hoteles del grupo y sin sumar pasajeros de alternativas.
    if (esVuelo) {
      const v = comun
        ? vuelosComunesCompatibles([r.valor], hoteles)
        : (() => { const x = validarVueloContraHotel(r.valor, { ...hotelElegido!, ref: hotelElegido!.id }); return x.ok ? { ok: true as const } : x; })();
      if (!v.ok) { setErr(v.error); return; }
    }
    if (editando) actualizarManual(editando, r.valor as ServicioManual);
    else add({ ...r.valor, tipo: "manual", fotoUrl: null, noches: null });
    limpiar();
  }

  const esVuelo = b.clase === "vuelo";
  const conIda = b.tramo !== "regreso";
  const conRegreso = b.tramo !== "ida";
  const iataHotel = plan?.iata ?? null;
  const hotelDelTramo = iataHotel ?? "IATA del destino";
  const otraTxt = b.otraCiudad.trim().toUpperCase() || "—";
  const rutaIda = tramo === "regreso" ? `${hotelDelTramo} → ${otraTxt}` : `${otraTxt} → ${hotelDelTramo}`;
  const etiquetaGrupo = (g: (typeof grupos)[number]) => `${g.destinoIata} · ${corto(g.fechaIda)} → ${corto(g.fechaRegreso)} · ${g.hoteles.map((h) => h.nombre).join(", ")}`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">{comun ? "Vuelos manuales de la comparativa" : "Servicio manual (vuelo u otro)"}</h2>
        {!abierto && (
          <button type="button" onClick={abrirNuevo} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
            <Plus size={14} aria-hidden /> Agregar
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Precio de venta declarado por el asesor. No reserva sillas ni confirma disponibilidad: en la cotización aparece «sujeto a confirmación». El costo y el proveedor se piden al convertir en contrato.
        {comun && " En una comparativa el vuelo se suma una sola vez al total de cada hotel de su grupo (mismo destino y fechas); nunca entre alternativas."}
      </p>
      {sinDato.length > 0 && (
        <p role="alert" data-testid="aviso-iata" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {sinDato[0].destinoIata
            ? `«${sinDato[0].nombre}» no tiene fechas confirmadas: no se pueden asociar vuelos.`
            : `El destino «${sinDato[0].destino ?? "—"}» de «${sinDato[0].nombre}» no tiene un código IATA confiable en el catálogo. Corrígelo en Producto → Destinos antes de agregar un vuelo (no se infiere del nombre).`}
        </p>
      )}
      {manuales.length > 0 && (
        <ul className="mb-3 space-y-2">
          {manuales.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                {m.nombre}{m.tramo ? ` · ${ETIQUETA_TRAMO[m.tramo]}` : ""}{m.clase === "vuelo" && m.origen && m.destino ? ` · ${m.origen} → ${m.destino}` : ""} · {m.pax} pax · {formatImporte(m.precio, monedaDeItem(m))}
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" aria-label={`Editar ${m.nombre}`} onClick={() => editar(m)} className="text-gray-500 hover:text-gray-800"><Pencil size={14} aria-hidden /></button>
                <button type="button" aria-label={`Quitar ${m.nombre}`} onClick={() => { remove(m.id); if (editando === m.id) limpiar(); }} className="text-gray-400 hover:text-red-500"><Trash2 size={14} aria-hidden /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {abierto && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl} htmlFor="man-clase">Tipo</label>
            <select id="man-clase" className={inp} value={b.clase} disabled={comun} onChange={(e) => set("clase", e.target.value)}>
              <option value="vuelo">Vuelo</option>
              {!comun && <option value="otro">Otro servicio</option>}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="man-nombre">Descripción</label>
            <input id="man-nombre" className={inp} value={b.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder={esVuelo ? "Ej. Tiquete Avianca" : "Ej. Traslado privado"} />
          </div>
          {esVuelo && (
            <>
              <div>
                <label className={lbl} htmlFor="man-tramo">Tramos del vuelo</label>
                <select id="man-tramo" className={inp} value={b.tramo} onChange={(e) => set("tramo", e.target.value)}>
                  {(Object.keys(ETIQUETA_TRAMO) as TramoVueloManual[]).map((t) => <option key={t} value={t}>{ETIQUETA_TRAMO[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="man-hotel">{comun ? "Grupo de la comparativa" : "Hotel o destino del carrito"}</label>
                {comun && !selectorHotel && !selectorFechas ? (
                  <p id="man-hotel" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {grupos.length ? `Todas las opciones · ${grupos[0].destinoIata} · ${corto(grupos[0].fechaIda)} → ${corto(grupos[0].fechaRegreso)}` : "Sin destino con código IATA"}
                  </p>
                ) : selectorFechas ? (
                  <select id="man-hotel" className={inp} value={grupoElegido?.clave ?? ""} onChange={(e) => set("hotelRef", e.target.value)}>
                    <option value="">Elige las fechas…</option>
                    {grupos.map((g) => <option key={g.clave} value={g.clave}>{etiquetaGrupo(g)}</option>)}
                  </select>
                ) : !comun && hoteles.length === 1 ? (
                  <p id="man-hotel" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{hoteles[0].nombre}{hoteles[0].destino ? ` · ${hoteles[0].destino}` : ""}</p>
                ) : (
                  <select id="man-hotel" className={inp} value={comun ? (grupoElegido ? (grupoElegido.hoteles[0]?.id ?? "") : "") : b.hotelRef}
                    onChange={(e) => set("hotelRef", e.target.value)}>
                    <option value="">Elige el hotel…</option>
                    {hoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}{h.destinoIata ? ` · ${h.destinoIata}` : ""}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={lbl} htmlFor="man-hotel-ciudad">{tramo === "regreso" ? "Origen (IATA del hotel)" : "Llegada (IATA del hotel)"}</label>
                <p id="man-hotel-ciudad" className="rounded-lg bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700">{iataHotel ?? "—"}</p>
              </div>
              <div>
                <label className={lbl} htmlFor="man-otra">{tramo === "regreso" ? "Destino (código IATA)" : "Origen (código IATA)"}</label>
                <input id="man-otra" className={`${inp} font-mono uppercase`} maxLength={3} value={b.otraCiudad} onChange={(e) => set("otraCiudad", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())} placeholder="BOG" />
              </div>
              <p className="text-xs text-gray-600 sm:col-span-2" data-testid="resumen-tramos-vuelo">
                {tramo === "ida_regreso"
                  ? <>Ida: <b>{rutaIda}</b> · Regreso: <b>{hotelDelTramo} → {otraTxt}</b></>
                  : <>{tramo === "ida" ? "Ida" : "Regreso"}: <b>{rutaIda}</b></>}
              </p>
            </>
          )}
          <div>
            <label className={lbl} htmlFor="man-ida">{esVuelo ? "Fecha del vuelo de ida (del plan)" : "Fecha de ida (opcional)"}</label>
            {!esVuelo ? (
              <DateInput id="man-ida" type="date" className={inp} value={b.fechaIda} onValueChange={(v) => set("fechaIda", v)} />
            ) : conIda ? (
              <p id="man-ida" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{fechas.fechaIda ?? "Elige el hotel o grupo"}</p>
            ) : <p id="man-ida" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-400">No aplica</p>}
          </div>
          <div>
            <label className={lbl} htmlFor="man-regreso">{esVuelo ? "Fecha del vuelo de regreso (del plan)" : "Fecha de regreso (opcional)"}</label>
            {!esVuelo ? (
              <DateInput id="man-regreso" type="date" className={inp} min={b.fechaIda || undefined} value={b.fechaRegreso} onValueChange={(v) => set("fechaRegreso", v)} />
            ) : conRegreso ? (
              <p id="man-regreso" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{fechas.fechaRegreso ?? "Elige el hotel o grupo"}</p>
            ) : <p id="man-regreso" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-400">No aplica</p>}
          </div>
          <div>
            <label className={lbl} htmlFor="man-pax">Pasajeros en este vuelo</label>
            <input id="man-pax" inputMode="numeric" className={inp} value={b.pax} onChange={(e) => set("pax", e.target.value.replace(/\D/g, ""))} />
            <p className="mt-1 text-[11px] text-gray-500">
              {comun
                ? `Por defecto, los de una opción del grupo (${paxPropuesto}); las alternativas no se suman. Cámbialo si el grupo viaja en vuelos distintos.`
                : `Por defecto, todos los de la cotización (${paxCarrito}). Cámbialo si el grupo viaja en vuelos distintos.`}
            </p>
          </div>
          <div>
            <label className={lbl} htmlFor="man-precio">Precio de venta total ({monedaCarrito ?? b.moneda})</label>
            <input id="man-precio" inputMode="decimal" className={inp} value={b.precio} onChange={(e) => set("precio", e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="man-imp">Impuesto no comisionable ({monedaCarrito ?? b.moneda})</label>
            <input id="man-imp" inputMode="decimal" className={inp} value={b.impuestoNoComisionable} onChange={(e) => set("impuestoNoComisionable", e.target.value)} />
            <p className="mt-1 text-[11px] text-gray-500">Parte del precio sobre la que no se paga comisión (p. ej. impuestos del vuelo). 0 si no aplica.</p>
          </div>
          {!monedaCarrito && (
            <div>
              <label className={lbl} htmlFor="man-moneda">Moneda</label>
              <select id="man-moneda" className={inp} value={b.moneda} onChange={(e) => set("moneda", e.target.value)}>
                <option value="COP">COP</option>
                <option value="USD">USD</option>
              </select>
            </div>
          )}
          {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">{err}</p>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" onClick={guardar} className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--brand-primary)" }}>
              {editando ? "Guardar cambios" : "Agregar al carrito"}
            </button>
            <button type="button" onClick={limpiar} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
