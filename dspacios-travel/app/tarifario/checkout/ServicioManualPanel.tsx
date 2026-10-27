"use client";

// #64 — Alta/edición/baja de un servicio MANUAL (vuelo libre u otro) sobre el
// carrito actual, solo para personal interno (el checkout lo monta únicamente
// con el contexto de asistencia autorizado; el servidor lo vuelve a exigir).
// No toca hoteles ni add-ons: usa `add`/`actualizarManual`/`remove` del carrito,
// que solo afectan al ítem manual. Aquí NO se captura costo ni proveedor.

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DateInput } from "@/components/ui/DateInput";
import { useCart, type ManualCartItem } from "@/lib/cart/CartContext";
import { validarServicioManual, type ServicioManual } from "@/lib/cart/servicioManual";
import { monedaDeItem, preverCotizacion, formatImporte } from "@/lib/cart/monedaCarrito";

const VACIO = { clase: "vuelo", nombre: "", origen: "", destino: "", fechaIda: "", fechaRegreso: "", pax: "1", precio: "", impuestoNoComisionable: "0", moneda: "COP" };
type Borrador = typeof VACIO;

const aBorrador = (m: ServicioManual): Borrador => ({
  clase: m.clase, nombre: m.nombre, origen: m.origen ?? "", destino: m.destino ?? "", fechaIda: m.fechaIda ?? "",
  fechaRegreso: m.fechaRegreso ?? "", pax: String(m.pax), precio: String(m.precio), impuestoNoComisionable: String(m.impuestoNoComisionable), moneda: m.moneda,
});

export function ServicioManualPanel() {
  const { items, add, actualizarManual, remove } = useCart();
  const manuales = items.filter((i): i is ManualCartItem => i.tipo === "manual");
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

  function limpiar() { setB(VACIO); setEditando(null); setErr(""); setAbierto(false); }

  function guardar() {
    const r = validarServicioManual({
      clase: b.clase, nombre: b.nombre, origen: b.origen, destino: b.destino, fechaIda: b.fechaIda, fechaRegreso: b.fechaRegreso,
      pax: Number(b.pax), precio: Number(b.precio.replace(/[^\d.]/g, "")), impuestoNoComisionable: Number(b.impuestoNoComisionable.replace(/[^\d.]/g, "") || "0"), moneda: monedaCarrito ?? b.moneda,
    }, monedaCarrito);
    if (!r.ok) { setErr(r.error); return; }
    if (editando) actualizarManual(editando, r.valor);
    else add({ ...r.valor, tipo: "manual", fotoUrl: null, noches: null });
    limpiar();
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Servicio manual (vuelo u otro)</h2>
        {!abierto && (
          <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
            <Plus size={14} aria-hidden /> Agregar
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Precio de venta declarado por el asesor. No reserva sillas ni confirma disponibilidad: en la cotización aparece «sujeto a confirmación». El costo y el proveedor se piden al convertir en contrato.
      </p>
      {manuales.length > 0 && (
        <ul className="mb-3 space-y-2">
          {manuales.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {m.nombre} · {m.pax} pax · {formatImporte(m.precio, monedaDeItem(m))}
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" aria-label={`Editar ${m.nombre}`} onClick={() => { setEditando(m.id); setB(aBorrador(m)); setAbierto(true); setErr(""); }} className="text-gray-500 hover:text-gray-800"><Pencil size={14} aria-hidden /></button>
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
            <select id="man-clase" className={inp} value={b.clase} onChange={(e) => set("clase", e.target.value)}>
              <option value="vuelo">Vuelo</option>
              <option value="otro">Otro servicio</option>
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="man-nombre">Descripción</label>
            <input id="man-nombre" className={inp} value={b.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder={b.clase === "vuelo" ? "Ej. Tiquete aéreo ida y regreso" : "Ej. Traslado privado"} />
          </div>
          {b.clase === "vuelo" && (
            <>
              <div>
                <label className={lbl} htmlFor="man-origen">Origen</label>
                <input id="man-origen" className={inp} value={b.origen} onChange={(e) => set("origen", e.target.value)} placeholder="BOG" />
              </div>
              <div>
                <label className={lbl} htmlFor="man-destino">Destino</label>
                <input id="man-destino" className={inp} value={b.destino} onChange={(e) => set("destino", e.target.value)} placeholder="CTG" />
              </div>
            </>
          )}
          <div>
            <label className={lbl} htmlFor="man-ida">Fecha de ida{b.clase === "vuelo" ? "" : " (opcional)"}</label>
            <DateInput id="man-ida" type="date" className={inp} value={b.fechaIda} onValueChange={(v) => set("fechaIda", v)} />
          </div>
          <div>
            <label className={lbl} htmlFor="man-regreso">Fecha de regreso (opcional)</label>
            <DateInput id="man-regreso" type="date" className={inp} min={b.fechaIda || undefined} value={b.fechaRegreso} onValueChange={(v) => set("fechaRegreso", v)} />
          </div>
          <div>
            <label className={lbl} htmlFor="man-pax">Pasajeros</label>
            <input id="man-pax" inputMode="numeric" className={inp} value={b.pax} onChange={(e) => set("pax", e.target.value.replace(/\D/g, ""))} />
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
