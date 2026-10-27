"use client";

// #64 — Alta/edición/baja de un servicio MANUAL (vuelo libre u otro servicio) sobre el
// carrito actual, solo para personal interno (el checkout lo monta únicamente
// con el contexto de asistencia autorizado; el servidor lo vuelve a exigir).
// Un VUELO es de ida, de regreso o de ida y regreso y pertenece a UN hotel del carrito:
// la ciudad del hotel sale del hotel (no se escribe) y las fechas se acotan a su estadía.
// En una comparativa (`comun`) el vuelo es común a todas las opciones: se valida contra todas.
// No toca hoteles ni add-ons: usa `add`/`actualizarManual`/`remove` del carrito.
// Aquí NO se captura costo ni proveedor.

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { useCart, type ManualCartItem } from "@/lib/cart/CartContext";
import { validarServicioManual, validarVueloContraHotel, vuelosComunesCompatibles, normalizarCiudad, type ServicioManual, type TramoVueloManual } from "@/lib/cart/servicioManual";
import { monedaDeItem, preverCotizacion, formatImporte } from "@/lib/cart/monedaCarrito";

/** Marca del vuelo común de una comparativa: el servidor lo valida contra CADA opción, no contra un hotel del carrito. */
export const HOTEL_COMUN = "comun";

const ETIQUETA_TRAMO: Record<TramoVueloManual, string> = { ida: "Solo ida", regreso: "Solo regreso", ida_regreso: "Ida y regreso" };
const VACIO = { clase: "vuelo", tramo: "ida_regreso", hotelRef: "", nombre: "", otraCiudad: "", fechaIda: "", fechaRegreso: "", pax: "", precio: "", impuestoNoComisionable: "0", moneda: "COP" };
type Borrador = typeof VACIO;

export function ServicioManualPanel({ comun = false }: { comun?: boolean }) {
  const { items, add, actualizarManual, remove } = useCart();
  const manuales = items.filter((i): i is ManualCartItem => i.tipo === "manual");
  // Hoteles del carrito (con sus fechas si el carrito las trae; un hotel por unidad sin fechas las valida el servidor).
  const hoteles = items.filter((i) => i.tipo === "hotel").map((i) => ({
    id: i.id, nombre: i.hotelNombre, destino: i.destino,
    fechaIda: "fechaIda" in i ? i.fechaIda : null, fechaRegreso: "fechaRegreso" in i ? i.fechaRegreso : null, pax: "pax" in i ? i.pax : 0,
  }));
  // Pasajeros del vuelo: por defecto el total de la cotización del carrito (editable: un grupo puede usar varios vuelos de distintas aerolíneas).
  const paxCarrito = hoteles.reduce((s, h) => s + (h.pax || 0), 0) || 1;
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

  // Hotel al que pertenece el vuelo: con UN solo hotel se asocia a él; con varios hay que elegir (nunca el primero por defecto).
  const hotelElegido = comun ? null : hoteles.length === 1 ? hoteles[0] : hoteles.find((h) => h.id === b.hotelRef) ?? null;
  const destinosComunes = [...new Set(hoteles.map((h) => normalizarCiudad(h.destino)))];
  const ciudadHotel = comun ? (destinosComunes.length === 1 ? hoteles[0]?.destino ?? null : null) : hotelElegido?.destino ?? null;
  const limites = comun
    ? { min: hoteles.map((h) => h.fechaIda).filter((f): f is string => !!f).sort().pop(), max: hoteles.map((h) => h.fechaRegreso).filter((f): f is string => !!f).sort()[0] }
    : { min: hotelElegido?.fechaIda ?? undefined, max: hotelElegido?.fechaRegreso ?? undefined };

  function limpiar() { setB(VACIO); setEditando(null); setErr(""); setAbierto(false); }
  function abrirNuevo() { setB({ ...VACIO, pax: String(paxCarrito) }); setAbierto(true); }

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
    const tramo = b.tramo as TramoVueloManual;
    if (esVuelo && !comun && !hotelElegido) { setErr("Elige el hotel o destino del carrito al que pertenece el vuelo."); return; }
    if (esVuelo && !ciudadHotel) { setErr(comun ? "Las opciones de la comparativa deben tener el mismo destino para agregar un vuelo común." : "El hotel elegido no tiene destino confirmado."); return; }
    const otra = b.otraCiudad.trim();
    const base = {
      clase: b.clase, nombre: b.nombre, pax: Number(b.pax),
      precio: Number(b.precio.replace(/[^\d.]/g, "")), impuestoNoComisionable: Number(b.impuestoNoComisionable.replace(/[^\d.]/g, "") || "0"), moneda: monedaCarrito ?? b.moneda,
    };
    const crudo = esVuelo
      ? {
        ...base, tramo, hotelRef: comun ? HOTEL_COMUN : hotelElegido!.id,
        origen: tramo === "regreso" ? ciudadHotel : otra, destino: tramo === "regreso" ? otra : ciudadHotel,
        fechaIda: tramo === "regreso" ? null : b.fechaIda, fechaRegreso: tramo === "ida" ? null : b.fechaRegreso,
      }
      : { ...base, origen: null, destino: null, fechaIda: b.fechaIda, fechaRegreso: b.fechaRegreso };
    const r = validarServicioManual(crudo, monedaCarrito);
    if (!r.ok) { setErr(r.error); return; }
    // Mismas comprobaciones que el servidor, ya aquí: ciudad del hotel y fechas dentro de su estadía (en una comparativa, contra TODAS las opciones).
    if (esVuelo) {
      const completos = hoteles.filter((h) => h.fechaIda && h.fechaRegreso && h.destino).map((h) => ({ ref: h.id, nombre: h.nombre, destino: h.destino, fechaIda: h.fechaIda, fechaRegreso: h.fechaRegreso }));
      const objetivo = comun ? completos : completos.filter((h) => h.ref === hotelElegido!.id);
      const v = vuelosComunesCompatibles([r.valor], objetivo);
      if (!v.ok) { setErr(v.error); return; }
    }
    if (editando) actualizarManual(editando, r.valor as ServicioManual);
    else add({ ...r.valor, tipo: "manual", fotoUrl: null, noches: null });
    limpiar();
  }

  const esVuelo = b.clase === "vuelo";
  const conIda = b.tramo !== "regreso";
  const conRegreso = b.tramo !== "ida";
  const hotelDelTramo = ciudadHotel ?? "ciudad del hotel";
  const otraTxt = b.otraCiudad.trim() || "otra ciudad";
  const rutaIda = b.tramo === "regreso" ? `${hotelDelTramo} → ${otraTxt}` : `${otraTxt} → ${hotelDelTramo}`;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{comun ? "Vuelo manual común a las opciones" : "Servicio manual (vuelo u otro)"}</h2>
        {!abierto && (
          <button type="button" onClick={abrirNuevo} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
            <Plus size={14} aria-hidden /> Agregar
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Precio de venta declarado por el asesor. No reserva sillas ni confirma disponibilidad: en la cotización aparece «sujeto a confirmación». El costo y el proveedor se piden al convertir en contrato.
        {comun && " En una comparativa el vuelo se suma una sola vez a cada opción; nunca entre opciones."}
      </p>
      {manuales.length > 0 && (
        <ul className="mb-3 space-y-2">
          {manuales.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {m.nombre}{m.tramo ? ` · ${ETIQUETA_TRAMO[m.tramo]}` : ""} · {m.pax} pax · {formatImporte(m.precio, monedaDeItem(m))}
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
        <div className="grid grid-cols-2 gap-3">
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
                <label className={lbl} htmlFor="man-hotel">Hotel o destino del carrito</label>
                {comun ? (
                  <p id="man-hotel" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">Todas las opciones{ciudadHotel ? ` · ${ciudadHotel}` : ""}</p>
                ) : hoteles.length === 1 ? (
                  <p id="man-hotel" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{hoteles[0].nombre}{hoteles[0].destino ? ` · ${hoteles[0].destino}` : ""}</p>
                ) : (
                  <select id="man-hotel" className={inp} value={b.hotelRef} onChange={(e) => set("hotelRef", e.target.value)}>
                    <option value="">Elige el hotel…</option>
                    {hoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}{h.destino ? ` · ${h.destino}` : ""}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={lbl} htmlFor="man-hotel-ciudad">{b.tramo === "regreso" ? "Ciudad de origen (del hotel)" : "Ciudad de llegada (del hotel)"}</label>
                <p id="man-hotel-ciudad" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{ciudadHotel ?? "—"}</p>
              </div>
              <div>
                <label className={lbl} htmlFor="man-otra">{b.tramo === "regreso" ? "Ciudad de destino" : "Ciudad de origen"}</label>
                <input id="man-otra" className={inp} value={b.otraCiudad} onChange={(e) => set("otraCiudad", e.target.value)} placeholder="BOG" />
              </div>
              <p className="col-span-2 text-xs text-gray-600" data-testid="resumen-tramos-vuelo">
                {b.tramo === "ida_regreso"
                  ? <>Ida: <b>{rutaIda}</b> · Regreso: <b>{hotelDelTramo} → {otraTxt}</b></>
                  : <>{b.tramo === "ida" ? "Ida" : "Regreso"}: <b>{rutaIda}</b></>}
              </p>
            </>
          )}
          <div>
            <label className={lbl} htmlFor="man-ida">{esVuelo ? "Fecha del vuelo de ida" : "Fecha de ida (opcional)"}</label>
            {(!esVuelo || conIda) ? (
              <DateInput id="man-ida" type="date" className={inp} min={esVuelo ? limites.min ?? undefined : undefined} max={esVuelo ? limites.max ?? undefined : undefined} value={b.fechaIda} onValueChange={(v) => set("fechaIda", v)} />
            ) : <p id="man-ida" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-400">No aplica</p>}
          </div>
          <div>
            <label className={lbl} htmlFor="man-regreso">{esVuelo ? "Fecha del vuelo de regreso" : "Fecha de regreso (opcional)"}</label>
            {(!esVuelo || conRegreso) ? (
              <DateInput id="man-regreso" type="date" className={inp} min={(esVuelo ? (b.fechaIda || limites.min) : b.fechaIda) || undefined} max={esVuelo ? limites.max ?? undefined : undefined} value={b.fechaRegreso} onValueChange={(v) => set("fechaRegreso", v)} />
            ) : <p id="man-regreso" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-400">No aplica</p>}
          </div>
          <div>
            <label className={lbl} htmlFor="man-pax">Pasajeros en este vuelo</label>
            <input id="man-pax" inputMode="numeric" className={inp} value={b.pax} onChange={(e) => set("pax", e.target.value.replace(/\D/g, ""))} />
            <p className="mt-1 text-[11px] text-gray-500">Por defecto, todos los de la cotización ({paxCarrito}). Cámbialo si el grupo viaja en vuelos distintos.</p>
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
          {err && <p role="alert" className="col-span-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
          <div className="col-span-2 flex gap-2">
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
