"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ⚠️ TEMPORAL (solo pruebas): permite entrar con un código corto en vez de
// escribir correo y contraseña.
//   Código "1" (QUICK_LOGIN_CODE) → admin:  QUICK_LOGIN_EMAIL / QUICK_LOGIN_PASSWORD → /dashboard
//   Código "2" (QUICK_LOGIN_B2B_CODE) → B2B: QUICK_LOGIN_B2B_EMAIL / QUICK_LOGIN_B2B_PASSWORD → /portal/b2b
// El código "2" AUTO-CREA y activa el aliado de prueba si no existe.
// Quitar este atajo antes de producción.
export async function loginConCodigo(
  codigo: string
): Promise<{ ok: false; error: string }> {
  const code = (codigo ?? "").trim();
  const codigoAdmin = process.env.QUICK_LOGIN_CODE || "1";
  const codigoB2B = process.env.QUICK_LOGIN_B2B_CODE || "2";

  let email: string | undefined;
  let password: string | undefined;
  let destino = "/dashboard";
  let esB2B = false;

  if (code === codigoAdmin) {
    email = process.env.QUICK_LOGIN_EMAIL;
    password = process.env.QUICK_LOGIN_PASSWORD;
    destino = "/dashboard";
  } else if (code === codigoB2B) {
    // Defaults para que el código "2" funcione sin configurar nada (pruebas).
    email = process.env.QUICK_LOGIN_B2B_EMAIL || "b2b.prueba@dspaciostravel.com";
    password = process.env.QUICK_LOGIN_B2B_PASSWORD || "B2bPrueba2026!";
    destino = "/portal/b2b";
    esB2B = true;
  } else {
    return { ok: false, error: "Código inválido." };
  }

  if (!email || !password) {
    return { ok: false, error: "Falta configurar las credenciales de la cuenta de pruebas en el entorno." };
  }

  // Auto-provisión del aliado de prueba: si no existe, se crea y se activa.
  if (esB2B && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: existente } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (!existente) {
      await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nombre: "B2B Prueba", rol: "agencia" },
      });
    }
    // Asegurar rol aliado + activo (aprobado).
    const { data: u } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (u) await admin.from("usuarios").update({ rol: "agencia", activo: true }).eq("id", u.id);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: "No se pudo entrar con la cuenta de pruebas (revisa las credenciales del entorno)." };
  }
  redirect(destino);
}
