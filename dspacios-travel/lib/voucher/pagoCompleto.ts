import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// ÚNICO criterio de «contrato 100 % pagado» para el acceso de ALIADOS a los vouchers (#53, migración 307). Lo decide la base (`contratos_pagados_completos`):
// total de cobro y moneda de COBRO autoritativos, tolerancia de redondeo de `estado_minimo` (0,5 COP / 0,01 USD), y un contrato cancelado nunca cuenta.
// FALLA CERRADO: ante cualquier error de lectura (RPC ausente, red, respuesta rara) devuelve `null` y el llamador NIEGA el acceso. Nunca se infiere «pagado» de un fallo.
// identidad:n/a — solo lectura
export async function contratosPagadosCompletos(numeros: readonly string[]): Promise<Set<string> | null> {
  const unicos = [...new Set(numeros.filter((n) => typeof n === "string" && n.length > 0))];
  const pagados = new Set<string>();
  if (!unicos.length) return pagados;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const admin = createAdminClient();
  for (let i = 0; i < unicos.length; i += 200) {
    const lote = unicos.slice(i, i + 200);
    const { data, error } = await admin.rpc("contratos_pagados_completos", { p_numeros: lote });
    if (error || !Array.isArray(data)) return null;
    for (const n of data) pagados.add(String(n));
  }
  return pagados;
}

/** Un solo contrato. `false` ante cualquier duda (falla cerrado). */
export async function contratoPagadoCompleto(numero: string): Promise<boolean> {
  const r = await contratosPagadosCompletos([numero]);
  return r != null && r.has(numero);
}
