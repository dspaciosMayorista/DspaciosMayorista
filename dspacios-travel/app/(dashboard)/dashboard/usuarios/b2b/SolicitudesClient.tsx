"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aprobarSolicitudB2B, rechazarSolicitudB2B } from "./actions";

export type Solicitud = {
  id: number; tipo: string; nombre: string; nit: string | null; tipo_documento: string | null;
  aliado_sugerido_id: number | null; contacto: string | null;
  email: string; telefono: string | null; ciudad: string | null; notas: string | null;
  acepta_notificaciones: boolean; estado: string; revisado_por: string | null; created_at: string;
};

export type AliadoOpt = { id: number; nombre: string; nit: string | null; tipo_documento: string | null };

const BADGE: Record<string, string> = { pendiente: "#C99A2E", aprobada: "var(--brand-success)", rechazada: "#C0392B" };

export function SolicitudesClient({ solicitudes, aliados = [] }: { solicitudes: Solicitud[]; aliados?: AliadoOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  // Ficha del catálogo elegida por solicitud. Arranca en la sugerida (por
  // coincidencia de documento) o en "nueva" si no hubo ninguna.
  const [vinculo, setVinculo] = useState<Record<number, string>>({});
  const valorVinculo = (s: Solicitud) => vinculo[s.id] ?? (s.aliado_sugerido_id ? String(s.aliado_sugerido_id) : "nueva");

  function aprobar(s: Solicitud) {
    setMsg("");
    const v = valorVinculo(s);
    const arg = v === "nueva" ? "nueva" : v === "ninguna" ? null : Number(v);
    start(async () => {
      const r = await aprobarSolicitudB2B(s.id, arg);
      if (r.ok) router.refresh();
      else setMsg(r.error ?? "Error");
    });
  }

  function rechazar(id: number) {
    setMsg("");
    start(async () => {
      const r = await rechazarSolicitudB2B(id);
      if (r.ok) router.refresh();
      else setMsg(r.error ?? "Error");
    });
  }

  if (!solicitudes.length) return <p className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-gray-400">No hay solicitudes de registro.</p>;

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {solicitudes.map((s) => {
        const sugerido = aliados.find((a) => a.id === s.aliado_sugerido_id);
        const doc = `${s.tipo_documento ?? "Doc"} ${s.nit ?? "—"}`;
        return (
          <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{s.nombre}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase text-gray-500">{s.tipo}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: BADGE[s.estado] ?? "#6b7280", backgroundColor: "rgba(0,0,0,0.04)" }}>{s.estado}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {s.email}{s.telefono ? ` · ${s.telefono}` : ""}{s.ciudad ? ` · ${s.ciudad}` : ""}{s.nit ? ` · ${doc}` : ""}
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
                  <Button disabled={pending} onClick={() => aprobar(s)} style={{ backgroundColor: "var(--brand-success)" }}>Aprobar</Button>
                  <Button disabled={pending} onClick={() => rechazar(s.id)} variant="secondary">Rechazar</Button>
                </div>
              )}
            </div>

            {/* Enlace con el catálogo de aliados: es lo que le da acceso a los
                contratos que ya le montaron. Se muestra solo mientras está
                pendiente, porque es parte de la decisión de aprobar. */}
            {s.estado === "pendiente" && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <label className="mb-1 block text-xs font-medium text-gray-600">Enlazar con la ficha de aliado</label>
                <select
                  value={valorVinculo(s)}
                  onChange={(e) => setVinculo((p) => ({ ...p, [s.id]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="nueva">+ Crear ficha nueva en el catálogo con estos datos</option>
                  <option value="ninguna">Aprobar sin enlazar (no verá contratos previos)</option>
                  {aliados.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.nombre}{a.nit ? ` — ${a.tipo_documento ?? "Doc"} ${a.nit}` : ""}
                      {a.id === s.aliado_sugerido_id ? "  (coincide el documento)" : ""}
                    </option>
                  ))}
                </select>
                {sugerido ? (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--brand-success)" }}>
                    El documento coincide con <strong>{sugerido.nombre}</strong>. Verifica que sea la misma persona o
                    empresa antes de aprobar: al enlazar, verá todos los contratos de esa ficha.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Ningún aliado del catálogo tiene ese documento. Si ya trabajaba con ustedes, búscalo en la lista;
                    si es nuevo, deja &quot;crear ficha nueva&quot;.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
