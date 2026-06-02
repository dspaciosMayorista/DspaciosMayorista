"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cambiarSillas } from "../actions";

type Destino = { id: number; record: string; fecha_ida: string | null };

export function CambiarSillasForm({
  origenId,
  disponibles,
  destinos,
}: {
  origenId: number;
  disponibles: number;
  destinos: Destino[];
}) {
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!destinoId || !Number(cantidad)) return;
    setMsg("");
    start(async () => {
      const r = await cambiarSillas({
        origenId,
        destinoId: Number(destinoId),
        cantidad: Number(cantidad),
        motivo,
      });
      if (r.ok) { setMsg("✓ Cambio registrado"); setCantidad(""); setMotivo(""); setDestinoId(""); }
      else setMsg(r.error);
    });
  }

  return (
    <form onSubmit={enviar} className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-gray-700">Cambiar sillas a otro record</p>
      <p className="mb-3 text-xs text-gray-500">Disponibles para mover: <b>{disponibles}</b></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Record destino</option>
          {destinos.map((d) => <option key={d.id} value={d.id}>{d.record} · {d.fecha_ida}</option>)}
        </select>
        <Input type="number" min={1} max={disponibles} placeholder="Cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Procesando…" : "Registrar cambio"}
        </Button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </form>
  );
}
