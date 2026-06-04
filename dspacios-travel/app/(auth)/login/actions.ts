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
  const codigoOk = process.env.QUICK_LOGIN_CODE || "1";
  if ((codigo ?? "").trim() !== codigoOk) {
    return { ok: false, error: "Código inválido." };
  }
  const email = process.env.QUICK_LOGIN_EMAIL;
  const password = process.env.QUICK_LOGIN_PASSWORD;
  if (!email || !password) {
    return { ok: false, error: "Falta configurar QUICK_LOGIN_EMAIL / QUICK_LOGIN_PASSWORD en el entorno." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: "No se pudo entrar con la cuenta de pruebas (revisa las credenciales del entorno)." };
  }
  redirect("/dashboard");
}
