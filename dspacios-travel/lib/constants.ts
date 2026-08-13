// Salario mínimo — actualizar cada diciembre con decreto presidencial
export const SMMLV = 1_750_905;
export const SUBSIDIO_TRANSPORTE = 249_095;

// Parámetros tributarios Colombia (Decreto dic-2025)
export const TRIBUTARIO = {
  ICA: 0.01,          // sobre ingresos brutos
  BOMBERIL: 0.01,     // sobre el ICA
  FONTUR: 0.025,      // sobre utilidad bruta
  RETENCION_RENTA: 0.035,   // retención en la fuente (anticipo de renta)
  IMPUESTO_RENTA: 0.35,     // impuesto de renta PyME sobre la renta líquida
  IVA: 0.19,
  RETENCION_HONORARIOS: 0.11,
} as const;

// Roles del sistema
export const ROLES = [
  "superadmin",
  "gerencia",
  "administracion",
  "operaciones",
  "venta",
  "control_vuelo",
  "agencia",
  "freelance",
  "cliente_final",
] as const;

export type Rol = (typeof ROLES)[number];

export const ROLES_INTERNOS: Rol[] = [
  "superadmin",
  "gerencia",
  "administracion",
  "operaciones",
  "venta",
  "control_vuelo",
];

export const ROLES_EXTERNOS: Rol[] = ["agencia", "freelance", "cliente_final"];

// Estados de silla
export const ESTADOS_SILLA = [
  "disponible",
  "en_plazo",
  "confirmada",
  "devuelta",
  "no_vendida",
  "cambio",
  "cambio_entrante",
] as const;

export type EstadoSilla = (typeof ESTADOS_SILLA)[number];

// Tipos de paquete
export const TIPOS_PAQUETE = [
  "bloqueo",
  "empaquetado",
  "dinamico",
  "porcion_terrestre",
] as const;

export type TipoPaquete = (typeof TIPOS_PAQUETE)[number];

// ── Módulos del dashboard: quién puede CONSULTAR cada uno ─────────────────
// Vive aquí (y no en lib/roles.ts) porque `proxy.ts` también lo necesita, y el
// middleware no puede importar nada que use `next/headers`.
//
// El rol `venta` quedó acotado a lo que realmente puede usar. Antes tenía todos
// los módulos, pero desde que dejó de leer `ventas` y las tablas de costos
// (migraciones 144/146 y las de producto, que ya lo excluían), pantallas como
// Finanzas, Cartera o Producto le salen VACÍAS. Mostrar un menú que no lleva a
// ninguna parte confunde y hace parecer roto lo que en realidad está bien
// protegido.
export const LECTURA_MODULO: Record<string, readonly Rol[]> = {
  // Comercial: lo que un asesor necesita para vender.
  tarifario: ROLES_INTERNOS,
  reservar: ROLES_INTERNOS,
  cotizaciones: ROLES_INTERNOS,
  contratos: ROLES_INTERNOS,
  crm: ROLES_INTERNOS,

  // Operación y producto: `venta` no lee estas tablas (RLS), así que tampoco
  // debe ver el menú. `bloqueos_vuelo`, `tarifa_hotel`, `servicios_adicionales`
  // y `proveedores` ya lo excluían desde antes de esta reorganización.
  ventas: ROLES_INTERNOS.filter((r) => r !== "venta"),
  vuelos: ROLES_INTERNOS.filter((r) => r !== "venta"),
  paquetes: ROLES_INTERNOS.filter((r) => r !== "venta"),
  producto: ROLES_INTERNOS.filter((r) => r !== "venta"),

  // Administración: costos, márgenes, nómina y comisiones.
  finanzas: ROLES_INTERNOS.filter((r) => r !== "venta"),
  configuracion: ROLES_INTERNOS.filter((r) => r !== "venta"),

  usuarios: ["superadmin", "administracion"] as Rol[],
  b2b: ["superadmin", "administracion", "gerencia"] as Rol[],
};

// Prefijo de ruta → módulo. Lo usa `proxy.ts` para bloquear el acceso por URL
// directa: ocultar el ítem del menú no impide que alguien escriba la dirección.
// El orden importa: gana el prefijo MÁS LARGO que coincida.
export const MODULO_POR_RUTA: { prefijo: string; modulo: string }[] = [
  { prefijo: "/dashboard/contratos", modulo: "contratos" },
  { prefijo: "/dashboard/cotizaciones", modulo: "cotizaciones" },
  { prefijo: "/dashboard/reservar", modulo: "reservar" },
  { prefijo: "/dashboard/ventas", modulo: "ventas" },
  { prefijo: "/dashboard/vuelos", modulo: "vuelos" },
  { prefijo: "/dashboard/paquetes", modulo: "paquetes" },
  { prefijo: "/dashboard/producto", modulo: "producto" },
  { prefijo: "/dashboard/tarifario", modulo: "tarifario" },
  { prefijo: "/dashboard/rentabilidad", modulo: "finanzas" },
  { prefijo: "/dashboard/flujo-caja", modulo: "finanzas" },
  { prefijo: "/dashboard/punto-equilibrio", modulo: "finanzas" },
  { prefijo: "/dashboard/cartera", modulo: "finanzas" },
  { prefijo: "/dashboard/pagos", modulo: "finanzas" },
  { prefijo: "/dashboard/comisiones", modulo: "finanzas" },
  { prefijo: "/dashboard/liquidacion", modulo: "finanzas" },
  { prefijo: "/dashboard/aliados", modulo: "finanzas" },
  { prefijo: "/dashboard/contabilidad", modulo: "finanzas" },
  { prefijo: "/dashboard/configuracion", modulo: "configuracion" },
  { prefijo: "/dashboard/usuarios/b2b", modulo: "b2b" },
  { prefijo: "/dashboard/usuarios", modulo: "usuarios" },
];

/** Módulo al que pertenece una ruta del dashboard (null si no está mapeada). */
export function moduloDeRuta(pathname: string): string | null {
  let mejor: { prefijo: string; modulo: string } | null = null;
  for (const m of MODULO_POR_RUTA) {
    if (pathname === m.prefijo || pathname.startsWith(m.prefijo + "/")) {
      if (!mejor || m.prefijo.length > mejor.prefijo.length) mejor = m;
    }
  }
  return mejor?.modulo ?? null;
}
