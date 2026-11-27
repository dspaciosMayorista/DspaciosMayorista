"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DecisionCandidato } from "@/components/referidos/DecisionReferido";
import type { CandidatoReferido, DecisionReferido } from "@/lib/referidos/reglas";
import { decidirCandidatoAction } from "./actions";

// #76 — Códigos de referido escritos en el registro público, por confirmar. Superadmin, gerencia y administración los VEN; solo superadmin/gerencia deciden. Una decisión por fila, sin sondeos.
export function CandidatosReferido({ candidatos, referidores, gestiona }: { candidatos: CandidatoReferido[]; referidores: { id: number; nombre: string }[]; gestiona: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [decisiones, setDecisiones] = useState<Record<number, DecisionReferido | null>>({});
  const pendientes = candidatos.filter((c) => c.referido_estado === "candidato");
  const resueltos = candidatos.filter((c) => c.referido_estado !== "candidato");

  function aplicar(c: CandidatoReferido) {
    const d = decisiones[c.solicitud_id]; if (!d) return;
    setMsg(null);
    start(async () => {
      const r = await decidirCandidatoAction({ solicitudId: c.solicitud_id, decision: d });
      if (r.ok) { setMsg({ ok: true, texto: r.estado === "ya_decidida" ? "Ese código ya tenía una decisión." : "Decisión aplicada. Rige solo para las compras futuras del aliado." }); router.refresh(); }
      else setMsg({ ok: false, texto: r.error });
    });
  }

  return (
    <section aria-labelledby="ref-candidatos" className="mb-8">
      <h2 id="ref-candidatos" className="text-lg font-semibold text-gray-900">Códigos de registro por confirmar</h2>
      <p className="mt-1 text-sm text-gray-500">
        Una agencia o freelance puede escribir un código de referido al registrarse. Es solo un candidato: no se asigna nada hasta que superadmin o gerencia lo confirmen, y rige únicamente para sus compras futuras.
        {!gestiona && " Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes."}
      </p>
      {msg && <p role="status" className={`mt-3 rounded-lg px-4 py-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
      {pendientes.length === 0 ? (
        <p className="mt-3 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-400">No hay códigos por confirmar.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pendientes.map((c) => {
            const listo = c.estado_solicitud === "aprobada" && c.aliado_id !== null;
            return (
              <li key={c.solicitud_id} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-sm font-semibold text-gray-800">{c.nombre} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-normal uppercase text-gray-500">{c.tipo}</span> <span className="ml-1 text-xs font-normal text-gray-500">registro {c.estado_solicitud}{c.aliado_nombre ? ` · ficha ${c.aliado_nombre}` : ""}</span></p>
                <DecisionCandidato candidato={c} referidores={referidores} gestiona={gestiona && listo} disabled={pend} onChange={(d) => setDecisiones((p) => (p[c.solicitud_id] === d ? p : { ...p, [c.solicitud_id]: d }))} />
                {gestiona && !listo && <p className="mt-2 text-[11px] text-amber-700">{c.estado_solicitud === "pendiente" ? "Decide al aprobar el registro (Usuarios → Aprobaciones B2B) o después de aprobarlo." : "El registro debe estar aprobado y enlazado a una ficha de aliado para asignar el referido."}</p>}
                {gestiona && listo && (
                  <button type="button" disabled={pend || !decisiones[c.solicitud_id]} onClick={() => aplicar(c)} className="mt-2 inline-flex items-center rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Aplicar decisión</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {resueltos.length > 0 && (
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">Decididos en los últimos 60 días ({resueltos.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {resueltos.map((c) => <li key={c.solicitud_id}>{c.nombre} · <span className="font-mono">{c.codigo}</span> · {c.referido_estado}{c.decidido_en ? ` · ${new Date(c.decidido_en).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
