"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarCambioOperacional } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function CambioOperacionalForm({
  bloqueoId,
  inicial,
}: {
  bloqueoId: number;
  inicial: {
    vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
    vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ ...inicial, nota: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await registrarCambioOperacional(bloqueoId, f);
      if (r.ok) { setMsg("✓ Cambio registrado."); setF({ ...f, nota: "" }); router.refresh(); }
      else setMsg(r.error);
    });
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.05)]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>✈ Registrar cambio operacional (vuelos / horas)</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">
            Actualiza el número de vuelo, las horas o las fechas cuando la aerolínea hace un cambio. Queda registrado en el historial (antes → después).
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><label className={lbl}># Vuelo ida</label><Input value={f.vueloIda} onChange={set("vueloIda")} /></div>
            <div><label className={lbl}>Fecha ida</label><Input type="date" value={f.fechaIda} onChange={set("fechaIda")} /></div>
            <div><label className={lbl}>Hora salida ida</label><Input type="time" value={f.horaSalidaIda} onChange={set("horaSalidaIda")} /></div>
            <div><label className={lbl}>Hora llegada ida</label><Input type="time" value={f.horaLlegadaIda} onChange={set("horaLlegadaIda")} /></div>
            <div><label className={lbl}># Vuelo regreso</label><Input value={f.vueloRegreso} onChange={set("vueloRegreso")} /></div>
            <div><label className={lbl}>Fecha regreso</label><Input type="date" value={f.fechaRegreso} onChange={set("fechaRegreso")} /></div>
            <div><label className={lbl}>Hora salida reg.</label><Input type="time" value={f.horaSalidaReg} onChange={set("horaSalidaReg")} /></div>
            <div><label className={lbl}>Hora llegada reg.</label><Input type="time" value={f.horaLlegadaReg} onChange={set("horaLlegadaReg")} /></div>
          </div>
          <div><label className={lbl}>Nota (opcional)</label><Input value={f.nota} onChange={set("nota")} placeholder="Ej. La aerolínea adelantó el vuelo de ida 30 min" /></div>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Registrando…" : "Registrar cambio"}
            </Button>
            {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
