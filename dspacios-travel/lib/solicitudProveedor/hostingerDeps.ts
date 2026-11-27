// #103 — wiring of the Hostinger drain to the real database (service client) and the existing event processor. Shared by the webhook route and the scheduled drain so both run EXACTLY the same bounded pass.
// Built only after authentication succeeded (a rejected request never creates a database client).
import { createAdminClient } from "@/lib/supabase/admin";
import { almacenHostingerDe, crearClienteHostinger, estadoRespuestaDe, type ConfigHostinger, type DepsNotificacion } from "./hostinger.ts";
import { procesarEvento, usuariosAvisarPorDefecto } from "./servicio.ts";
import { notificarInternoPorCorreo } from "./avisoInterno.ts";

export function construirDepsHostinger(c: ConfigHostinger): DepsNotificacion {
  const admin = createAdminClient();
  return {
    config: c, cliente: crearClienteHostinger({ baseUrl: c.baseUrl, token: c.tokenApi }), almacen: almacenHostingerDe(admin), estadoRespuesta: estadoRespuestaDe(admin),
    procesar: (ev) => procesarEvento({ admin, usuariosAvisar: (s) => usuariosAvisarPorDefecto(admin, s), notificarInterno: (s, e) => notificarInternoPorCorreo(s, e) }, ev),
  };
}
