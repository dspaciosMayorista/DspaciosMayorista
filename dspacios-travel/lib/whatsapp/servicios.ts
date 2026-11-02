import "server-only";

// Consultas del canal WhatsApp: las MISMAS de SalesBot (Bloqueos y Porción,
// motores vigentes de venta) pero con el contexto público sin usuario. Lo que
// este canal no ofrece falla cerrado: Programas y B2B/agencias nunca consultan.
import { createClient } from "@supabase/supabase-js";
import { generarFlujoId } from "@/lib/observabilidad/medicion";
import { buscarBloqueos, buscarPorcion, cargarContextoPaquetes, cotizarBloqueo, cotizarPorcion, destinosPorcionDisponibles, ofertaBloqueoPorClave, type ContextoPaquetes } from "@/lib/salesbot/paquetes/lectura";
import { crearSello, type Respuesta } from "@/lib/salesbot/contrato";
import type { ServiciosConversacion } from "@/lib/salesbot/conversacion/flujo";

const NO_DISPONIBLE = "Esa consulta la atiende un asesor.";
const cerrado = <T>(): Promise<Respuesta<T>> => Promise.resolve({ ok: false, codigo: "no_autorizado", motivo: NO_DISPONIBLE, sello: crearSello("buscarProgramas") });

/**
 * Sin usuario: el cliente es el de un visitante anónimo (llave anon, sin sesión), o sea lo mismo que ve el
 * tarifario público; nunca service-role para leer el catálogo. Los motores usan service-role por dentro, como en la web.
 */
function prepararContextoPublico() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return cargarContextoPaquetes(sb as unknown as ContextoPaquetes["sb"], generarFlujoId());
}

export function serviciosWhatsApp(): ServiciosConversacion {
  let preparado: ReturnType<typeof prepararContextoPublico> | null = null;
  const paquetes = () => (preparado ??= prepararContextoPublico());
  const sinContexto = <T>(fuente: "buscarBloqueos" | "cotizarBloqueo" | "buscarPorcion" | "cotizarPorcion", p: { codigo: "no_autorizado" | "error_tecnico"; motivo: string }): Respuesta<T> => ({
    ok: false,
    codigo: p.codigo,
    motivo: p.motivo,
    sello: crearSello(fuente),
  });
  return {
    buscarProgramas: () => cerrado(),
    detallePrograma: () => cerrado(),
    listarAgencias: () => cerrado(),
    porcentajeAgencia: () => cerrado(),
    buscarBloqueos: async (e) => {
      const p = await paquetes();
      return p.ok ? buscarBloqueos(p.ctx, e) : sinContexto("buscarBloqueos", p);
    },
    ofertaBloqueo: async (clave) => {
      const p = await paquetes();
      return p.ok ? ofertaBloqueoPorClave(p.ctx, clave) : null;
    },
    cotizarBloqueo: async (e) => {
      const p = await paquetes();
      return p.ok ? cotizarBloqueo(p.ctx, e) : sinContexto("cotizarBloqueo", p);
    },
    destinosPorcion: async () => {
      const p = await paquetes();
      return p.ok ? destinosPorcionDisponibles(p.ctx) : null;
    },
    buscarPorcion: async (e) => {
      const p = await paquetes();
      return p.ok ? buscarPorcion(p.ctx, e) : sinContexto("buscarPorcion", p);
    },
    cotizarPorcion: async (e) => {
      const p = await paquetes();
      return p.ok ? cotizarPorcion(p.ctx, e) : sinContexto("cotizarPorcion", p);
    },
  };
}
