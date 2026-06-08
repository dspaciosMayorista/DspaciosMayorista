"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, PAX_TARIFA_DEFAULT, type AcomRoom } from "@/lib/acomodaciones";
import { useCart } from "@/lib/cart/CartContext";
import { cotizarPorFechas, type ComboCotizado } from "@/app/(dashboard)/dashboard/reservar/actions";
import { RegimenInfo, type PlanesInfo } from "./RegimenInfo";
import type { FilaTarifario } from "./TarifarioPublic";

// ── Modelo de la vista dinámica: tarjetas por hotel, detalle con opciones ────
type HotelCard = {
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  foto: string | null;
  desde: number | null;
  estrellas: number | null;
  clasificacion: string | null;
  descripcion: string | null;
  filas: FilaTarifario[];
};

// Estrellas (★) o, si no maneja, la clasificación (Boutique/Luxury…) como chip.
function Categoria({ estrellas, clasificacion, className = "" }: { estrellas: number | null; clasificacion: string | null; className?: string }) {
  if (estrellas && estrellas > 0) {
    return <span className={`text-amber-400 ${className}`} title={`${estrellas} estrellas`}>{"★".repeat(estrellas)}</span>;
  }
  if (clasificacion?.trim()) {
    return <span className={`rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 ${className}`}>{clasificacion}</span>;
  }
  return null;
}

type Opcion = {
  key: string;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  bloqueoId: number | null;
  label: string;
  destino: string | null;
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

function sumarDias(fecha: string, n: number): string {
  if (!fecha) return "";
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Ciclo base del tarifario: 3 noches. La fecha de regreso por defecto es la de
// ida + 3 noches (no el rango completo del paquete).
const CICLO_NOCHES = 3;

function minRoomPvp(filas: FilaTarifario[]): number | null {
  const precios = filas
    .filter((f) => f.acomodacion && f.acomodacion !== "nino" && f.acomodacion !== "nino2" && f.precio_pvp > 0)
    .map((f) => f.precio_pvp);
  return precios.length ? Math.min(...precios) : null;
}

export function VistaBooking({
  filas,
  fotosPorHotel = {},
  cuposPorBloqueo = {},
  puedeReservar = false,
  ventanaPorPaquete = {},
  infoPorHotel = {},
  planesInfo = {},
}: {
  filas: FilaTarifario[];
  fotosPorHotel?: Record<number, string>;
  cuposPorBloqueo?: Record<number, number>;
  puedeReservar?: boolean;
  ventanaPorPaquete?: Record<number, { min: string | null; max: string | null }>;
  infoPorHotel?: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null }>;
  planesInfo?: PlanesInfo;
}) {
  // Solo módulos con hotel (bloqueo + porción). Servicios/programas viven en la tabla.
  const hoteles = useMemo<HotelCard[]>(() => {
    const conHotel = filas.filter(
      (f) => (f.modulo === "bloqueo" || f.modulo === "porcion_terrestre") && f.hotel_id != null
    );
    const map = new Map<number, HotelCard>();
    for (const f of conHotel) {
      const id = f.hotel_id as number;
      let c = map.get(id);
      if (!c) {
        const info = infoPorHotel[id];
        c = {
          hotelId: id, hotelNombre: f.hotel_nombre ?? "—", destino: f.destino_nombre,
          foto: fotosPorHotel[id] ?? null, desde: null,
          estrellas: info?.estrellas ?? null, clasificacion: info?.clasificacion ?? null, descripcion: info?.descripcion ?? null,
          filas: [],
        };
        map.set(id, c);
      }
      c.filas.push(f);
    }
    const arr = [...map.values()];
    for (const c of arr) c.desde = minRoomPvp(c.filas);
    return arr.sort((a, b) => a.hotelNombre.localeCompare(b.hotelNombre));
  }, [filas, fotosPorHotel, infoPorHotel]);

  const [abierto, setAbierto] = useState<HotelCard | null>(null);

  if (!hoteles.length) {
    return <p className="py-12 text-center text-sm text-gray-400">No hay alojamientos para los filtros aplicados.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hoteles.map((h) => (
          <button
            key={h.hotelId}
            type="button"
            onClick={() => setAbierto(h)}
            className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="relative aspect-[16/10] w-full bg-gray-100">
              {h.foto ? (
                <Image src={h.foto} alt={h.hotelNombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800">{h.hotelNombre}</span>
                <Categoria estrellas={h.estrellas} clasificacion={h.clasificacion} className="text-sm" />
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{h.destino ?? ""}</div>
              {h.descripcion?.trim() && (
                <p className="mt-1 line-clamp-2 text-xs text-gray-400">{h.descripcion}</p>
              )}
              <div className="mt-3 flex items-end justify-between">
                {h.desde != null ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
                    <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(h.desde)}</div>
                    <div className="text-[10px] text-gray-400">por persona</div>
                  </div>
                ) : <span className="text-sm text-gray-400">Consultar</span>}
                <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand-accent)" }}>
                  Ver opciones →
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {abierto && (
        <HotelModal hotel={abierto} cuposPorBloqueo={cuposPorBloqueo} puedeReservar={puedeReservar} ventanaPorPaquete={ventanaPorPaquete} planesInfo={planesInfo} onClose={() => setAbierto(null)} />
      )}
    </div>
  );
}

// ── Modal de detalle: elige opción (salida/paquete), categoría/régimen y
//    habitaciones; calcula el precio y agrega al carrito ─────────────────────
function HotelModal({
  hotel, cuposPorBloqueo, puedeReservar, ventanaPorPaquete, planesInfo, onClose,
}: {
  hotel: HotelCard; cuposPorBloqueo: Record<number, number>; puedeReservar: boolean;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>; planesInfo: PlanesInfo; onClose: () => void;
}) {
  const { add } = useCart();

  const opciones = useMemo<Opcion[]>(() => {
    const map = new Map<string, Opcion>();
    for (const f of hotel.filas) {
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
          fechaIda: f.fecha_ida,
          fechaRegreso: f.fecha_regreso,
          noches: f.noches,
          filas: [],
        };
        map.set(key, o);
      }
      o.filas.push(f);
    }
    return [...map.values()];
  }, [hotel, cuposPorBloqueo]);

  const [opKey, setOpKey] = useState(opciones[0]?.key ?? "");
  const opcion = opciones.find((o) => o.key === opKey) ?? opciones[0];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[16/9] w-full bg-gray-100">
          {hotel.foto ? (
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
            </div>
            <p className="text-sm text-gray-500">{hotel.destino ?? ""}</p>
            {hotel.descripcion?.trim() && (
              <p className="mt-2 text-sm text-gray-600">{hotel.descripcion}</p>
            )}
          </div>

          {!opcion ? (
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
                        style={opKey === o.key
                          ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.08)" }
                          : { borderColor: "#e5e7eb", backgroundColor: "white" }}
                      >
                        <span className="block font-medium text-gray-800">{o.label}</span>
                        <span className="block text-xs text-gray-500">
                          {o.fechaIda ? `${fmtFecha(o.fechaIda)} → ${fmtFecha(o.fechaRegreso)}` : ""}{o.noches ? ` · ${o.noches}N` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {opcion.modulo === "porcion_terrestre" ? (
                <SelectorPorFechas
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  ventana={ventanaPorPaquete[opcion.paqueteId] ?? { min: null, max: null }}
                  planesInfo={planesInfo}
                  onAgregar={(item) => { add(item); onClose(); }}
                />
              ) : (
                <Selector
                  key={opcion.key}
                  opcion={opcion}
                  hotel={hotel}
                  puedeReservar={puedeReservar}
                  planesInfo={planesInfo}
                  onAgregar={(item) => { add(item); onClose(); }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Selector({
  opcion, hotel, puedeReservar, planesInfo, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; puedeReservar: boolean; planesInfo: PlanesInfo;
  onAgregar: (item: Parameters<ReturnType<typeof useCart>["add"]>[0]) => void;
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

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, pax: number, precio: number) =>
    onAgregar({
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: opcion.bloqueoId,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: opcion.fechaIda, fechaRegreso: opcion.fechaRegreso, noches: opcion.noches,
      habitaciones, ninos, ninos2, pax, precio,
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

      <EditorPax pvp={pvp} nota={!puedeReservar ? "El valor es una estimación con tarifas publicadas; el precio final se confirma al generar la cotización." : undefined} onAgregar={agregarItem} />
    </div>
  );
}

// Editor de habitaciones/niños + total + botón. Recibe el PVP por acomodación y
// reporta la selección (no conoce fechas ni módulo). Reutilizado por bloqueo y porción.
function EditorPax({
  pvp, nota, onAgregar,
}: {
  pvp: Record<string, number>;
  nota?: string;
  onAgregar: (habitaciones: Record<string, number>, ninos: number, ninos2: number, pax: number, precio: number) => void;
}) {
  const [habs, setHabs] = useState<Record<string, number>>({});
  const [ninos, setNinos] = useState(0);
  const [ninos2, setNinos2] = useState(0);
  const setHab = (a: AcomRoom, n: number) => setHabs((p) => ({ ...p, [a]: Math.max(0, n) }));

  let precio = 0;
  let pax = 0;
  for (const a of ACOM_ROOMS) {
    const rooms = habs[a] ?? 0;
    if (rooms > 0 && pvp[a] != null) { const p = rooms * PAX_TARIFA_DEFAULT[a]; precio += p * pvp[a]; pax += p; }
  }
  if (ninos > 0 && pvp["nino"] != null) { precio += ninos * pvp["nino"]; pax += ninos; }
  if (ninos2 > 0 && pvp["nino2"] != null) { precio += ninos2 * pvp["nino2"]; pax += ninos2; }

  function agregar() {
    if (precio <= 0) return;
    const habitaciones: Record<string, number> = {};
    for (const a of ACOM_ROOMS) if ((habs[a] ?? 0) > 0) habitaciones[a] = habs[a];
    onAgregar(habitaciones, ninos, ninos2, pax, precio);
  }

  const inputCls = "w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Habitaciones</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACOM_ROOMS.map((a) => (
            <div key={a} className={`rounded-lg border p-2 ${pvp[a] == null ? "opacity-40" : ""}`}>
              <div className="text-xs font-medium text-gray-700">{ACOM_ROOM_LABEL[a]}</div>
              <div className="text-[11px] text-gray-400">{pvp[a] != null ? `${formatCOP(pvp[a])}/pers` : "No aplica"}</div>
              <input type="number" min={0} value={habs[a] ?? 0} disabled={pvp[a] == null}
                onChange={(e) => setHab(a, Number(e.target.value))} className={`${inputCls} mt-1`} />
            </div>
          ))}
        </div>
      </div>

      {(pvp["nino"] != null || pvp["nino2"] != null) && (
        <div className="flex flex-wrap gap-3">
          {pvp["nino"] != null && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Niños 1 ({formatCOP(pvp["nino"])})</label>
              <input type="number" min={0} value={ninos} onChange={(e) => setNinos(Math.max(0, Number(e.target.value)))} className={inputCls} />
            </div>
          )}
          {pvp["nino2"] != null && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Niños 2 ({formatCOP(pvp["nino2"])})</label>
              <input type="number" min={0} value={ninos2} onChange={(e) => setNinos2(Math.max(0, Number(e.target.value)))} className={inputCls} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div>
          <div className="text-xs text-gray-400">Total estimado{pax > 0 ? ` · ${pax} pax` : ""}</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(precio)}</div>
        </div>
        <button type="button" onClick={agregar} disabled={precio <= 0}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--brand-primary)" }}>
          Agregar al carrito
        </button>
      </div>
      {nota && <p className="text-[11px] text-gray-400">{nota}</p>}
    </>
  );
}

// Motor por fechas (porción/dinámico): el usuario elige las fechas reales y se
// liquida la tarifa noche por noche (cotizarPorFechas, service-role, solo PVP).
function SelectorPorFechas({
  opcion, hotel, ventana, planesInfo, onAgregar,
}: {
  opcion: Opcion; hotel: HotelCard; ventana: { min: string | null; max: string | null }; planesInfo: PlanesInfo;
  onAgregar: (item: Parameters<ReturnType<typeof useCart>["add"]>[0]) => void;
}) {
  // Por defecto: ida = inicio del rango; regreso = ida + 3 noches (ciclo base),
  // NO el regreso del paquete completo.
  const idaInicial = opcion.fechaIda ?? ventana.min ?? "";
  const [fIda, setFIda] = useState(idaInicial);
  const [fReg, setFReg] = useState(idaInicial ? sumarDias(idaInicial, CICLO_NOCHES) : "");
  const [combos, setCombos] = useState<ComboCotizado[] | null>(null);
  const [nochesCot, setNochesCot] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [cat, setCat] = useState("");
  const [reg, setReg] = useState("");

  function cotizar() {
    setErr("");
    if (!fIda || !fReg) { setErr("Indica fecha de ida y de regreso."); return; }
    start(async () => {
      const r = await cotizarPorFechas({ paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, fechaIda: fIda, fechaRegreso: fReg });
      if (r.ok) {
        setCombos(r.combos); setNochesCot(r.noches);
        setCat(r.combos[0]?.categoria ?? ""); setReg(r.combos[0]?.regimen ?? "");
      } else { setCombos(null); setErr(r.error); }
    });
  }

  const cats = combos ? [...new Set(combos.map((c) => c.categoria))] : [];
  const catEff = cats.includes(cat) ? cat : (cats[0] ?? "");
  const regs = combos ? [...new Set(combos.filter((c) => c.categoria === catEff).map((c) => c.regimen))] : [];
  const regEff = regs.includes(reg) ? reg : (regs[0] ?? "");
  const pvp = combos?.find((c) => c.categoria === catEff && c.regimen === regEff)?.precios ?? {};

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const dateCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  const agregarItem = (habitaciones: Record<string, number>, ninos: number, ninos2: number, pax: number, precio: number) =>
    onAgregar({
      modulo: opcion.modulo, paqueteId: opcion.paqueteId, hotelId: hotel.hotelId, bloqueoId: null,
      hotelNombre: hotel.hotelNombre, destino: hotel.destino, fotoUrl: hotel.foto,
      categoria: catEff, regimen: regEff,
      fechaIda: fIda, fechaRegreso: fReg, noches: nochesCot ?? calcNoches(fIda, fReg),
      habitaciones, ninos, ninos2, pax, precio,
    });

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Elige tus fechas</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ida</label>
            <input type="date" value={fIda} min={ventana.min ?? undefined} max={ventana.max ?? undefined}
              onChange={(e) => {
                const nueva = e.target.value;
                setFIda(nueva);
                // Mantén el ciclo de 3 noches por defecto si el regreso quedó vacío
                // o ya no es posterior a la nueva ida.
                if (nueva && (!fReg || fReg <= nueva)) setFReg(sumarDias(nueva, CICLO_NOCHES));
                setCombos(null);
              }}
              className={dateCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Regreso</label>
            <input type="date" value={fReg} min={fIda || (ventana.min ?? undefined)} max={ventana.max ?? undefined} onChange={(e) => { setFReg(e.target.value); setCombos(null); }} className={dateCls} />
          </div>
          <button type="button" onClick={cotizar} disabled={pending || !fIda || !fReg}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-accent)" }}>
            {pending ? "Cotizando…" : "Cotizar"}
          </button>
        </div>
        {(ventana.min || ventana.max) && (
          <p className="mt-1 text-[11px] text-gray-400">Rango del paquete: {ventana.min ?? "—"} → {ventana.max ?? "—"}</p>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
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
          <EditorPax pvp={pvp} onAgregar={agregarItem} />
        </>
      )}
    </div>
  );
}
