"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardarPerfilServidor, type RespuestaPerfil } from "@/lib/portal/perfilEdicionServidor";

/**
 * #25 — Guarda una sección de «Mi perfil». La identidad sale de la sesión; del formulario solo se leen las llaves permitidas
 * de cada sección (cualquier otro campo, como rol, aliado_id, NIT o activo, se descarta aquí y de nuevo en el servidor).
 */
type Originales = Partial<Record<"nombre" | "contacto" | "telefono" | "email" | "direccion", string | null>>;

export async function guardarPerfil(entrada: {
  seccion: "usuario" | "ficha"; nombre?: string; contacto?: string; telefono?: string; email?: string; direccion?: string; confirmaNombreFicha?: boolean;
  /** Valores ORIGINALES con los que se abrió el formulario: solo para detectar una edición desfasada. */
  esperado?: Originales;
}): Promise<RespuestaPerfil> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const e = entrada?.esperado;
  const limpia = entrada?.seccion === "usuario"
    ? { seccion: "usuario" as const, nombre: entrada.nombre, esperado: e && typeof e === "object" ? { nombre: e.nombre } : undefined }
    : {
        seccion: "ficha" as const, nombre: entrada?.nombre, contacto: entrada?.contacto, telefono: entrada?.telefono, email: entrada?.email, direccion: entrada?.direccion,
        confirmaNombreFicha: entrada?.confirmaNombreFicha === true,
        esperado: e && typeof e === "object" ? { nombre: e.nombre, contacto: e.contacto, telefono: e.telefono, email: e.email, direccion: e.direccion } : undefined,
      };
  const r = await guardarPerfilServidor(createAdminClient(), user ? { id: user.id, email: user.email ?? null } : null, limpia);
  if (r.ok && r.cambios.length) revalidatePath("/portal/b2b/perfil");
  return r;
}
