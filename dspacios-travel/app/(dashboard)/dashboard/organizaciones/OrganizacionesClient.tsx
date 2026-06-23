"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearOrganizacion, actualizarOrganizacion, type OrgInput } from "./actions";

export type OrgRow = {
  id: string; slug: string; nombre: string; nit: string | null; ciudad: string | null;
  email: string | null; telefono: string | null; color_primario: string | null; color_acento: string | null;
  logo_url: string | null; logo_white_url: string | null; plan: string; estado: string; created_at: string;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const PLANES = ["trial", "basico", "pro", "enterprise"];
const ESTADOS = ["activa", "suspendida", "cancelada"];

function vacia(): OrgInput {
  return { slug: "", nombre: "", nit: "", ciudad: "", email: "", telefono: "",
    colorPrimario: "#1D7C9A", colorAcento: "#26BBD9", logoUrl: "", logoWhiteUrl: "",
    plan: "trial", estado: "activa", adminEmail: "", adminNombre: "" };
}

export function OrganizacionesClient({ orgs, conteoUsuarios }: { orgs: OrgRow[]; conteoUsuarios: Record<string, number> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nueva, setNueva] = useState<OrgInput>(vacia());
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  const set = (k: keyof OrgInput, v: string) => setNueva((p) => ({ ...p, [k]: v }));

  function crear() {
    if (!nueva.nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr(""); setMsg("");
    start(async () => {
      const r = await crearOrganizacion(nueva);
      if (r.ok) { setMsg(r.mensaje ?? "Organización creada."); setNueva(vacia()); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-8">
      {/* Crear */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
        <p className="mb-3 text-sm font-semibold text-gray-700">Nueva organización</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={lbl}>Nombre *</label><Input value={nueva.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Agencia Ejemplo" /></div>
          <div><label className={lbl}>Slug (URL /o/…)</label><Input value={nueva.slug} onChange={(e) => set("slug", e.target.value)} placeholder="se genera del nombre" /></div>
          <div><label className={lbl}>NIT</label><Input value={nueva.nit} onChange={(e) => set("nit", e.target.value)} /></div>
          <div><label className={lbl}>Ciudad</label><Input value={nueva.ciudad} onChange={(e) => set("ciudad", e.target.value)} /></div>
          <div><label className={lbl}>Email</label><Input value={nueva.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={nueva.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
          <div>
            <label className={lbl}>Color primario</label>
            <div className="flex items-center gap-2">
              <input type="color" value={nueva.colorPrimario || "#1D7C9A"} onChange={(e) => set("colorPrimario", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
              <Input value={nueva.colorPrimario} onChange={(e) => set("colorPrimario", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={lbl}>Color acento</label>
            <div className="flex items-center gap-2">
              <input type="color" value={nueva.colorAcento || "#26BBD9"} onChange={(e) => set("colorAcento", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
              <Input value={nueva.colorAcento} onChange={(e) => set("colorAcento", e.target.value)} />
            </div>
          </div>
          <div className="col-span-2"><label className={lbl}>Logo (URL, fondos claros)</label><Input value={nueva.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" /></div>
          <div className="col-span-2"><label className={lbl}>Logo blanco (URL, header)</label><Input value={nueva.logoWhiteUrl} onChange={(e) => set("logoWhiteUrl", e.target.value)} placeholder="https://…" /></div>
          <div>
            <label className={lbl}>Plan</label>
            <select value={nueva.plan} onChange={(e) => set("plan", e.target.value)} className={sel}>
              {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">Primer usuario superadmin (opcional — deja la org usable de inmediato)</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Email del admin</label><Input value={nueva.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} placeholder="dueño@agencia.com" /></div>
            <div><label className={lbl}>Nombre del admin</label><Input value={nueva.adminNombre} onChange={(e) => set("adminNombre", e.target.value)} /></div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Creando…" : "Crear organización"}
          </Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        {msg && <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      </div>

      {/* Listado */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700">{orgs.length} organización(es)</p>
        {orgs.map((o) => (
          <OrgFila key={o.id} org={o} usuarios={conteoUsuarios[o.id] ?? 0} />
        ))}
        {!orgs.length && <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Aún no hay organizaciones.</p>}
      </div>
    </div>
  );
}

function OrgFila({ org, usuarios }: { org: OrgRow; usuarios: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState("");
  const [v, setV] = useState({
    nombre: org.nombre, email: org.email ?? "", telefono: org.telefono ?? "", ciudad: org.ciudad ?? "",
    colorPrimario: org.color_primario ?? "#1D7C9A", colorAcento: org.color_acento ?? "#26BBD9",
    logoUrl: org.logo_url ?? "", logoWhiteUrl: org.logo_white_url ?? "", plan: org.plan, estado: org.estado,
  });
  const setK = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));

  function guardar() {
    setErr("");
    start(async () => {
      const r = await actualizarOrganizacion(org.id, v);
      if (r.ok) { setEdit(false); router.refresh(); } else setErr(r.error);
    });
  }

  const badge = org.estado === "activa" ? "bg-green-100 text-green-700"
    : org.estado === "suspendida" ? "bg-amber-100 text-amber-700" : "bg-gray-200 text-gray-600";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-8 w-8 rounded-lg" style={{ background: `linear-gradient(120deg, ${org.color_primario ?? "#1D7C9A"}, ${org.color_acento ?? "#26BBD9"})` }} />
          <div>
            <p className="font-medium text-gray-800">{org.nombre}</p>
            <p className="text-xs text-gray-500">
              <code className="rounded bg-gray-100 px-1">/o/{org.slug}</code> · {usuarios} usuario(s) · plan {org.plan}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge}`}>{org.estado}</span>
          <a href={`/o/${org.slug}/tarifario`} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand-accent)] hover:underline">Ver tarifario ↗</a>
          <button type="button" onClick={() => setEdit((x) => !x)} className="text-xs text-gray-500 hover:text-gray-800">{edit ? "Cerrar" : "Editar"}</button>
        </div>
      </div>

      {edit && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><label className={lbl}>Nombre</label><Input value={v.nombre} onChange={(e) => setK("nombre", e.target.value)} /></div>
            <div><label className={lbl}>Email</label><Input value={v.email} onChange={(e) => setK("email", e.target.value)} /></div>
            <div><label className={lbl}>Teléfono</label><Input value={v.telefono} onChange={(e) => setK("telefono", e.target.value)} /></div>
            <div><label className={lbl}>Ciudad</label><Input value={v.ciudad} onChange={(e) => setK("ciudad", e.target.value)} /></div>
            <div>
              <label className={lbl}>Color primario</label>
              <div className="flex items-center gap-2">
                <input type="color" value={v.colorPrimario} onChange={(e) => setK("colorPrimario", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
                <Input value={v.colorPrimario} onChange={(e) => setK("colorPrimario", e.target.value)} />
              </div>
            </div>
            <div>
              <label className={lbl}>Color acento</label>
              <div className="flex items-center gap-2">
                <input type="color" value={v.colorAcento} onChange={(e) => setK("colorAcento", e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
                <Input value={v.colorAcento} onChange={(e) => setK("colorAcento", e.target.value)} />
              </div>
            </div>
            <div>
              <label className={lbl}>Plan</label>
              <select value={v.plan} onChange={(e) => setK("plan", e.target.value)} className={sel}>
                {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Estado</label>
              <select value={v.estado} onChange={(e) => setK("estado", e.target.value)} className={sel}>
                {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className={lbl}>Logo (URL)</label><Input value={v.logoUrl} onChange={(e) => setK("logoUrl", e.target.value)} /></div>
            <div className="col-span-2"><label className={lbl}>Logo blanco (URL)</label><Input value={v.logoWhiteUrl} onChange={(e) => setK("logoWhiteUrl", e.target.value)} /></div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar"}</Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
