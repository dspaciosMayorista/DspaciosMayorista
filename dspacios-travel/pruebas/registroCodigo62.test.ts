// #62 — registro B2B con verificación del correo por CÓDIGO: acciones REALES (`app/portal/registro/actions.ts`) contra un Auth y unas tablas simulados con ESTADO
// (el código se consume, el correo solo queda confirmado si verifyOtp lo acepta, borrar la cuenta cae en cascada) y una RÉPLICA de las funciones `registro_b2b_*` de la migración 324
// (cada función es atómica, como el candado de fila; la réplica cede el turno ANTES de entrar, para forzar entrelazados). Se prueba lo que decide el servidor:
//   · la solicitud de aprobación NO nace sin `email_confirmed_at` en Auth; · intentos acotados; · repetición/concurrencia; · cuentas ajenas intactas; · respuestas sin enumeración;
//   · B5: una limpieza/reinicio/intento incorrecto NUNCA borra una cuenta verificada, ni con entrelazados; · B6: un fallo posterior al código no deja el registro varado y se continúa
//     con correo + contraseña, sin duplicar la solicitud ni borrar nada.
// La réplica solo vale para la LÓGICA de la aplicación; las funciones SQL reales se prueban en test_324_registro_candados.sql y supabase/scripts/real_62/registro_concurrente.mjs.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Fila = Record<string, unknown>;
type UsuarioAuth = { id: string; email: string; password: string; confirmado: boolean; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> };
type Reg = { estado: "pendiente" | "verificado" | "completado"; reclamados: number; fallos: number; enVuelo: number; ultimoReclamo: number; datos: Fila | null };
let auth: Map<string, UsuarioAuth>;
let usuarios: Fila[];
let solicitudes: Fila[];
let registros: Map<string, Reg>;
let codigoVigente: Map<string, string | null>; // correo → código sin consumir
let envios: string[]; // correos a los que Auth «envió» un código
let enviosN: Map<string, number>;
let verifyLlamadas: number;
let errorResend: { status?: number; code?: string } | null;
let errorSignIn: { status?: number; code?: string } | null;
let verifyConfirmaSinMarcar: boolean; // simula un cliente mentiroso: verifyOtp «ok» pero Auth NO confirma
let falloInsertSolicitud: boolean; // completar falla sin efecto (transacción revertida)
let falloRpc: Set<string>; // funciones registro_b2b_* que fallan de forma transitoria
let falloGetUser: boolean;
let deleteUserLlamadas: number; // la capa de aplicación NO debe borrar cuentas de Auth: lo hace la base (atómico)
let verifyPierdeRespuesta: boolean; // Auth SÍ aplica la verificación, pero la respuesta se pierde (resultado desconocido, sin status)
let verifyErrorStatus: number | null; // Auth responde con este status SIN aplicar nada (p. ej. 502)
let compuertaVerify: Promise<void> | null; // si existe, verifyOtp espera aquí (mantiene un intento «en vuelo»)
let enVerify: (() => void) | null;
let rpcLlamadas: string[];
let seq = 0;
const ceder = () => new Promise<void>((r) => setImmediate(r));
const VENCIMIENTO_MS = 120_000;

function tabla(nombre: string) {
  const filas = () => (nombre === "usuarios" ? usuarios : nombre === "b2b_solicitudes" ? solicitudes : (() => { throw new Error("tabla inesperada " + nombre); })());
  const filtros: Array<(f: Fila) => boolean> = [];
  let modo: "select" | "update" = "select";
  let cambios: Fila = {};
  const aplicar = () => filas().filter((f) => filtros.every((p) => p(f)));
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return api; },
    neq: (c: string, v: unknown) => { filtros.push((f) => f[c] !== v); return api; },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return api; },
    ilike: (c: string, v: string) => { filtros.push((f) => String(f[c] ?? "").toLowerCase() === v.toLowerCase()); return api; },
    limit: () => api,
    update: (p: Fila) => { modo = "update"; cambios = p; return api; },
    maybeSingle: async () => ({ data: aplicar()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const filasAfectadas = aplicar();
      if (modo === "update") filasAfectadas.forEach((f) => Object.assign(f, cambios));
      return Promise.resolve({ data: filasAfectadas.map((f) => ({ ...f })), error: null }).then(ok, ko);
    },
  };
  return api;
}

/** Réplica de las funciones de la migración 324. Cada llamada cede el turno al entrar y luego se ejecuta SIN pausas (atómica), igual que bajo el candado de fila. */
async function rpc(fn: string, args: Record<string, unknown>) {
  rpcLlamadas.push(fn);
  await ceder();
  if (falloRpc.has(fn)) return { data: null, error: { message: "fallo transitorio simulado" } };
  const id = String(args.p_usuario);
  const max = typeof args.p_max === "number" ? args.p_max : 5;
  const confirmado = () => !!auth.get(id)?.confirmado;
  const ahora = Date.now();
  const asegurar = (siembra = 0): Reg => {
    if (!auth.has(id)) throw new Error("FK auth.users");
    let r = registros.get(id);
    if (!r) { const n = Math.min(Math.max(siembra, 0), max); r = { estado: "pendiente", reclamados: n, fallos: n, enVuelo: 0, ultimoReclamo: 0, datos: null }; registros.set(id, r); }
    return r;
  };
  /** delete from auth.users where id = … and email_confirmed_at is null — UNA sentencia atómica: o borra (sin verificar) o conserva (confirmada). */
  const borrarSinVerificar = (): "borrada" | "verificado" | "sin_cuenta" => {
    const u = auth.get(id);
    if (u && !u.confirmado) { auth.delete(id); usuarios = usuarios.filter((x) => x.id !== id); solicitudes = solicitudes.filter((x) => x.usuario_id !== id); registros.delete(id); return "borrada"; }
    if (u) { const r = registros.get(id); if (r && r.estado !== "completado") r.estado = "verificado"; return "verificado"; }
    return "sin_cuenta";
  };
  const ok = (data: unknown) => ({ data, error: null });
  try {
    switch (fn) {
      case "registro_b2b_iniciar": { if (!registros.has(id)) { const r = asegurar(); r.datos = (args.p_datos as Fila) ?? null; } return ok("ok"); }
      case "registro_b2b_reclamar_intento": {
        if (!auth.has(id)) return ok("sin_cuenta");
        const r = asegurar(typeof args.p_previos === "number" ? args.p_previos : 0);
        if (r.estado === "verificado" || r.estado === "completado") return ok(r.estado);
        if (confirmado()) { r.estado = "verificado"; return ok("verificado"); }
        if (r.enVuelo > 0 && r.ultimoReclamo < ahora - VENCIMIENTO_MS) { r.reclamados = Math.max(r.reclamados - r.enVuelo, r.fallos); r.enVuelo = 0; }   // se LIBERA, no se cuenta como fallo
        if (r.reclamados >= max) {
          if (r.fallos >= max) { const v = borrarSinVerificar(); return ok(v === "borrada" ? "agotado" : v === "verificado" ? "verificado" : "sin_cuenta"); }
          return ok("en_curso");
        }
        r.reclamados++; r.enVuelo++; r.ultimoReclamo = ahora;
        return ok("ok");
      }
      case "registro_b2b_resolver_intento": {
        const r = registros.get(id); if (!r) return ok("sin_registro");
        if (args.p_resultado === "exito") { r.enVuelo = Math.max(r.enVuelo - 1, 0); if (r.estado === "pendiente") r.estado = "verificado"; return ok(r.estado); }
        if (args.p_resultado === "omitido") { r.enVuelo = Math.max(r.enVuelo - 1, 0); r.reclamados = Math.max(r.reclamados - 1, 0); return ok("omitido"); }
        r.enVuelo = Math.max(r.enVuelo - 1, 0);
        if (r.estado === "verificado" || r.estado === "completado") return ok(r.estado);
        if (confirmado()) { r.estado = "verificado"; return ok("verificado"); }
        r.fallos++;
        if (r.fallos >= max) { const v = borrarSinVerificar(); return ok(v === "borrada" ? "descartada" : v === "verificado" ? "verificado" : "sin_registro"); }
        return ok("fallo");
      }
      case "registro_b2b_descartar": {
        if (!auth.has(id)) return ok("sin_cuenta");
        const r = asegurar();
        if (r.estado === "verificado" || r.estado === "completado") return ok(r.estado);
        if (r.enVuelo > 0 && r.ultimoReclamo >= ahora - VENCIMIENTO_MS) return ok("ocupado");
        return ok(borrarSinVerificar());
      }
      case "registro_b2b_permitir_reenvio": { const r = registros.get(id); return ok(auth.has(id) && (r?.estado ?? "pendiente") === "pendiente" && !confirmado()); }
      case "registro_b2b_completar": {
        if (!auth.has(id)) return ok("sin_cuenta");
        const r = asegurar();
        if (!confirmado()) return ok("sin_verificar");
        const u = usuarios.find((x) => x.id === id); const a = auth.get(id)!;
        if (!u || a.app_metadata.registro_b2b_codigo !== true || u.activo !== false || !["agencia", "freelance"].includes(String(u.rol))) return ok("no_aplica");
        if (solicitudes.some((x) => x.usuario_id === id)) { r.estado = "completado"; r.datos = null; return ok("ya_existia"); }
        if (falloInsertSolicitud) return { data: null, error: { message: "fallo simulado al insertar" } }; // la función revierte: el estado NO cambia
        const d = (r.datos ?? (args.p_datos as Fila | null) ?? {}) as Fila;
        solicitudes.push({
          tipo: u.rol, nombre: String(u.nombre ?? ""), nit: String(d.nit ?? "") || null, tipo_documento: String(d.tipo_documento ?? "") || (u.rol === "agencia" ? "NIT" : "CC"), aliado_sugerido_id: null,
          contacto: String(d.contacto ?? "") || null, email: a.email, telefono: String(d.telefono ?? "") || null, ciudad: String(d.ciudad ?? "") || null, notas: String(d.notas ?? "") || null,
          acepta_notificaciones: d.acepta_notificaciones === true, estado: "pendiente", usuario_id: id,
        });
        r.estado = "completado"; r.datos = null; return ok("creada");
      }
    }
    throw new Error("función inesperada " + fn);
  } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
}

const adminFalso = {
  from: (t: string) => tabla(t),
  rpc,
  auth: {
    admin: {
      createUser: async (a: { email: string; password: string; email_confirm: boolean; user_metadata: Fila; app_metadata: Fila }) => {
        if ([...auth.values()].some((u) => u.email === a.email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
        const id = `u-${++seq}`;
        auth.set(id, { id, email: a.email, password: a.password, confirmado: a.email_confirm === true, app_metadata: a.app_metadata ?? {}, user_metadata: a.user_metadata ?? {} });
        usuarios.push({ id, email: a.email, rol: "agencia", nombre: String(a.user_metadata?.nombre ?? ""), activo: false }); // el trigger de la 193 crea el perfil inactivo
        return { data: { user: { id } }, error: null };
      },
      getUserById: async (id: string) => {
        if (falloGetUser) return { data: { user: null }, error: { message: "fallo transitorio de Auth" } };
        const u = auth.get(id);
        return u ? { data: { user: { id, app_metadata: u.app_metadata, user_metadata: u.user_metadata, email_confirmed_at: u.confirmado ? "2026-11-20T10:00:00Z" : null } }, error: null } : { data: { user: null }, error: null };
      },
      deleteUser: async (id: string) => {
        deleteUserLlamadas++;
        auth.delete(id);
        usuarios = usuarios.filter((x) => x.id !== id);
        solicitudes = solicitudes.filter((x) => x.usuario_id !== id);
        registros.delete(id); // ON DELETE CASCADE
        return { data: {}, error: null };
      },
    },
  },
};
const sinSesionFalso = {
  auth: {
    resend: async (a: { type: string; email: string }) => {
      assert.equal(a.type, "signup");
      if (errorResend) return { error: errorResend };
      envios.push(a.email);
      const n = enviosN.get(a.email) ?? 0; enviosN.set(a.email, n + 1);
      codigoVigente.set(a.email, String(123456 + n));   // cada envío invalida el anterior (como Auth): el primero es 123456, el segundo 123457…
      return { error: null };
    },
    verifyOtp: async (a: { email: string; token: string; type: string }) => {
      verifyLlamadas++;
      assert.equal(a.type, "signup");
      if (compuertaVerify) { enVerify?.(); await compuertaVerify; } else await ceder();
      if (verifyErrorStatus !== null) return { error: { status: verifyErrorStatus, message: "Bad gateway" } };           // Auth no aplicó nada; resultado desconocido para la app
      const existe = [...auth.values()].some((u) => u.email === a.email);                                              // una verificación tardía de una cuenta ya borrada NO la resucita
      if (!existe || codigoVigente.get(a.email) !== a.token) return { error: { status: 403, message: "Token has expired or is invalid" } };
      codigoVigente.set(a.email, null); // se consume UNA vez
      if (!verifyConfirmaSinMarcar) for (const u of auth.values()) if (u.email === a.email) u.confirmado = true;
      if (verifyPierdeRespuesta) return { error: { message: "fetch failed" } };                                        // Auth SÍ confirmó; la respuesta se perdió (sin status)
      return { error: null };
    },
    signInWithPassword: async (a: { email: string; password: string }) => {
      await ceder();
      if (errorSignIn) return { data: { user: null }, error: errorSignIn };
      const u = [...auth.values()].find((x) => x.email === a.email);
      if (!u || u.password !== a.password) return { data: { user: null }, error: { status: 400, code: "invalid_credentials" } };
      if (!u.confirmado) return { data: { user: null }, error: { status: 400, code: "email_not_confirmed" } };
      return { data: { user: { id: u.id } }, error: null };
    },
  },
};
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => adminFalso } });
mock.module("@/lib/supabase/sinSesion", { namedExports: { createClienteSinSesion: () => sinSesionFalso } });

const { iniciarRegistroB2B, confirmarCodigoYSolicitarB2B, reenviarCodigoB2B, continuarRegistroB2B } = await import("../app/portal/registro/actions.ts");

const form = (extra: Record<string, unknown> = {}) => ({
  tipo: "agencia", tipoDocumento: "NIT", nombre: "Viajes Prueba SAS", nit: "900123456", contacto: "Ana", email: "Ana@Agencia.com ", telefono: "3000000000",
  ciudad: "Medellín", notas: "", aceptaNotificaciones: true, password: "secreta123", passwordConfirm: "secreta123", ...extra,
});
const datos = (extra: Record<string, unknown> = {}, codigo = "123456") => { const { password: _p, passwordConfirm: _c, ...d } = form(extra); return { ...d, codigo }; };
const cuenta = (email = "ana@agencia.com") => [...auth.values()].find((u) => u.email === email);
const reg = (email = "ana@agencia.com") => registros.get(cuenta(email)!.id)!;
const INVALIDO = "El código no es válido o ya venció. Revisa el correo o pide uno nuevo.";
const msgDe = (r: { ok: boolean; error?: string }) => (r.ok ? "" : (r.error as string));
async function malos(n: number) { for (let i = 0; i < n; i++) await confirmarCodigoYSolicitarB2B(datos({}, "000000")); }

beforeEach(() => {
  auth = new Map(); usuarios = []; solicitudes = []; registros = new Map(); codigoVigente = new Map(); envios = []; enviosN = new Map(); verifyLlamadas = 0; rpcLlamadas = [];
  errorResend = null; errorSignIn = null; verifyConfirmaSinMarcar = false; falloInsertSolicitud = false; falloRpc = new Set(); falloGetUser = false;
  deleteUserLlamadas = 0; verifyPierdeRespuesta = false; verifyErrorStatus = null;
  compuertaVerify = null; enVerify = null; seq = 0;
});

describe("paso 1: iniciar el registro", () => {
  test("crea la cuenta SIN verificar e inactiva, guarda el estado coordinado, manda el código y NO crea todavía la solicitud", async () => {
    assert.deepEqual(await iniciarRegistroB2B(form()), { ok: true });
    const c = cuenta()!;
    assert.equal(c.confirmado, false);
    assert.deepEqual(c.app_metadata, { registro_b2b_codigo: true, intentos_codigo: 0 });
    assert.equal(usuarios[0].activo, false);
    assert.deepEqual(envios, ["ana@agencia.com"]);
    assert.equal(solicitudes.length, 0, "sin código verificado no existe solicitud de aprobación");
    assert.deepEqual([reg().estado, reg().reclamados, reg().fallos, reg().enVuelo], ["pendiente", 0, 0, 0]);
    assert.equal((reg().datos as Fila).nit, "900123456", "los datos del formulario los guarda el servidor (sin contraseña)");
    assert.ok(!JSON.stringify(reg().datos).includes("secreta123"));
  });

  test("#76 código de referido opcional: se guarda como CANDIDATO normalizado en los datos del servidor; uno con formato inválido se rechaza antes de crear la cuenta", async () => {
    const mala = await iniciarRegistroB2B({ ...form(), codigoReferido: "a b" });
    assert.equal(mala.ok, false); assert.match(msgDe(mala), /El código de referido usa de 4 a 20/);
    assert.equal(auth.size, 0, "no se creó ninguna cuenta"); assert.deepEqual(envios, []);
    assert.deepEqual(await iniciarRegistroB2B({ ...form(), codigoReferido: "  odair-2 " }), { ok: true });
    assert.equal((reg().datos as Fila).codigo_referido, "ODAIR-2", "texto normalizado; nunca referidor ni porcentaje");
    assert.ok(!JSON.stringify(reg().datos).match(/referidor|pct/i));
  });

  test("#76 sin código: no se guarda ninguno (cadena vacía) y el registro sigue igual", async () => {
    assert.deepEqual(await iniciarRegistroB2B(form()), { ok: true });
    assert.equal((reg().datos as Fila).codigo_referido, "");
  });

  test("si el código no se puede enviar, la cuenta no queda a medias; el límite de envíos de Auth se explica", async () => {
    errorResend = { status: 429, code: "over_email_send_rate_limit" };
    const r = await iniciarRegistroB2B(form());
    assert.equal(r.ok, false);
    assert.match(msgDe(r), /Espera un momento/);
    assert.equal(auth.size, 0);
    assert.equal(usuarios.length, 0);
    assert.equal(registros.size, 0);
  });

  test("si no se puede guardar el estado coordinado, la cuenta nueva se descarta (falla cerrado) y no se envía código", async () => {
    falloRpc.add("registro_b2b_iniciar");
    const r = await iniciarRegistroB2B(form());
    assert.equal(r.ok, false);
    assert.equal(auth.size, 0);
    assert.deepEqual(envios, []);
  });

  test("un intento ABANDONADO se reemplaza (reintentar con el mismo correo y nombre); una cuenta ya existente se respeta", async () => {
    await iniciarRegistroB2B(form());
    const primero = cuenta()!.id;
    assert.deepEqual(await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" })), { ok: true });
    assert.notEqual(cuenta()!.id, primero);
    assert.equal(auth.size, 1);
    assert.equal(registros.has(primero), false, "el estado del intento anterior cae con su cuenta");

    // Cuenta antigua/aprobada: confirmada, activa, sin marcador → intacta y con el mensaje de siempre.
    auth.set("viejo", { id: "viejo", email: "vieja@agencia.com", password: "x", confirmado: true, app_metadata: {}, user_metadata: {} });
    usuarios.push({ id: "viejo", email: "vieja@agencia.com", rol: "agencia", nombre: "Otra Agencia", activo: true });
    const r = await iniciarRegistroB2B(form({ email: "vieja@agencia.com", nombre: "Nueva Agencia" }));
    assert.deepEqual(r, { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." });
    assert.ok(auth.has("viejo"), "la cuenta existente no se borra");
  });

  test("un marcador falsificado en user_metadata (lo único que el usuario puede escribir) NO hace borrable una cuenta", async () => {
    auth.set("viejo", { id: "viejo", email: "vieja@agencia.com", password: "x", confirmado: false, app_metadata: {}, user_metadata: { registro_b2b_codigo: true } });
    usuarios.push({ id: "viejo", email: "vieja@agencia.com", rol: "agencia", nombre: "Otra Agencia", activo: false });
    const r = await iniciarRegistroB2B(form({ email: "vieja@agencia.com", nombre: "Nueva Agencia" }));
    assert.equal(r.ok, false);
    assert.ok(auth.has("viejo"));
  });
});

describe("paso 2: código y solicitud", () => {
  test("flujo completo: con el código correcto el correo queda verificado y recién ahí nace la solicitud pendiente; la cuenta sigue inactiva", async () => {
    await iniciarRegistroB2B(form());
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    assert.equal(cuenta()!.confirmado, true);
    assert.equal(solicitudes.length, 1);
    const s = solicitudes[0];
    assert.deepEqual([s.estado, s.email, s.tipo, s.usuario_id, s.nit], ["pendiente", "ana@agencia.com", "agencia", cuenta()!.id, "900123456"]);
    assert.equal(usuarios[0].activo, false, "aprobar sigue siendo trabajo del personal interno");
    assert.equal(reg().estado, "completado");
  });

  test("código incorrecto: sin solicitud, intentos contados en el SERVIDOR DE DATOS; al agotarlos el registro sin verificar se descarta (hay que pedir un código nuevo)", async () => {
    await iniciarRegistroB2B(form());
    for (let i = 1; i <= 4; i++) {
      const r = await confirmarCodigoYSolicitarB2B(datos({}, "000000"));
      assert.deepEqual(r, { ok: false, error: INVALIDO });
      assert.equal(reg().fallos, i);
      assert.equal(cuenta()!.app_metadata.intentos_codigo, 0, "el contador ya no vive en app_metadata (leer-sumar-escribir)");
    }
    const ultimo = await confirmarCodigoYSolicitarB2B(datos({}, "000000"));
    assert.match(msgDe(ultimo), /Superaste los intentos/);
    assert.equal(cuenta(), undefined, "cuenta sin verificar descartada");
    assert.equal(solicitudes.length, 0);
    // El código bueno ya no sirve: la cuenta no existe.
    assert.equal((await confirmarCodigoYSolicitarB2B(datos())).ok, false);
    assert.equal(solicitudes.length, 0);
  });

  test("código con forma inválida: ni siquiera se consulta a Auth ni a la base ni se cuenta un intento", async () => {
    await iniciarRegistroB2B(form());
    rpcLlamadas = [];
    for (const c of ["", "12ab56", "123", "1".repeat(20)]) assert.equal((await confirmarCodigoYSolicitarB2B(datos({}, c))).ok, false);
    assert.equal(verifyLlamadas, 0);
    assert.deepEqual(rpcLlamadas, []);
    assert.equal(reg().reclamados, 0);
  });

  test("la autoridad es Auth: si verifyOtp «acepta» pero la cuenta NO queda con email_confirmed_at, no hay solicitud y la cuenta no se borra", async () => {
    await iniciarRegistroB2B(form());
    verifyConfirmaSinMarcar = true;
    assert.equal((await confirmarCodigoYSolicitarB2B(datos())).ok, false);
    assert.equal(solicitudes.length, 0);
    assert.ok(cuenta());
  });

  test("repetición y concurrencia: con el mismo código válido enviado dos veces a la vez, exactamente UNA solicitud y la cuenta intacta", async () => {
    await iniciarRegistroB2B(form());
    const [a, b] = await Promise.all([confirmarCodigoYSolicitarB2B(datos()), confirmarCodigoYSolicitarB2B(datos())]);
    assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
    assert.equal(solicitudes.length, 1);
    assert.ok(cuenta());
    // Reenviar la misma petición después: el registro ya tiene solicitud → respuesta genérica, nada nuevo.
    assert.equal((await confirmarCodigoYSolicitarB2B(datos())).ok, false);
    assert.equal(solicitudes.length, 1);
  });

  test("no enumera cuentas: correo desconocido, cuenta antigua y cuenta aprobada responden igual que un código malo, sin llamar a Auth ni a la base", async () => {
    auth.set("viejo", { id: "viejo", email: "vieja@agencia.com", password: "x", confirmado: true, app_metadata: {}, user_metadata: {} });
    usuarios.push({ id: "viejo", email: "vieja@agencia.com", rol: "agencia", nombre: "Otra Agencia", activo: true });
    const esperado = { ok: false, error: INVALIDO };
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos({ email: "nadie@x.com" })), esperado);
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos({ email: "vieja@agencia.com" })), esperado);
    assert.equal(verifyLlamadas, 0);
    assert.deepEqual(rpcLlamadas, []);
    assert.equal(auth.get("viejo")!.app_metadata.intentos_codigo, undefined, "no se tocan cuentas ajenas");
  });

  test("el tipo y el nombre de la solicitud salen de la cuenta creada en el paso 1, no de lo que mande el navegador en el paso 2", async () => {
    await iniciarRegistroB2B(form({ tipo: "freelance", tipoDocumento: "CC" }));
    usuarios[0].rol = "freelance";
    await confirmarCodigoYSolicitarB2B(datos({ tipo: "agencia", nombre: "Otro Nombre" }));
    assert.deepEqual([solicitudes[0].tipo, solicitudes[0].nombre], ["freelance", "Viajes Prueba SAS"]);
  });

  test("cuenta anterior a la 324 (sin fila de estado): el contador viejo de app_metadata se respeta como semilla (3 fallos previos → 2 intentos más)", async () => {
    auth.set("u-v", { id: "u-v", email: "ana@agencia.com", password: "x", confirmado: false, app_metadata: { registro_b2b_codigo: true, intentos_codigo: 3 }, user_metadata: {} });
    usuarios.push({ id: "u-v", email: "ana@agencia.com", rol: "agencia", nombre: "Viajes Prueba SAS", activo: false });
    codigoVigente.set("ana@agencia.com", "123456");
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos({}, "000000")), { ok: false, error: INVALIDO });
    assert.match(msgDe(await confirmarCodigoYSolicitarB2B(datos({}, "000000"))), /Superaste los intentos/);
    assert.equal(cuenta(), undefined);
  });
});

describe("B5 — serialización: un intento incorrecto, un reinicio o una limpieza NUNCA borran una cuenta verificada", () => {
  test("reproducción de Codex: 4 incorrectos y luego el código correcto y un incorrecto A LA VEZ → la cuenta verificada y su solicitud sobreviven (ambos órdenes)", async () => {
    for (const ordenCorrectoPrimero of [true, false]) {
      auth = new Map(); usuarios = []; solicitudes = []; registros = new Map(); codigoVigente = new Map(); envios = []; enviosN = new Map(); seq = 0;
      await iniciarRegistroB2B(form());
      await malos(4);
      const correcto = confirmarCodigoYSolicitarB2B(datos());
      const incorrecto = confirmarCodigoYSolicitarB2B(datos({}, "000000"));
      const [a, b] = ordenCorrectoPrimero ? await Promise.all([correcto, incorrecto]) : (await Promise.all([incorrecto, correcto])).reverse();
      assert.equal(a.ok, true, "el código correcto registra la solicitud");
      assert.equal(b.ok, false);
      assert.ok(cuenta(), "la cuenta verificada NO se borra");
      assert.equal(solicitudes.length, 1);
      assert.equal(solicitudes[0].usuario_id, cuenta()!.id);
      assert.notEqual(reg().estado, "pendiente");
    }
  });

  test("entrelazado forzado: el quinto intento correcto está en vuelo; uno incorrecto simultáneo NO verifica ni borra («en curso») y el correcto termina bien", async () => {
    await iniciarRegistroB2B(form());
    await malos(4);
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const correcto = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;                                           // el intento correcto ya reservó su cupo y espera a Auth
    const llamadasAntes = verifyLlamadas;
    const incorrecto = await confirmarCodigoYSolicitarB2B(datos({}, "000000"));
    assert.match(msgDe(incorrecto), /otro intento/);
    assert.equal(verifyLlamadas, llamadasAntes, "el sobrante no llama a Auth: no cuenta como intento");
    compuertaVerify = null; soltar();
    assert.deepEqual(await correcto, { ok: true });
    assert.ok(cuenta());
    assert.equal(solicitudes.length, 1);
  });

  test("entrelazado forzado: el reinicio del registro con una verificación EN VUELO no borra nada («ocupado»); al terminar, la cuenta verificada y su solicitud siguen", async () => {
    await iniciarRegistroB2B(form());
    const id = cuenta()!.id;
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const correcto = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;
    const reinicio = await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }));
    assert.equal(reinicio.ok, false);
    assert.match(msgDe(reinicio), /otro intento/);
    assert.equal(cuenta()!.id, id, "la cuenta original sigue ahí");
    compuertaVerify = null; soltar();
    assert.deepEqual(await correcto, { ok: true });
    assert.equal(solicitudes.length, 1);
    assert.equal(cuenta()!.id, id);
  });

  test("reinicio sobre una cuenta ya VERIFICADA sin solicitud: no se borra ni se reemplaza; se indica continuar con la contraseña", async () => {
    await iniciarRegistroB2B(form());
    falloRpc.add("registro_b2b_completar");
    await confirmarCodigoYSolicitarB2B(datos());        // verificó, pero no pudo completar
    falloRpc.clear();
    const id = cuenta()!.id;
    const r = await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }));
    assert.equal(r.ok, false);
    assert.equal((r as { continuar?: boolean }).continuar, true);
    assert.equal(cuenta()!.id, id);
    assert.equal(cuenta()!.password, "secreta123", "la contraseña original no se pisa");
  });

  test("ráfaga: 7 códigos incorrectos simultáneos → a lo sumo 5 llegan a Auth, la cuenta sin verificar se descarta UNA vez y no queda ninguna solicitud", async () => {
    await iniciarRegistroB2B(form());
    const rs = await Promise.all(Array.from({ length: 7 }, () => confirmarCodigoYSolicitarB2B(datos({}, "000000"))));
    assert.ok(rs.every((r) => !r.ok));
    assert.ok(verifyLlamadas <= 5, `llamadas a Auth: ${verifyLlamadas}`);
    assert.equal(cuenta(), undefined);
    assert.equal(solicitudes.length, 0);
  });

  test("tras verificarse y completarse, ninguna avalancha de códigos incorrectos borra la cuenta ni la solicitud", async () => {
    await iniciarRegistroB2B(form());
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    const rs = await Promise.all(Array.from({ length: 8 }, () => confirmarCodigoYSolicitarB2B(datos({}, "000000"))));
    assert.ok(rs.every((r) => !r.ok));
    assert.ok(cuenta());
    assert.equal(solicitudes.length, 1);
  });

  test("tras agotarse los intentos, un intento que ya estaba en vuelo y resulta correcto NO borra la cuenta verificada (Auth confirmó primero)", async () => {
    await iniciarRegistroB2B(form());
    await malos(4);
    // El 5.º intento reservado confirma el correo en Auth y recién entonces llega una limpieza por agotamiento.
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const correcto = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;
    compuertaVerify = null; soltar();
    await correcto;
    const extra = await confirmarCodigoYSolicitarB2B(datos({}, "000000"));
    assert.equal(extra.ok, false);
    assert.ok(cuenta());
    assert.equal(solicitudes.length, 1);
  });

  test("el reenvío no actúa sobre cuentas verificadas ni sobre cuentas ya borradas por el reinicio", async () => {
    await iniciarRegistroB2B(form());
    envios.length = 0;
    cuenta()!.confirmado = true;
    assert.deepEqual(await reenviarCodigoB2B("ana@agencia.com"), { ok: true });
    assert.deepEqual(envios, []);
  });
});

describe("B5 residual — verificación TARDÍA de Auth, resultado desconocido y proceso interrumpido: el tiempo nunca autoriza borrar", () => {
  const envejecer = (email = "ana@agencia.com") => { reg(email).ultimoReclamo = Date.now() - 3 * 60_000; };   // reloj lógico: la reserva «venció» (no se espera tiempo real)

  test("reproducción de Codex: una verificación en vuelo VENCE, el registro se reinicia y la verificación original completa tarde → ninguna cuenta confirmada se borra; el reinicio no usa deleteUser", async () => {
    await iniciarRegistroB2B(form());
    const viejo = cuenta()!.id;
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const tardia = confirmarCodigoYSolicitarB2B(datos());       // la petición a Auth queda «en vuelo» y se demora
    await llegoAVerify;
    envejecer();                                                // pasan >2 minutos: la reserva se considera vencida
    compuertaVerify = null;
    const reinicio = await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }));
    assert.deepEqual(reinicio, { ok: true }, "la reserva vencida no bloquea el reinicio");
    assert.equal(deleteUserLlamadas, 0, "el borrado lo hizo la base (atómico), no la aplicación");
    assert.equal(auth.has(viejo), false, "la cuenta ORIGINAL sin verificar se descartó antes de que Auth la confirmara");
    const nuevo = cuenta()!;
    assert.notEqual(nuevo.id, viejo);
    soltar();                                                   // la verificación original llega tarde: la cuenta ya no existe
    const r = await tardia;
    assert.equal(r.ok, false);
    assert.match(msgDe(r), /no es válido/);
    assert.equal(auth.get(nuevo.id)!.confirmado, false, "la cuenta nueva no se confirmó con un código ajeno");
    assert.equal(solicitudes.length, 0);
    assert.equal(reg().estado, "pendiente", "el estado de la cuenta NUEVA no se contaminó con el resultado tardío (ni fallos, ni verificado)");
    assert.equal(reg().fallos, 0);
    // y el registro nuevo avanza normalmente con su propio código
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos({}, "123457")), { ok: true });   // el reinicio mandó un código NUEVO (123457); el viejo ya no vale
    assert.equal(solicitudes.length, 1);
    assert.equal(solicitudes[0].usuario_id, nuevo.id);
  });

  test("la verificación tardía gana: confirma ANTES de que el reinicio ejecute el descarte → el reinicio NO borra (se conserva y se continúa con la contraseña)", async () => {
    await iniciarRegistroB2B(form());
    const id = cuenta()!.id;
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const tardia = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;
    envejecer();
    falloRpc.add("registro_b2b_resolver_intento"); falloRpc.add("registro_b2b_completar");   // la app no llega a anotar ni a completar
    compuertaVerify = null; soltar();
    const r = await tardia;
    assert.equal((r as { continuar?: boolean }).continuar, true, "Auth confirmó pero no se pudo completar: se pide continuar");
    falloRpc.clear();
    const reinicio = await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }));
    assert.equal((reinicio as { continuar?: boolean }).continuar, true);
    assert.equal(cuenta()!.id, id, "la cuenta confirmada tarde NO se reemplazó ni se borró");
    assert.equal(deleteUserLlamadas, 0);
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" }), { ok: true });
    assert.equal(solicitudes.length, 1);
  });

  test("resultado DESCONOCIDO con Auth que SÍ confirmó (la respuesta se pierde): no cuenta como intento fallido y el registro se completa preguntando a la base", async () => {
    await iniciarRegistroB2B(form());
    verifyPierdeRespuesta = true;
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    assert.equal(cuenta()!.confirmado, true);
    assert.equal(solicitudes.length, 1);
    assert.equal(reg().fallos, 0, "un resultado desconocido no se anota como rechazo");
    assert.equal(deleteUserLlamadas, 0);
  });

  test("resultado DESCONOCIDO con Auth que NO aplicó nada (5xx, corte): no cuenta, no borra y se puede reintentar; cinco así NO agotan el registro", async () => {
    await iniciarRegistroB2B(form());
    verifyErrorStatus = 502;
    for (let i = 0; i < 6; i++) {
      const r = await confirmarCodigoYSolicitarB2B(datos());
      assert.equal(r.ok, false);
      assert.match(msgDe(r), /No pudimos procesar/);
    }
    assert.equal(reg().fallos, 0);
    assert.equal(reg().enVuelo, 0, "cada reserva se liberó");
    assert.ok(cuenta());
    verifyErrorStatus = null;
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    assert.equal(solicitudes.length, 1);
  });

  test("solo un rechazo DEFINITIVO (4xx) cuenta: cinco rechazos reales agotan el registro SIN verificar y la base lo borra en esa misma llamada", async () => {
    await iniciarRegistroB2B(form());
    await malos(5);
    assert.equal(cuenta(), undefined);
    assert.equal(deleteUserLlamadas, 0);
    assert.equal(registros.size, 0);
  });

  test("proceso INTERRUMPIDO: una reserva que nunca se resolvió se libera pasado el tiempo SIN contarse como fallo (no atasca ni agota); la cuenta sigue y verifica", async () => {
    await iniciarRegistroB2B(form());
    const id = cuenta()!.id;
    await malos(4);
    const huerfano = await rpc("registro_b2b_reclamar_intento", { p_usuario: id, p_max: 5 });   // el proceso murió justo después de reservar el quinto cupo
    assert.equal(huerfano.data, "ok");
    const enCurso = await confirmarCodigoYSolicitarB2B(datos());
    assert.match(msgDe(enCurso), /otro intento/, "mientras la reserva es reciente se espera");
    envejecer();
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true }, "vencida: el cupo se libera y el código correcto verifica");
    assert.equal(solicitudes.length, 1);
    assert.ok(cuenta());
  });

  test("proceso interrumpido y reinicio: sin verificación tardía el reinicio SÍ reemplaza la cuenta sin verificar (no queda atascada)", async () => {
    await iniciarRegistroB2B(form());
    const id = cuenta()!.id;
    await rpc("registro_b2b_reclamar_intento", { p_usuario: id, p_max: 5 });
    envejecer();
    assert.deepEqual(await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" })), { ok: true });
    assert.notEqual(cuenta()!.id, id);
    assert.equal(deleteUserLlamadas, 0);
  });

  test("reinicio con una verificación RECIENTE en vuelo sigue esperando («otro intento»): es cortesía de liveness, ya no es la barrera de seguridad", async () => {
    await iniciarRegistroB2B(form());
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const viva = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;
    const reinicio = await iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }));
    assert.equal(reinicio.ok, false);
    compuertaVerify = null; soltar();
    assert.deepEqual(await viva, { ok: true });
  });

  test("reenvío concurrente con una verificación tardía: nunca borra ni resucita nada", async () => {
    await iniciarRegistroB2B(form());
    let soltar!: () => void; compuertaVerify = new Promise<void>((r) => { soltar = r; });
    const llegoAVerify = new Promise<void>((r) => { enVerify = r; });
    const tardia = confirmarCodigoYSolicitarB2B(datos());
    await llegoAVerify;
    envejecer();
    compuertaVerify = null;
    const [reenvio, reinicio] = await Promise.all([reenviarCodigoB2B("ana@agencia.com"), iniciarRegistroB2B(form({ password: "otraClave1", passwordConfirm: "otraClave1" }))]);
    soltar();
    await tardia;
    assert.equal(deleteUserLlamadas, 0);
    assert.ok(cuenta(), "siempre queda exactamente una cuenta para ese correo");
    assert.equal([...auth.values()].filter((u) => u.email === "ana@agencia.com").length, 1);
    void reinicio;
  });

  test("cableado: la capa de aplicación del registro NO contiene ninguna llamada a deleteUser (solo la base elimina cuentas, de forma atómica)", () => {
    const fuente = readFileSync(new URL("../app/portal/registro/actions.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(fuente, /\.deleteUser\(/);
    assert.match(fuente, /registro_b2b_descartar/);
  });
});

describe("B6 — un fallo posterior a la verificación no deja el registro varado; se continúa con correo + contraseña", () => {
  test("reproducción de Codex: verifyOtp confirma y la lectura posterior de Auth falla de forma transitoria → ya NO responde «código inválido» y la solicitud se crea", async () => {
    await iniciarRegistroB2B(form());
    // La acción ya no depende de una segunda lectura de Auth: aunque getUserById falle justo después del código, la verificación la revalida la base.
    const original = adminFalso.auth.admin.getUserById;
    let llamadas = 0;
    adminFalso.auth.admin.getUserById = async (id: string) => { llamadas++; return llamadas > 1 ? { data: { user: null }, error: { message: "fallo transitorio de Auth" } } : original(id); };
    try {
      assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    } finally { adminFalso.auth.admin.getUserById = original; }
    assert.equal(solicitudes.length, 1);
    assert.ok(cuenta());
  });

  test("si falla la anotación del intento exitoso, igual se completa (la base revalida con Auth)", async () => {
    await iniciarRegistroB2B(form());
    falloRpc.add("registro_b2b_resolver_intento");
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });
    assert.equal(solicitudes.length, 1);
  });

  test("si falla la creación de la solicitud DESPUÉS de verificar: la cuenta verificada se CONSERVA, se pide continuar, y el mismo correo ya no dice «ya existe»", async () => {
    await iniciarRegistroB2B(form());
    falloInsertSolicitud = true;
    const r = await confirmarCodigoYSolicitarB2B(datos());
    assert.equal(r.ok, false);
    assert.equal((r as { continuar?: boolean }).continuar, true);
    assert.match(msgDe(r), /contraseña/);
    assert.ok(cuenta(), "NO se borra la cuenta verificada (antes se descartaba)");
    assert.equal(cuenta()!.confirmado, true);
    assert.equal(solicitudes.length, 0);
    // Reintentar el paso 1 o el paso 2 con ese correo lleva a continuar, no a «Inicia sesión» ni a reiniciar.
    const otra = await iniciarRegistroB2B(form());
    assert.equal((otra as { continuar?: boolean }).continuar, true);
    const paso2 = await confirmarCodigoYSolicitarB2B(datos());
    assert.equal((paso2 as { continuar?: boolean }).continuar, true);
  });

  test("continuar con correo + contraseña correctos completa el registro; repetirlo (respuesta perdida, doble clic) NO duplica la solicitud", async () => {
    await iniciarRegistroB2B(form());
    falloInsertSolicitud = true;
    await confirmarCodigoYSolicitarB2B(datos());
    falloInsertSolicitud = false;
    assert.deepEqual(await continuarRegistroB2B({ email: "ANA@agencia.com", password: "secreta123" }), { ok: true });
    assert.equal(solicitudes.length, 1);
    assert.equal(solicitudes[0].nit, "900123456", "usa los datos que guardó el servidor en el paso 1");
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" }), { ok: true });
    const rs = await Promise.all([1, 2, 3, 4].map(() => continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" })));
    assert.ok(rs.every((r) => r.ok));
    assert.equal(solicitudes.length, 1);
    assert.ok(cuenta());
  });

  test("saber el correo NO autoriza: contraseña equivocada, vacía o de otra cuenta → no se crea nada y no se revela cuál falló", async () => {
    await iniciarRegistroB2B(form());
    falloInsertSolicitud = true;
    await confirmarCodigoYSolicitarB2B(datos());
    falloInsertSolicitud = false;
    const rechazo = { ok: false, error: "No pudimos confirmar tu identidad. Revisa el correo y la contraseña de tu registro (el correo debe estar verificado)." };
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "incorrecta" }), rechazo);
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "" }), rechazo);
    assert.deepEqual(await continuarRegistroB2B({ email: "", password: "secreta123" }), rechazo);
    assert.deepEqual(await continuarRegistroB2B({ email: "nadie@x.com", password: "secreta123" }), rechazo);
    assert.equal(solicitudes.length, 0);
  });

  test("continuar con el correo SIN verificar (el código nunca se aceptó) no completa nada: Auth rechaza el inicio de sesión", async () => {
    await iniciarRegistroB2B(form());
    assert.equal((await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" })).ok, false);
    assert.equal(solicitudes.length, 0);
    assert.ok(cuenta());
    assert.equal(reg().estado, "pendiente");
  });

  test("continuar sobre una cuenta que NO es de este flujo (aprobada/antigua) no crea solicitud", async () => {
    auth.set("viejo", { id: "viejo", email: "vieja@agencia.com", password: "clave123", confirmado: true, app_metadata: {}, user_metadata: {} });
    usuarios.push({ id: "viejo", email: "vieja@agencia.com", rol: "agencia", nombre: "Otra Agencia", activo: true });
    const r = await continuarRegistroB2B({ email: "vieja@agencia.com", password: "clave123" });
    assert.deepEqual(r, { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." });
    assert.equal(solicitudes.length, 0);
    assert.ok(auth.has("viejo"));
  });

  test("el límite de frecuencia del inicio de sesión se muestra como espera", async () => {
    await iniciarRegistroB2B(form());
    errorSignIn = { status: 429, code: "over_request_rate_limit" };
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" }), { ok: false, error: "Espera un momento antes de pedir otro código." });
  });

  test("fallo transitorio de la base al completar: se puede reintentar hasta que funcione, sin borrar y sin duplicar", async () => {
    await iniciarRegistroB2B(form());
    falloRpc.add("registro_b2b_completar");
    const r1 = await confirmarCodigoYSolicitarB2B(datos());
    assert.equal((r1 as { continuar?: boolean }).continuar, true);
    const r2 = await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" });
    assert.equal((r2 as { continuar?: boolean }).continuar, true);
    assert.equal(solicitudes.length, 0);
    falloRpc.clear();
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" }), { ok: true });
    assert.equal(solicitudes.length, 1);
    assert.ok(cuenta());
  });

  test("respuesta interrumpida: la solicitud se creó pero el navegador no lo supo; continuar responde ok sin duplicar", async () => {
    await iniciarRegistroB2B(form());
    assert.deepEqual(await confirmarCodigoYSolicitarB2B(datos()), { ok: true });   // «respuesta perdida»
    assert.deepEqual(await continuarRegistroB2B({ email: "ana@agencia.com", password: "secreta123" }), { ok: true });
    assert.equal(solicitudes.length, 1);
  });
});

describe("reenvío", () => {
  test("reenvía solo a registros pendientes y responde igual (ok) para correos desconocidos, sin enviar nada", async () => {
    assert.deepEqual(await reenviarCodigoB2B("nadie@x.com"), { ok: true });
    assert.deepEqual(envios, []);
    await iniciarRegistroB2B(form());
    envios.length = 0;
    assert.deepEqual(await reenviarCodigoB2B("ANA@agencia.com"), { ok: true });
    assert.deepEqual(envios, ["ana@agencia.com"]);
  });
  test("el límite de frecuencia de Auth se muestra como espera, no como éxito", async () => {
    await iniciarRegistroB2B(form());
    errorResend = { status: 429 };
    assert.deepEqual(await reenviarCodigoB2B("ana@agencia.com"), { ok: false, error: "Espera un momento antes de pedir otro código." });
  });
});
