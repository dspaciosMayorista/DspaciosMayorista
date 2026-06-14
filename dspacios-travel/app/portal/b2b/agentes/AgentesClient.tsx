"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearAgente, cambiarEstadoAgente } from "./actions";

export type Agente = { id: string; nombre: string; email: string; activo: boolean };
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function AgentesClient({ agentes }: { agentes: Agente[] }) {
  const router = useRouter();
  const [f, setF] = useState({ nombre: "", email: "", password: "" });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function crear() {
    setMsg("");
    start(async () => {
      const r = await crearAgente(f);
      if (r.ok) { setF({ nombre: "", email: "", password: "" }); setMsg("✓ Agente creado"); router.refresh(); }
      else setMsg(r.error);
    });
  }
  const toggle = (id: string, activo: boolean) => start(async () => { await cambiarEstadoAgente(id, activo); router.refresh(); });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Crear agente</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={lbl}>Nombre</label><Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><label className={lbl}>Correo</label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label className={lbl}>Contraseña</label><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="mín. 6" /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Creando…" : "Crear agente"}</Button>
          {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-gray-400">El agente entra con ese correo y clave. La facturación de contratos netos siempre va a la agencia.</p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Agentes ({agentes.length})</h2>
        {agentes.length === 0 ? (
          <p className="text-sm text-gray-400">Aún no tienes agentes.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {agentes.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm font-medium text-gray-800">{a.nombre}</span>
                  <span className="ml-2 text-xs text-gray-400">{a.email}</span>
                  {!a.activo && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">inactivo</span>}
                </div>
                <button type="button" onClick={() => toggle(a.id, !a.activo)} disabled={pending}
                  className="text-xs font-medium" style={{ color: a.activo ? "#C0392B" : "var(--brand-success)" }}>
                  {a.activo ? "Desactivar" : "Activar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
