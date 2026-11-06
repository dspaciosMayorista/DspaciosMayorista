"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ROLES } from "@/lib/constants";
import { TENANTS, diferencias, efectosDeCambio, esRolB2B, type UsuarioEditable } from "@/lib/usuarios/edicion";
import { actualizarUsuario, buscarFichasAliado, type FichaAliado } from "./actions";

export type UsuarioFila = UsuarioEditable & { id: string; email: string; acceso_legacy_nombre?: boolean | null };
export type FichaInfo = { nombre: string; nit: string | null; tipo?: string | null };

// Guardar aplica (acción de servidor, que re-valida todo); Cancelar descarta el borrador.
// Correo: solo lectura. Contraseña: no existe aquí.
export function EditarUsuarioDialog({ u, fichas, rolActor, open, onClose }: {
  u: UsuarioFila; fichas: Record<number, FichaInfo>; rolActor: string; open: boolean; onClose: () => void;
}) {
  const original: UsuarioEditable = { nombre: u.nombre, rol: u.rol, activo: u.activo, tenant: u.tenant, aliado_id: u.aliado_id, pct_comision: u.pct_comision };
  const [d, setD] = useState<UsuarioEditable>(original);
  const [doc, setDoc] = useState("");
  const [halladas, setHalladas] = useState<FichaAliado[]>([]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const set = <K extends keyof UsuarioEditable>(k: K, v: UsuarioEditable[K]) => setD((p) => ({ ...p, [k]: v }));
  const esSuper = rolActor === "superadmin";
  const nombreFicha = (id: number | null) => {
    if (id === null) return "sin ficha";
    const f = fichas[id] ?? halladas.find((x) => x.id === id);
    return f ? `${f.nombre}${f.nit ? ` (${f.nit})` : ""}` : `#${id}`;
  };
  const legacy = u.acceso_legacy_nombre !== false; // sin dato = se asume heredado (falla cerrado)
  const efectos = efectosDeCambio(original, d, nombreFicha, legacy);
  const cambios = diferencias(original, d);
  const hayCambios = Object.keys(cambios).length > 0;
  const bloqueado = legacy && cambios.nombre !== undefined;
  const b2b = esRolB2B(d.rol);
  const esAgencia = d.rol === "agencia";
  const tipoRol = esAgencia ? "agencia" : "freelance";
  const docEtiqueta = esAgencia ? "NIT" : "documento";
  // Cambiar agencia ↔ freelance no toca la ficha: se avisa y se resuelve a mano (nada se borra ni reasigna solo).
  const tipoActual = d.aliado_id === null ? null : (fichas[d.aliado_id]?.tipo ?? halladas.find((x) => x.id === d.aliado_id)?.tipo ?? null);
  const fichaIncompatible = b2b && tipoActual !== null && tipoActual !== d.rol;
  const visibles = halladas.filter((f) => f.tipo === tipoRol);

  function buscar() {
    setMsg("");
    start(async () => {
      const r = await buscarFichasAliado(doc, tipoRol);
      if (!r.ok) return setMsg(r.error);
      setHalladas(r.fichas);
      if (r.fichas.length === 0) setMsg(`No hay fichas de ${tipoRol} con ese ${docEtiqueta}.`);
    });
  }
  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarUsuario(u.id, cambios);
      if (r.ok) onClose(); else setMsg(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] overflow-y-auto bg-white sm:max-w-lg">
        <DialogTitle>Editar usuario</DialogTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-500 sm:col-span-2">Correo (no editable)
            <Input value={u.email} disabled readOnly className="mt-1" aria-label="Correo" />
          </label>
          <label className="text-xs text-gray-500">Nombre
            <Input value={d.nombre} onChange={(e) => set("nombre", e.target.value)} className="mt-1" aria-label="Nombre" />
          </label>
          <label className="text-xs text-gray-500">Rol
            <select value={d.rol} onChange={(e) => set("rol", e.target.value)} aria-label="Rol"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {ROLES.filter((r) => esSuper || r !== "superadmin" || r === u.rol).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Empresa
            <select value={d.tenant} onChange={(e) => set("tenant", e.target.value)} disabled={!esSuper} aria-label="Empresa"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50">
              {TENANTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
            <input type="checkbox" checked={d.activo} onChange={(e) => set("activo", e.target.checked)} aria-label="Activo" /> Activo
          </label>
          {b2b && (
            <>
              <label className="text-xs text-gray-500">Comisión %
                <Input type="number" step="0.5" min={0} max={100} aria-label="Comisión"
                  value={d.pct_comision === null ? "" : Math.round(d.pct_comision * 1000) / 10}
                  onChange={(e) => set("pct_comision", e.target.value === "" ? null : Number(e.target.value) / 100)} className="mt-1" />
              </label>
              <div className="text-xs text-gray-500 sm:col-span-2">
                <p>Ficha de {tipoRol}: <span className="font-medium text-gray-700">{nombreFicha(d.aliado_id)}</span></p>
                <div className="mt-1 flex gap-2">
                  <Input placeholder={`Buscar ficha de ${tipoRol} por ${docEtiqueta}`} aria-label={`Documento de la ficha de ${tipoRol}`} value={doc} onChange={(e) => setDoc(e.target.value)} />
                  <Button type="button" variant="outline" onClick={buscar} disabled={pending || !doc.trim()}>Buscar</Button>
                  {d.aliado_id !== null && <Button type="button" variant="outline" onClick={() => set("aliado_id", null)}>Quitar</Button>}
                </div>
                {visibles.length > 0 && (
                  <select value={d.aliado_id ?? ""} aria-label="Ficha encontrada"
                    onChange={(e) => set("aliado_id", e.target.value ? Number(e.target.value) : null)}
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                    <option value="">Elegir ficha…</option>
                    {visibles.map((f) => <option key={f.id} value={f.id}>{f.nombre} — {f.nit}</option>)}
                  </select>
                )}
              </div>
            </>
          )}
        </div>
        {efectos.length > 0 && (
          <ul role="status" className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-800">
            {efectos.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {fichaIncompatible && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            La ficha actual es de {tipoActual}, no de {tipoRol}. No se borra ni se reasigna sola: quítala o elige una ficha de {tipoRol} antes de guardar.
          </p>
        )}
        {msg && <p role="alert" className="mt-3 text-sm text-red-600">{msg}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="button" onClick={guardar} disabled={pending || !hayCambios || bloqueado || fichaIncompatible} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
