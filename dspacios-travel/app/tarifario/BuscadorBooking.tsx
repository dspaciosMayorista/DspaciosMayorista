"use client";

import { useState, useTransition } from "react";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type CartItem } from "@/lib/cart/CartContext";
import { buscarHoteles, type BusquedaResultado } from "@/app/(dashboard)/dashboard/reservar/actions";

type Hab = { acom: AcomRoom; ninos: number };

function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00`); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function BuscadorBooking({
  fotosPorHotel = {}, infoPorHotel = {},
}: {
  fotosPorHotel?: Record<number, string>;
  infoPorHotel?: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null }>;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState(hoy);
  const [fReg, setFReg] = useState(sumarDias(hoy, 3));
  const [adultos, setAdultos] = useState("2");
  const [ninos, setNinos] = useState("0");
  const [infantes, setInfantes] = useState("0");
  const [nHab, setNHab] = useState("1");
  const [habs, setHabs] = useState<Hab[]>([{ acom: "doble", ninos: 0 }]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [resultados, setResultados] = useState<BusquedaResultado[] | null>(null);

  // Ajusta el nº de filas de habitación.
  function setCantidad(n: number) {
    const cant = Math.max(1, Math.min(8, Math.trunc(n) || 1));
    setNHab(String(cant));
    setHabs((prev) => {
      const next = [...prev];
      while (next.length < cant) next.push({ acom: "doble", ninos: 0 });
      next.length = cant;
      return next;
    });
  }
  const setHab = (i: number, patch: Partial<Hab>) => setHabs((p) => p.map((h, n) => (n === i ? { ...h, ...patch } : h)));

  const ninosAsignados = habs.reduce((s, h) => s + (Number(h.ninos) || 0), 0);
  const ninosTotal = Number(ninos) || 0;

  function buscar() {
    setErr(""); setResultados(null);
    if (ninosAsignados !== ninosTotal) { setErr(`Asigna los ${ninosTotal} niño(s) a las habitaciones (asignados: ${ninosAsignados}).`); return; }
    start(async () => {
      const r = await buscarHoteles({ fechaIda: fIda, fechaRegreso: fReg, habitaciones: habs.map((h) => ({ acom: h.acom, ninos: Number(h.ninos) || 0 })), infantes: Number(infantes) || 0 });
      if (r.ok) setResultados(r.resultados);
      else setErr(r.error);
    });
  }

  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar alojamiento</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="mb-1 block text-xs text-gray-500">Ida</label><input type="date" min={hoy} value={fIda} onChange={(e) => { setFIda(e.target.value); if (fReg <= e.target.value) setFReg(sumarDias(e.target.value, 3)); }} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Regreso</label><input type="date" min={fIda} value={fReg} onChange={(e) => setFReg(e.target.value)} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Adultos (12+)</label><input type="number" min={1} value={adultos} onChange={(e) => setAdultos(e.target.value)} className={`${sel} w-20`} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Niños (2-11)</label><input type="number" min={0} value={ninos} onChange={(e) => setNinos(e.target.value)} className={`${sel} w-20`} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Infantes (0-1)</label><input type="number" min={0} value={infantes} onChange={(e) => setInfantes(e.target.value)} className={`${sel} w-20`} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Habitaciones</label><input type="number" min={1} max={8} value={nHab} onChange={(e) => setCantidad(Number(e.target.value))} className={`${sel} w-20`} /></div>
        </div>

        {/* Una fila por habitación: acomodación + niños en esa habitación */}
        <div className="mt-3 space-y-2">
          {habs.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-gray-500">Habitación {i + 1}</span>
              <select value={h.acom} onChange={(e) => setHab(i, { acom: e.target.value as AcomRoom })} className={sel}>
                {ACOM_ROOMS.map((a) => <option key={a} value={a}>{ACOM_ROOM_LABEL[a]}</option>)}
              </select>
              {ninosTotal > 0 && (
                <label className="flex items-center gap-1 text-gray-500">
                  Niños aquí
                  <input type="number" min={0} value={h.ninos} onChange={(e) => setHab(i, { ninos: Math.max(0, Number(e.target.value) || 0) })} className={`${sel} w-16`} />
                </label>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={buscar} disabled={pending} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Buscando…" : "Buscar hoteles"}
          </button>
          {resultados && <button type="button" onClick={() => setResultados(null)} className="text-xs text-gray-400 hover:text-gray-700">Limpiar resultados</button>}
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      {resultados && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-gray-500">{resultados.length} hotel(es) disponibles para tu búsqueda</p>
          {resultados.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">No hay hoteles que cumplan esa composición/fechas. Prueba otra acomodación o fechas.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultados.map((r) => (
                <Resultado
                  key={`${r.paqueteId}-${r.hotelId}`}
                  r={r}
                  foto={fotosPorHotel[r.hotelId] ?? null}
                  info={infoPorHotel[r.hotelId]}
                  item={{
                    modulo: "porcion_terrestre", paqueteId: r.paqueteId, hotelId: r.hotelId, bloqueoId: null,
                    hotelNombre: r.hotelNombre ?? "", destino: r.destino, fotoUrl: fotosPorHotel[r.hotelId] ?? null,
                    categoria: r.categoria, regimen: r.regimen, fechaIda: r.fechaIda, fechaRegreso: r.fechaRegreso, noches: r.noches,
                    habitaciones: r.habitaciones, ninos: r.ninos, ninos2: 0, pax: r.pax, precio: r.total,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Resultado({ r, foto, info, item }: { r: BusquedaResultado; foto: string | null; info?: { estrellas: number | null; clasificacion: string | null }; item: Omit<CartItem, "id"> }) {
  const { items, add, remove } = useCart();
  // El estado del botón se deriva del carrito real: si se quita del carrito,
  // vuelve a estar disponible para agregar.
  const enCarrito = items.find((i) =>
    i.hotelId === item.hotelId && i.paqueteId === item.paqueteId &&
    i.fechaIda === item.fechaIda && i.fechaRegreso === item.fechaRegreso &&
    i.categoria === item.categoria && i.regimen === item.regimen);
  const estrellas = info?.estrellas && info.estrellas > 0 ? "★".repeat(info.estrellas) : "";
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="aspect-[16/10] w-full bg-gray-100">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt={r.hotelNombre ?? ""} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">{r.hotelNombre}</span>
          {estrellas && <span className="text-sm text-amber-400">{estrellas}</span>}
        </div>
        <div className="text-xs text-gray-500">{r.destino ?? ""} · {r.categoria} / {r.regimen} · {r.noches}N</div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">total {r.pax} pax</div>
            <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(r.total)}</div>
          </div>
          <button type="button" onClick={() => (enCarrito ? remove(enCarrito.id) : add(item))}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: enCarrito ? "var(--brand-success)" : "var(--brand-primary)" }}>
            {enCarrito ? "✓ En el carrito · quitar" : "Agregar al carrito"}
          </button>
        </div>
      </div>
    </div>
  );
}
