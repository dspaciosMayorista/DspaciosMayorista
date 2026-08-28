"use server";

import { createClient } from "@/lib/supabase/server";
import { buscarPaginaTarifarioCompleta, type ResultadoPaginaTarifarioCompleto } from "@/lib/tarifario/datos";
import { generarFlujoId } from "@/lib/observabilidad/medicion";

// Server Action invocable desde el navegador — usada por `TarifarioPublic`
// (componente COMPARTIDO por /tarifario, /dashboard/reservar y, hasta la
// ronda de "carga bajo demanda", también por /dashboard/tarifario) para
// pedir la SIGUIENTE página de resultados (búsqueda inicial en reservar,
// "Cargar más" en cualquiera de las dos) sin descargar el catálogo
// completo. `filtrosRaw` llega como `unknown`: es el body de un Server
// Action, cualquiera con el JS del navegador podría llamarlo con lo que
// quiera — `buscarPaginaTarifarioCompleta()` lo valida por completo
// (`parsearFiltrosTarifario`) antes de tocar la base de datos. Usa el
// cliente `sb` normal (con RLS) — nunca `service_role` para convertir
// filtros del cliente en consultas sin autorización; el `admin` interno de
// `buscarPaginaTarifarioCompleta` solo se usa, igual que siempre, para las
// tablas auxiliares (vigencia/cupos/empaquetados), no para decidir qué fila
// de `tarifario_resultado` es visible.
export async function buscarPaginaTarifarioAccion(filtrosRaw: unknown): Promise<ResultadoPaginaTarifarioCompleto> {
  const sb = await createClient();
  const flujoId = generarFlujoId();
  return buscarPaginaTarifarioCompleta(sb, filtrosRaw, "tarifario_cargar_mas", flujoId);
}
