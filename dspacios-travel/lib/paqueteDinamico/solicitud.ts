// Reglas de la solicitud de cotización de un paquete dinámico (#82) y resolución del canal. PURO, sin I/O.
// Espejo de `p82_priv.validar_solicitud` (migración 275) para dar mensajes claros ANTES de ir a la base; la base es la
// frontera real (valida lo mismo con la fila viva), así que una página o petición vieja nunca se salta estas reglas.

export type PaqueteSolicitud = {
  activo: boolean; publicado: boolean; noches: number; usa_hotel: boolean; usa_vuelo: boolean;
  compra_inicio: string | null; compra_fin: string | null; viaje_inicio: string | null; viaje_fin: string | null;
};
export type VueloSolicitud = { fecha_ida: string | null; fecha_regreso: string | null };

export type CodigoSolicitud = "NO_PUBLICADO" | "COMPRA" | "FECHAS" | "HOTEL" | "VUELO";
export type ResultadoSolicitud = { ok: true } | { ok: false; codigo: CodigoSolicitud; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const falla = (codigo: CodigoSolicitud, error: string): ResultadoSolicitud => ({ ok: false, codigo, error });

export function validarSolicitudDin(a: {
  paquete: PaqueteSolicitud; hoy: string; ida: string; regreso: string;
  hotelPerteneceAlPaquete: boolean; vueloEncontrado: VueloSolicitud | null; hotelElegido: boolean; vueloElegido: boolean;
}): ResultadoSolicitud {
  const p = a.paquete;
  if (!p.activo || !p.publicado) return falla("NO_PUBLICADO", "Este paquete no está disponible para cotizar.");
  if ((p.compra_inicio && a.hoy < p.compra_inicio) || (p.compra_fin && a.hoy > p.compra_fin)) return falla("COMPRA", "Este paquete no está en su vigencia de compra.");
  if (!ISO.test(a.ida) || !ISO.test(a.regreso) || a.ida < a.hoy || dias(a.ida, a.regreso) !== p.noches) {
    return falla("FECHAS", `El viaje debe ser futuro y durar exactamente ${p.noches} noches.`);
  }
  if ((p.viaje_inicio && a.ida < p.viaje_inicio) || (p.viaje_fin && a.regreso > p.viaje_fin)) return falla("FECHAS", "Las fechas están fuera de la ventana de viaje del paquete.");
  if (p.usa_hotel ? !a.hotelPerteneceAlPaquete : a.hotelElegido) return falla("HOTEL", "El hotel elegido no pertenece al paquete.");
  if (p.usa_vuelo) {
    const v = a.vueloEncontrado;
    if (!v) return falla("VUELO", "El vuelo elegido no pertenece al paquete.");
    if ((v.fecha_ida && v.fecha_ida !== a.ida) || (v.fecha_regreso && v.fecha_regreso !== a.regreso)) return falla("VUELO", "Las fechas pedidas no coinciden con las del vuelo elegido.");
  } else if (a.vueloElegido) {
    return falla("VUELO", "El paquete no incluye vuelo.");
  }
  return { ok: true };
}

export type CanalDin = "interno" | "b2b" | "publico";
const INTERNOS = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;

/**
 * El canal lo decide el SERVIDOR por la sesión, nunca el navegador.
 *  · sin sesión → visitante; rol interno activo → interno; agencia/freelance activo → B2B;
 *  · sesión con perfil inactivo/desconocido o rol sin canal (cliente_final, control_vuelo…) → rechazado.
 */
export function resolverCanalDin(sesion: { rol: string | null; activo: boolean } | null | "anonimo"):
  { ok: true; canal: CanalDin } | { ok: false; error: string } {
  if (sesion === "anonimo" || sesion === null) return { ok: true, canal: "publico" };
  if (!sesion.activo || !sesion.rol) return { ok: false, error: "Tu usuario no está activo." };
  if ((INTERNOS as readonly string[]).includes(sesion.rol)) return { ok: true, canal: "interno" };
  if (sesion.rol === "agencia" || sesion.rol === "freelance") return { ok: true, canal: "b2b" };
  return { ok: false, error: "Tu usuario no puede cotizar paquetes dinámicos." };
}

/** Datos mínimos del visitante (espejo de DIN_82_CONTACTO): nombre y un correo o teléfono válidos. */
export function contactoVisitanteValido(c: { nombres: string; apellidos: string; email: string; telefono: string }): boolean {
  const email = c.email.trim().toLowerCase();
  const tel = c.telefono.replace(/\D/g, "");
  return c.nombres.trim().length > 0 && c.nombres.length <= 120 && c.apellidos.length <= 120 && email.length <= 200
    && (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || tel.length >= 7);
}

/**
 * Qué agencia ve la pestaña «Dinámicos». El visitante (y cualquier sesión que no pueda cotizar) ve los públicos de Mayorista; el aliado B2B
 * ve los de SU agencia; el personal interno, los de la agencia activa. Misma regla que la cotización (`crearCotizacionDin`): nadie ve ni
 * cotiza un paquete de la otra agencia.
 */
export function tenantDinamicosVisibles(
  perfil: { rol: string; activo: boolean; tenant: string | null } | null,
  tenantInterno: string,
): "mayorista" | "minorista" {
  if (!perfil) return "mayorista";
  const canal = resolverCanalDin({ rol: perfil.rol, activo: perfil.activo });
  if (!canal.ok) return "mayorista";
  const t = canal.canal === "b2b" ? perfil.tenant : canal.canal === "interno" ? tenantInterno : "mayorista";
  return t === "minorista" ? "minorista" : "mayorista";
}
