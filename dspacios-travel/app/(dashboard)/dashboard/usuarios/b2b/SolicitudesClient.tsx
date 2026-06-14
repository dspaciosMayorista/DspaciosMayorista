"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aprobarSolicitudB2B, rechazarSolicitudB2B } from "./actions";

export type Solicitud = {
  id: number; tipo: string; nombre: string; nit: string | null; contacto: string | null;
  email: string; telefono: string | null; ciudad: string | null; notas: string | null;
  acepta_notificaciones: boolean; estado: string; revisado_por: string | null; created_at: string;
};

const BADGE: Record<string, string> = { pendiente: "#C99A2E", aprobada: "var(--brand-success)", rechazada: "#C0392B" };

export function SolicitudesClient({ solicitudes }: { solicitudes: Solicitud[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const accion = (fn: (id: number) => Promise<{ ok: boolean; error?: string }>, id: number) => {
    setMsg("");
    start(async () => {
      const r = await fn(id);
      if (r.ok) router.refresh();
      else setMsg(r.error ?? "Error");
    });
  };

  if (!solicitudes.length) return <p className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-gray-400">No hay solicitudes de registro.</p>;

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {solicitudes.map((s) => (
        <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800">{s.nombre}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-500">{s.tipo}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: BADGE[s.estado] ?? "#6b7280", backgroundColor: "rgba(0,0,0,0.04)" }}>{s.estado}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {s.email}{s.telefono ? ` · ${s.telefono}` : ""}{s.ciudad ? ` · ${s.ciudad}` : ""}{s.nit ? ` · NIT ${s.nit}` : ""}
              </p>
              {s.contacto && <p className="text-xs text-gray-500">Contacto: {s.contacto}</p>}
              {s.notas && <p className="mt-1 text-xs text-gray-400">{s.notas}</p>}
              <p className="mt-1 text-[10px] text-gray-400">
                {s.acepta_notificaciones ? "Acepta notificaciones" : "No acepta notificaciones"}
                {s.revisado_por ? ` · revisado por ${s.revisado_por}` : ""}
              </p>
            </div>
            {s.estado === "pendiente" && (
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => accion(aprobarSolicitudB2B, s.id)} style={{ backgroundColor: "var(--brand-success)" }}>Aprobar</Button>
                <Button disabled={pending} onClick={() => accion(rechazarSolicitudB2B, s.id)} variant="secondary">Rechazar</Button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
