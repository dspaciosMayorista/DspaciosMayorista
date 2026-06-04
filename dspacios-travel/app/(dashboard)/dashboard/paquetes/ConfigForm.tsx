"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearPaquete, actualizarPaquete, type PaqueteConfig } from "./actions";

type Opt = { id: number; nombre: string };

type Tipo = "bloqueo" | "porcion_terrestre" | "servicios";
type Initial = Partial<{
  nombre: string;
  tipo: Tipo;
  noches: number;
  activo: boolean;
  destinoId: number | null;
  fechaCompraInicio: string;
  fechaCompraFin: string;
  fechaViajeInicio: string;
  fechaViajeFin: string;
  pctMk: number;          // porcentaje (20 = 20 %)
  impuestoTipo: "tiquete" | "fijo";
  impuestoFijo: number;
  notas: string;
}>;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ConfigForm({
  destinos,
  id,
  initial,
}: {
  destinos: Opt[];
  id?: number;
  initial?: Initial;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [tipo, setTipo] = useState<Tipo>(initial?.tipo ?? "bloqueo");
  const [noches, setNoches] = useState(initial?.noches != null ? String(initial.noches) : "3");
  const [activo, setActivo] = useState(initial?.activo ?? true);
  const [destinoId, setDestinoId] = useState<number | "">(initial?.destinoId ?? "");
  const [compraIni, setCompraIni] = useState(initial?.fechaCompraInicio ?? "");
  const [compraFin, setCompraFin] = useState(initial?.fechaCompraFin ?? "");
  const [viajeIni, setViajeIni] = useState(initial?.fechaViajeInicio ?? "");
  const [viajeFin, setViajeFin] = useState(initial?.fechaViajeFin ?? "");
  const [pctMk, setPctMk] = useState(initial?.pctMk != null ? String(initial.pctMk) : "");
  const [impTipo, setImpTipo] = useState<"tiquete" | "fijo">(initial?.impuestoTipo ?? "tiquete");
  const [impFijo, setImpFijo] = useState(initial?.impuestoFijo != null ? String(initial.impuestoFijo) : "");
  const [notas, setNotas] = useState(initial?.notas ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function guardar() {
    if (!nombre.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    setErr("");
    const cfg: PaqueteConfig = {
      nombre,
      tipo,
      noches: Number(noches) || 3,
      destinoId: destinoId === "" ? null : Number(destinoId),
      fechaCompraInicio: compraIni,
      fechaCompraFin: compraFin,
      fechaViajeInicio: viajeIni,
      fechaViajeFin: viajeFin,
      pctMk: Number(pctMk) || 0,
      impuestoTipo: impTipo,
      impuestoFijo: Number(impFijo) || 0,
      activo,
      notas,
    };
    start(async () => {
      const r = id ? await actualizarPaquete(id, cfg) : await crearPaquete(cfg);
      if (r.ok) {
        router.push(`/dashboard/paquetes/${r.id ?? id}`);
        router.refresh();
      } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={lbl}>Nombre del paquete *</label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cartagena 4D/3N — Bloqueo junio" />
        </div>

        <div className="md:col-span-2">
          <label className={lbl}>Tipo de paquete *</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={sel}>
            <option value="bloqueo">Bloqueo (vuelo + hotel)</option>
            <option value="porcion_terrestre">Porción terrestre (solo hotel)</option>
            <option value="servicios">Servicios (solo servicios)</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-400">Define qué adicionas y en qué módulo del tarifario aparece.</p>
        </div>

        {tipo === "porcion_terrestre" && (
          <div>
            <label className={lbl}>Noches (porción terrestre)</label>
            <Input type="number" min={1} value={noches} onChange={(e) => setNoches(e.target.value)} placeholder="3" />
            <p className="mt-1 text-[11px] text-gray-400">Se liquida desde la fecha de inicio del viaje.</p>
          </div>
        )}

        <div>
          <label className={lbl}>Destino</label>
          <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")} className={sel}>
            <option value="">— Elige destino —</option>
            {destinos.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">Filtra los vuelos, hoteles y servicios disponibles.</p>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (visible en el tarifario)
          </label>
        </div>

        <div>
          <label className={lbl}>Vigencia de compra — desde</label>
          <Input type="date" value={compraIni} onChange={(e) => setCompraIni(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Vigencia de compra — hasta</label>
          <Input type="date" value={compraFin} onChange={(e) => setCompraFin(e.target.value)} />
        </div>

        <div>
          <label className={lbl}>Rango de viaje — desde</label>
          <Input type="date" value={viajeIni} onChange={(e) => setViajeIni(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Rango de viaje — hasta</label>
          <Input type="date" value={viajeFin} onChange={(e) => setViajeFin(e.target.value)} />
        </div>

        <div>
          <label className={lbl}>% MK (margen)</label>
          <Input type="number" min={0} max={99} value={pctMk} onChange={(e) => setPctMk(e.target.value)} placeholder="20" />
          <p className="mt-1 text-[11px] text-gray-400">PVP = costo / (1 − %mk). Aplica a hotel y servicios.</p>
        </div>

        <div>
          <label className={lbl}>Impuesto (Base No Comisionable)</label>
          <select value={impTipo} onChange={(e) => setImpTipo(e.target.value as "tiquete" | "fijo")} className={sel}>
            <option value="tiquete">Valor neto del tiquete</option>
            <option value="fijo">Valor fijo</option>
          </select>
        </div>

        {impTipo === "fijo" && (
          <div>
            <label className={lbl}>Valor fijo del impuesto</label>
            <Input type="number" min={0} value={impFijo} onChange={(e) => setImpFijo(e.target.value)} placeholder="599000" />
          </div>
        )}

        <div className="md:col-span-2">
          <label className={lbl}>Notas (opcional)</label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} className={sel} rows={2} />
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : id ? "Guardar cambios" : "Crear y continuar →"}
        </Button>
      </div>
    </div>
  );
}
