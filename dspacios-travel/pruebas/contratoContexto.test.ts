import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolverContextoCrearContrato,
  intentarGenerarNumeroContrato,
  resolverContextoCrearContratoOrquestado,
} from "../lib/contrato/contextoPuro.ts";
import { resolverTenantActivo } from "../lib/tenant.ts";

// resolverContextoCrearContrato — el gate fail-closed de crearContrato()
// (revisión posterior al PR #274): a diferencia de resolverContextoCotizacion
// (que sirve también el autoservicio B2B, sin exigir un rol interno), este
// SÍ exige un rol con permiso real de escritura sobre `ventas`
// (`autorizadoPorRol`, calculado en el wrapper impuro vía `puedeEscribir
// ("ventas", rol)` — ver lib/contrato/contexto.ts) porque crearContrato() es
// un flujo puramente interno sin equivalente de autoservicio.
describe("resolverContextoCrearContrato", () => {
  test("perfil ausente (null) → no autorizado, sin sesión", () => {
    const ctx = resolverContextoCrearContrato(null, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });

  test("perfil ausente (undefined) → no autorizado", () => {
    const ctx = resolverContextoCrearContrato(undefined, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = false → no autorizado, aunque el rol tenga permiso", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: false }, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });

  test("activo = null → no autorizado (fallar cerrado, no abierto)", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: null }, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = undefined → no autorizado", () => {
    const ctx = resolverContextoCrearContrato({ rol: "venta", activo: undefined }, true, "mayorista");
    assert.equal(ctx.ok, false);
  });

  test("activo = true pero rol SIN permiso (autorizadoPorRol=false) → no autorizado, mensaje distinto", () => {
    const ctx = resolverContextoCrearContrato({ rol: "agencia", activo: true }, false, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /rol.*permiso/i);
  });

  test("activo = true Y rol con permiso → autorizado, expone tenant y rol", () => {
    const ctx = resolverContextoCrearContrato({ rol: "venta", activo: true }, true, "mayorista");
    assert.equal(ctx.ok, true);
    if (ctx.ok) {
      assert.equal(ctx.tenant, "mayorista");
      assert.equal(ctx.rol, "venta");
    }
  });

  test("activo = true, rol superadmin, tenant minorista → autorizado", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: true }, true, "minorista");
    assert.equal(ctx.ok, true);
    if (ctx.ok) { assert.equal(ctx.tenant, "minorista"); assert.equal(ctx.rol, "superadmin"); }
  });

  test("activo = false Y autorizadoPorRol = true → SIGUE sin autorizar (activo se revisa antes que el rol)", () => {
    const ctx = resolverContextoCrearContrato({ rol: "superadmin", activo: false }, true, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /sesión/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// EJECUCIÓN REAL contra ESCRITURA.ventas (lib/roles.ts) — no `lib/roles.ts`
// importable bajo `node --test` (usa alias `@/lib/...` que solo resuelve
// dentro del build de Next.js), así que en vez de asumir su contenido se
// EXTRAE el arreglo real del archivo fuente y se reconstruye como un array
// de JS de verdad — luego se invoca `.includes()` REAL sobre ese array (no
// un regex que busque la palabra "control_vuelo" en el texto), y el
// resultado real se alimenta a `resolverContextoCrearContrato()`. Esto
// prueba, con datos y ejecución reales, que el flujo real que usa
// `contextoCrearContrato()` (crearContrato, reservarPrograma) rechaza
// exactamente los roles que ESCRITURA.ventas excluye — no una copia
// hipotética.
// ───────────────────────────────────────────────────────────────────────────
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function extraerArrayDeRoles(src: string, patron: RegExp): string[] {
  const m = patron.exec(src);
  assert.ok(m, `no se pudo extraer el arreglo con el patrón ${patron}`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("ESCRITURA.ventas real (lib/roles.ts) — reconstruida y evaluada, no asumida", () => {
  const src = leer("lib/roles.ts");
  const adminRoles = extraerArrayDeRoles(src, /ADMIN_ROLES:\s*readonly\s+Rol\[\]\s*=\s*\[([^\]]*)\]/);
  const ventasExtra = extraerArrayDeRoles(src, /ventas:\s*\[\.\.\.ADMIN_ROLES,\s*([^\]]*)\]/);
  // ESCRITURA.ventas = [...ADMIN_ROLES, "operaciones", "venta"] — se
  // reconstruye el spread real concatenando los dos arreglos extraídos.
  const escrituraVentas = [...adminRoles, ...ventasExtra];

  test("el arreglo reconstruido tiene el contenido esperado (evidencia de que la extracción funcionó)", () => {
    assert.deepEqual([...escrituraVentas].sort(), ["administracion", "gerencia", "operaciones", "superadmin", "venta"].sort());
  });

  test("control_vuelo NO está en ESCRITURA.ventas real — la vulnerabilidad que se corrigió (control_vuelo alcanzaba el RPC administrativo) sigue cerrada", () => {
    assert.equal(escrituraVentas.includes("control_vuelo"), false);
  });

  for (const rolExterno of ["agencia", "freelance", "cliente_final"]) {
    test(`${rolExterno} (externo) tampoco está en ESCRITURA.ventas real`, () => {
      assert.equal(escrituraVentas.includes(rolExterno), false);
    });
  }

  test("resolverContextoCrearContrato(), alimentado con el resultado REAL de ESCRITURA.ventas.includes('control_vuelo'), rechaza a control_vuelo", () => {
    const autorizado = escrituraVentas.includes("control_vuelo"); // = false, con datos reales
    const ctx = resolverContextoCrearContrato({ rol: "control_vuelo", activo: true }, autorizado, "mayorista");
    assert.equal(ctx.ok, false);
    if (!ctx.ok) assert.match(ctx.error, /rol.*permiso/i);
  });

  for (const rolInterno of ["superadmin", "administracion", "gerencia", "operaciones", "venta"]) {
    test(`resolverContextoCrearContrato(), alimentado con el resultado REAL de ESCRITURA.ventas.includes('${rolInterno}'), autoriza a ${rolInterno}`, () => {
      const autorizado = escrituraVentas.includes(rolInterno); // = true, con datos reales
      const ctx = resolverContextoCrearContrato({ rol: rolInterno, activo: true }, autorizado, "mayorista");
      assert.equal(ctx.ok, true);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// COBERTURA COMPUESTA DE NO-CONSUMO (revisión posterior al PR #274, ronda 3,
// ítem 3): las dos piezas de arriba — "la base rechaza invocaciones directas
// de anon/authenticated" (SQL, test_consecutivo_dtm_mayorista.sh) y
// "resolverContextoCrearContrato rechaza control_vuelo" (pura, arriba) — se
// probaban por separado. Eso NO demuestra, compuestas, que un intento de
// control_vuelo nunca llega a invocar el generador. Aquí SÍ se compone: se
// llama a `intentarGenerarNumeroContrato()` (que internamente usa la función
// REAL `resolverContextoCrearContrato`, la misma que production) con un
// GENERADOR ESPÍA (cuenta invocaciones, nunca hace I/O real) y se cuenta
// exactamente cuántas veces se invocó.
//
// ⚠️ Esto NO es una prueba end-to-end de la Server Action `reservarPrograma`/
// `crearContrato`: no las invoca, no corre contra una base real, y por lo
// tanto NO mide `contrato_seq_mayorista` en el momento de llamar a esas
// Server Actions — eso se prueba aparte, con SQL real, en
// `test_consecutivo_dtm_mayorista.sh` (Pruebas 6a/6b/6c: un intento
// RECHAZADO a nivel de base no cambia `contrato_seq_mayorista.last_value`).
// Lo que esta prueba SÍ demuestra con ejecución real y composición real es
// la invariante que hace que ese no-consumo sea posible en primer lugar: el
// generador (aquí un espía; en producción, siempre `siguienteNumeroContrato`,
// importado por el módulo — nunca algo que el navegador pueda elegir, ya que
// las Server Actions de Next.js solo aceptan argumentos serializables, nunca
// funciones) JAMÁS se invoca si el gate real rechaza.
describe("intentarGenerarNumeroContrato — compone el gate REAL con un generador espía", () => {
  function espia<T>(valor: T): { fn: (tenant: string) => Promise<T>; llamadas: string[] } {
    const llamadas: string[] = [];
    return {
      llamadas,
      fn: async (tenant: string) => {
        llamadas.push(tenant);
        return valor;
      },
    };
  }

  test("control_vuelo activo (rol sin permiso, ESCRITURA.ventas real) → el generador se llama 0 veces", async () => {
    const { fn, llamadas } = espia("DTM-9999");
    const res = await intentarGenerarNumeroContrato({ rol: "control_vuelo", activo: true }, false, "mayorista", fn);
    assert.equal(res.ok, false);
    assert.equal(llamadas.length, 0, `se esperaban 0 llamadas al generador, hubo ${llamadas.length}`);
  });

  test("usuario inactivo (rol venta, activo=false) → el generador se llama 0 veces", async () => {
    const { fn, llamadas } = espia("DTM-9999");
    const res = await intentarGenerarNumeroContrato({ rol: "venta", activo: false }, true, "mayorista", fn);
    assert.equal(res.ok, false);
    assert.equal(llamadas.length, 0, `se esperaban 0 llamadas al generador, hubo ${llamadas.length}`);
  });

  test("perfil ausente (sin sesión / sin fila en usuarios) → el generador se llama 0 veces", async () => {
    const { fn, llamadas } = espia("DTM-9999");
    const res = await intentarGenerarNumeroContrato(null, true, "mayorista", fn);
    assert.equal(res.ok, false);
    assert.equal(llamadas.length, 0, `se esperaban 0 llamadas al generador, hubo ${llamadas.length}`);
  });

  test("rol venta activo (autorizado) → el generador se llama EXACTAMENTE 1 vez, con el tenant correcto", async () => {
    const { fn, llamadas } = espia("DTM-0007");
    const res = await intentarGenerarNumeroContrato({ rol: "venta", activo: true }, true, "mayorista", fn);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.valor, "DTM-0007");
    assert.equal(llamadas.length, 1, `se esperaba EXACTAMENTE 1 llamada al generador, hubo ${llamadas.length}`);
    assert.deepEqual(llamadas, ["mayorista"]);
  });

  test("dos intentos rechazados seguidos + uno autorizado → el generador acumula exactamente 1 llamada en total", async () => {
    // Refuerza que el conteo es real y acumulativo, no un artefacto de un
    // solo caso aislado — compone varios intentos contra el MISMO espía.
    const { fn, llamadas } = espia("DTM-0008");
    await intentarGenerarNumeroContrato({ rol: "control_vuelo", activo: true }, false, "mayorista", fn);
    await intentarGenerarNumeroContrato(null, true, "mayorista", fn);
    await intentarGenerarNumeroContrato({ rol: "venta", activo: true }, true, "mayorista", fn);
    assert.equal(llamadas.length, 1, `se esperaba 1 sola llamada acumulada tras 2 rechazos + 1 autorizado, hubo ${llamadas.length}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Wiring: reservarPrograma() debe usar contextoCrearContrato() (fail-closed
// interno con rol), NUNCA contextoCotizacion() a secas — regresión exacta
// del hallazgo "control_vuelo podía alcanzar el RPC administrativo".
// ───────────────────────────────────────────────────────────────────────────
// Extrae el cuerpo de una función balanceando llaves desde su primer `{`
// posterior al cierre de la lista de parámetros (soporta tipos de retorno
// con llaves propias, ej. `Promise<{ ok: true } | { ok: false }>`) — mismo
// helper que pruebas/numeracionOrdenWiring.test.ts, duplicado aquí a
// propósito para que este archivo siga siendo autocontenido.
function cuerpoDeFuncion(src: string, nombre: string): string {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `no se encontró la función ${nombre}`);
  let i = src.indexOf("(", m!.index);
  let profParen = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") profParen++;
    else if (src[i] === ")") { profParen--; if (profParen === 0) { i++; break; } }
  }
  let profAngulo = 0;
  for (; i < src.length; i++) {
    if (src[i] === "<") profAngulo++;
    else if (src[i] === ">") profAngulo--;
    else if (src[i] === "{" && profAngulo === 0) break;
  }
  let depth = 0;
  const inicio = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(inicio, i + 1); }
  }
  throw new Error(`no se pudo balancear las llaves de ${nombre}`);
}

describe("reservar/actions.ts: reservarPrograma usa contextoCrearContrato(), no contextoCotizacion()", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarPrograma");

  test("llama a contextoCrearContrato()", () => {
    // Acepta tanto la llamada directa como envuelta en `medirEtapa(...)`
    // (medición de rendimiento sin PII agregada en la ronda de optimización
    // del botón "Reservar"/"Generar contrato" — sigue siendo, en cualquier
    // caso, la MISMA función real la que resuelve `ctx`).
    assert.match(cuerpo, /const\s+ctx\s*=\s*await\s+[\s\S]{0,80}?contextoCrearContrato\(\)/);
  });

  test("ya NO llama a contextoCotizacion() (el gate viejo, sin verificación de rol)", () => {
    assert.doesNotMatch(cuerpo, /contextoCotizacion\(\)/);
  });

  test("no confía en tipoAsesor/asesorInterno/agenciaNombre/freelanceNombre de `input` para resolver el tenant o la identidad del caller", () => {
    // El tenant debe salir de `ctx.tenant` (resuelto server-side), nunca de
    // un campo homónimo leído de `input`.
    assert.doesNotMatch(cuerpo, /const\s+tenant\s*=\s*input\./);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// RONDA DE RENDIMIENTO (posterior al PR #274): `contextoCrearContrato()`
// duplicaba `auth.getUser()` y la consulta de `usuarios` porque llamaba a
// `getTenant()` a secas, que internamente las repite. Se corrigió pidiendo
// `tenant` en la MISMA consulta de perfil y resolviendo el tenant activo con
// `resolverTenantActivo()` (puro, sin I/O) en vez de `getTenant()`.
//
// Cobertura, en capas honestas (mismo criterio que la ronda 3 de este PR):
//   1) EJECUCIÓN REAL con espías, contra `resolverContextoCrearContratoOrquestado`
//      (el cuerpo real de `contextoCrearContrato()`, con las 3 fuentes de I/O
//      inyectadas) — cuenta cuántas veces se invoca cada una.
//   2) EJECUCIÓN REAL de `resolverTenantActivo()` (la pieza que reemplazó a
//      `getTenant()`) contra los casos de superadmin/cookie manipulada.
//   3) Regresión ESTRUCTURAL sobre el archivo real `lib/contrato/contexto.ts`:
//      un solo `auth.getUser()`, una sola consulta a `usuarios`, y NINGUNA
//      referencia a `getTenant()`/`tenantContext()`.
// Ninguna capa por sí sola prueba "cuántas llamadas de red hace Supabase de
// verdad" (eso solo se ve en producción/staging con logs reales, ver
// `lib/observabilidad/medicion.ts`); combinadas SÍ demuestran, con ejecución
// real y sin asumir nada de texto, que la duplicación estructural desapareció.
// ═════════════════════════════════════════════════════════════════════════

function espiaLlamadas<A extends unknown[], R>(impl: (...args: A) => R): { fn: (...args: A) => R; llamadas: A[] } {
  const llamadas: A[] = [];
  const fn = ((...args: A) => {
    llamadas.push(args);
    return impl(...args);
  }) as (...args: A) => R;
  return { fn, llamadas };
}

describe("resolverContextoCrearContratoOrquestado — cuenta llamadas reales de auth/perfil (ejecución real, no grep)", () => {
  test("flujo autorizado: obtenerUsuario se invoca EXACTAMENTE 1 vez", async () => {
    const obtenerUsuario = espiaLlamadas(async () => ({ id: "u1" }));
    const consultarPerfil = espiaLlamadas(async () => ({ rol: "venta", activo: true, tenant: "mayorista" }));
    const res = await resolverContextoCrearContratoOrquestado(
      obtenerUsuario.fn, consultarPerfil.fn, () => "mayorista", () => true
    );
    assert.equal(res.ok, true);
    assert.equal(obtenerUsuario.llamadas.length, 1, `se esperaba 1 llamada a obtenerUsuario, hubo ${obtenerUsuario.llamadas.length}`);
  });

  test("flujo autorizado: consultarPerfil se invoca EXACTAMENTE 1 vez", async () => {
    const obtenerUsuario = espiaLlamadas(async () => ({ id: "u1" }));
    const consultarPerfil = espiaLlamadas(async () => ({ rol: "venta", activo: true, tenant: "mayorista" }));
    await resolverContextoCrearContratoOrquestado(
      obtenerUsuario.fn, consultarPerfil.fn, () => "mayorista", () => true
    );
    assert.equal(consultarPerfil.llamadas.length, 1, `se esperaba 1 llamada a consultarPerfil, hubo ${consultarPerfil.llamadas.length}`);
    assert.deepEqual(consultarPerfil.llamadas[0], ["u1"], "consultarPerfil debe recibir el id del usuario ya resuelto");
  });

  test("sin sesión (obtenerUsuario devuelve null) → bloqueado, y consultarPerfil NUNCA se invoca (0 veces)", async () => {
    const obtenerUsuario = espiaLlamadas(async () => null);
    const consultarPerfil = espiaLlamadas(async () => ({ rol: "venta", activo: true, tenant: "mayorista" }));
    const res = await resolverContextoCrearContratoOrquestado(
      obtenerUsuario.fn, consultarPerfil.fn, () => "mayorista", () => true
    );
    assert.equal(res.ok, false);
    assert.equal(obtenerUsuario.llamadas.length, 1);
    assert.equal(consultarPerfil.llamadas.length, 0, `sin sesión, consultarPerfil no debía llamarse — se llamó ${consultarPerfil.llamadas.length} veces`);
  });

  test("perfil ausente (consultarPerfil devuelve null — sin fila, o error de consulta: la misma consulta real descarta el error y deja perfil=null) → bloqueado", async () => {
    const obtenerUsuario = espiaLlamadas(async () => ({ id: "u1" }));
    const consultarPerfil = espiaLlamadas(async () => null);
    const res = await resolverContextoCrearContratoOrquestado(
      obtenerUsuario.fn, consultarPerfil.fn, () => "mayorista", () => true
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /sesión/i);
    assert.equal(obtenerUsuario.llamadas.length, 1);
    assert.equal(consultarPerfil.llamadas.length, 1, "el intento de consultar el perfil SÍ debe contarse, aunque no haya devuelto fila");
  });

  test("usuario inactivo (activo=false) → bloqueado", async () => {
    const res = await resolverContextoCrearContratoOrquestado(
      async () => ({ id: "u1" }),
      async () => ({ rol: "superadmin", activo: false, tenant: "mayorista" }),
      () => "mayorista",
      () => true
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /sesión/i);
  });

  test("rol no autorizado (control_vuelo, ESCRITURA.ventas real) → bloqueado", async () => {
    const src = leer("lib/roles.ts");
    const adminRoles = extraerArrayDeRoles(src, /ADMIN_ROLES:\s*readonly\s+Rol\[\]\s*=\s*\[([^\]]*)\]/);
    const ventasExtra = extraerArrayDeRoles(src, /ventas:\s*\[\.\.\.ADMIN_ROLES,\s*([^\]]*)\]/);
    const escrituraVentas = [...adminRoles, ...ventasExtra];
    const res = await resolverContextoCrearContratoOrquestado(
      async () => ({ id: "u1" }),
      async () => ({ rol: "control_vuelo", activo: true, tenant: "mayorista" }),
      () => "mayorista",
      (rol) => escrituraVentas.includes(rol)
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /rol.*permiso/i);
  });

  test("rol autorizado (venta, ESCRITURA.ventas real) → autorizado", async () => {
    const src = leer("lib/roles.ts");
    const adminRoles = extraerArrayDeRoles(src, /ADMIN_ROLES:\s*readonly\s+Rol\[\]\s*=\s*\[([^\]]*)\]/);
    const ventasExtra = extraerArrayDeRoles(src, /ventas:\s*\[\.\.\.ADMIN_ROLES,\s*([^\]]*)\]/);
    const escrituraVentas = [...adminRoles, ...ventasExtra];
    const res = await resolverContextoCrearContratoOrquestado(
      async () => ({ id: "u1" }),
      async () => ({ rol: "venta", activo: true, tenant: "mayorista" }),
      () => "mayorista",
      (rol) => escrituraVentas.includes(rol)
    );
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.rol, "venta");
  });

  test("flujo autorizado conserva el tenant que devolvió resolverTenant()", async () => {
    const res = await resolverContextoCrearContratoOrquestado(
      async () => ({ id: "u1" }),
      async () => ({ rol: "superadmin", activo: true, tenant: "mayorista" }),
      () => "minorista", // simula superadmin con cookie de agencia = minorista
      () => true
    );
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.tenant, "minorista");
  });
});

describe("resolverTenantActivo (lib/tenant.ts) — reemplaza a getTenant() dentro de contextoCrearContrato()", () => {
  test("superadmin + cookie válida 'minorista' → cambia a minorista", () => {
    const tenant = resolverTenantActivo({ rol: "superadmin", tenant: "mayorista" }, "minorista");
    assert.equal(tenant, "minorista");
  });

  test("superadmin + cookie válida 'mayorista' → se queda en mayorista", () => {
    const tenant = resolverTenantActivo({ rol: "superadmin", tenant: "mayorista" }, "mayorista");
    assert.equal(tenant, "mayorista");
  });

  test("superadmin + cookie AUSENTE → cae al primero de los permitidos (mayorista)", () => {
    const tenant = resolverTenantActivo({ rol: "superadmin", tenant: "minorista" }, undefined);
    assert.equal(tenant, "mayorista");
  });

  test("superadmin + cookie con valor BASURA (no es un tenant válido) → ignora la cookie, cae al primero permitido", () => {
    const tenant = resolverTenantActivo({ rol: "superadmin", tenant: "minorista" }, "otra-cosa");
    assert.equal(tenant, "mayorista");
  });

  test("usuario NO superadmin (venta, home=mayorista) + cookie manipulada a 'minorista' → NUNCA concede minorista, se queda en su propio tenant", () => {
    const tenant = resolverTenantActivo({ rol: "venta", tenant: "mayorista" }, "minorista");
    assert.equal(tenant, "mayorista", "un usuario no-superadmin no debe poder cambiar de agencia manipulando la cookie");
  });

  test("usuario NO superadmin (operaciones, home=minorista) + cookie manipulada a 'mayorista' → NUNCA concede mayorista, se queda en su propio tenant", () => {
    const tenant = resolverTenantActivo({ rol: "operaciones", tenant: "minorista" }, "mayorista");
    assert.equal(tenant, "minorista", "un usuario no-superadmin no debe poder cambiar de agencia manipulando la cookie");
  });

  test("usuario NO superadmin sin cookie → su propio tenant (home)", () => {
    const tenant = resolverTenantActivo({ rol: "venta", tenant: "minorista" }, undefined);
    assert.equal(tenant, "minorista");
  });

  test("perfil ausente (null) → mayorista por defecto (mismo fallback que tenantContext())", () => {
    const tenant = resolverTenantActivo(null, "minorista");
    assert.equal(tenant, "mayorista", "sin perfil, permitidos=['mayorista'] — nunca concede minorista aunque la cookie lo pida");
  });

  test("perfil sin tenant propio (tenant ausente/null) → home cae a mayorista", () => {
    const tenant = resolverTenantActivo({ rol: "venta", tenant: null }, undefined);
    assert.equal(tenant, "mayorista");
  });
});

describe("Regresión estructural — contexto.ts no debe volver a duplicar auth/perfil, tenant.server.ts no debe divergir", () => {
  const contextoSrc = leer("lib/contrato/contexto.ts");

  test("contexto.ts NUNCA vuelve a importar de lib/tenant.server (de donde salen getTenant()/tenantContext())", () => {
    // Chequea el IMPORT, no cualquier ocurrencia del texto "getTenant("/
    // "tenantContext(" — el propio código de este archivo los MENCIONA en
    // comentarios (explicando qué se optimizó), así que un grep de texto
    // plano daría un falso positivo. Sin un import de "@/lib/tenant.server",
    // es estructuralmente imposible volver a invocarlos.
    assert.doesNotMatch(
      contextoSrc,
      /from\s*"@\/lib\/tenant\.server"/,
      "contexto.ts volvió a importar de lib/tenant.server — de ahí salen getTenant()/tenantContext(), que reintroducen la duplicación de auth.getUser()/usuarios"
    );
  });

  test("contexto.ts hace EXACTAMENTE una llamada a sb.auth.getUser()", () => {
    const ocurrencias = contextoSrc.match(/\.auth\.getUser\s*\(/g) ?? [];
    assert.equal(ocurrencias.length, 1, `se esperaba exactamente 1 ocurrencia de .auth.getUser(), hubo ${ocurrencias.length}`);
  });

  test("contexto.ts hace EXACTAMENTE una consulta a la tabla usuarios", () => {
    const ocurrencias = contextoSrc.match(/\.from\(\s*"usuarios"\s*\)/g) ?? [];
    assert.equal(ocurrencias.length, 1, `se esperaba exactamente 1 ocurrencia de .from("usuarios"), hubo ${ocurrencias.length}`);
  });

  test("contexto.ts pide rol+activo+tenant en la MISMA consulta (una sola .select con las tres columnas)", () => {
    assert.match(contextoSrc, /\.select\(\s*"rol,\s*activo,\s*tenant"\s*\)/);
  });

  test("tenant.server.ts (tenantContext) delega en resolverTenantActivo() — no reimplementa la regla por separado", () => {
    const tenantServerSrc = leer("lib/tenant.server.ts");
    assert.match(tenantServerSrc, /resolverTenantActivo\s*\(/, "tenantContext() debe usar la MISMA función pura que contextoCrearContrato(), para que no puedan divergir");
  });

  test("crearContrato() y reservarPrograma() reutilizan ctx.sb en vez de crear un cliente nuevo", () => {
    const contratosSrc = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    const reservarSrc = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(contratosSrc, /const\s*\{\s*tenant,\s*sb\s*\}\s*=\s*ctx\s*;/, "crearContrato() debe desestructurar sb de ctx, no crear un cliente nuevo");
    assert.match(reservarSrc, /const\s*\{\s*tenant,\s*sb\s*\}\s*=\s*ctx\s*;/, "reservarPrograma() debe desestructurar sb de ctx, no crear un cliente nuevo");
  });
});
