"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Hand, MessageSquare, Save } from "lucide-react";
import { agregarActividadLead, actualizarLead, cambiarEtapaLead, tomarLead } from "../actions";
import {
  CRM_LEAD_CANAL_LABEL,
  CRM_LEAD_ETAPA_LABEL,
  CRM_LEAD_ETAPAS,
  CRM_LEAD_TIPO_DOC_LABEL,
  CRM_LEAD_TIPOS_DOC,
  type CrmLeadCanal,
  type CrmLeadEtapa,
} from "@/lib/crm/leads";
import { DateInput } from "@/components/ui/DateInput";

export type LeadDetalle = {
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

export type ActividadRow = {
  id: number;
  lead_id: number;
  tipo: string;
  cuerpo: string | null;
  proxima_accion_at: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
};

export type ResponsableOpt = { id: string; nombre: string | null; email: string | null; rol: string | null; tenant: string | null };

type Props = {
  lead: LeadDetalle;
  actividades: ActividadRow[];
  responsables: ResponsableOpt[];
  puedeReasignar: boolean;
};

function fechaParte(v: string | null) {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function horaParte(v: string | null) {
  if (!v) return "09:00";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fechaHoraDeForm(formData: FormData) {
  const fecha = String(formData.get("proximaAccionFecha") ?? "");
  if (!fecha) return "";
  const hora = String(formData.get("proximaAccionHora") ?? "09:00") || "09:00";
  return `${fecha}T${hora}`;
}

function fecha(v: string | null) {
  if (!v) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
}

export function LeadDetalleClient({ lead, actividades, responsables, puedeReasignar }: Props) {
  const [estado, setEstado] = useState<{ ok: boolean; texto: string; aviso?: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const responsablesPorId = useMemo(() => new Map(responsables.map((r) => [r.id, r])), [responsables]);
  const responsable = lead.responsable_id ? responsablesPorId.get(lead.responsable_id) : null;

  function guardar(formData: FormData) {
    // Quien no puede reasignar NO manda un responsable: manda el que ya tiene,
    // asi guardar no intenta quitarle el lead a otro ni tomarlo por sorpresa.
    // Tomarlo es una accion explicita ("Tomar lead"), resuelta en SQL.
    const responsableId = puedeReasignar
      ? String(formData.get("responsableId") ?? "")
      : lead.responsable_id ?? "";
    startTransition(async () => {
      const r = await actualizarLead(lead.id, {
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
      setEstado(r.ok ? { ok: true, texto: "Lead actualizado.", aviso: r.aviso } : { ok: false, texto: r.error });
    });
  }

  function tomar() {
    startTransition(async () => {
      const r = await tomarLead(lead.id);
      setEstado({ ok: r.ok, texto: r.ok ? "Lead tomado." : r.error });
      if (r.ok) router.refresh();
    });
  }

  function etapa(formData: FormData) {
    startTransition(async () => {
      const r = await cambiarEtapaLead(lead.id, String(formData.get("etapa") ?? lead.etapa));
      setEstado({ ok: r.ok, texto: r.ok ? "Etapa actualizada." : r.error });
      // La bitácora y la columna de la etapa llegan desde el servidor: sin este
      // refresco la cabecera seguiría mostrando la etapa anterior.
      if (r.ok) router.refresh();
    });
  }

  function actividad(formData: FormData) {
    startTransition(async () => {
      const r = await agregarActividadLead(lead.id, {
        tipo: String(formData.get("tipo") ?? "nota"),
        cuerpo: String(formData.get("cuerpo") ?? ""),
        proximaAccionAt: fechaHoraDeForm(formData),
      });
      setEstado({ ok: r.ok, texto: r.ok ? "Actividad registrada." : r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <section className="space-y-4">
        <div className="rounded-lg border border-white/70 bg-white/85 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{CRM_LEAD_ETAPA_LABEL[lead.etapa]}</span>
            <span className="rounded-md bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800">{CRM_LEAD_CANAL_LABEL[lead.canal]}</span>
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">{lead.tenant}</span>
            <span className="text-xs text-gray-500">Responsable: {responsable?.nombre ?? responsable?.email ?? "Sin responsable"}</span>
            {!lead.responsable_id && !puedeReasignar && (
              <button
                type="button"
                onClick={tomar}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800 disabled:opacity-60"
              >
                <Hand size={13} /> Tomar lead
              </button>
            )}
          </div>

          <form action={guardar} className="grid gap-3 md:grid-cols-2">
            <input name="nombre" defaultValue={lead.nombre} required className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <select name="canal" defaultValue={lead.canal} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="otro">Otro</option>
            </select>
            <input name="telefono" defaultValue={lead.telefono ?? ""} placeholder="Teléfono" className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <input name="email" defaultValue={lead.email ?? ""} placeholder="Correo" className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
            {/* Tipo y número van juntos: sin tipo explícito no se guarda un número (no se asume CC). */}
            <div className="grid grid-cols-[112px_1fr] gap-2">
              <select name="tipoDoc" aria-label="Tipo de documento" defaultValue={lead.tipo_doc ?? ""} className="rounded-md border border-gray-200 px-2 py-2 text-sm">
                <option value="">Tipo doc.</option>
                {CRM_LEAD_TIPOS_DOC.map((t) => <option key={t} value={t} title={CRM_LEAD_TIPO_DOC_LABEL[t]}>{t}</option>)}
              </select>
              <input name="documento" aria-label="Número de documento" defaultValue={lead.documento ?? ""} placeholder="Número de documento" className="min-w-0 rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </div>
            {puedeReasignar ? (
              <select name="responsableId" defaultValue={lead.responsable_id ?? ""} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
                <option value="">Sin responsable</option>
                {responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre ?? r.email}</option>)}
              </select>
            ) : (
              <input readOnly value={responsable?.nombre ?? responsable?.email ?? "Sin responsable"} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
            )}
            <input name="interes" defaultValue={lead.interes ?? ""} placeholder="Interés" className="md:col-span-2 rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <input name="origenDetalle" defaultValue={lead.origen_detalle ?? ""} placeholder="Origen / contexto" className="md:col-span-2 rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <label className="md:col-span-2 flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
              <CalendarClock size={16} className="text-gray-400" />
              <DateInput name="proximaAccionFecha" aria-label="Fecha de próxima acción" defaultValue={fechaParte(lead.proxima_accion_at)} className="min-w-0 flex-1 border-0 px-0 py-0 text-sm" />
              <input name="proximaAccionHora" type="time" defaultValue={horaParte(lead.proxima_accion_at)} className="w-28 border-0 text-sm outline-none" />
            </label>
            <textarea name="notas" defaultValue={lead.notas ?? ""} rows={4} placeholder="Notas generales" className="md:col-span-2 rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <button disabled={isPending} className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Save size={16} /> Guardar cambios
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-white/70 bg-white/85 p-4">
          <h2 className="mb-3 font-semibold text-gray-900">Bitácora</h2>
          <div className="space-y-3">
            {actividades.map((a) => (
              <article key={a.id} className="rounded-md border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-semibold uppercase text-gray-700">{a.tipo}</span>
                  <span>{fecha(a.created_at)}</span>
                  {a.actor_email && <span>{a.actor_email}</span>}
                </div>
                {a.cuerpo && <p className="whitespace-pre-wrap text-gray-800">{a.cuerpo}</p>}
                {a.proxima_accion_at && <p className="mt-2 text-xs font-medium text-cyan-800">Próxima acción: {fecha(a.proxima_accion_at)}</p>}
              </article>
            ))}
            {actividades.length === 0 && <p className="text-sm text-gray-500">Todavía no hay actividades.</p>}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/70 bg-white/85 p-4">
          <h2 className="mb-3 font-semibold text-gray-900">Etapa comercial</h2>
          <form action={etapa} className="flex gap-2">
            <select name="etapa" defaultValue={lead.etapa} className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm">
              {CRM_LEAD_ETAPAS.map((e) => <option key={e} value={e}>{CRM_LEAD_ETAPA_LABEL[e]}</option>)}
            </select>
            <button disabled={isPending} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white">
              <Check size={16} />
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-white/70 bg-white/85 p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare size={17} />
            <h2 className="font-semibold text-gray-900">Registrar actividad</h2>
          </div>
          <form action={actividad} className="space-y-3">
            <select name="tipo" defaultValue="nota" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
              <option value="nota">Nota</option>
              <option value="llamada">Llamada</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="email">Email</option>
              <option value="reunion">Reunión</option>
            </select>
            <textarea name="cuerpo" rows={4} required placeholder="Qué pasó y qué sigue" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            <div className="grid grid-cols-[1fr_112px] gap-2">
              <DateInput name="proximaAccionFecha" aria-label="Fecha de próxima acción de la actividad" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
              <input name="proximaAccionHora" type="time" defaultValue="09:00" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <button disabled={isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Check size={16} /> Registrar
            </button>
          </form>
        </div>

        {estado && (
          <p role="status" className={`rounded-md px-3 py-2 text-sm ${estado.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {estado.texto}
          </p>
        )}
        {estado?.ok && estado.aviso && (
          <p data-testid="aviso-coincidencias" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {estado.aviso}
          </p>
        )}
      </aside>
    </div>
  );
}
