// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta la Server Action REAL `iniciarRegistroB2B` (app/portal/registro/
// actions.ts) — el destino del enlace "Solicitar acceso B2B" del login —
// contra un cliente service-role simulado (stub "@/lib/supabase/admin"):
// #62: el registro es en DOS pasos; la solicitud `pendiente` ya NO nace en `iniciarRegistroB2B` sino tras verificar el código
//     (recorrido completo en pruebas/registroCodigo62.test.ts). Aquí quedan las barreras del PASO 1 que no necesitan Auth OTP.
//   - La cuenta queda INACTIVA (`usuarios.activo = false`) hasta que alguien la
//     apruebe; el registro nunca escribe `activo: true`.
//   - Falla cerrado: si no se puede confirmar la cuenta inactiva (error o 0
//     filas afectadas) o no se registra la solicitud, se borra la cuenta
//     recién creada y no queda nada a medias.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { iniciarRegistroB2B } = await import("../app/portal/registro/actions.ts");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

const UID = "00000000-0000-4000-8000-000000000b2b";

type Op = { tabla: string; op: "select" | "update" | "insert"; payload: unknown; filtros: unknown[][] };
type Fallos = { updateError?: boolean; updateSinFilas?: boolean; insertError?: boolean; duplicado?: boolean };

function adminFalso(fallos: Fallos = {}) {
  const ops: Op[] = [];
  const auth = { creados: [] as unknown[], borrados: [] as string[], rpc: [] as Array<{ fn: string; args: unknown }> };

  function resolver(q: Op) {
    if (q.tabla === "usuarios" && q.op === "select") return { data: fallos.duplicado ? { id: "otro" } : null, error: null };
    if (q.tabla === "usuarios" && q.op === "update") {
      if (fallos.updateError) return { data: null, error: { message: "fallo simulado" } };
      return { data: fallos.updateSinFilas ? [] : [{ id: UID }], error: null };
    }
    if (q.tabla === "aliados" && q.op === "select") return { data: [], error: null };
    if (q.tabla === "b2b_solicitudes" && q.op === "insert") {
      return { data: null, error: fallos.insertError ? { message: "insert simulado falló" } : null };
    }
    throw new Error(`operación inesperada: ${q.op} ${q.tabla}`);
  }

  const sb = {
    from(tabla: string) {
      const q: Op = { tabla, op: "select", payload: null, filtros: [] };
      ops.push(q);
      const api = {
        select: () => api,
        update: (p: unknown) => { q.op = "update"; q.payload = p; return api; },
        insert: (p: unknown) => { q.op = "insert"; q.payload = p; return api; },
        eq: (...a: unknown[]) => { q.filtros.push(["eq", ...a]); return api; },
        in: (...a: unknown[]) => { q.filtros.push(["in", ...a]); return api; },
        ilike: (...a: unknown[]) => { q.filtros.push(["ilike", ...a]); return api; },
        neq: (...a: unknown[]) => { q.filtros.push(["neq", ...a]); return api; },
        limit: () => api,
        maybeSingle: () => Promise.resolve(resolver(q)),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver(q)).then(ok, ko),
      };
      return api;
    },
    // Funciones registro_b2b_* (migración 324): la BASE borra la cuenta sin verificar (atómico) y responde «borrada»; la aplicación no llama a deleteUser.
    rpc: async (fn: string, args: unknown) => { auth.rpc.push({ fn, args }); return { data: fn === "registro_b2b_descartar" ? "borrada" : "ok", error: null }; },
    auth: {
      admin: {
        createUser: async (args: unknown) => { auth.creados.push(args); return { data: { user: { id: UID } }, error: null }; },
        deleteUser: async (id: string) => { auth.borrados.push(id); return { data: {}, error: null }; },
      },
    },
  };
  return { sb, ops, auth };
}

const entrada = (extra: Partial<Parameters<typeof iniciarRegistroB2B>[0]> = {}) => ({
  tipo: "agencia", tipoDocumento: "NIT", nombre: "Viajes Prueba SAS", nit: "900123456", contacto: "Ana",
  email: "Ana@Agencia.com ", telefono: "3000000000", ciudad: "Medellín", notas: "", aceptaNotificaciones: true,
  password: "secreta123", passwordConfirm: "secreta123", ...extra,
});

afterEach(() => __resetAdmin());

for (const [caso, fallos] of [
  ["error al inactivar", { updateError: true }],
  ["inactivar no afectó ninguna fila", { updateSinFilas: true }],
] as const) {
  test(`falla cerrado (${caso}): pide a la base descartar la cuenta recién creada (sin deleteUser desde la aplicación) y no deja solicitud`, async () => {
    const { sb, ops, auth } = adminFalso(fallos);
    __setAdmin(sb);
    const r = await iniciarRegistroB2B(entrada());
    assert.equal(r.ok, false);
    assert.deepEqual(auth.borrados, [], "la aplicación no borra cuentas de Auth: lo hace la base, de forma atómica");
    assert.deepEqual(auth.rpc.filter((c) => c.fn === "registro_b2b_descartar").map((c) => (c.args as { p_usuario: string }).p_usuario), [UID], "la cuenta no puede quedar viva (estaría activa por default): se pide su descarte a la base");
    assert.equal(ops.some((o) => o.tabla === "b2b_solicitudes"), false, "sin solicitud");
  });
}

test("validaciones y nombre duplicado: ni siquiera se crea la cuenta", async () => {
  for (const [extra, fallos] of [
    [{ passwordConfirm: "otra" }, {}],
    [{ password: "123", passwordConfirm: "123" }, {}],
    [{ nit: " " }, {}],
    [{}, { duplicado: true }],
  ] as const) {
    const { sb, auth } = adminFalso(fallos);
    __setAdmin(sb);
    const r = await iniciarRegistroB2B(entrada(extra));
    assert.equal(r.ok, false);
    assert.deepEqual(auth.creados, [], `no debe crear cuenta (${JSON.stringify(extra)} ${JSON.stringify(fallos)})`);
  }
});

test("wiring: solo la aprobación interna activa la cuenta y la bandeja lista las pendientes", () => {
  const leer = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const registro = leer("../app/portal/registro/actions.ts");
  assert.doesNotMatch(registro, /activo:\s*true/, "el registro nunca activa");

  const aprobaciones = leer("../app/(dashboard)/dashboard/usuarios/b2b/actions.ts");
  assert.match(aprobaciones, /rpc\("aprobar_solicitud_b2b"/, "la aprobación delega en la RPC atómica");
  assert.match(aprobaciones, /puedeEscribir\("b2b", await miRol\(\)\)/, "y exige permiso del módulo b2b");
  // La activación vive en la RPC (migración 193), atada a la solicitud pendiente.
  const mig = leer("../supabase/migrations/20260601000193_registro_b2b_endurecido.sql");
  assert.match(mig, /set activo = true,[\s\S]*?where id = v_sol\.usuario_id\s+and activo = false/);
  assert.match(mig, /create policy "b2b_solicitudes: lectura admin" on public\.b2b_solicitudes for select/);
  assert.doesNotMatch(mig, /create policy "b2b_solicitudes: registro público"/);

  const pagina = leer("../app/(dashboard)/dashboard/usuarios/b2b/page.tsx");
  assert.match(pagina, /from\("b2b_solicitudes"\)/);
  assert.match(pagina, /\bestado\b/, "la bandeja trae el estado de cada solicitud");
  assert.match(leer("../app/(dashboard)/dashboard/usuarios/b2b/SolicitudesClient.tsx"), /s\.estado === "pendiente"/);
});
