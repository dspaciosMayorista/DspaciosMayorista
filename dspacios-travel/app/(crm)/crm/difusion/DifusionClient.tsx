"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import {
  TIPOS_MATERIAL, ESTADOS_MATERIAL, PRIORIDADES, CANALES, LISTAS, OBJETIVOS, RESULTADOS, ESTADOS_PLAN,
  DESTINOS_EXTRA, label, ROTACION_LABEL, puedeEnviar, type Rotacion, type RotacionEstado,
} from "@/lib/crm/difusion";
import {
  crearMaterial, actualizarMaterial, eliminarMaterial, registrarEnvio, eliminarEnvio,
  crearPlan, cambiarEstadoPlan, eliminarPlan, marcarPlanEnviado,
  type MaterialInput, type EnvioInput, type PlanInput,
} from "./actions";

type MaterialRow = Database["public"]["Tables"]["crm_material"]["Row"];
export type MaterialConRot = MaterialRow & { rotacion: Rotacion };
export type EnvioRow = Database["public"]["Tables"]["crm_envio"]["Row"];
export type PlanRow = Database["public"]["Tables"]["crm_difusion_plan"]["Row"];
export type HotelOpt = { id: number; nombre: string; destino: string | null };

const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

const ROT_COLOR: Record<RotacionEstado, string> = {
  prioridad: "bg-[#AEF44A]/30 text-[#4d6b13]",
  puede: "bg-[#66B596]/20 text-[#2f6b54]",
  no_repetir: "bg-amber-100 text-amber-700",
  en_pausa: "bg-red-100 text-red-700",
};
function RotBadge({ r }: { r: Rotacion }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ROT_COLOR[r.estado]}`}>{ROTACION_LABEL[r.estado]}</span>;
}

const fmt = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) : "—");
const diaSemana = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString("es-CO", { weekday: "long" });
function isoSemana(f: string): string {
  const d = new Date(`${f}T00:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const jueves = d.getTime();
  d.setMonth(0, 1);
  const semana = 1 + Math.round((jueves - d.getTime()) / 86_400_000 / 7);
  return `Semana ${semana}`;
}

const TABS = [
  { k: "semana", label: "Qué enviar esta semana" },
  { k: "inventario", label: "Inventario" },
  { k: "historico", label: "Histórico" },
  { k: "calendario", label: "Calendario" },
  { k: "panel", label: "Panel" },
];

export function DifusionClient({ hoy, materiales, envios, plan, hoteles, destinos }: {
  hoy: string; materiales: MaterialConRot[]; envios: EnvioRow[]; plan: PlanRow[]; hoteles: HotelOpt[]; destinos: string[];
}) {
  const [tab, setTab] = useState("semana");
  const [envioPrefill, setEnvioPrefill] = useState<MaterialConRot | null>(null);

  const destinoOpts = useMemo(() => [...new Set([...destinos, ...DESTINOS_EXTRA])], [destinos]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className="px-3 py-2 text-sm"
            style={tab === t.k ? { color: "var(--brand-primary)", borderBottom: "2px solid var(--brand-primary)", fontWeight: 600 } : { color: "#6b7280" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "semana" && <TabSemana materiales={materiales} onEnviar={(m) => { setEnvioPrefill(m); setTab("historico"); }} />}
      {tab === "inventario" && <TabInventario materiales={materiales} hoteles={hoteles} destinoOpts={destinoOpts} />}
      {tab === "historico" && <TabHistorico envios={envios} materiales={materiales} destinoOpts={destinoOpts} prefill={envioPrefill} onDone={() => setEnvioPrefill(null)} />}
      {tab === "calendario" && <TabCalendario plan={plan} materiales={materiales} destinoOpts={destinoOpts} hoy={hoy} />}
      {tab === "panel" && <TabPanel materiales={materiales} envios={envios} plan={plan} hoy={hoy} />}
    </div>
  );
}

// ── TAB 1 · Esta semana ──────────────────────────────────────────────────────
function TabSemana({ materiales, onEnviar }: { materiales: MaterialConRot[]; onEnviar: (m: MaterialConRot) => void }) {
  const orden: Record<string, number> = { alta: 0, media: 1, baja: 2 };
  const lista = materiales
    .filter((m) => puedeEnviar(m.rotacion))
    .sort((a, b) => {
      if (a.rotacion.estado !== b.rotacion.estado) return a.rotacion.estado === "prioridad" ? -1 : 1;
      return (orden[a.prioridad] ?? 1) - (orden[b.prioridad] ?? 1);
    });
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">{lista.length} material(es) listos para enviar (prioridad de envío o ya cumplieron los 21 días).</p>
      {!lista.length ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-gray-400">Nada por enviar ahora mismo. 👌</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Destino</th><th className="px-4 py-3">Hotel / Producto</th><th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Prioridad</th><th className="px-4 py-3">Últ. envío</th><th className="px-4 py-3">Rotación</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-600">{m.destino ?? "—"}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{m.hotel_producto}{m.link_archivo && <a href={m.link_archivo} target="_blank" rel="noreferrer" className="ml-1 text-xs text-[var(--brand-accent)]">↗</a>}</td>
                  <td className="px-4 py-2 text-gray-500">{label(TIPOS_MATERIAL, m.tipo_material)}</td>
                  <td className="px-4 py-2 text-gray-500">{label(PRIORIDADES, m.prioridad)}</td>
                  <td className="px-4 py-2 text-gray-500">{fmt(m.rotacion.ultimaFecha)}{m.rotacion.diasDesde != null ? ` · hace ${m.rotacion.diasDesde}d` : ""}</td>
                  <td className="px-4 py-2"><RotBadge r={m.rotacion} /></td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => onEnviar(m)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Registrar envío</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── TAB 2 · Inventario ───────────────────────────────────────────────────────
function TabInventario({ materiales, hoteles, destinoOpts }: { materiales: MaterialConRot[]; hoteles: HotelOpt[]; destinoOpts: string[] }) {
  const [edit, setEdit] = useState<MaterialConRot | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [q, setQ] = useState("");
  const vis = q.trim() ? materiales.filter((m) => (m.hotel_producto + " " + (m.destino ?? "")).toLowerCase().includes(q.toLowerCase())) : materiales;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar hotel/producto o destino…" className="max-w-xs" />
        <Button onClick={() => { setNuevo(true); setEdit(null); }} style={{ backgroundColor: "var(--brand-primary)" }}>+ Agregar material</Button>
      </div>
      {(nuevo || edit) && (
        <MaterialForm hoteles={hoteles} destinoOpts={destinoOpts} inicial={edit} onClose={() => { setNuevo(false); setEdit(null); }} />
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-4 py-3">Destino</th><th className="px-4 py-3">Hotel / Producto</th><th className="px-4 py-3">Material</th>
            <th className="px-4 py-3">Estado</th><th className="px-4 py-3">Rotación</th><th className="px-4 py-3">Últ. envío</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {vis.map((m) => (
              <tr key={m.id} className="border-b border-gray-50">
                <td className="px-4 py-2 text-gray-600">{m.destino ?? "—"}</td>
                <td className="px-4 py-2 font-medium text-gray-800">{m.hotel_producto}{m.hotel_id ? <span className="ml-1 text-[10px] text-gray-400">(tarifario)</span> : null}</td>
                <td className="px-4 py-2 text-gray-500">{label(TIPOS_MATERIAL, m.tipo_material)}</td>
                <td className="px-4 py-2 text-gray-500">{label(ESTADOS_MATERIAL, m.estado)}</td>
                <td className="px-4 py-2"><RotBadge r={m.rotacion} /></td>
                <td className="px-4 py-2 text-gray-500">{fmt(m.rotacion.ultimaFecha)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => { setEdit(m); setNuevo(false); }} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialForm({ hoteles, destinoOpts, inicial, onClose }: { hoteles: HotelOpt[]; destinoOpts: string[]; inicial: MaterialConRot | null; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<MaterialInput>({
    destino: inicial?.destino ?? "", hotelProducto: inicial?.hotel_producto ?? "", hotelId: inicial?.hotel_id ?? null,
    tipoMaterial: inicial?.tipo_material ?? "flyer", fuente: inicial?.fuente ?? "", estado: inicial?.estado ?? "disponible",
    prioridad: inicial?.prioridad ?? "media", linkArchivo: inicial?.link_archivo ?? "", fechaMaterial: inicial?.fecha_material ?? "", observaciones: inicial?.observaciones ?? "",
  });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof MaterialInput>(k: K, v: MaterialInput[K]) => setF((p) => ({ ...p, [k]: v }));

  function elegirHotel(id: string) {
    if (!id) { set("hotelId", null); return; }
    const h = hoteles.find((x) => x.id === Number(id));
    if (h) setF((p) => ({ ...p, hotelId: h.id, hotelProducto: h.nombre, destino: h.destino ?? p.destino }));
  }
  function guardar() {
    setErr("");
    start(async () => {
      const r = inicial ? await actualizarMaterial(inicial.id, f) : await crearMaterial(f);
      if (r.ok) { onClose(); router.refresh(); } else setErr(r.error);
    });
  }
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">{inicial ? "Editar material" : "Nuevo material"}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Desde el tarifario <span className="font-normal text-gray-400">(opcional)</span></label>
          <select value={f.hotelId ?? ""} onChange={(e) => elegirHotel(e.target.value)} className={sel}>
            <option value="">— Manual —</option>
            {hoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}{h.destino ? ` · ${h.destino}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Destino</label>
          <input list="dif-destinos" value={f.destino} onChange={(e) => set("destino", e.target.value)} className={sel} placeholder="Cartagena…" />
          <datalist id="dif-destinos">{destinoOpts.map((d) => <option key={d} value={d} />)}</datalist>
        </div>
        <div><label className={lbl}>Hotel / Producto *</label><Input value={f.hotelProducto} onChange={(e) => set("hotelProducto", e.target.value)} placeholder="Nombre del hotel o producto" /></div>
        <div><label className={lbl}>Tipo de material</label><select value={f.tipoMaterial} onChange={(e) => set("tipoMaterial", e.target.value)} className={sel}>{TIPOS_MATERIAL.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Fuente</label><Input value={f.fuente} onChange={(e) => set("fuente", e.target.value)} placeholder="Material del hotel / propio…" /></div>
        <div><label className={lbl}>Estado</label><select value={f.estado} onChange={(e) => set("estado", e.target.value)} className={sel}>{ESTADOS_MATERIAL.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Prioridad</label><select value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)} className={sel}>{PRIORIDADES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Fecha del material</label><Input type="date" value={f.fechaMaterial} onChange={(e) => set("fechaMaterial", e.target.value)} /></div>
        <div><label className={lbl}>Link del archivo</label><Input value={f.linkArchivo} onChange={(e) => set("linkArchivo", e.target.value)} placeholder="https://…" /></div>
        <div className="sm:col-span-3"><label className={lbl}>Observaciones</label><Input value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancelar</button>
        {inicial && <button onClick={() => { if (confirm("¿Eliminar material?")) start(async () => { await eliminarMaterial(inicial.id); onClose(); router.refresh(); }); }} className="ml-auto text-xs text-red-500 hover:underline">Eliminar</button>}
      </div>
    </div>
  );
}

// ── TAB 3 · Histórico ────────────────────────────────────────────────────────
function TabHistorico({ envios, materiales, destinoOpts, prefill, onDone }: { envios: EnvioRow[]; materiales: MaterialConRot[]; destinoOpts: string[]; prefill: MaterialConRot | null; onDone: () => void }) {
  const [abrir, setAbrir] = useState(!!prefill);
  return (
    <div>
      <div className="mb-3 flex justify-between">
        <p className="text-sm text-gray-600">{envios.length} envío(s) registrados.</p>
        <Button onClick={() => setAbrir(true)} style={{ backgroundColor: "var(--brand-primary)" }}>+ Registrar envío</Button>
      </div>
      {(abrir || prefill) && <EnvioForm materiales={materiales} destinoOpts={destinoOpts} prefill={prefill} onClose={() => { setAbrir(false); onDone(); }} />}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Material</th>
            <th className="px-4 py-3">Lista</th><th className="px-4 py-3">Canal</th><th className="px-4 py-3">Resultado</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.id} className="border-b border-gray-50">
                <td className="px-4 py-2 text-gray-600">{fmt(e.fecha_envio)} <span className="text-xs text-gray-400">{diaSemana(e.fecha_envio)}</span></td>
                <td className="px-4 py-2 text-gray-500">{e.destino ?? "—"}</td>
                <td className="px-4 py-2 font-medium text-gray-700">{e.hotel_producto}</td>
                <td className="px-4 py-2 text-gray-500">{label(TIPOS_MATERIAL, e.tipo_material)}</td>
                <td className="px-4 py-2 text-gray-500">{label(LISTAS, e.lista_enviada)}</td>
                <td className="px-4 py-2 text-gray-500">{label(CANALES, e.canal)}</td>
                <td className="px-4 py-2 text-gray-500">{label(RESULTADOS, e.resultado)}</td>
                <td className="px-4 py-2 text-right"><EliminarBtn onDel={() => eliminarEnvio(e.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnvioForm({ materiales, destinoOpts, prefill, onClose }: { materiales: MaterialConRot[]; destinoOpts: string[]; prefill: MaterialConRot | null; onClose: () => void }) {
  const router = useRouter();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const [f, setF] = useState<EnvioInput>({
    materialId: prefill?.id ?? null, destino: prefill?.destino ?? "", hotelProducto: prefill?.hotel_producto ?? "",
    tipoMaterial: prefill?.tipo_material ?? "flyer", fechaEnvio: hoy, listaEnviada: "agencias", canal: "difusion_wpp",
    objetivo: "impulsar_destino", enfoque: "", resultado: "sin_medir", responsable: "", observaciones: "",
  });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof EnvioInput>(k: K, v: EnvioInput[K]) => setF((p) => ({ ...p, [k]: v }));
  function elegirMaterial(id: string) {
    if (!id) { set("materialId", null); return; }
    const m = materiales.find((x) => x.id === Number(id));
    if (m) setF((p) => ({ ...p, materialId: m.id, hotelProducto: m.hotel_producto, destino: m.destino ?? p.destino, tipoMaterial: m.tipo_material ?? p.tipoMaterial }));
  }
  function guardar() {
    setErr("");
    start(async () => { const r = await registrarEnvio(f); if (r.ok) { onClose(); router.refresh(); } else setErr(r.error); });
  }
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">Registrar envío</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className={lbl}>Material del inventario <span className="font-normal text-gray-400">(opcional)</span></label>
          <select value={f.materialId ?? ""} onChange={(e) => elegirMaterial(e.target.value)} className={sel}>
            <option value="">— Suelto —</option>
            {materiales.map((m) => <option key={m.id} value={m.id}>{m.hotel_producto}{m.destino ? ` · ${m.destino}` : ""}</option>)}
          </select></div>
        <div><label className={lbl}>Destino</label><input list="dif-destinos-env" value={f.destino} onChange={(e) => set("destino", e.target.value)} className={sel} /><datalist id="dif-destinos-env">{destinoOpts.map((d) => <option key={d} value={d} />)}</datalist></div>
        <div><label className={lbl}>Hotel / Producto *</label><Input value={f.hotelProducto} onChange={(e) => set("hotelProducto", e.target.value)} /></div>
        <div><label className={lbl}>Fecha de envío *</label><Input type="date" value={f.fechaEnvio} onChange={(e) => set("fechaEnvio", e.target.value)} /></div>
        <div><label className={lbl}>Tipo de material</label><select value={f.tipoMaterial} onChange={(e) => set("tipoMaterial", e.target.value)} className={sel}>{TIPOS_MATERIAL.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Lista enviada</label><select value={f.listaEnviada} onChange={(e) => set("listaEnviada", e.target.value)} className={sel}>{LISTAS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Canal</label><select value={f.canal} onChange={(e) => set("canal", e.target.value)} className={sel}>{CANALES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Objetivo comercial</label><select value={f.objetivo} onChange={(e) => set("objetivo", e.target.value)} className={sel}>{OBJETIVOS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Resultado</label><select value={f.resultado} onChange={(e) => set("resultado", e.target.value)} className={sel}>{RESULTADOS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Responsable</label><Input value={f.responsable} onChange={(e) => set("responsable", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Enfoque del mensaje</label><Input value={f.enfoque} onChange={(e) => set("enfoque", e.target.value)} placeholder="Últimos cupos, comparativo de precio…" /></div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Registrar"}</Button>
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancelar</button>
      </div>
    </div>
  );
}

// ── TAB 4 · Calendario ───────────────────────────────────────────────────────
const PLAN_COLOR: Record<string, string> = {
  pendiente: "bg-amber-50 border-amber-200", programado: "bg-[#26BBD9]/10 border-[#26BBD9]/30",
  enviado: "bg-[#66B596]/10 border-[#66B596]/30", reprogramar: "bg-orange-50 border-orange-200", cancelado: "bg-red-50 border-red-200",
};
function TabCalendario({ plan, materiales, destinoOpts, hoy }: { plan: PlanRow[]; materiales: MaterialConRot[]; destinoOpts: string[]; hoy: string }) {
  const router = useRouter();
  const [abrir, setAbrir] = useState(false);
  const [, start] = useTransition();
  const futuros = plan.filter((p) => p.estado !== "cancelado");
  const grupos = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    for (const p of futuros) { const k = isoSemana(p.fecha_programada); (m.get(k) ?? m.set(k, []).get(k)!).push(p); }
    return [...m.entries()];
  }, [futuros]);
  return (
    <div>
      <div className="mb-3 flex justify-between">
        <p className="text-sm text-gray-600">Próximos envíos programados.</p>
        <Button onClick={() => setAbrir(true)} style={{ backgroundColor: "var(--brand-primary)" }}>+ Programar</Button>
      </div>
      {abrir && <PlanForm materiales={materiales} destinoOpts={destinoOpts} hoy={hoy} onClose={() => setAbrir(false)} />}
      {!grupos.length ? (
        <p className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-gray-400">Nada programado. Usa “+ Programar”.</p>
      ) : grupos.map(([semana, items]) => (
        <div key={semana} className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-gray-500">{semana}</h3>
          <div className="space-y-2">
            {items.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${PLAN_COLOR[p.estado] ?? "border-gray-200"}`}>
                <span className="font-medium text-gray-700">{fmt(p.fecha_programada)} <span className="text-xs font-normal capitalize text-gray-400">{diaSemana(p.fecha_programada)}</span></span>
                <span className="text-gray-700">{p.hotel_producto ?? "—"}</span>
                <span className="text-xs text-gray-500">{p.destino ?? ""} · {label(TIPOS_MATERIAL, p.tipo_material)} · {label(CANALES, p.canal)}</span>
                <span className="ml-auto text-xs font-medium capitalize text-gray-500">{label(ESTADOS_PLAN, p.estado)}</span>
                <div className="flex items-center gap-2 text-xs">
                  {p.estado !== "enviado" && <button onClick={() => start(async () => { await marcarPlanEnviado(p.id); router.refresh(); })} className="text-[#2f6b54] hover:underline">Enviado</button>}
                  <select value={p.estado} onChange={(e) => start(async () => { await cambiarEstadoPlan(p.id, e.target.value); router.refresh(); })} className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs">
                    {ESTADOS_PLAN.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                  <button onClick={() => { if (confirm("¿Eliminar programación?")) start(async () => { await eliminarPlan(p.id); router.refresh(); }); }} className="text-red-500 hover:underline">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanForm({ materiales, destinoOpts, hoy, onClose }: { materiales: MaterialConRot[]; destinoOpts: string[]; hoy: string; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<PlanInput>({ materialId: null, fechaProgramada: hoy, destino: "", hotelProducto: "", tipoMaterial: "flyer", canal: "difusion_wpp", listaObjetivo: "agencias", enfoque: "", estado: "programado", observaciones: "" });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setF((p) => ({ ...p, [k]: v }));
  function elegirMaterial(id: string) {
    if (!id) { set("materialId", null); return; }
    const m = materiales.find((x) => x.id === Number(id));
    if (m) setF((p) => ({ ...p, materialId: m.id, hotelProducto: m.hotel_producto, destino: m.destino ?? p.destino, tipoMaterial: m.tipo_material ?? p.tipoMaterial }));
  }
  function guardar() { setErr(""); start(async () => { const r = await crearPlan(f); if (r.ok) { onClose(); router.refresh(); } else setErr(r.error); }); }
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">Programar envío</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className={lbl}>Fecha *</label><Input type="date" value={f.fechaProgramada} onChange={(e) => set("fechaProgramada", e.target.value)} /></div>
        <div><label className={lbl}>Material del inventario</label><select value={f.materialId ?? ""} onChange={(e) => elegirMaterial(e.target.value)} className={sel}><option value="">— Suelto —</option>{materiales.map((m) => <option key={m.id} value={m.id}>{m.hotel_producto}</option>)}</select></div>
        <div><label className={lbl}>Hotel / Producto</label><Input value={f.hotelProducto} onChange={(e) => set("hotelProducto", e.target.value)} /></div>
        <div><label className={lbl}>Destino</label><input list="dif-destinos-plan" value={f.destino} onChange={(e) => set("destino", e.target.value)} className={sel} /><datalist id="dif-destinos-plan">{destinoOpts.map((d) => <option key={d} value={d} />)}</datalist></div>
        <div><label className={lbl}>Tipo</label><select value={f.tipoMaterial} onChange={(e) => set("tipoMaterial", e.target.value)} className={sel}>{TIPOS_MATERIAL.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Canal</label><select value={f.canal} onChange={(e) => set("canal", e.target.value)} className={sel}>{CANALES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Lista objetivo</label><select value={f.listaObjetivo} onChange={(e) => set("listaObjetivo", e.target.value)} className={sel}>{LISTAS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div><label className={lbl}>Estado</label><select value={f.estado} onChange={(e) => set("estado", e.target.value)} className={sel}>{ESTADOS_PLAN.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div className="sm:col-span-3"><label className={lbl}>Enfoque comercial</label><Input value={f.enfoque} onChange={(e) => set("enfoque", e.target.value)} /></div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Programar"}</Button>
        <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancelar</button>
      </div>
    </div>
  );
}

// ── TAB 5 · Panel ────────────────────────────────────────────────────────────
function TabPanel({ materiales, envios, plan, hoy }: { materiales: MaterialConRot[]; envios: EnvioRow[]; plan: PlanRow[]; hoy: string }) {
  const mesActual = hoy.slice(0, 7);
  const enviosMes = envios.filter((e) => e.fecha_envio.slice(0, 7) === mesActual);
  const cuenta = (arr: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const x of arr) { const k = x ?? "—"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const porRot = (est: RotacionEstado) => materiales.filter((m) => m.rotacion.estado === est).length;
  const en7 = plan.filter((p) => p.estado !== "cancelado" && p.estado !== "enviado" && p.fecha_programada >= hoy && p.fecha_programada <= sumar(hoy, 7)).length;

  const kpis = [
    { n: materiales.length, l: "Materiales registrados" },
    { n: porRot("prioridad") + porRot("puede"), l: "Listos para enviar", hot: true },
    { n: porRot("no_repetir"), l: "No repetir todavía" },
    { n: porRot("en_pausa"), l: "En pausa" },
    { n: enviosMes.length, l: "Envíos este mes" },
    { n: en7, l: "Programados próx. 7 días" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4" style={k.hot ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.06)" } : {}}>
            <div className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{k.n}</div>
            <div className="mt-1 text-xs text-gray-500">{k.l}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Resumen titulo="Envíos por destino" filas={cuenta(envios.map((e) => e.destino))} />
        <Resumen titulo="Envíos por tipo de material" filas={cuenta(envios.map((e) => e.tipo_material)).map(([k, n]) => [labelOf(TIPOS_MATERIAL, k), n])} />
        <Resumen titulo="Materiales por estado de rotación" filas={(["prioridad", "puede", "no_repetir", "en_pausa"] as RotacionEstado[]).map((e) => [ROTACION_LABEL[e], porRot(e)])} />
        <Resumen titulo="Resultado de los envíos" filas={cuenta(envios.map((e) => e.resultado)).map(([k, n]) => [labelOf(RESULTADOS, k), n])} />
      </div>
    </div>
  );
}
function Resumen({ titulo, filas }: { titulo: string; filas: [string, number][] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>{titulo}</div>
      <table className="w-full text-sm">
        <tbody>
          {filas.length ? filas.map(([k, n]) => <tr key={k} className="border-b border-gray-50"><td className="px-4 py-1.5 text-gray-600">{k}</td><td className="px-4 py-1.5 text-right font-medium text-gray-800">{n}</td></tr>)
            : <tr><td className="px-4 py-3 text-gray-400">Sin datos</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── util ─────────────────────────────────────────────────────────────────────
function EliminarBtn({ onDel }: { onDel: () => Promise<unknown> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button disabled={pending} onClick={() => { if (confirm("¿Eliminar?")) start(async () => { await onDel(); router.refresh(); }); }} className="text-xs text-red-500 hover:underline">Eliminar</button>;
}
function labelOf(ops: { v: string; label: string }[], v: string) { return ops.find((o) => o.v === v)?.label ?? v; }
function sumar(f: string, n: number) { const d = new Date(`${f}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
