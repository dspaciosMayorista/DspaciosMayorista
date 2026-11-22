"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import s from "@/components/portal/vidrio.module.css";
import { TIPOS_DOCUMENTO_CLIENTE } from "@/lib/portal/clientesAliado";
import { guardarCliente } from "./actions";

export type ClienteFila = {
  clave: string;
  nombre: string;
  guardado: { id: number; tipo_documento: string | null; documento: string | null; email: string | null; telefono: string | null; notas: string | null; actualizado_en: string } | null;
  contratos: { numero_contrato: string; destino: string | null; fecha_salida: string | null; estado: string | null }[];
  cotizaciones: { id: number; codigo: string | null; destino: string | null; fecha_salida: string | null; estado: string | null }[];
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const vacio = { nombre: "", tipoDocumento: "", documento: "", email: "", telefono: "", notas: "", autorizacion: false };

function Formulario({ inicial, id, esperado, onListo, etiqueta }: {
  inicial: typeof vacio; id?: number; esperado?: string; onListo: () => void; etiqueta: string;
}) {
  const router = useRouter();
  const [f, setF] = useState(inicial);
  const [msg, setMsg] = useState("");
  const [pendiente, start] = useTransition();
  const set = (k: keyof typeof vacio, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    start(async () => {
      const r = await guardarCliente({ ...f, id, esperado });
      if (r.ok) { setF(vacio); onListo(); router.refresh(); } else setMsg(r.error);
    });
  }
  return (
    <form onSubmit={enviar} className="space-y-3" aria-label={etiqueta}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className={lbl} htmlFor={`nom-${id ?? "n"}`}>Nombre del cliente</label>
          <Input id={`nom-${id ?? "n"}`} value={f.nombre} maxLength={120} onChange={(e) => set("nombre", e.target.value)} required /></div>
        <div><label className={lbl} htmlFor={`td-${id ?? "n"}`}>Tipo de documento</label>
          <select id={`td-${id ?? "n"}`} value={f.tipoDocumento} onChange={(e) => set("tipoDocumento", e.target.value)} className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm">
            <option value="">Sin documento</option>
            {TIPOS_DOCUMENTO_CLIENTE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></div>
        <div><label className={lbl} htmlFor={`doc-${id ?? "n"}`}>Documento</label>
          <Input id={`doc-${id ?? "n"}`} value={f.documento} maxLength={30} onChange={(e) => set("documento", e.target.value)} /></div>
        <div><label className={lbl} htmlFor={`em-${id ?? "n"}`}>Correo</label>
          <Input id={`em-${id ?? "n"}`} type="email" value={f.email} maxLength={120} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className={lbl} htmlFor={`tel-${id ?? "n"}`}>Teléfono</label>
          <Input id={`tel-${id ?? "n"}`} value={f.telefono} maxLength={30} onChange={(e) => set("telefono", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={lbl} htmlFor={`no-${id ?? "n"}`}>Notas (opcional)</label>
          <textarea id={`no-${id ?? "n"}`} value={f.notas} maxLength={500} rows={2} onChange={(e) => set("notas", e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" /></div>
      </div>
      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={f.autorizacion} onChange={(e) => set("autorizacion", e.target.checked)} className="mt-0.5" />
        <span>Confirmo que este cliente me autorizó a guardar sus datos de contacto.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente} style={{ backgroundColor: "var(--brand-primary)" }}>{pendiente ? "Guardando…" : etiqueta}</Button>
        {msg && <span role="alert" className="text-sm text-red-600">{msg}</span>}
      </div>
    </form>
  );
}

function FilaCliente({ c, puedeEditar }: { c: ClienteFila; puedeEditar: boolean }) {
  const [editando, setEditando] = useState(false);
  const g = c.guardado;
  return (
    <li className="py-3">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-gray-800">{c.nombre}</span>
          <span className="text-xs text-gray-500">
            {c.contratos.length} {c.contratos.length === 1 ? "contrato" : "contratos"} · {c.cotizaciones.length} {c.cotizaciones.length === 1 ? "cotización" : "cotizaciones"}
            {!g && " · sin datos de contacto"}
          </span>
        </summary>
        <div className="mt-3 space-y-3 text-sm text-gray-700">
          {g && !editando && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {g.documento && <div><dt className="inline text-gray-400">Documento: </dt><dd className="inline">{g.tipo_documento} {g.documento}</dd></div>}
              {g.email && <div><dt className="inline text-gray-400">Correo: </dt><dd className="inline break-all">{g.email}</dd></div>}
              {g.telefono && <div><dt className="inline text-gray-400">Teléfono: </dt><dd className="inline">{g.telefono}</dd></div>}
              {g.notas && <div className="sm:col-span-2"><dt className="inline text-gray-400">Notas: </dt><dd className="inline whitespace-pre-line">{g.notas}</dd></div>}
            </dl>
          )}
          {puedeEditar && !editando && (
            <button type="button" onClick={() => setEditando(true)} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--brand-primary)" }}>
              {g ? <Pencil size={14} aria-hidden /> : <Plus size={14} aria-hidden />}{g ? "Editar datos" : "Agregar datos de contacto"}
            </button>
          )}
          {puedeEditar && editando && (
            <Formulario
              etiqueta="Guardar cambios" id={g?.id} esperado={g?.actualizado_en} onListo={() => setEditando(false)}
              inicial={{ nombre: c.nombre, tipoDocumento: g?.tipo_documento ?? "", documento: g?.documento ?? "", email: g?.email ?? "", telefono: g?.telefono ?? "", notas: g?.notas ?? "", autorizacion: !!g }}
            />
          )}
          {c.contratos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">Contratos</p>
              <ul className="space-y-0.5 text-xs">
                {c.contratos.map((k) => <li key={k.numero_contrato}>{k.numero_contrato} · {k.destino ?? "—"} · salida {k.fecha_salida ?? "—"} · {k.estado ?? "—"}</li>)}
              </ul>
            </div>
          )}
          {c.cotizaciones.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">Cotizaciones</p>
              <ul className="space-y-0.5 text-xs">
                {c.cotizaciones.map((k) => <li key={k.id}>{k.codigo ?? `#${k.id}`} · {k.destino ?? "—"} · salida {k.fecha_salida ?? "—"} · {k.estado ?? "—"}</li>)}
              </ul>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export function ClientesAliado({ items, puedeEditar }: { items: ClienteFila[]; puedeEditar: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 rounded-lg bg-white/60 px-3 py-2 text-xs text-gray-600">
        <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: "var(--brand-primary)" }} />
        Guarda solo datos de clientes que te hayan autorizado. Solo tú y el personal autorizado de D&apos;spacios los ven; no se comparten con otros aliados ni se usan en campañas.
      </p>
      {puedeEditar && (
        <section className={s.panel}>
          {!abierto ? (
            <button type="button" onClick={() => setAbierto(true)} className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>
              <Plus size={16} aria-hidden /> Agregar cliente
            </button>
          ) : (
            <>
              <h2 className={s.h2}>Nuevo cliente</h2>
              <Formulario etiqueta="Guardar cliente" onListo={() => setAbierto(false)} inicial={vacio} />
            </>
          )}
        </section>
      )}
      <section className={s.panel}>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no hay clientes. Aparecerán aquí los de tus cotizaciones y contratos, y los que agregues.</p>
        ) : (
          <ul className="divide-y divide-gray-100">{items.map((c) => <FilaCliente key={c.clave} c={c} puedeEditar={puedeEditar} />)}</ul>
        )}
      </section>
    </div>
  );
}
