"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guardarTarifa, eliminarTarifa, type PrecioAcomodacion } from "../actions";
import { calcPrecioDesdeProducto, calcPreciosTarifa, calcMargenEfectivo } from "@/lib/calc/tarifario";
import { formatCOP } from "@/lib/utils";

type Hotel = { id: number; nombre: string; zona: string | null };
type Temporada = { id: number; nombre: string; anio: number };
type Plan = { id: number; codigo: string; nombre: string };

type TarifaExistente = {
  id: number;
  noches: number;
  comisionable: boolean;
  impuesto_no_comisionable: number;
  costo_base: number | null;
  pct_mk: number | null;
  notas: string | null;
  hotel_id: number;
  plan_id: number;
  temporada_id: number;
  hoteles: { nombre: string } | null;
  planes_alimentacion: { codigo: string } | null;
  temporadas: { nombre: string; anio: number } | null;
  tarifa_precios: { acomodacion: string; precio: number }[];
};

const ACOMODACIONES = [
  { key: "sencilla", label: "Sencilla" },
  { key: "doble",    label: "Doble" },
  { key: "triple",   label: "Triple" },
  { key: "multiple", label: "Múltiple" },
  { key: "nino",     label: "Niño" },
] as const;

export function ProductoTab({
  destinoId, hoteles, temporadas, planes, tarifas,
}: {
  destinoId: number;
  hoteles: Hotel[];
  temporadas: Temporada[];
  planes: Plan[];
  tarifas: TarifaExistente[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [hotelId,     setHotelId]     = useState<number | "">("");
  const [planId,      setPlanId]      = useState<number | "">("");
  const [temporadaId, setTemporadaId] = useState<number | "">("");
  const [noches,      setNoches]      = useState(3);
  const [comisionable, setComisionable] = useState(true);
  const [impuesto,    setImpuesto]    = useState(0);
  const [notas,       setNotas]       = useState("");

  // Desglose de costos
  const [costoHotel,      setCostoHotel]      = useState("");
  const [costoReceptivo,  setCostoReceptivo]  = useState("");
  const [costoAsistencia, setCostoAsistencia] = useState("");
  const [costoOtros,      setCostoOtros]      = useState("");
  const [pctMargen,       setPctMargen]       = useState("");

  // Precios por acomodación
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [saved,   setSaved]   = useState(false);

  const costoTotal =
    (Number(costoHotel)      || 0) +
    (Number(costoReceptivo)  || 0) +
    (Number(costoAsistencia) || 0) +
    (Number(costoOtros)      || 0);

  const pvpCalculado =
    costoTotal > 0 && pctMargen !== "" && Number(pctMargen) < 100
      ? calcPrecioDesdeProducto(costoTotal, Number(pctMargen))
      : null;

  useEffect(() => {
    if (!pvpCalculado) return;
    setPrecios((prev) => {
      const next = { ...prev };
      ACOMODACIONES.forEach(({ key }) => {
        if (!prev[key]) next[key] = String(Math.round(pvpCalculado));
      });
      return next;
    });
  }, [pvpCalculado]);

  function resetForm() {
    setEditId(null);
    setHotelId(""); setPlanId(""); setTemporadaId(""); setNoches(3);
    setComisionable(true); setImpuesto(0); setNotas("");
    setCostoHotel(""); setCostoReceptivo(""); setCostoAsistencia(""); setCostoOtros("");
    setPctMargen(""); setPrecios({});
  }

  function cargarParaEditar(t: TarifaExistente) {
    setEditId(t.id);
    setHotelId(t.hotel_id);
    setPlanId(t.plan_id);
    setTemporadaId(t.temporada_id);
    setNoches(t.noches);
    setComisionable(t.comisionable);
    setImpuesto(t.impuesto_no_comisionable ?? 0);
    setNotas(t.notas ?? "");
    setCostoHotel(t.costo_base != null ? String(t.costo_base) : "");
    setCostoReceptivo(""); setCostoAsistencia(""); setCostoOtros("");
    setPctMargen(t.pct_mk != null ? String(t.pct_mk) : "");
    setPrecios(Object.fromEntries(t.tarifa_precios.map((p) => [p.acomodacion, String(p.precio)])));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hotelId || !planId || !temporadaId) return;

    const preciosArr: PrecioAcomodacion[] = ACOMODACIONES
      .filter(({ key }) => precios[key] && Number(precios[key]) > 0)
      .map(({ key }) => ({ acomodacion: key, precio: Number(precios[key]) }));

    if (!preciosArr.length) return;

    startTransition(async () => {
      await guardarTarifa({
        hotelId: Number(hotelId),
        planId: Number(planId),
        temporadaId: Number(temporadaId),
        noches,
        comisionable,
        impuestoNoComisionable: impuesto,
        costoBase: costoTotal || null,
        pctMk: pctMargen ? Number(pctMargen) : null,
        notas,
        precios: preciosArr,
        destinoId,
      });
      resetForm();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-500 mb-6">
        Ingresa los costos netos por proveedor y el % de margen.{" "}
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">
          PVP = Costo total ÷ (1 − %Margen)
        </code>
      </p>

      {editId && (
        <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-sm text-amber-700">Editando tarifa existente</span>
          <button type="button" onClick={resetForm} className="text-xs text-amber-600 hover:underline">
            Cancelar edición / nueva tarifa
          </button>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">

        {/* Identificación */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Identificación de la tarifa</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Hotel *</label>
              <select value={hotelId} onChange={(e) => setHotelId(Number(e.target.value) || "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" required>
                <option value="">Selecciona hotel</option>
                {hoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}{h.zona ? ` (${h.zona})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Plan *</label>
              <select value={planId} onChange={(e) => setPlanId(Number(e.target.value) || "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" required>
                <option value="">Selecciona plan</option>
                {planes.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Temporada *</label>
              <select value={temporadaId} onChange={(e) => setTemporadaId(Number(e.target.value) || "")}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" required>
                <option value="">Selecciona temporada</option>
                {temporadas.map((t) => <option key={t.id} value={t.id}>{t.nombre} {t.anio}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Noches base</label>
              <Input type="number" value={noches} onChange={(e) => setNoches(Number(e.target.value))} min={1} max={30} />
            </div>
          </div>
        </div>

        {/* Costos + Margen */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-4">
          <p className="text-xs font-semibold text-[#1D7C9A] uppercase tracking-wider">Costos netos por proveedor ($/pax)</p>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Hotel / Alojamiento",   val: costoHotel,      set: setCostoHotel },
              { label: "Receptivo / Traslados",  val: costoReceptivo,  set: setCostoReceptivo },
              { label: "Asistencia / Seguro",    val: costoAsistencia, set: setCostoAsistencia },
              { label: "Otros proveedores",      val: costoOtros,      set: setCostoOtros },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                <Input type="number" value={val} onChange={(e) => set(e.target.value)} placeholder="0" min={0} className="text-sm bg-white" />
              </div>
            ))}
          </div>

          {/* Calculadora */}
          <div className="bg-white rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Costo total</span>
              <span className="font-medium tabular-nums">{formatCOP(costoTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-gray-600">
              <span>% Margen</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number" value={pctMargen}
                  onChange={(e) => setPctMargen(e.target.value)}
                  placeholder="ej: 30" min={0} max={99}
                  className="w-20 h-7 text-sm text-right"
                />
                <span className="text-gray-400 text-xs">%</span>
              </div>
            </div>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="text-xs text-gray-500 font-mono">costo ÷ (1 − %)</span>
              <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>
                {pvpCalculado ? formatCOP(pvpCalculado) : "—"}
              </span>
            </div>
            {pvpCalculado && costoTotal > 0 && (
              <p className="text-xs text-gray-400 text-right">
                Margen efectivo: {calcMargenEfectivo(pvpCalculado, costoTotal).toFixed(1)}%
                {" · "}Ganancia: {formatCOP(pvpCalculado - costoTotal)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={comisionable} onChange={(e) => setComisionable(e.target.checked)} className="rounded" />
              Comisionable al 100%
            </label>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Impuesto no comisionable ($/pax)</label>
              <Input type="number" value={impuesto || ""} onChange={(e) => setImpuesto(Number(e.target.value))}
                placeholder="0" className="w-32 bg-white" min={0} />
            </div>
          </div>
        </div>

        {/* Precios por acomodación */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">PVP por acomodación ($/pax)</p>
            {pvpCalculado && (
              <button type="button" className="text-xs text-[#1D7C9A] hover:underline"
                onClick={() => setPrecios(Object.fromEntries(ACOMODACIONES.map(({ key }) => [key, String(Math.round(pvpCalculado))])))}>
                Aplicar PVP a todas
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-3">
            {ACOMODACIONES.map(({ key, label }) => {
              const precio = Number(precios[key] || 0);
              const calc   = precio > 0 ? calcPreciosTarifa(precio, impuesto) : null;
              return (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 block">{label}</label>
                  <Input
                    type="number"
                    value={precios[key] || ""}
                    onChange={(e) => setPrecios({ ...precios, [key]: e.target.value })}
                    placeholder="—" min={0} className="text-sm"
                  />
                  {calc && (
                    <div className="text-xs space-y-0.5">
                      <p className="text-[#26BBD9]">Neta: {formatCOP(calc.tarifaNetaAgencia)}</p>
                      {costoTotal > 0 && (
                        <p className="text-gray-400">{calcMargenEfectivo(precio, costoTotal).toFixed(0)}% margen</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
          <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observaciones opcionales" />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !hotelId || !planId || !temporadaId}
            style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando..." : editId ? "Actualizar tarifa" : "Guardar tarifa"}
          </Button>
          {saved && <span className="text-sm font-medium" style={{ color: "var(--brand-success)" }}>✓ Tarifa guardada</span>}
        </div>
      </form>

      {/* Lista de tarifas existentes */}
      <div className="mt-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Tarifas cargadas ({tarifas.length})
        </p>
        {tarifas.length === 0 ? (
          <p className="text-sm text-gray-400">Aún no hay tarifas para este destino.</p>
        ) : (
          <div className="space-y-2">
            {tarifas.map((t) => <TarifaItem key={t.id} tarifa={t} destinoId={destinoId} onEditar={cargarParaEditar} editando={editId === t.id} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function TarifaItem({
  tarifa, destinoId, onEditar, editando,
}: {
  tarifa: TarifaExistente;
  destinoId: number;
  onEditar: (t: TarifaExistente) => void;
  editando: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const precioMap = Object.fromEntries(tarifa.tarifa_precios.map((p) => [p.acomodacion, p.precio]));

  return (
    <div className={`flex items-center justify-between bg-white border rounded-lg px-4 py-3 group ${editando ? "border-amber-300 ring-1 ring-amber-200" : "border-gray-200"}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {tarifa.hoteles?.nombre ?? "—"}
          <span className="text-gray-400 font-normal"> · {tarifa.planes_alimentacion?.codigo ?? "?"}</span>
          <span className="text-gray-400 font-normal"> · {tarifa.temporadas?.nombre} {tarifa.temporadas?.anio}</span>
          <span className="text-gray-400 font-normal"> · {tarifa.noches}n</span>
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {ACOMODACIONES.map(({ key, label }) => {
            const precio = precioMap[key];
            if (!precio) return null;
            return (
              <span key={key} className="text-xs text-gray-500">
                {label}: <span className="font-medium tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(precio)}</span>
              </span>
            );
          })}
          {tarifa.impuesto_no_comisionable > 0 && (
            <span className="text-xs text-gray-400">+{formatCOP(tarifa.impuesto_no_comisionable)} imp.</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <button type="button" onClick={() => onEditar(tarifa)}
          className="text-xs text-[#1D7C9A] hover:underline px-2 py-1">
          Editar
        </button>
        <button type="button" disabled={pending}
          onClick={() => {
            if (!confirm("¿Eliminar esta tarifa y sus precios?")) return;
            startTransition(() => eliminarTarifa(tarifa.id, destinoId));
          }}
          className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition-all px-2 py-1">
          Eliminar
        </button>
      </div>
    </div>
  );
}
