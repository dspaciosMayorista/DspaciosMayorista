"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearPaquete, type AcomodacionTipo, type PaqueteInput } from "./actions";

type Destino = { id: number; nombre: string };
type Bloqueo = { id: number; record: string; ruta: string | null; fecha_ida: string | null };

const ACOM: { key: AcomodacionTipo; label: string }[] = [
  { key: "sencilla", label: "Sencilla" },
  { key: "doble", label: "Doble" },
  { key: "triple", label: "Triple" },
  { key: "multiple", label: "Múltiple" },
  { key: "nino", label: "Niño" },
];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";

type HotelRow = { nombre: string; ciudad: string; alimentacion: string; acomodacionDetalle: string; noches: number };

export function NuevoPaqueteForm({ destinos, bloqueos }: { destinos: Destino[]; bloqueos: Bloqueo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const [categoria, setCategoria] = useState<"bloqueo" | "porcion_terrestre">("bloqueo");
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [plan, setPlan] = useState("");
  const [noches, setNoches] = useState(3);
  const [comisionable, setComisionable] = useState(true);
  const [impuesto, setImpuesto] = useState(0);
  const [bloqueoId, setBloqueoId] = useState<number | "">("");

  const [hoteles, setHoteles] = useState<HotelRow[]>([{ nombre: "", ciudad: "", alimentacion: "", acomodacionDetalle: "", noches: 0 }]);
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [costos, setCostos] = useState({ costoHotel: "", costoAereo: "", costoReceptivo: "", costoAsistencia: "", otrosCostos: "" });

  const costoTotal = Object.values(costos).reduce((s, v) => s + (Number(v) || 0), 0);

  function setHotel(i: number, patch: Partial<HotelRow>) {
    setHoteles((a) => a.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { setErr("El nombre del paquete es obligatorio."); return; }
    const preciosArr = ACOM.filter(({ key }) => precios[key] && Number(precios[key]) > 0)
      .map(({ key }) => ({ acomodacion: key, precio: Number(precios[key]) }));
    if (!preciosArr.length) { setErr("Carga al menos un precio por acomodación."); return; }
    setErr("");
    const input: PaqueteInput = {
      categoria, destinoId: destinoId === "" ? null : Number(destinoId),
      nombre, descripcion, planAlimentacion: plan, noches, comisionable,
      impuestoNoComisionable: impuesto, bloqueoId: bloqueoId === "" ? null : Number(bloqueoId),
      hoteles: hoteles.filter((h) => h.nombre.trim() !== ""),
      precios: preciosArr,
      costos: {
        costoHotel: Number(costos.costoHotel) || 0, costoAereo: Number(costos.costoAereo) || 0,
        costoReceptivo: Number(costos.costoReceptivo) || 0, costoAsistencia: Number(costos.costoAsistencia) || 0,
        otrosCostos: Number(costos.otrosCostos) || 0,
      },
    };
    start(async () => {
      const r = await crearPaquete(input);
      if (r.ok) router.push("/dashboard/paquetes");
      else setErr(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      {/* Identificación */}
      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Identificación</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Categoría *</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as "bloqueo" | "porcion_terrestre")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="bloqueo">Bloqueo (con vuelo)</option>
              <option value="porcion_terrestre">Porción terrestre (sin vuelo)</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Destino</label>
            <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Nombre del paquete *</label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Plan Cartagena 4D-3N" />
          </div>
          <div>
            <label className={lbl}>Plan de alimentación</label>
            <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="PC, PAM, FULL…" />
          </div>
          <div>
            <label className={lbl}>Noches</label>
            <Input type="number" min={1} value={noches} onChange={(e) => setNoches(Number(e.target.value) || 1)} />
          </div>
          {categoria === "bloqueo" && (
            <div>
              <label className={lbl}>Record / vuelo (bloqueo)</label>
              <select value={bloqueoId} onChange={(e) => setBloqueoId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— (se elige al vender)</option>
                {bloqueos.map((b) => <option key={b.id} value={b.id}>{b.record} · {b.ruta} · {b.fecha_ida}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={comisionable} onChange={(e) => setComisionable(e.target.checked)} /> Comisionable 100%
          </label>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Impuesto no comisionable</label>
            <Input type="number" min={0} className="w-32" value={impuesto || ""} onChange={(e) => setImpuesto(Number(e.target.value) || 0)} placeholder="0" />
          </div>
        </div>
        <div>
          <label className={lbl}>Descripción</label>
          <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Tours, traslados incluidos…" />
        </div>
      </section>

      {/* Hoteles encadenados */}
      <section className={card}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Hoteles (en orden)</p>
          <button type="button" className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setHoteles((a) => [...a, { nombre: "", ciudad: "", alimentacion: "", acomodacionDetalle: "", noches: 0 }])}>
            + Agregar hotel
          </button>
        </div>
        {hoteles.map((h, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-5">
            <Input placeholder="Hotel" value={h.nombre} onChange={(e) => setHotel(i, { nombre: e.target.value })} />
            <Input placeholder="Ciudad" value={h.ciudad} onChange={(e) => setHotel(i, { ciudad: e.target.value })} />
            <Input placeholder="Alimentación" value={h.alimentacion} onChange={(e) => setHotel(i, { alimentacion: e.target.value })} />
            <Input placeholder="Acomodación detalle" value={h.acomodacionDetalle} onChange={(e) => setHotel(i, { acomodacionDetalle: e.target.value })} />
            <div className="flex items-center gap-2">
              <Input type="number" min={0} placeholder="Noches" value={h.noches || ""} onChange={(e) => setHotel(i, { noches: Number(e.target.value) || 0 })} />
              <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setHoteles((a) => a.filter((_, j) => j !== i))}>×</button>
            </div>
          </div>
        ))}
      </section>

      {/* Precio por acomodación */}
      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Precio de venta por acomodación ($/pax)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {ACOM.map(({ key, label }) => (
            <div key={key}>
              <label className={lbl}>{label}</label>
              <Input type="number" min={0} value={precios[key] || ""} onChange={(e) => setPrecios({ ...precios, [key]: e.target.value })} placeholder="—" />
            </div>
          ))}
        </div>
      </section>

      {/* Costos negociados (ocultos al asesor) */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
        <p className="text-sm font-semibold text-amber-700">Costos negociados (uso interno — el asesor no los ve)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {([
            ["costoHotel", "Costo hotel"], ["costoAereo", "Costo aéreo"], ["costoReceptivo", "Costo receptivo"],
            ["costoAsistencia", "Costo asistencia"], ["otrosCostos", "Otros costos"],
          ] as [keyof typeof costos, string][]).map(([k, label]) => (
            <div key={k}>
              <label className={lbl}>{label}</label>
              <Input type="number" min={0} value={costos[k]} onChange={(e) => setCostos({ ...costos, [k]: e.target.value })} placeholder="0" className="bg-white" />
            </div>
          ))}
        </div>
        <p className="text-xs text-amber-700">Costo directo total: <b>{formatCOP(costoTotal)}</b></p>
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Creando…" : "Crear paquete"}
      </Button>
    </form>
  );
}
