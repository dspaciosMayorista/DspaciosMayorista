"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ⚠️ TEMPORAL (solo pruebas): permite entrar con un código corto en vez de
// escribir correo y contraseña. El código por defecto es "1" (configurable con
// QUICK_LOGIN_CODE) e inicia sesión con la cuenta definida en:
//   QUICK_LOGIN_EMAIL  /  QUICK_LOGIN_PASSWORD   (variables de entorno en Vercel)
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

  if (code === codigoAdmin) {
    email = process.env.QUICK_LOGIN_EMAIL;
    password = process.env.QUICK_LOGIN_PASSWORD;
    destino = "/dashboard";
  } else if (code === codigoB2B) {
    email = process.env.QUICK_LOGIN_B2B_EMAIL;
    password = process.env.QUICK_LOGIN_B2B_PASSWORD;
    destino = "/portal/b2b";
  } else {
    return { ok: false, error: "Código inválido." };
  }

  if (!email || !password) {
    return { ok: false, error: "Falta configurar las credenciales de la cuenta de pruebas en el entorno." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: "No se pudo entrar con la cuenta de pruebas (revisa las credenciales del entorno)." };
  }
  redirect(destino);
}
