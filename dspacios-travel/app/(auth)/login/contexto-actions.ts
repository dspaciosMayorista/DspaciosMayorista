"use server";

import { iniciarContextoAgencia } from "@/lib/auth/contextoAgencia";

// Vincula la agencia activa a la sesión que ACABA de autenticarse en el
// navegador (login con contraseña). No recibe argumentos a propósito: la sesión
// y el usuario salen del token validado en el servidor, y la agencia, de la regla
// de siempre (cookie validada contra lo que el rol permite). Ver migración 237.
export async function iniciarContextoSesion(): Promise<{ ok: boolean }> {
  const r = await iniciarContextoAgencia();
  return { ok: r.ok };
}
