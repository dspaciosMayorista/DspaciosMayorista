"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import {
  crearSalidaDinamica, actualizarSalidaDinamica, eliminarSalidaDinamica,
  type SalidaDinamicaInput,
} from "../actions";

export type SalidaDinamica = {
  id: number; aerolinea: string | null; ruta: string | null; origen: string | null;
  fecha_ida: string; fecha_regreso: string | null;
  hora_salida_ida: string | null; hora_llegada_ida: string | null; hora_salida_reg: string | null; hora_llegada_reg: string | null;
  valor_tiquete: number; aplica_mk: boolean; ta: number; fee_infante: number;
  compra_inicio: string | null; compra_fin: string | null; notas: string | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";

function vacia(): SalidaDinamicaInput {
  return {
    aerolinea: "", ruta: "", origen: "", fechaIda: "", fechaRegreso: "",
    horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "",
    valorTiquete: 0, aplicaMk: true, ta: 0, feeInfante: 0, compraInicio: "", compraFin: "", notas: "",
  };
}
function aInput(s: SalidaDinamica): SalidaDinamicaInput {
  return {
    aerolinea: s.aerolinea ?? "", ruta: s.ruta ?? "", origen: s.origen ?? "",
    fechaIda: s.fecha_ida ?? "", fechaRegreso: s.fecha_regreso ?? "",
    horaSalidaIda: s.hora_salida_ida ?? "", horaLlegadaIda: s.hora_llegada_ida ?? "",
    horaSalidaReg: s.hora_salida_reg ?? "", horaLlegadaReg: s.hora_llegada_reg ?? "",
    valorTiquete: s.valor_tiquete ?? 0, aplicaMk: s.aplica_mk, ta: s.ta ?? 0, feeInfante: s.fee_infante ?? 0,
    compraInicio: s.compra_inicio ?? "", compraFin: s.compra_fin ?? "", notas: s.notas ?? "",
  };
}

export function SalidasDinamicasEditor({ paqueteId, salidas, moneda }: { paqueteId: number; salidas: SalidaDinamica[]; moneda: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nueva, setNueva] = useState<SalidaDinamicaInput>(vacia());
  const [err, setErr] = useState("");

  function agregar() {
    if (!nueva.fechaIda) { setErr("Pon al menos la fecha de ida."); return; }
    setErr("");
    start(async () => {
      const r = await crearSalidaDinamica(paqueteId, nueva);
      if (r.ok) { setNueva(vacia()); router.refresh(); } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Cada salida es un vuelo por sistema (sin record): su ruta, fecha e info, y el valor del tiquete.
        El hotel se liquidará por las noches de cada salida. Moneda del paquete: <b>{moneda}</b>.
      </p>

      <div className="space-y-2">
        {salidas.map((s) => <SalidaFila key={s.id} s={s} moneda={moneda} onChanged={() => router.refresh()} setErr={setErr} />)}
      </div>

      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3">
        <p className="mb-2 text-xs font-medium text-gray-600">+ Agregar salida</p>
        <CamposSalida value={nueva} onChange={setNueva} />
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={agregar} disabled={pending}>Agregar salida</Button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </div>
    </div>
  );
}

function SalidaFila({ s, moneda, onChanged, setErr }: { s: SalidaDinamica; moneda: string; onChanged: () => void; setErr: (m: string) => void }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState<SalidaDinamicaInput>(aInput(s));
  const [editando, setEditando] = useState(false);

  function guardar() {
    start(async () => {
      const r = await actualizarSalidaDinamica(s.id, v);
      if (r.ok) { setEditando(false); onChanged(); } else setErr(r.error);
    });
  }
  function borrar() {
    if (!confirm("¿Eliminar esta salida?")) return;
    start(async () => { const r = await eliminarSalidaDinamica(s.id); if (r.ok) onChanged(); else setErr(r.error); });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {!editando ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-gray-700">{s.ruta || "—"} {s.aerolinea ? `· ${s.aerolinea}` : ""}</span>
          <span className="text-xs text-gray-500">{s.fecha_ida} → {s.fecha_regreso || "—"}</span>
          <span className="tabular-nums text-gray-700">
            Tiquete {formatMoneda(Number(s.valor_tiquete), moneda)} {s.aplica_mk ? "(mk)" : `(+TA ${formatMoneda(Number(s.ta), moneda)})`}
            {Number(s.fee_infante) > 0 ? ` · inf ${formatMoneda(Number(s.fee_infante), moneda)}` : ""}
          </span>
          <span className="flex gap-3">
            <button type="button" onClick={() => setEditando(true)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
            <button type="button" disabled={pending} onClick={borrar} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
          </span>
        </div>
      ) : (
        <>
          <CamposSalida value={v} onChange={setV} />
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar</Button>
            <button type="button" onClick={() => { setEditando(false); setV(aInput(s)); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

function CamposSalida({ value, onChange }: { value: SalidaDinamicaInput; onChange: (v: SalidaDinamicaInput) => void }) {
  const set = (k: keyof SalidaDinamicaInput, val: string | number | boolean) => onChange({ ...value, [k]: val });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div><label className={lbl}>Aerolínea</label><Input value={value.aerolinea} onChange={(e) => set("aerolinea", e.target.value)} placeholder="JetSMART, Avianca…" /></div>
        <div><label className={lbl}>Ruta (IATA)</label><Input value={value.ruta} onChange={(e) => set("ruta", e.target.value)} placeholder="MDE - MIA - MDE" /></div>
        <div><label className={lbl}>Origen (IATA)</label><Input value={value.origen} onChange={(e) => set("origen", e.target.value)} placeholder="MDE" /></div>
        <div></div>
        <div><label className={lbl}>Fecha ida *</label><Input type="date" value={value.fechaIda} onChange={(e) => set("fechaIda", e.target.value)} /></div>
        <div><label className={lbl}>Fecha regreso</label><Input type="date" value={value.fechaRegreso} onChange={(e) => set("fechaRegreso", e.target.value)} /></div>
        <div><label className={lbl}>Hora salida ida</label><Input value={value.horaSalidaIda} onChange={(e) => set("horaSalidaIda", e.target.value)} placeholder="08:30" /></div>
        <div><label className={lbl}>Hora llegada ida</label><Input value={value.horaLlegadaIda} onChange={(e) => set("horaLlegadaIda", e.target.value)} placeholder="11:00" /></div>
        <div><label className={lbl}>Hora salida regreso</label><Input value={value.horaSalidaReg} onChange={(e) => set("horaSalidaReg", e.target.value)} placeholder="18:00" /></div>
        <div><label className={lbl}>Hora llegada regreso</label><Input value={value.horaLlegadaReg} onChange={(e) => set("horaLlegadaReg", e.target.value)} placeholder="20:30" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2 md:grid-cols-4">
        <div><label className={lbl}>Valor tiquete (adulto 2+)</label><Input type="number" min={0} value={value.valorTiquete || ""} onChange={(e) => set("valorTiquete", Number(e.target.value) || 0)} placeholder="—" /></div>
        <div>
          <label className={lbl}>Montaje del vuelo</label>
          <select value={value.aplicaMk ? "mk" : "ta"} onChange={(e) => set("aplicaMk", e.target.value === "mk")} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="mk">Markup del paquete</option>
            <option value="ta">TA (tarifa administrativa)</option>
          </select>
        </div>
        {!value.aplicaMk && (
          <div><label className={lbl}>TA por pax</label><Input type="number" min={0} value={value.ta || ""} onChange={(e) => set("ta", Number(e.target.value) || 0)} placeholder="—" /></div>
        )}
        <div><label className={lbl}>Fee infante (0–1.99)</label><Input type="number" min={0} value={value.feeInfante || ""} onChange={(e) => set("feeInfante", Number(e.target.value) || 0)} placeholder="0" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div><label className={lbl}>Vigencia compra desde</label><Input type="date" value={value.compraInicio} onChange={(e) => set("compraInicio", e.target.value)} /></div>
        <div><label className={lbl}>Vigencia compra hasta</label><Input type="date" value={value.compraFin} onChange={(e) => set("compraFin", e.target.value)} /></div>
        <div className="md:col-span-2"><label className={lbl}>Notas</label><Input value={value.notas} onChange={(e) => set("notas", e.target.value)} /></div>
      </div>
    </div>
  );
}
