"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cambiarSillas } from "../actions";
import { nuevaOperacionId } from "@/lib/vuelos/operaciones";

/** Records COMPATIBLES (mismo destino y proveedor, sin salir), calculados por la página. */
type Destino = { id: number; record: string; fecha_ida: string | null; libres: number; tarifaDistinta: boolean };

/**
 * Trasladar cupos LIBRES de este record a otro: las mismas sillas cambian de
 * record (no se clonan). Este record pierde N cupos activos y el destino gana
 * N; la suma no cambia. Queda en el historial de los dos records.
 */
export function CambiarSillasForm({
  origenId,
  disponibles,
  destinos,
}: {
  origenId: number;
  /** Cupos libres de verdad en este record. */
  disponibles: number;
  destinos: Destino[];
}) {
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  // Un id por intento de traslado; se conserva en los reintentos tras un error
  // para que, si el primer envío sí se aplicó, la base no lo repita.
  const [operacionId, setOperacionId] = useState(() => nuevaOperacionId());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const destino = destinos.find((d) => d.id === destinoId) ?? null;
  const n = Number(cantidad);
  const cantidadValida = Number.isInteger(n) && n >= 1 && n <= disponibles;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!destinoId || !cantidadValida) return;
    setMsg(null);
    start(async () => {
      const r = await cambiarSillas({ origenId, destinoId: Number(destinoId), cantidad: n, motivo, operacionId });
      if (r.ok) {
        setMsg({ ok: true, texto: r.repetida ? "Este traslado ya se había aplicado; no se repitió." : `Listo: ${r.movidas} cupo(s) trasladado(s) a ${destino?.record ?? "el destino"}.` });
        setCantidad(""); setMotivo(""); setDestinoId("");
        setOperacionId(nuevaOperacionId());
      } else setMsg({ ok: false, texto: r.error });
    });
  }

  return (
    <form onSubmit={enviar} className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Trasladar cupos libres a otro record</p>
      <p className="mb-3 text-xs text-gray-500">
        Las mismas sillas pasan al destino: este record pierde los cupos y el destino los gana; el total no cambia.
        Cupos libres aquí: <b>{disponibles}</b>. Solo records del mismo destino y proveedor que no han salido.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select aria-label="Record destino" value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Record destino</option>
          {destinos.map((d) => <option key={d.id} value={d.id}>{d.record} · {d.fecha_ida}{d.tarifaDistinta ? " · otra tarifa" : ""}</option>)}
        </select>
        <Input aria-label="Cantidad" type="number" min={1} max={disponibles} placeholder="Cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Input aria-label="Motivo" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {destino?.tarifaDistinta && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          La tarifa neta de {destino.record} es distinta. Los cupos se trasladan sin recalcular ningún valor.
        </p>
      )}
      {cantidad !== "" && !cantidadValida && (
        <p className="mt-2 text-xs text-red-600">La cantidad debe estar entre 1 y {disponibles}.</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={pending || !destinoId || !cantidadValida} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Procesando…" : "Trasladar cupos"}
        </Button>
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={`flex items-center gap-1 text-sm ${msg.ok ? "text-gray-600" : "text-red-600"}`}>
            {msg.ok && <Check className="h-4 w-4" style={{ color: "var(--brand-success)" }} />}{msg.texto}
          </span>
        )}
      </div>
    </form>
  );
}
