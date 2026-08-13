"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ⚠️ TEMPORAL (solo pruebas): permite entrar con un código corto en vez de
// escribir correo y contraseña.
//   Código QUICK_LOGIN_CODE     → admin: QUICK_LOGIN_EMAIL / QUICK_LOGIN_PASSWORD → /dashboard
//   Código QUICK_LOGIN_B2B_CODE → B2B:   QUICK_LOGIN_B2B_EMAIL / QUICK_LOGIN_B2B_PASSWORD → /portal/b2b
//
// ⚠️ SEGURIDAD — este atajo nace APAGADO y solo se enciende con
// `QUICK_LOGIN_ENABLED=1`. Antes venía encendido siempre y con valores por
// defecto ("2" + correo y contraseña quemados en el código + auto-creación del
// usuario con rol `agencia` y `activo: true`): eso significaba que CUALQUIERA
// que escribiera "2" en el login de producción obtenía una sesión válida de
// aliado B2B, sin necesidad de configurar nada. Ahora, sin la variable puesta
// y sin credenciales explícitas en el entorno, no hay atajo posible.
export async function loginConCodigo(
  codigo: string
): Promise<{ ok: false; error: string }> {
  if (process.env.QUICK_LOGIN_ENABLED !== "1") {
    return { ok: false, error: "El ingreso por código no está habilitado." };
  }

  const code = (codigo ?? "").trim();
  const codigoAdmin = process.env.QUICK_LOGIN_CODE;
  const codigoB2B = process.env.QUICK_LOGIN_B2B_CODE;

  let email: string | undefined;
  let password: string | undefined;
  let destino = "/dashboard";
  let esB2B = false;

  // Se comparan solo códigos definidos en el entorno: sin variable no hay
  // código válido (un `code` vacío nunca debe coincidir con un `undefined`).
  if (codigoAdmin && code === codigoAdmin) {
    email = process.env.QUICK_LOGIN_EMAIL;
    password = process.env.QUICK_LOGIN_PASSWORD;
    destino = "/dashboard";
  } else if (codigoB2B && code === codigoB2B) {
    email = process.env.QUICK_LOGIN_B2B_EMAIL;
    password = process.env.QUICK_LOGIN_B2B_PASSWORD;
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
