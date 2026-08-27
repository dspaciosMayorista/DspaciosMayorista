import type { Tenant } from "@/lib/tenant";

// Lógica PURA (sin I/O) — separada a propósito para poder probarla con
// `node --test`, igual que `lib/cotizacion/accesoPuro.ts`.
//
// A diferencia de `resolverContextoCotizacion()` (que NO exige un rol
// concreto, porque también sirve el autoservicio B2B — un aliado convierte
// SU PROPIA cotización, y ahí "el permiso real" es ser dueño de la fila, no
// tener un rol interno), `crearContrato()` es un flujo puramente INTERNO
// (formulario manual bajo `/dashboard/contratos`, sin equivalente de
// autoservicio: los roles externos B2B ya son redirigidos fuera de esa ruta
// por `proxy.ts`). Por eso este contexto SÍ exige que el rol tenga permiso
// real de escritura sobre `ventas` — el mismo criterio de `ESCRITURA.ventas`
// en `lib/roles.ts` (que a su vez debe reflejar la RLS real, migración 137).
// `autorizadoPorRol` se calcula en el wrapper impuro (`contexto.ts`), que sí
// puede importar `lib/roles.ts`, para no arrastrar esa dependencia (y su
// import transitivo de `next/headers`) a este módulo puro.
// `tecnico?: true` (revisión posterior — ronda 3, defecto "ERROR TÉCNICO DE
// CONTEXTO NO ELEVA EL TOTAL"): distingue, SOLO para uso interno del
// servidor, un rechazo de negocio/sesión legítimo (perfil inexistente,
// usuario inactivo, rol sin permiso, o sesión realmente ausente) de un
// fallo TÉCNICO real al consultar `auth.getUser()`/`usuarios` (Supabase caído,
// timeout, error de RLS inesperado, etc.). El mensaje público (`error`) es
// SIEMPRE el mismo genérico de sesión en ambos casos — `tecnico` nunca se
// expone al navegador, solo lo lee `crearContrato()`/`reservarPrograma()`
// para decidir si el TOTAL debe elevarse a "error" en vez de quedar en
// "rechazado" (ver `lib/observabilidad/medicion.ts`).
export type ContextoCrearContrato =
  | { ok: true; tenant: Tenant; rol: string }
  | { ok: false; error: string; tecnico?: boolean };

const MSG_SESION = "No tienes una sesión válida para crear contratos.";
const MSG_ROL = "Tu rol no tiene permiso para crear contratos.";

// ⚠️ Falla CERRADO: cualquier valor de `activo` que no sea EXACTAMENTE
// `true` bloquea (mismo criterio que `resolverContextoCotizacion`).
export function resolverContextoCrearContrato(
  perfil: { rol: string; activo: boolean | null | undefined } | null | undefined,
  autorizadoPorRol: boolean,
  tenant: Tenant
): ContextoCrearContrato {
  if (!perfil) return { ok: false, error: MSG_SESION };
  if (perfil.activo !== true) return { ok: false, error: MSG_SESION };
  if (!autorizadoPorRol) return { ok: false, error: MSG_ROL };
  return { ok: true, tenant, rol: perfil.rol };
}

// ── Orquestador puro: compone el gate REAL con un generador inyectable ────
// (revisión posterior al PR #274, ronda 3, ítem 3 "COBERTURA HONESTA DE NO
// CONSUMO"): las dos piezas — "la base rechaza invocaciones directas" y
// "resolverContextoCrearContrato rechaza control_vuelo" — probadas por
// separado NO demuestran, compuestas, que el generador realmente nunca se
// invoca cuando el gate rechaza. Esta función SÍ compone ambas piezas en una
// sola ejecución real: si `resolverContextoCrearContrato(...)` (la función
// real de este mismo archivo, no una reimplementación) rechaza, `generador`
// NUNCA se invoca — se puede probar contando cuántas veces se llamó un spy.
//
// `generador` es un parámetro de esta función — no hay forma de que un
// navegador lo "elija": las Server Actions de Next.js solo aceptan
// argumentos serializables (nunca funciones) en su firma pública, así que
// esta inyección de dependencia es estructuralmente inalcanzable desde el
// cliente. En producción, cualquier caller pasa SIEMPRE
// `siguienteNumeroContrato` (la función real de `lib/contrato/numeracion.ts`,
// que usa `service_role`) — la inyección de un generador falso solo existe
// en las pruebas (`pruebas/contratoContexto.test.ts`).
//
// ⚠️ ALCANCE HONESTO — qué prueba y qué NO prueba esta función/su prueba:
//   SÍ prueba, con ejecución real (no grep, no orden textual): que la
//   función real `resolverContextoCrearContrato` compuesta con un generador
//   cualquiera nunca invoca ese generador cuando rechaza, y lo invoca
//   EXACTAMENTE una vez cuando autoriza.
//   NO invoca la Server Action `reservarPrograma`/`crearContrato` en sí (no
//   es viable en este entorno de pruebas sin un servidor Next.js + Supabase
//   real corriendo) y por lo tanto NO mide `contrato_seq_mayorista` en el
//   momento de invocar esas Server Actions — eso NO se afirma en ningún
//   lado. `reservarPrograma`/`crearContrato` NO llaman a esta función en
//   producción (tienen validaciones de negocio legítimas entre el gate y la
//   generación — precios, cupos, márgenes — que deliberadamente deben poder
//   fallar ANTES de gastar un consecutivo, ver la ronda 1 "CONSUMO
//   PREMATURO"; comprimir gate+generación en una sola llamada aquí
//   reintroduciría ese defecto). Lo que SÍ comparten con esta función es la
//   MISMA invariante estructural: ambas llaman a `contextoCrearContrato()`
//   como su primerísima operación y retornan de inmediato si no autoriza,
//   antes de tocar cualquier otro código — verificado aparte por wiring
//   (`pruebas/contratoContexto.test.ts`: `reservarPrograma` usa
//   `contextoCrearContrato()`) y por SQL real (`test_consecutivo_dtm_
//   mayorista.sh`: un intento rechazado nunca avanza `contrato_seq_
//   mayorista`, sin importar quién lo intente). Las tres piezas combinadas
//   — invariante pura compuesta, wiring estructural, y no-consumo real en
//   SQL — son la cobertura real alcanzable en este entorno; ninguna por sí
//   sola es una prueba end-to-end de la Server Action, y no se presenta como
//   tal.
export async function intentarGenerarNumeroContrato<T>(
  perfil: { rol: string; activo: boolean | null | undefined } | null | undefined,
  autorizadoPorRol: boolean,
  tenant: Tenant,
  generador: (tenant: Tenant) => Promise<T>
): Promise<{ ok: true; valor: T } | { ok: false; error: string }> {
  const ctx = resolverContextoCrearContrato(perfil, autorizadoPorRol, tenant);
  if (!ctx.ok) return ctx;
  const valor = await generador(ctx.tenant);
  return { ok: true, valor };
}

// ── Orquestador puro con I/O INYECTADO: cuenta llamadas reales ────────────
// (optimización posterior al PR #274: `contextoCrearContrato()` duplicaba
// `auth.getUser()` y la consulta de `usuarios` porque llamaba a `getTenant()`
// a secas, que internamente vuelve a hacer las dos). Este orquestador es el
// cuerpo REAL de `contextoCrearContrato()` (lib/contrato/contexto.ts), con
// sus tres fuentes de I/O — obtener el usuario de la sesión, consultar el
// perfil, y resolver el tenant activo (que ya no hace I/O propio: recibe la
// cookie ya leída) — recibidas como funciones. Igual que
// `intentarGenerarNumeroContrato`, esto permite probar con EJECUCIÓN REAL
// (no grep, no conteo de texto) que `obtenerUsuario`/`consultarPerfil` se
// invocan EXACTAMENTE el número de veces esperado — nunca dos, como pasaba
// antes de esta ronda. `contexto.ts` pasa closures reales que envuelven
// `sb.auth.getUser()`/`sb.from("usuarios")...`; las pruebas pasan espías.
//
// `resolverTenant` es SÍNCRONO a propósito: el cálculo del tenant activo
// (`resolverTenantActivo()`, lib/tenant.ts) no hace I/O — ya recibe el
// perfil y la cookie, ambos ya leídos — así que envolverlo en una promesa
// aquí solo añadiría una vuelta de microtask sin ganar nada.
//
// `obtenerUsuario`/`consultarPerfil` (revisión posterior — ronda 3): en vez
// de devolver directamente el valor (`user`/`perfil`), devuelven
// `{ tecnico, ... }` — `tecnico=true` significa que la consulta a Supabase
// EN SÍ falló (`r.error` truthy en `contexto.ts`), no que legítimamente no
// hubiera sesión/fila. Antes, el wrapper impuro (`contexto.ts`) descartaba
// esa distinción al devolver solo `res.data.user`/`res.data` — un error
// técnico de `auth.getUser()`/la consulta de `usuarios` se comportaba
// exactamente igual que "no hay sesión"/"no existe el perfil", y el TOTAL
// terminaba clasificado como "rechazado" en vez de "error". Aquí, un
// `tecnico=true` en cualquiera de las dos corta INMEDIATAMENTE con
// `{ ok:false, error: MSG_SESION, tecnico:true }` (mismo mensaje público que
// siempre, para no revelar nada distinto al navegador) — nunca sigue hacia
// `resolverContextoCrearContrato()`, que es la que decide los rechazos de
// negocio genuinos (sesión ausente, inactivo, rol sin permiso) y por eso
// jamás pone `tecnico` en su resultado.
export async function resolverContextoCrearContratoOrquestado(
  obtenerUsuario: () => Promise<{ tecnico: boolean; user: { id: string } | null }>,
  consultarPerfil: (
    userId: string
  ) => Promise<{ tecnico: boolean; perfil: { rol: string; activo: boolean | null | undefined; tenant?: string | null } | null }>,
  resolverTenant: (
    perfil: { rol: string; activo: boolean | null | undefined; tenant?: string | null } | null
  ) => Tenant,
  autorizadoPorRolFn: (rol: string) => boolean
): Promise<ContextoCrearContrato> {
  const u = await obtenerUsuario();
  if (u.tecnico) return { ok: false, error: MSG_SESION, tecnico: true };
  if (!u.user) return resolverContextoCrearContrato(null, false, "mayorista");

  const p = await consultarPerfil(u.user.id);
  if (p.tecnico) return { ok: false, error: MSG_SESION, tecnico: true };
  const tenant = resolverTenant(p.perfil);
  return resolverContextoCrearContrato(p.perfil, p.perfil ? autorizadoPorRolFn(p.perfil.rol) : false, tenant);
}
