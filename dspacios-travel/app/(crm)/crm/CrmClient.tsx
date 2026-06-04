"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { crearContacto, eliminarContacto, cargarContactosMasivo } from "./actions";

export type Contacto = {
  id: number; categoria: string; nombre: string; email: string | null; telefono: string | null;
  ciudad: string | null; pais: string | null; fecha_nacimiento: string | null; genero: string | null;
  origen: string | null; acepta_publicidad: boolean; no_contactar: boolean;
};

const CATS: { value: string; label: string }[] = [
  { value: "cliente_final", label: "Clientes finales" },
  { value: "agencia", label: "Agencias" },
  { value: "freelance", label: "Freelance" },
  { value: "empresa", label: "Empresas" },
  { value: "pasajero", label: "Pasajeros" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map((c) => [c.value, c.label]));

const COLS = [
  { key: "categoria", label: "Categoría (cliente_final/agencia/freelance/empresa/pasajero)", ejemplo: "cliente_final" },
  { key: "nombre", label: "Nombre", ejemplo: "Juan Pérez" },
  { key: "tipo_doc", label: "Tipo doc", ejemplo: "CC" },
  { key: "documento", label: "Documento", ejemplo: "1020304050" },
  { key: "email", label: "Email", ejemplo: "juan@correo.com" },
  { key: "telefono", label: "Teléfono", ejemplo: "3001234567" },
  { key: "ciudad", label: "Ciudad", ejemplo: "Medellín" },
  { key: "pais", label: "País", ejemplo: "Colombia" },
  { key: "fecha_nacimiento", label: "Fecha nacimiento (AAAA-MM-DD)", ejemplo: "1990-05-20" },
  { key: "genero", label: "Género (F/M/otro)", ejemplo: "F" },
  { key: "origen", label: "Origen (agencia/canal)", ejemplo: "Agencia XYZ" },
  { key: "acepta_publicidad", label: "Acepta publicidad (si/no)", ejemplo: "si" },
  { key: "no_contactar", label: "No contactar (si/no)", ejemplo: "no" },
  { key: "notas", label: "Notas", ejemplo: "" },
];

const card = "rounded-xl border border-gray-200 bg-white/90 p-4 backdrop-blur";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function CrmClient({ contactos }: { contactos: Contacto[] }) {
  const [cat, setCat] = useState<string>("todos");
  const [q, setQ] = useState("");
  const [abrirNuevo, setAbrirNuevo] = useState(false);

  const conteo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contactos) m[c.categoria] = (m[c.categoria] ?? 0) + 1;
    return m;
  }, [contactos]);

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase();
    return contactos.filter((c) => {
      if (cat !== "todos" && c.categoria !== cat) return false;
      if (!term) return true;
      return [c.nombre, c.email, c.telefono, c.ciudad, c.origen].some((x) => (x ?? "").toLowerCase().includes(term));
    });
  }, [contactos, cat, q]);

  return (
    <div className="space-y-5">
      {/* KPIs por categoría */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total" valor={contactos.length} activo={cat === "todos"} onClick={() => setCat("todos")} />
        {CATS.map((c) => (
          <Kpi key={c.value} label={c.label} valor={conteo[c.value] ?? 0} activo={cat === c.value} onClick={() => setCat(c.value)} />
        ))}
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Buscar nombre, email, teléfono…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs bg-white/90" />
        <Button onClick={() => setAbrirNuevo((o) => !o)} style={{ backgroundColor: "var(--brand-primary)" }}>
          {abrirNuevo ? "Cerrar" : "+ Nuevo contacto"}
        </Button>
        <Link href="/crm/email" className="rounded-lg border border-gray-300 bg-white/90 px-3 py-2 text-sm text-gray-700 hover:bg-white">
          ⚙️ Config email
        </Link>
        <div className="ml-auto w-full sm:w-auto sm:min-w-[420px]">
          <CargaMasivaCSV
            titulo="Carga masiva de contactos (CSV)"
            nota="Cada fila = un contacto. La columna 'categoria' los separa. Marca 'acepta_publicidad' solo si el titular autorizó el tratamiento de datos (Habeas Data)."
            descripcion="Categorías: cliente_final, agencia, freelance, empresa, pasajero. Dedup por documento o email dentro del archivo."
            columnas={COLS}
            onSubmit={cargarContactosMasivo}
            nombreArchivo="plantilla_crm_contactos"
          />
        </div>
      </div>

      {abrirNuevo && <NuevoContacto onDone={() => setAbrirNuevo(false)} />}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white/90 backdrop-blur">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="bg-gray-50/80 text-left text-xs uppercase text-gray-400">
            <th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Nombre</th>
            <th className="px-3 py-2">Email</th><th className="px-3 py-2">Teléfono</th>
            <th className="px-3 py-2">Ciudad</th><th className="px-3 py-2">Origen</th>
            <th className="px-3 py-2 text-center">Publicidad</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {filtrados.map((c) => <Fila key={c.id} c={c} />)}
            {!filtrados.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Sin contactos en esta vista.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">{filtrados.length} contacto(s) · mostrando hasta 2.000.</p>
    </div>
  );
}

function Kpi({ label, valor, activo, onClick }: { label: string; valor: number; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border p-3 text-left transition ${activo ? "border-[var(--brand-primary)] bg-white" : "border-gray-200 bg-white/80 hover:bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{valor}</div>
    </button>
  );
}

function Fila({ c }: { c: Contacto }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-3 py-2"><span className="rounded-full bg-[var(--brand-accent)]/15 px-2 py-0.5 text-xs text-gray-600">{CAT_LABEL[c.categoria] ?? c.categoria}</span></td>
      <td className="px-3 py-2 text-gray-700">
        <Link href={`/crm/${c.id}`} className="font-medium text-gray-800 hover:text-[var(--brand-primary)] hover:underline">{c.nombre}</Link>
        {c.no_contactar && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-600">no contactar</span>}
      </td>
      <td className="px-3 py-2 text-gray-500">{c.email ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{c.telefono ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{c.ciudad ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{c.origen ?? "—"}</td>
      <td className="px-3 py-2 text-center">{c.acepta_publicidad ? "✓" : "—"}</td>
      <td className="px-3 py-2 text-right">
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${c.nombre}?`)) start(() => { void eliminarContacto(c.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}

function NuevoContacto({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState({
    categoria: "cliente_final", nombre: "", tipoDoc: "CC", documento: "", email: "", telefono: "",
    ciudad: "", pais: "Colombia", fechaNacimiento: "", genero: "", origen: "", notas: "",
    aceptaPublicidad: false, noContactar: false,
  });
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  function guardar() {
    if (!v.nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearContacto(v);
      if (r.ok) onDone(); else setErr(r.error);
    });
  }

  return (
    <div className={card}>
      <p className="mb-3 text-sm font-semibold text-gray-700">Nuevo contacto</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={lbl}>Categoría</label>
          <select value={v.categoria} onChange={(e) => setV((s) => ({ ...s, categoria: e.target.value }))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Nombre *</label><Input value={v.nombre} onChange={set("nombre")} /></div>
        <div><label className={lbl}>Documento</label><Input value={v.documento} onChange={set("documento")} /></div>
        <div><label className={lbl}>Email</label><Input value={v.email} onChange={set("email")} /></div>
        <div><label className={lbl}>Teléfono</label><Input value={v.telefono} onChange={set("telefono")} /></div>
        <div><label className={lbl}>Ciudad</label><Input value={v.ciudad} onChange={set("ciudad")} /></div>
        <div><label className={lbl}>Fecha nacimiento</label><Input type="date" value={v.fechaNacimiento} onChange={set("fechaNacimiento")} /></div>
        <div>
          <label className={lbl}>Género</label>
          <select value={v.genero} onChange={(e) => setV((s) => ({ ...s, genero: e.target.value }))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">—</option><option value="F">F</option><option value="M">M</option><option value="otro">Otro</option>
          </select>
        </div>
        <div><label className={lbl}>Origen</label><Input value={v.origen} onChange={set("origen")} placeholder="Agencia / canal" /></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={v.aceptaPublicidad} onChange={(e) => setV((s) => ({ ...s, aceptaPublicidad: e.target.checked }))} />
          Acepta publicidad (autorizó datos)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={v.noContactar} onChange={(e) => setV((s) => ({ ...s, noContactar: e.target.checked }))} />
          No contactar
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar contacto"}</Button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
