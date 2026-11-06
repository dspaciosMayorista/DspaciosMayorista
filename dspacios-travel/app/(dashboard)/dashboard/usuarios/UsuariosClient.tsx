"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLES_INTERNOS, type Rol } from "@/lib/constants";
import { AliadoB2BForm } from "./AliadoB2BForm";
import { crearUsuario } from "./actions";
import { EditarUsuarioDialog, type FichaInfo, type UsuarioFila } from "./EditarUsuarioDialog";
import { grupoDeRol, type GrupoUsuario } from "@/lib/usuarios/edicion";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

export function UsuariosClient({ usuarios, fichas = {}, rolActor = "administracion" }: { usuarios: UsuarioFila[]; fichas?: Record<number, FichaInfo>; rolActor?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<Rol>("venta");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function crear() {
    setMsg("");
    start(async () => {
      const r = await crearUsuario({ email, password, nombre, rol });
      if (r.ok) { setEmail(""); setPassword(""); setNombre(""); setRol("venta"); setMsg("✓ Usuario creado"); }
      else setMsg(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Crear usuario interno</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Contraseña (mín. 6)" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {ROLES_INTERNOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Creando…" : "Crear usuario interno"}
          </Button>
          {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
        </div>
      </div>

      <AliadoB2BForm />

      <ListaUsuarios usuarios={usuarios} fichas={fichas} rolActor={rolActor} />
    </div>
  );
}

const PESTANAS: { id: GrupoUsuario; label: string }[] = [
  { id: "b2b", label: "B2B" }, { id: "internos", label: "Internos" }, { id: "otros", label: "Otros" },
];

function ListaUsuarios({ usuarios, fichas, rolActor }: { usuarios: UsuarioFila[]; fichas: Record<number, FichaInfo>; rolActor: string }) {
  const [tab, setTab] = useState<GrupoUsuario>("b2b");
  const [editando, setEditando] = useState<UsuarioFila | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [apertura, setApertura] = useState(0); // nueva instancia en cada apertura = borrador limpio
  const grupos = { b2b: [] as UsuarioFila[], internos: [] as UsuarioFila[], otros: [] as UsuarioFila[] };
  for (const u of usuarios) grupos[grupoDeRol(u.rol)].push(u);
  const visibles = PESTANAS.filter((p) => p.id !== "otros" || grupos.otros.length > 0);
  const lista = grupos[tab];
  const mostrarB2B = tab === "b2b";
  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1 border-b border-gray-200">
        {visibles.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === p.id ? "border-[var(--brand-primary)] font-semibold text-gray-900" : "border-transparent text-gray-500"}`}>
            {p.label} ({grupos[p.id].length})
          </button>
        ))}
      </div>
      {lista.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No hay usuarios en esta pestaña.</p>
      ) : (
        <ResponsiveTableShell minWidth={mostrarB2B ? 760 : 620} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className={`w-full text-sm ${mostrarB2B ? "min-w-[760px]" : "min-w-[620px]"}`}>
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Rol</th>
              {mostrarB2B && <><th className="px-4 py-2">Ficha</th><th className="px-4 py-2">Comisión</th></>}
              <th className="px-4 py-2">Estado</th><th className="px-4 py-2">Acciones</th>
            </tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className="border-t border-gray-50">
                  <td className="max-w-[14rem] break-words px-4 py-2 text-gray-700" data-label="Nombre">{u.nombre}</td>
                  <td className="max-w-[16rem] break-all px-4 py-2 text-gray-500" data-label="Email">{u.email}</td>
                  <td className="px-4 py-2 text-gray-700" data-label="Rol">{u.rol}</td>
                  {mostrarB2B && <>
                    <td className="max-w-[14rem] break-words px-4 py-2 text-gray-500" data-label="Ficha">
                      {u.aliado_id !== null ? (fichas[u.aliado_id]?.nombre ?? `#${u.aliado_id}`) : <span className="text-gray-300">Sin ficha</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-500" data-label="Comisión">{u.pct_comision != null ? `${Math.round(u.pct_comision * 1000) / 10} %` : "—"}</td>
                  </>}
                  <td className="px-4 py-2" data-label="Estado">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${u.activo ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>{u.activo ? "Activo" : "Inactivo"}</span>
                  </td>
                  <td className="px-4 py-2" data-label="Acciones">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setEditando(u); setApertura((n) => n + 1); setAbierto(true); }} aria-label={`Editar ${u.nombre}`}>Editar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      )}
      {editando && <EditarUsuarioDialog key={`${editando.id}-${apertura}`} u={editando} open={abierto} fichas={fichas} rolActor={rolActor} onClose={() => setAbierto(false)} />}
    </div>
  );
}
