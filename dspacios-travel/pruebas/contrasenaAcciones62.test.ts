// #62 — acciones reales de restablecer, cambiar y cerrar sesiones, con las fronteras de Supabase Auth simuladas.
// B1: el restablecimiento (sin contraseña actual) SOLO lo autoriza una sesión de RECUPERACIÓN verificada en el servidor (getUser(token) + amr de ESE token).
//     Una sesión ordinaria, de OAuth/enlace mágico, vencida, ya consumida o de otro usuario NO lo autoriza; «cambiar» sigue exigiendo la contraseña actual.
// B2: si la contraseña cambió pero el cierre de sesiones falla (error DEVUELTO o LANZADO) el resultado es PARCIAL, nunca éxito completo.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Llamada = { cliente: string; op: string; args?: unknown };
const llamadas: Llamada[] = [];
const AHORA = Date.parse("2026-11-19T15:00:00Z");
const seg = (ms: number) => Math.floor(ms / 1000);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p: Record<string, unknown>) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.firma`;

let usuario: { id: string; email?: string; user_metadata?: Record<string, unknown> | null } | null;
let token: string | null;
let tokenVerificado: string | null; // el único token que «Auth» acepta
let errorUpdate: { code?: string; status?: number } | null;
let throwUpdate = false;
let errorVerificacion: { code?: string; status?: number } | null;
let errorSignOut: { message: string } | null;
let throwSignOut = false;
let throwGetSession = false;

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => ({
      auth: {
        getSession: async () => { if (throwGetSession) throw new Error("boom"); return { data: { session: token ? { access_token: token } : null } }; },
        getUser: async (jwtArg?: string) => {
          llamadas.push({ cliente: "sesion", op: "getUser", args: jwtArg ?? null });
          // Con token explícito Auth solo lo acepta si es el verificado; sin argumento usa el de la sesión.
          const valido = jwtArg === undefined ? token !== null : jwtArg === tokenVerificado;
          return valido && usuario ? { data: { user: usuario }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
        },
        updateUser: async (a: unknown) => { llamadas.push({ cliente: "sesion", op: "updateUser", args: a }); if (throwUpdate) throw new Error("red"); return { error: errorUpdate }; },
        signOut: async (a: unknown) => { llamadas.push({ cliente: "sesion", op: "signOut", args: a }); if (throwSignOut) throw new Error("red"); return { error: errorSignOut }; },
      },
    }),
  },
});
// B4: tabla del servidor «recuperaciones_consumidas» simulada en memoria. El insert es check-and-set SÍNCRONO (como la PK de Postgres) y cada operación cede el turno
// al bucle de eventos, para que dos solicitudes concurrentes se entrelacen de verdad.
type Fila = { estado: string };
const reclamos = new Map<string, Fila>();
let fallaLecturaReclamo = false;
let fallaInsertReclamo: { code?: string } | null = null;
let fallaEscrituraReclamo = false; // update/delete lanzan
const clave = (u: string, e: string) => u + "|" + e;
const ceder = () => new Promise<void>((r) => setImmediate(r));
mock.module("@/lib/supabase/admin", {
  namedExports: {
    createAdminClient: () => ({
      from: (t: string) => {
        assert.equal(t, "recuperaciones_consumidas");
        return {
          select: () => ({ eq: (_a: string, u: string) => ({ eq: (_b: string, e: string) => ({ maybeSingle: async () => {
            llamadas.push({ cliente: "admin", op: "select" }); await ceder();
            if (fallaLecturaReclamo) return { data: null, error: { message: "caída" } };
            return { data: reclamos.get(clave(u, e)) ?? null, error: null };
          } }) }) }),
          insert: async (v: { user_id: string; evento: string; estado: string }) => {
            llamadas.push({ cliente: "admin", op: "insert", args: v }); await ceder();
            if (fallaInsertReclamo) return { error: fallaInsertReclamo };
            const k = clave(v.user_id, v.evento);
            if (reclamos.has(k)) return { error: { code: "23505" } };
            reclamos.set(k, { estado: v.estado });
            return { error: null };
          },
          update: (v: { estado: string }) => ({ eq: (_a: string, u: string) => ({ eq: async (_b: string, e: string) => {
            llamadas.push({ cliente: "admin", op: "update", args: v }); await ceder();
            if (fallaEscrituraReclamo) throw new Error("caída");
            const f = reclamos.get(clave(u, e)); if (f) f.estado = v.estado; return { error: null };
          } }) }),
          delete: () => ({ eq: (_a: string, u: string) => ({ eq: async (_b: string, e: string) => {
            llamadas.push({ cliente: "admin", op: "delete" }); await ceder();
            if (fallaEscrituraReclamo) throw new Error("caída");
            reclamos.delete(clave(u, e)); return { error: null };
          } }) }),
        };
      },
    }),
  },
});
mock.module("@/lib/supabase/sinSesion", {
  namedExports: {
    createClienteSinSesion: () => ({
      auth: { signInWithPassword: async (a: unknown) => { llamadas.push({ cliente: "sinSesion", op: "signInWithPassword", args: a }); return { error: errorVerificacion }; } },
    }),
  },
});

const { restablecerContrasena, cambiarContrasena, cerrarSesionesAbiertas } = await import("../app/(auth)/contrasena-actions.ts");
const ops = () => llamadas.map((l) => `${l.cliente}.${l.op}`);
const sinGetUser = () => ops().filter((o) => o !== "sesion.getUser" && !o.startsWith("admin."));
const soloAdmin = () => ops().filter((o) => o.startsWith("admin."));

/** Sesión de recuperación GENUINA: amr «recovery» reciente, mismo usuario, cuenta sin tocar desde el canje. */
function sesionRecuperacion(sobre: { amr?: unknown; sub?: string; metadata?: Record<string, unknown> | null; hace?: number; sid?: string | null } = {}) {
  const ts = seg(AHORA) - (sobre.hace ?? 60);
  usuario = { id: "u-1", email: "ana@agencia.co", user_metadata: sobre.metadata === undefined ? {} : sobre.metadata };
  token = jwt({ sub: sobre.sub ?? "u-1", ...(sobre.sid === null ? {} : { session_id: sobre.sid ?? "s-1" }), amr: "amr" in sobre ? sobre.amr : [{ method: "recovery", timestamp: ts }] });
  tokenVerificado = token;
}
function sesionOrdinaria(metodo = "password") {
  usuario = { id: "u-1", email: "ana@agencia.co", user_metadata: {} };
  token = jwt({ sub: "u-1", session_id: "s-ord", amr: [{ method: metodo, timestamp: seg(AHORA) - 60 }] });
  tokenVerificado = token;
}

mock.timers.enable({ apis: ["Date"], now: AHORA });
beforeEach(() => {
  llamadas.length = 0; reclamos.clear(); fallaLecturaReclamo = false; fallaInsertReclamo = null; fallaEscrituraReclamo = false; errorUpdate = null; throwUpdate = false; errorVerificacion = null; errorSignOut = null; throwSignOut = false; throwGetSession = false;
  sesionOrdinaria();
});

describe("B1 · restablecerContrasena: solo una sesión de recuperación verificada lo autoriza", () => {
  test("entrada inválida: ninguna llamada a Auth", async () => {
    for (const [n, c] of [["corta", "corta"], ["Viaje2026", "Viaje2027"]] as const) assert.equal((await restablecerContrasena(n, c)).ok, false);
    assert.deepEqual(llamadas, []);
  });
  test("GENUINA: verifica ESE token con Auth, actualiza y revoca todas las sesiones, en ese orden", async () => {
    sesionRecuperacion();
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(ops(), ["sesion.getUser", "admin.select", "admin.insert", "sesion.updateUser", "admin.update", "sesion.signOut"], "verifica el token, lee el reclamo, lo RECLAMA antes de cambiar la clave, la cambia, confirma y revoca");
    assert.equal(llamadas[0].args, token, "se verifica el token que se lee, no una cookie cualquiera");
    assert.deepEqual(llamadas.find((l) => l.op === "insert")!.args, { user_id: "u-1", evento: `s-1:${seg(AHORA) - 60}`, estado: "reclamada" }, "el reclamo se ata a usuario + sesión de recuperación + instante");
    assert.deepEqual(llamadas.find((l) => l.op === "updateUser")!.args, { password: "Viaje2026" }, "updateUser ya NO lleva ninguna marca en user_metadata");
    assert.deepEqual(llamadas.find((l) => l.op === "signOut")!.args, { scope: "global" });
    assert.equal(reclamos.get(`u-1|s-1:${seg(AHORA) - 60}`)?.estado, "aplicada");
  });
  for (const metodo of ["password", "oauth", "otp", "magiclink", "anonymous", "totp"]) {
    test(`sesión ORDINARIA (${metodo}): NO autoriza el restablecimiento ni llama a updateUser; remite a «Cambiar contraseña»`, async () => {
      sesionOrdinaria(metodo);
      const r = await restablecerContrasena("Viaje2026", "Viaje2026");
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.usarCambio, true);
      assert.match(!r.ok ? r.error : "", /Cambiar contraseña[\s\S]*contraseña actual/);
      assert.deepEqual(sinGetUser(), []);
    });
  }
  test("enlace VENCIDO (canjeado hace 16 min, ventana de 15): denegado", async () => {
    sesionRecuperacion({ hace: 16 * 60 });
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.equal(!r.ok && r.enlaceVencido, true);
    assert.deepEqual(sinGetUser(), []);
  });
  test("límite de la ventana: a los 15 min exactos aún sirve; un segundo después no", async () => {
    sesionRecuperacion({ hace: 15 * 60 });
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), { ok: true });
    llamadas.length = 0;
    sesionRecuperacion({ hace: 15 * 60 + 1 });
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false);
    assert.deepEqual(sinGetUser(), []);
  });
  test("sesión DISTINTA: el token dice recuperación de otro usuario → denegado", async () => {
    sesionRecuperacion({ sub: "u-OTRO" });
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.equal(!r.ok && r.enlaceVencido, true);
    assert.deepEqual(sinGetUser(), []);
  });
  test("token ALTERADO: los reclamos dicen «recuperación» pero Auth no verifica ese token → denegado", async () => {
    sesionRecuperacion();
    tokenVerificado = "otro.token.cualquiera";
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false);
    assert.deepEqual(sinGetUser(), []);
  });
  test("amr malformado o ausente nunca autoriza", async () => {
    for (const amr of [undefined, null, "recovery", [], [{ method: "recovery" }], [{ method: "recovery", timestamp: "ahora" }], [{ method: "password", timestamp: seg(AHORA) }]]) {
      llamadas.length = 0;
      sesionRecuperacion({ amr: amr as never });
      assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false, JSON.stringify(amr));
      assert.deepEqual(sinGetUser(), []);
    }
  });
  test("sin sesión o lectura que falla: denegado (falla cerrado)", async () => {
    token = null; usuario = null;
    assert.equal(!(await restablecerContrasena("Viaje2026", "Viaje2026")).ok, true);
    throwGetSession = true; sesionRecuperacion();
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false);
    assert.deepEqual(sinGetUser(), []);
  });
  test("error de Auth al actualizar (misma clave): mensaje claro, NINGUNA revocación y el reclamo se LIBERA para corregir y reintentar", async () => {
    sesionRecuperacion(); errorUpdate = { code: "same_password", status: 422 };
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.match(!r.ok ? (r as { error: string }).error : "", /distinta/);
    assert.deepEqual(sinGetUser(), ["sesion.updateUser"]);
    assert.equal(reclamos.size, 0, "rechazo definitivo (4xx): nada se aplicó, el reclamo se libera");
    errorUpdate = null;
    assert.deepEqual(await restablecerContrasena("Viaje2027", "Viaje2027"), { ok: true }, "la misma recuperación sirve para el reintento corregido");
  });
});

describe("B1 · cambiarContrasena (sesión ordinaria): la contraseña actual sigue siendo obligatoria", () => {
  test("validaciones locales primero: ninguna llamada a Auth", async () => {
    assert.equal((await cambiarContrasena("", "Viaje2027", "Viaje2027")).ok, false);
    assert.match((await cambiarContrasena("Viaje2026", "Viaje2026", "Viaje2026") as { error: string }).error, /distinta de la actual/);
    assert.match((await cambiarContrasena("Viaje2026", "Viaje2027", "otra") as { error: string }).error, /no coincide/);
    assert.deepEqual(llamadas, []);
  });
  test("sin sesión o sin correo: pide ingresar y no verifica nada", async () => {
    token = null; usuario = null;
    const r = await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027");
    assert.equal(!r.ok && r.enlaceVencido, true);
    usuario = { id: "u-1" }; token = jwt({ sub: "u-1" }); tokenVerificado = token;
    assert.equal((await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027")).ok, false);
    assert.deepEqual(sinGetUser(), []);
  });
  test("actual INCORRECTA: se verifica SIN sesión; no se actualiza ni se cierra ninguna sesión (aunque la sesión sea de recuperación)", async () => {
    sesionRecuperacion(); errorVerificacion = { code: "invalid_credentials", status: 400 };
    const r = await cambiarContrasena("mala", "Viaje2027", "Viaje2027");
    assert.equal(!r.ok ? (r as { error: string }).error : "", "La contraseña actual no es correcta.");
    assert.deepEqual(sinGetUser(), ["sinSesion.signInWithPassword"]);
    assert.deepEqual(llamadas.find((l) => l.op === "signInWithPassword")!.args, { email: "ana@agencia.co", password: "mala" }, "el correo sale de la SESIÓN");
  });
  test("límite de frecuencia al verificar: mensaje de espera, no «incorrecta»", async () => {
    errorVerificacion = { status: 429 };
    assert.match((await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027") as { error: string }).error, /Demasiados intentos/);
  });
  test("éxito: verifica, actualiza y cierra solo las OTRAS sesiones", async () => {
    const r = await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(sinGetUser(), ["sinSesion.signInWithPassword", "sesion.updateUser", "sesion.signOut"]);
    assert.deepEqual(llamadas.find((l) => l.op === "signOut")!.args, { scope: "others" });
  });
  test("Auth rechaza la clave nueva (débil): error legible, otras sesiones intactas", async () => {
    errorUpdate = { code: "weak_password" };
    assert.match((await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027") as { error: string }).error, /débil/);
    assert.deepEqual(sinGetUser(), ["sinSesion.signInWithPassword", "sesion.updateUser"]);
  });
});

describe("B2 · la contraseña cambió pero el cierre de sesiones falla: resultado PARCIAL, nunca éxito completo", () => {
  const PARCIAL = (r: unknown, alcance: string) => {
    const x = r as { ok: unknown; alcance?: string; mensaje?: string };
    assert.equal(x.ok, "parcial");
    assert.equal(x.alcance, alcance);
    assert.match(x.mensaje ?? "", /SÍ se actualizó/);
    assert.match(x.mensaje ?? "", /reintenta el cierre de sesiones/);
    assert.match(x.mensaje ?? "", /hasta que venza su acceso actual/, "el token de acceso ya emitido sigue vigente hasta expirar");
    assert.doesNotMatch(x.mensaje ?? "", /todas tus sesiones se cerraron|vuelve a cambiar|repite el cambio de contraseña\b(?! No)/i, "no promete cierre inmediato ni manda a repetir el cambio");
  };
  for (const modo of ["devuelto", "lanzado"] as const) {
    test(`restablecer, error de signOut ${modo}: parcial global; updateUser se llamó UNA sola vez`, async () => {
      sesionRecuperacion();
      if (modo === "devuelto") errorSignOut = { message: "fallo" }; else throwSignOut = true;
      PARCIAL(await restablecerContrasena("Viaje2026", "Viaje2026"), "global");
      assert.equal(ops().filter((o) => o === "sesion.updateUser").length, 1);
    });
    test(`cambiar, error de signOut ${modo}: parcial others; updateUser se llamó UNA sola vez`, async () => {
      if (modo === "devuelto") errorSignOut = { message: "fallo" }; else throwSignOut = true;
      PARCIAL(await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027"), "others");
      assert.equal(ops().filter((o) => o === "sesion.updateUser").length, 1);
    });
  }
});

describe("B2 · cerrarSesionesAbiertas reintenta SOLO el cierre", () => {
  test("éxito: solo signOut con el alcance pedido; jamás updateUser", async () => {
    assert.deepEqual(await cerrarSesionesAbiertas("others"), { ok: true });
    assert.deepEqual(await cerrarSesionesAbiertas("global"), { ok: true });
    assert.deepEqual(llamadas.filter((l) => l.op === "signOut").map((l) => l.args), [{ scope: "others" }, { scope: "global" }]);
    assert.equal(ops().includes("sesion.updateUser"), false);
  });
  test("error devuelto o lanzado: ok:false con mensaje; sin sesión: ok:false; alcance inválido: ok:false sin llamadas", async () => {
    errorSignOut = { message: "x" };
    assert.equal((await cerrarSesionesAbiertas("others")).ok, false);
    errorSignOut = null; throwSignOut = true;
    assert.equal((await cerrarSesionesAbiertas("global")).ok, false);
    throwSignOut = false; token = null; usuario = null;
    assert.equal((await cerrarSesionesAbiertas("others")).ok, false);
    llamadas.length = 0;
    assert.equal((await cerrarSesionesAbiertas("todos" as never)).ok, false);
    assert.deepEqual(llamadas, []);
  });
});

// ───────────────────────── B4 · consumo en estado del SERVIDOR, atado al evento, con reclamo atómico ─────────────────────────
describe("B4 · una recuperación se consume UNA vez; user_metadata no autoriza nada", () => {
  const OK = { ok: true };
  const evento = () => `s-1:${seg(AHORA) - 60}`;

  test("replay tras fallo de cierre de sesiones: la primera da PARCIAL, la segunda (sesión de recuperación aún viva) se NIEGA sin tocar la contraseña", async () => {
    sesionRecuperacion(); throwSignOut = true;
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026") as { ok: unknown }).ok, "parcial");
    llamadas.length = 0;
    const r = await restablecerContrasena("Otra2026x", "Otra2026x");
    assert.equal(!r.ok && r.enlaceVencido, true);
    assert.equal(ops().includes("sesion.updateUser"), false, "no hay una segunda escritura de contraseña");
    assert.equal(ops().includes("admin.insert"), false, "ni siquiera se intenta reclamar: la autorización ya ve el evento consumido");
  });
  test("borrar o falsificar user_metadata NO reactiva una recuperación consumida (la marca vieja ya no es autoridad)", async () => {
    sesionRecuperacion(); throwSignOut = true;
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026") as { ok: unknown }).ok, "parcial");
    for (const metadata of [{}, null, { recuperacion_consumida: 0 }, { recuperacion_consumida: "no" }, { recuperacion_consumida: seg(AHORA) - 99999 }, { recuperacion_consumida: null, otra: 1 }]) {
      llamadas.length = 0;
      usuario = { id: "u-1", email: "ana@agencia.co", user_metadata: metadata };
      const r = await restablecerContrasena("Otra2026x", "Otra2026x");
      assert.equal(!r.ok && r.enlaceVencido, true, JSON.stringify(metadata));
      assert.equal(ops().includes("sesion.updateUser"), false, JSON.stringify(metadata));
    }
  });
  test("lo que escribe el usuario en metadatos nunca bloquea ni desbloquea: con una marca presente pero sin reclamo en el servidor, la recuperación genuina vale", async () => {
    sesionRecuperacion({ metadata: { recuperacion_consumida: seg(AHORA) + 99999 } });
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), OK);
  });
  test("DOS solicitudes concurrentes con contraseñas distintas: solo UNA llega a updateUser", async () => {
    sesionRecuperacion(); throwSignOut = true; // el escenario del auditor: el cierre falla y la sesión de recuperación sigue viva
    const [a, b] = await Promise.all([restablecerContrasena("Primera2026", "Primera2026"), restablecerContrasena("Segunda2026", "Segunda2026")]);
    assert.equal(llamadas.filter((l) => l.op === "updateUser").length, 1, "una sola escritura de contraseña");
    const resultados = [a, b] as Array<{ ok: unknown; enlaceVencido?: boolean }>;
    assert.equal(resultados.filter((r) => r.ok === "parcial").length, 1);
    assert.equal(resultados.filter((r) => r.ok === false && r.enlaceVencido === true).length, 1, "la otra se niega como enlace ya usado");
    assert.equal(llamadas.filter((l) => l.op === "insert").length, 2, "las dos pasaron la lectura y reclamaron a la vez: la clave primaria decidió");
  });
  test("diez solicitudes simultáneas: exactamente una escritura", async () => {
    sesionRecuperacion();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => restablecerContrasena(`Clave${i}2026x`, `Clave${i}2026x`)));
    assert.equal(llamadas.filter((l) => l.op === "updateUser").length, 1);
    assert.equal(rs.filter((r) => r.ok === true).length, 1);
  });
  test("resultado INCIERTO (updateUser lanza): no se revoca, el reclamo se CONSERVA y repetir con la sesión viva se niega; el remedio es un enlace nuevo", async () => {
    sesionRecuperacion(); throwUpdate = true;
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.equal(!r.ok && r.incierto, true);
    assert.match(!r.ok ? r.error : "", /No pudimos confirmar si tu contraseña cambió[\s\S]*enlace nuevo/);
    assert.equal(ops().includes("sesion.signOut"), false);
    assert.equal(reclamos.get(`u-1|${evento()}`)?.estado, "reclamada", "reclamada (no aplicada): la página lo muestra como incierto");
    throwUpdate = false; llamadas.length = 0;
    const otra = await restablecerContrasena("Otra2026x", "Otra2026x");
    assert.equal(!otra.ok && otra.enlaceVencido, true);
    assert.equal(ops().includes("sesion.updateUser"), false);
  });
  test("resultado INCIERTO (Auth contesta 5xx o sin estado) conserva el reclamo; un 4xx definitivo lo libera", async () => {
    for (const e of [{ status: 500 }, { status: 502 }, {}, { code: "unexpected_failure" }]) {
      reclamos.clear(); llamadas.length = 0;
      sesionRecuperacion(); errorUpdate = e;
      const r = await restablecerContrasena("Viaje2026", "Viaje2026");
      assert.equal(!r.ok && r.incierto, true, JSON.stringify(e));
      assert.equal(reclamos.size, 1, JSON.stringify(e));
    }
    for (const e of [{ status: 400 }, { status: 422, code: "weak_password" }, { status: 429 }]) {
      reclamos.clear(); llamadas.length = 0;
      sesionRecuperacion(); errorUpdate = e;
      const r = await restablecerContrasena("Viaje2026", "Viaje2026");
      assert.equal(!r.ok && !r.incierto, true, JSON.stringify(e));
      assert.equal(reclamos.size, 0, JSON.stringify(e));
    }
  });
  test("si liberar el reclamo falla tras un 4xx, queda consumido (el remedio seguro es un enlace nuevo, no un desbloqueo)", async () => {
    sesionRecuperacion(); errorUpdate = { status: 422, code: "weak_password" }; fallaEscrituraReclamo = true;
    await restablecerContrasena("Viaje2026", "Viaje2026");
    errorUpdate = null; fallaEscrituraReclamo = false; llamadas.length = 0;
    const r = await restablecerContrasena("Viaje2027", "Viaje2027");
    assert.equal(!r.ok && r.enlaceVencido, true);
    assert.equal(ops().includes("sesion.updateUser"), false);
  });
  test("si confirmar falla tras el éxito, el evento sigue consumido y el resultado no cambia", async () => {
    sesionRecuperacion(); fallaEscrituraReclamo = true;
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), OK);
    assert.equal(reclamos.get(`u-1|${evento()}`)?.estado, "reclamada");
  });
  test("una recuperación NUEVA (otra sesión) funciona después de una anterior completada, y la anterior sigue consumida", async () => {
    sesionRecuperacion({ sid: "s-1" }); throwSignOut = true;
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026") as { ok: unknown }).ok, "parcial");
    throwSignOut = false; llamadas.length = 0;
    sesionRecuperacion({ sid: "s-2" });
    assert.deepEqual(await restablecerContrasena("Nueva2026x", "Nueva2026x"), OK);
    assert.equal(reclamos.size, 2);
    sesionRecuperacion({ sid: "s-1" }); llamadas.length = 0;
    assert.equal((await restablecerContrasena("Vieja2026x", "Vieja2026x")).ok, false);
    assert.equal(ops().includes("sesion.updateUser"), false);
  });
  test("mismo usuario y sesión pero otro INSTANTE de recuperación es otro evento; otro usuario con la misma sesión también", async () => {
    sesionRecuperacion({ hace: 600 });
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), OK);
    sesionRecuperacion({ hace: 60 });
    assert.deepEqual(await restablecerContrasena("Viaje2027", "Viaje2027"), OK);
    reclamos.clear(); sesionRecuperacion();
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), OK);
    sesionRecuperacion({ sub: "u-2" }); usuario = { id: "u-2", email: "b@agencia.co", user_metadata: {} };
    assert.deepEqual(await restablecerContrasena("Viaje2026", "Viaje2026"), OK);
  });
  test("falla cerrado: lectura del reclamo caída, insert con error distinto de 23505, o token sin session_id → no se escribe la contraseña", async () => {
    sesionRecuperacion(); fallaLecturaReclamo = true;
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false);
    fallaLecturaReclamo = false; fallaInsertReclamo = { code: "42501" };
    const r = await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && !r.enlaceVencido, true, "es un error transitorio, no «enlace usado»");
    fallaInsertReclamo = null;
    sesionRecuperacion({ sid: null });
    assert.equal((await restablecerContrasena("Viaje2026", "Viaje2026")).ok, false);
    assert.equal(ops().includes("sesion.updateUser"), false);
  });
  test("sesión ordinaria: ni siquiera consulta ni reclama (no toca la tabla)", async () => {
    sesionOrdinaria("password");
    await restablecerContrasena("Viaje2026", "Viaje2026");
    assert.deepEqual(soloAdmin(), []);
    assert.equal(reclamos.size, 0);
  });
  test("cambiarContrasena (contraseña actual) y el reintento de cierre NO usan la tabla de recuperaciones", async () => {
    sesionRecuperacion(); throwSignOut = true;
    await restablecerContrasena("Viaje2026", "Viaje2026");
    throwSignOut = false; llamadas.length = 0;
    assert.deepEqual(await cambiarContrasena("Viaje2026", "Viaje2027", "Viaje2027"), OK);
    assert.deepEqual(await cerrarSesionesAbiertas("global"), { ok: true });
    assert.deepEqual(soloAdmin(), []);
  });
});
