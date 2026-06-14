import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MODULOS, ROLES, permisoEfectivoRol, type Permiso } from "@/lib/permisos";
import { PermisosClient } from "./PermisosClient";

export const dynamic = "force-dynamic";

export default async function PermisosPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle() : { data: null };
  if (!["superadmin", "administracion", "gerencia"].includes(perfil?.rol ?? "")) {
    redirect("/dashboard");
  }

  const [{ data: filasRol }, { data: filasUsr }, { data: usuarios }] = await Promise.all([
    sb.from("permisos_rol").select("rol, modulo, consultar, modificar, eliminar"),
    sb.from("permisos_usuario").select("usuario_id, modulo, consultar, modificar, eliminar"),
    sb.from("usuarios").select("id, nombre, email, rol").eq("activo", true).order("nombre"),
  ]);

  // Matriz efectiva por rol (defaults + filas guardadas).
  const porRol: Record<string, Record<string, Permiso>> = {};
  for (const r of ROLES) {
    const filas = (filasRol ?? []).filter((f) => f.rol === r.key);
    porRol[r.key] = permisoEfectivoRol(r.key, filas);
  }

  // Overrides por usuario (solo módulos con fila).
  const porUsuario: Record<string, Record<string, Permiso>> = {};
  for (const f of filasUsr ?? []) {
    (porUsuario[f.usuario_id] ??= {})[f.modulo] = { consultar: f.consultar, modificar: f.modificar, eliminar: f.eliminar };
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/usuarios" className="text-sm text-gray-400 hover:text-gray-700">← Usuarios</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Permisos por módulo</h1>
      <p className="mb-6 text-sm text-gray-500">
        Activa por rol qué puede <b>Consultar</b>, <b>Modificar</b> y <b>Eliminar</b> en cada módulo. También puedes dar
        <b> acceso especial</b> a un usuario puntual aunque tenga un rol. (Superadmin siempre tiene todo.)
      </p>
      <PermisosClient
        modulos={MODULOS}
        roles={ROLES}
        porRol={porRol}
        usuarios={(usuarios ?? []).map((u) => ({ id: u.id, nombre: u.nombre ?? u.email ?? u.id, rol: u.rol ?? "" }))}
        porUsuario={porUsuario}
      />
    </div>
  );
}
