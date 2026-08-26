import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverContextoCrearContrato } from "../lib/contrato/contextoPuro.ts";

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
    assert.match(cuerpo, /const\s+ctx\s*=\s*await\s+contextoCrearContrato\(\)/);
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
