"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLES, type Rol } from "@/lib/constants";
import { crearUsuario, cambiarRol, cambiarActivo } from "./actions";

type Usuario = { id: string; email: string; nombre: string; rol: string; activo: boolean };

export function UsuariosClient({ usuarios }: { usuarios: Usuario[] }) {
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
        <p className="mb-3 text-sm font-semibold text-gray-700">Crear usuario</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Contraseña (mín. 6)" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Creando…" : "Crear usuario"}
          </Button>
          {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
        </div>
      </div>

      {usuarios.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Rol</th><th className="px-4 py-2">Estado</th>
            </tr></thead>
            <tbody>{usuarios.map((u) => <UsuarioRow key={u.id} u={u} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsuarioRow({ u }: { u: Usuario }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{u.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{u.email}</td>
      <td className="px-4 py-2">
        <select defaultValue={u.rol} disabled={pending}
          onChange={(e) => start(() => { void cambiarRol(u.id, e.target.value as Rol); })}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td className="px-4 py-2">
        <button type="button" disabled={pending}
          onClick={() => start(() => { void cambiarActivo(u.id, !u.activo); })}
          className={`rounded-full px-2 py-0.5 text-xs ${u.activo ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
          {u.activo ? "Activo" : "Inactivo"}
        </button>
      </td>
    </tr>
  );
}
