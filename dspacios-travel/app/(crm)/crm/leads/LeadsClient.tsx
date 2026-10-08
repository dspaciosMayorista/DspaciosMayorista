"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, Clock, Search, UserPlus } from "lucide-react";
import { crearLead } from "./actions";
import {
  CRM_LEAD_CANAL_LABEL,
  CRM_LEAD_ETAPA_LABEL,
  CRM_LEAD_ETAPAS,
  CRM_LEAD_TIPO_DOC_LABEL,
  CRM_LEAD_TIPOS_DOC,
  textoDocumentoLead,
  type CrmLeadCanal,
  type CrmLeadEtapa,
} from "@/lib/crm/leads";
import { DateInput } from "@/components/ui/DateInput";

export type LeadRow = {
  id: number;
  tenant: string;
  etapa: CrmLeadEtapa;
  canal: CrmLeadCanal;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tipo_doc: string | null;
  documento: string | null;
  interes: string | null;
  origen_detalle: string | null;
  notas: string | null;
  responsable_id: string | null;
  proxima_accion_at: string | null;
  cerrado_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ResponsableOpt = { id: string; nombre: string | null; email: string | null; rol: string | null; tenant: string | null };

type Props = {
  leads: LeadRow[];
  responsables: ResponsableOpt[];
  puedeReasignar: boolean;
  usuarioId: string;
};

const hoy = new Date();

function textoFecha(v: string | null) {
  if (!v) return "Sin próxima acción";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
}

function fechaHoraDeForm(formData: FormData) {
  const fecha = String(formData.get("proximaAccionFecha") ?? "");
  if (!fecha) return "";
  const hora = String(formData.get("proximaAccionHora") ?? "09:00") || "09:00";
  return `${fecha}T${hora}`;
}

export function LeadsClient({ leads, responsables, puedeReasignar, usuarioId }: Props) {
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState<"todos" | CrmLeadEtapa>("todos");
  const [estado, setEstado] = useState<{ ok: boolean; texto: string; aviso?: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();

  const responsablesPorId = useMemo(() => new Map(responsables.map((r) => [r.id, r])), [responsables]);
  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((lead) => {
      if (etapa !== "todos" && lead.etapa !== etapa) return false;
      if (!needle) return true;
      // El número basta para EMPEZAR a buscar; la identidad la da tipo + número,
      // por eso el resultado muestra los dos.
      return [lead.nombre, lead.telefono, lead.email, lead.documento, textoDocumentoLead(lead.tipo_doc, lead.documento), lead.interes, lead.origen_detalle]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [leads, q, etapa]);

  const vencidos = leads.filter((l) => l.proxima_accion_at && new Date(l.proxima_accion_at) < hoy && !l.cerrado_at).length;

  function submit(formData: FormData) {
    const responsableId = puedeReasignar
      ? String(formData.get("responsableId") ?? "")
      : String(formData.get("tomar") ?? "") === "1" ? usuarioId : "";
    startTransition(async () => {
      const r = await crearLead({
        nombre: String(formData.get("nombre") ?? ""),
        canal: String(formData.get("canal") ?? "whatsapp"),
        telefono: String(formData.get("telefono") ?? ""),
        email: String(formData.get("email") ?? ""),
        tipoDoc: String(formData.get("tipoDoc") ?? ""),
        documento: String(formData.get("documento") ?? ""),
        interes: String(formData.get("interes") ?? ""),
        origenDetalle: String(formData.get("origenDetalle") ?? ""),
        notas: String(formData.get("notas") ?? ""),
        responsableId,
        proximaAccionAt: fechaHoraDeForm(formData),
      });
      setEstado(r.ok ? { ok: true, texto: `Lead #${r.id} creado.`, aviso: r.aviso } : { ok: false, texto: r.error });
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="min-w-0">
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-white/70 bg-white/75 p-3">
            <p className="text-xs font-medium text-gray-500">Bandeja visible</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{leads.length}</p>
          </div>
          <div className="rounded-lg border border-white/70 bg-white/75 p-3">
            <p className="text-xs font-medium text-gray-500">Sin responsable</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{leads.filter((l) => !l.responsable_id && !l.cerrado_at).length}</p>
          </div>
          <div className="rounded-lg border border-white/70 bg-white/75 p-3">
            <p className="text-xs font-medium text-gray-500">Seguimientos vencidos</p>
            <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-gray-900"><Clock size={18} />{vencidos}</p>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/70 bg-white/75 p-2">
          <div className="flex min-w-56 flex-1 items-center gap-2 rounded-md bg-white px-3 py-2 text-sm">
            <Search size={16} className="text-gray-400" />
            <input className="w-full outline-none" placeholder="Buscar nombre, teléfono, correo, documento, interés..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" value={etapa} onChange={(e) => setEtapa(e.target.value as never)}>
            <option value="todos">Todas las etapas</option>
            {CRM_LEAD_ETAPAS.map((e) => <option key={e} value={e}>{CRM_LEAD_ETAPA_LABEL[e]}</option>)}
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border border-white/70 bg-white/85">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Etapa</th>
                <th className="px-3 py-2">Responsable</th>
                <th className="px-3 py-2">Próxima acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibles.map((lead) => {
                const responsable = lead.responsable_id ? responsablesPorId.get(lead.responsable_id) : null;
                const vencido = lead.proxima_accion_at && new Date(lead.proxima_accion_at) < hoy && !lead.cerrado_at;
                return (
                  <tr key={lead.id} className="hover:bg-cyan-50/50">
                    <td className="px-3 py-3">
                      <Link href={`/crm/leads/${lead.id}`} className="font-semibold text-gray-900 hover:text-[var(--brand-primary)]">{lead.nombre}</Link>
                      <div className="mt-1 text-xs text-gray-500">{lead.telefono || lead.email || textoDocumentoLead(lead.tipo_doc, lead.documento) || "Sin identificador"}</div>
                    </td>
                    <td className="px-3 py-3">{CRM_LEAD_CANAL_LABEL[lead.canal] ?? lead.canal}</td>
                    <td className="px-3 py-3"><span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{CRM_LEAD_ETAPA_LABEL[lead.etapa]}</span></td>
                    <td className="px-3 py-3">{responsable?.nombre ?? responsable?.email ?? "Sin responsable"}</td>
                    <td className={`px-3 py-3 ${vencido ? "font-semibold text-red-700" : "text-gray-600"}`}>{textoFecha(lead.proxima_accion_at)}</td>
                  </tr>
                );
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">No hay leads con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="rounded-lg border border-white/70 bg-white/85 p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus size={18} />
          <h2 className="font-semibold text-gray-900">Nuevo lead</h2>
        </div>
        <form action={submit} className="space-y-3">
          <input name="nombre" required placeholder="Nombre o Desconocido" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <select name="canal" className="rounded-md border border-gray-200 px-3 py-2 text-sm" defaultValue="whatsapp">
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="otro">Otro</option>
            </select>
            {puedeReasignar ? (
              <select name="responsableId" className="rounded-md border border-gray-200 px-3 py-2 text-sm" defaultValue="">
                <option value="">Sin responsable</option>
                {responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre ?? r.email}</option>)}
              </select>
            ) : (
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input type="checkbox" name="tomar" value="1" /> Tomarlo
              </label>
            )}
          </div>
          <input name="telefono" placeholder="Teléfono / WhatsApp" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          <input name="email" placeholder="Correo" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          {/* Tipo y número van juntos: sin tipo explícito no se guarda un número (no se asume CC). */}
          <div className="grid grid-cols-[112px_1fr] gap-2">
            <select name="tipoDoc" aria-label="Tipo de documento" defaultValue="" className="rounded-md border border-gray-200 px-2 py-2 text-sm">
              <option value="">Tipo doc.</option>
              {CRM_LEAD_TIPOS_DOC.map((t) => <option key={t} value={t} title={CRM_LEAD_TIPO_DOC_LABEL[t]}>{t}</option>)}
            </select>
            <input name="documento" aria-label="Número de documento" placeholder="Número de documento" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <input name="interes" placeholder="Interés: destino, producto, fecha..." className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          <input name="origenDetalle" placeholder="Contexto: historia, pauta, referido..." className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          <div className="grid grid-cols-[1fr_112px] gap-2">
            <DateInput name="proximaAccionFecha" aria-label="Fecha de próxima acción" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <input name="proximaAccionHora" type="time" defaultValue="09:00" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <textarea name="notas" rows={4} placeholder="Notas iniciales" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
          <button disabled={isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            <Check size={16} /> Guardar lead
          </button>
          {estado && (
            <p role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${estado.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              <AlertCircle size={16} className="mt-0.5" /> {estado.texto}
            </p>
          )}
          {estado?.ok && estado.aviso && (
            <p data-testid="aviso-coincidencias" className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertCircle size={16} className="mt-0.5" /> {estado.aviso}
            </p>
          )}
        </form>
      </aside>
    </div>
  );
}
