// #32 (bloque Portal B2B, ADL-039) — Logo del aliado en SUS cotizaciones.
// Acciones y rutas REALES con Supabase simulado en la frontera (base + storage); el candado de la base se prueba aparte en test_319_aliado_logo.sql.
// Lo que se demuestra: el tipo se valida por bytes; el aliado sale de la sesión/cotización (nunca de la URL ni del formulario); A no toca ni lee lo de B;
// el logo solo sale por rutas que autorizan y sin caché compartida.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { createHash } from "node:crypto";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

type Fila = Record<string, unknown>;
const PNG = (relleno = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, relleno, 1, 2, 3]);
const JPG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const SVG = () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ── Base y storage simulados (estado por prueba) ────────────────────────────────────────────────────────────────
const U = (id: string, rol: string, aliado_id: number | null, extra: Fila = {}) => ({ id, email: `${id}@t.co`, rol, activo: true, agencia_id: null, aliado_id, acceso_legacy_nombre: false, nombre: id, ...extra });
let db: { usuarios: Fila[]; aliados: Fila[]; cotizaciones: Fila[]; comision_plan: Fila[]; aliado_logos: Fila[] };
let objetos: Map<string, Uint8Array>;
let llamadas: { rpc: string[]; upload: string[]; download: string[] };
let sesion: string | null;
let tenantOk = true;

function reiniciar() {
  db = {
    usuarios: [
      U("laura", "freelance", 1), U("sol", "agencia", 2), U("agente", "agencia", 2, { agencia_id: "ag-1" }),
      U("staff", "superadmin", null), U("gerente", "gerencia", null), U("admin", "administracion", null), U("vendedor", "venta", null),
      U("inactivo", "freelance", 1, { activo: false }),
    ],
    aliados: [{ id: 1, nombre: "Laura Gómez", tipo: "freelance" }, { id: 2, nombre: "Viajes Sol SAS", tipo: "agencia" }],
    cotizaciones: [
      { id: 101, share_token: "tok-a", aliado_id: 1, b2b_aliado: null, tenant: "mayorista" },
      { id: 102, share_token: "tok-b", aliado_id: 2, b2b_aliado: null, tenant: "mayorista" },
      { id: 103, share_token: "tok-carrito", aliado_id: null, b2b_aliado: "1", tenant: "mayorista" },
      { id: 104, share_token: "tok-plan", aliado_id: null, b2b_aliado: null, tenant: "mayorista" },
      { id: 105, share_token: "tok-b2c", aliado_id: null, b2b_aliado: null, tenant: "mayorista" },
    ],
    comision_plan: [{ cotizacion_id: 104, version: 1, aliado_id: 2 }],
    aliado_logos: [],
  };
  objetos = new Map(); llamadas = { rpc: [], upload: [], download: [] }; sesion = null; tenantOk = true;
}

function consulta(tabla: keyof typeof db) {
  const filtros: ((f: Fila) => boolean)[] = []; let orden: string | null = null;
  const b: Record<string, unknown> = {};
  const filas = () => {
    let r = db[tabla].filter((f) => filtros.every((p) => p(f)));
    if (orden) r = [...r].sort((a, c) => Number(c[orden!]) - Number(a[orden!]));
    // `aliado_logos` con `aliados(nombre)` embebido, como PostgREST.
    return tabla === "aliado_logos" ? r.map((f) => ({ ...f, aliados: db.aliados.find((a) => a.id === f.aliado_id) ?? null })) : r;
  };
  Object.assign(b, {
    select: () => b, order: (c: string) => { orden = c; return b; }, limit: () => b,
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return b; },
    neq: (c: string, v: unknown) => { filtros.push((f) => f[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { filtros.push((f) => v.includes(f[c])); return b; },
    is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return b; },
    maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas(), count: filas().length, error: null }).then(ok),
  });
  return b;
}

// Emula las reglas de la RPC de la 319 (la verdad del SQL se prueba en test_319_aliado_logo.sql).
function rpc(fn: string, a: Fila) {
  llamadas.rpc.push(fn);
  const u = db.usuarios.find((x) => x.id === a.p_actor);
  const via = !u || u.activo !== true ? null : ["superadmin", "gerencia"].includes(String(u.rol)) ? "interno" : ["agencia", "freelance"].includes(String(u.rol)) && u.agencia_id == null && u.aliado_id === a.p_aliado ? "portal" : null;
  if (!via) return { data: { ok: false, codigo: "no_autorizado" }, error: null };
  if (fn === "retirar_logo_aliado") { for (const l of db.aliado_logos) if (l.aliado_id === a.p_aliado && l.vigente) l.vigente = false; return { data: { ok: true }, error: null }; }
  const v = db.aliado_logos.find((l) => l.aliado_id === a.p_aliado && l.vigente);
  if (v && v.sha256 === a.p_sha) return { data: { ok: true, sin_cambio: true }, error: null };
  for (const l of db.aliado_logos) if (l.aliado_id === a.p_aliado && l.vigente) l.vigente = false;
  db.aliado_logos.push({ id: db.aliado_logos.length + 1, aliado_id: a.p_aliado, path: a.p_path, mime: a.p_mime, sha256: a.p_sha, vigente: true, via });
  return { data: { ok: true, sin_cambio: false }, error: null };
}
const storage = {
  from: () => ({
    upload: async (p: string, bytes: Uint8Array) => { llamadas.upload.push(p); if (objetos.has(p)) return { error: { message: "The resource already exists" } }; objetos.set(p, bytes); return { error: null }; },
    download: async (p: string) => { llamadas.download.push(p); const b = objetos.get(p); return b ? { data: new Blob([b as BlobPart]), error: null } : { data: null, error: { message: "missing" } }; },
  }),
};
const admin = () => ({ from: (t: string) => consulta(t as keyof typeof db), rpc: async (fn: string, a: Fila) => rpc(fn, a), storage });
const sb = () => ({
  auth: { getUser: async () => ({ data: { user: sesion ? { id: sesion, email: `${sesion}@t.co` } : null }, error: null }) },
  from: (t: string) => {
    const q = consulta(t as keyof typeof db);
    // La sesión (RLS) lee su propio perfil; para la cotización interna lee la fila tal cual (el acceso lo decide `autorizaTenant`).
    return q;
  },
});

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sb() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => admin() } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({}), autorizaTenant: () => tenantOk } });
mock.module("@/lib/auth/contextoAgencia", { namedExports: { exigirEscrituraCatalogoGlobal: async () => ({ ok: true }) } });

const { detectarMimeLogo, validarLogo, rutaLogo, aliadoIdDeCotizacion, cabecerasLogoPrivado, MAX_LOGO_BYTES } = await import("../lib/aliados/logo.ts");
const { guardarLogo, logoParaDocumento } = await import("../lib/aliados/logoServidor.ts");
const portal = await import("../app/portal/b2b/perfil/logo-actions.ts");
const interno = await import("../app/(dashboard)/dashboard/aliados/logo-actions.ts");
const rutaToken = await import("../app/cot/[token]/logo/route.ts");
const rutaCot = await import("../app/cotizacion/[id]/logo/route.ts");
const rutaPortal = await import("../app/portal/b2b/perfil/logo/route.ts");
const rutaInterna = await import("../app/(dashboard)/dashboard/aliados/logo/[id]/route.ts");

const archivo = (b: Uint8Array, nombre = "logo.png", type = "image/png") => { const fd = new FormData(); fd.set("logo", new File([b as BlobPart], nombre, { type })); return fd; };
const get = async (r: Promise<Response>) => { const x = await r; return { status: x.status, bytes: new Uint8Array(await x.arrayBuffer()), h: x.headers }; };
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const vigenteDe = (id: number) => db.aliado_logos.find((l) => l.aliado_id === id && l.vigente);

beforeEach(reiniciar);

describe("#32 validación del archivo (por bytes, no por nombre ni tipo declarado)", () => {
  test("PNG y JPG reales pasan; SVG, GIF, WebP, PDF, vacío y texto no", () => {
    assert.equal(detectarMimeLogo(PNG()), "image/png");
    assert.equal(detectarMimeLogo(JPG()), "image/jpeg");
    for (const malo of [SVG(), new TextEncoder().encode("GIF89a...."), new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), new TextEncoder().encode("%PDF-1.7"), new Uint8Array(), new Uint8Array([0x89, 0x50, 0x4e])]) {
      assert.equal(validarLogo(malo).ok, false);
    }
  });
  test("límite de 1 MB: justo en el límite pasa, un byte más no", () => {
    const en = new Uint8Array(MAX_LOGO_BYTES); en.set(PNG());
    const sobre = new Uint8Array(MAX_LOGO_BYTES + 1); sobre.set(PNG());
    assert.equal(validarLogo(en).ok, true);
    assert.equal(validarLogo(sobre).ok, false);
  });
  test("la ruta se deriva del contenido: otro logo nunca pisa el archivo del anterior", () => {
    assert.notEqual(rutaLogo(1, sha(PNG(1)), "png"), rutaLogo(1, sha(PNG(2)), "png"));
    assert.equal(rutaLogo(7, "ab".repeat(32), "jpg"), `7/${"ab".repeat(32)}.jpg`);
  });
  test("cabeceras de un archivo privado: sin caché compartida, sin reinterpretar el contenido", () => {
    const h = cabecerasLogoPrivado("image/png");
    assert.match(h["Cache-Control"], /private/); assert.match(h["Cache-Control"], /no-store/); assert.doesNotMatch(h["Cache-Control"], /public|max-age=[1-9]/);
    assert.equal(h["X-Content-Type-Options"], "nosniff"); assert.match(h["Content-Security-Policy"], /sandbox/);
  });
});

describe("#32 aliado dueño de la cotización (solo de lo que la cotización guardó)", () => {
  test("orden de autoridad: columna → carrito asistido → plan; texto no numérico o inválido ⇒ null", () => {
    assert.equal(aliadoIdDeCotizacion({ aliado_id: 3, b2b_aliado: "9", plan_aliado: 8 }), 3);
    assert.equal(aliadoIdDeCotizacion({ aliado_id: null, b2b_aliado: "9", plan_aliado: 8 }), 9);
    assert.equal(aliadoIdDeCotizacion({ aliado_id: null, b2b_aliado: null, plan_aliado: 8 }), 8);
    for (const raro of ["Laura Gómez", "12abc", "-1", "0", 1.5, "", null, undefined, {}]) assert.equal(aliadoIdDeCotizacion({ aliado_id: raro }), null);
  });
});

describe("#32 subir desde el portal: la ficha sale de la SESIÓN", () => {
  test("Laura sube un PNG: queda vigente en SU ficha, direccionado por contenido, y el formulario no puede elegir otro aliado", async () => {
    sesion = "laura";
    const fd = archivo(PNG(5)); fd.set("aliadoId", "2"); fd.set("aliado_id", "2");
    const r = await portal.subirLogoPortal(fd);
    assert.deepEqual(r, { ok: true, sinCambio: false });
    assert.equal(vigenteDe(1)?.path, rutaLogo(1, sha(PNG(5)), "png"));
    assert.equal(vigenteDe(2), undefined, "el aliado 2 no se toca");
    assert.deepEqual(llamadas.upload, [rutaLogo(1, sha(PNG(5)), "png")]);
  });
  test("tipos falsos se rechazan ANTES de tocar storage o base (SVG con extensión .png, tipo declarado image/png)", async () => {
    sesion = "laura";
    const r = await portal.subirLogoPortal(archivo(SVG(), "logo.png", "image/png"));
    assert.equal(r.ok, false);
    assert.deepEqual(llamadas, { rpc: [], upload: [], download: [] });
    assert.equal(db.aliado_logos.length, 0);
  });
  test("más de 1 MB se rechaza sin leerlo a memoria ni subirlo", async () => {
    sesion = "laura";
    const grande = new Uint8Array(MAX_LOGO_BYTES + 1); grande.set(PNG());
    assert.equal((await portal.subirLogoPortal(archivo(grande))).ok, false);
    assert.deepEqual(llamadas.upload, []);
  });
  test("reemplazar: el anterior queda en el historial (no vigente) y su archivo se conserva; repetir el mismo archivo no cambia nada", async () => {
    sesion = "laura";
    await portal.subirLogoPortal(archivo(PNG(1)));
    const r2 = await portal.subirLogoPortal(archivo(JPG(), "x.jpg", "image/jpeg"));
    assert.deepEqual(r2, { ok: true, sinCambio: false });
    assert.equal(db.aliado_logos.length, 2);
    assert.equal(db.aliado_logos.filter((l) => l.vigente).length, 1);
    assert.equal(vigenteDe(1)?.mime, "image/jpeg");
    assert.equal(objetos.size, 2, "ningún archivo se borra");
    assert.deepEqual(await portal.subirLogoPortal(archivo(JPG(), "x.jpg", "image/jpeg")), { ok: true, sinCambio: true });
    assert.equal(db.aliado_logos.length, 2);
  });
  test("quién NO puede: agente de la agencia, cuenta inactiva, venta, administración, sin sesión", async () => {
    for (const quien of ["agente", "inactivo", "vendedor", "admin", null]) {
      reiniciar(); sesion = quien;
      const r = await portal.subirLogoPortal(archivo(PNG()));
      assert.equal(r.ok, false, `${quien} no debe poder`);
      assert.equal(db.aliado_logos.length, 0, `${quien}: nada persistido`);
      assert.equal(llamadas.upload.length, 0, `${quien}: nada subido`);
    }
  });
  test("ficha compartida con otra cuenta titular: no se cambia desde el portal", async () => {
    db.usuarios.push(U("socia", "freelance", 1));
    sesion = "laura";
    assert.equal((await portal.subirLogoPortal(archivo(PNG()))).ok, false);
    assert.equal(db.aliado_logos.length, 0);
  });
  test("Sol (otra agencia) sube el suyo; el de Laura no cambia; retirar solo retira el propio", async () => {
    sesion = "laura"; await portal.subirLogoPortal(archivo(PNG(1)));
    sesion = "sol"; await portal.subirLogoPortal(archivo(PNG(2)));
    assert.equal(vigenteDe(1)?.sha256, sha(PNG(1)));
    assert.equal(vigenteDe(2)?.sha256, sha(PNG(2)));
    assert.deepEqual(await portal.retirarLogoPortal(), { ok: true });
    assert.equal(vigenteDe(2), undefined);
    assert.ok(vigenteDe(1), "el de Laura sigue vigente");
  });
});

describe("#32 subir desde Aliados (interno)", () => {
  test("superadmin y gerencia cambian el logo del aliado elegido; el id se valida", async () => {
    for (const quien of ["staff", "gerente"]) {
      reiniciar(); sesion = quien;
      const fd = archivo(PNG(7)); fd.set("aliadoId", "2");
      assert.equal((await interno.subirLogoAliadoInterno(fd)).ok, true);
      assert.equal(vigenteDe(2)?.via, "interno");
      assert.equal(vigenteDe(1), undefined);
    }
    sesion = "staff";
    for (const raro of ["", "abc", "-3", "1.5", "0"]) { const fd = archivo(PNG()); fd.set("aliadoId", raro); assert.equal((await interno.subirLogoAliadoInterno(fd)).ok, false); }
  });
  test("administración, venta, aliados y anónimos no pueden (ni subir ni retirar)", async () => {
    for (const quien of ["admin", "vendedor", "laura", "sol", null]) {
      reiniciar(); sesion = quien;
      const fd = archivo(PNG()); fd.set("aliadoId", "1");
      assert.equal((await interno.subirLogoAliadoInterno(fd)).ok, false, `${quien} subir`);
      assert.equal((await interno.retirarLogoAliadoInterno(1)).ok, false, `${quien} retirar`);
      assert.equal(llamadas.upload.length, 0);
    }
  });
});

async function conLogos() {
  sesion = "laura"; await portal.subirLogoPortal(archivo(PNG(1)));
  sesion = "sol"; await portal.subirLogoPortal(archivo(JPG(), "s.jpg", "image/jpeg"));
  sesion = null;
}

describe("#32 enlace público /cot/<token>/logo: el token resuelve UNA cotización y de ELLA sale el aliado", () => {
  test("cada cotización muestra el logo de SU aliado (columna, carrito asistido y plan de comisión); nunca el de otro", async () => {
    await conLogos();
    const esperado: [string, Uint8Array][] = [["tok-a", PNG(1)], ["tok-b", JPG()], ["tok-carrito", PNG(1)], ["tok-plan", JPG()]];
    for (const [token, bytes] of esperado) {
      const r = await get(rutaToken.GET(new Request("http://x"), params({ token })));
      assert.equal(r.status, 200, token);
      assert.deepEqual(r.bytes, bytes, `${token} sirve el logo de su aliado`);
    }
  });
  test("token desconocido, cotización sin aliado (B2C) o aliado sin logo ⇒ 404 idéntico y sin caché compartida", async () => {
    await conLogos();
    sesion = "sol"; await portal.retirarLogoPortal(); sesion = null;
    for (const token of ["no-existe", "tok-b2c", "tok-b", "tok-plan"]) {
      const r = await get(rutaToken.GET(new Request("http://x"), params({ token })));
      assert.equal(r.status, 404, token);
      assert.match(r.h.get("Cache-Control") ?? "", /no-store/);
    }
  });
  test("cabeceras del archivo: private/no-store, nosniff, el tipo guardado", async () => {
    await conLogos();
    const r = await get(rutaToken.GET(new Request("http://x"), params({ token: "tok-a" })));
    assert.equal(r.h.get("Content-Type"), "image/png");
    assert.match(r.h.get("Cache-Control") ?? "", /private/); assert.doesNotMatch(r.h.get("Cache-Control") ?? "", /public/);
    assert.equal(r.h.get("X-Content-Type-Options"), "nosniff");
  });
  test("un id de aliado en la URL/consulta no cambia nada (la ruta solo conoce el token)", async () => {
    await conLogos();
    const r = await get(rutaToken.GET(new Request("http://x?aliado=2&aliadoId=2"), params({ token: "tok-a" })));
    assert.deepEqual(r.bytes, PNG(1));
  });
});

describe("#32 /cotizacion/<id>/logo (interno): misma regla de acceso que la página", () => {
  test("con acceso a la cotización sirve el logo de SU aliado; sin acceso (otra agencia) o id inválido ⇒ 404", async () => {
    await conLogos(); sesion = "staff";
    assert.deepEqual((await get(rutaCot.GET(new Request("http://x"), params({ id: "101" })))).bytes, PNG(1));
    assert.deepEqual((await get(rutaCot.GET(new Request("http://x"), params({ id: "102" })))).bytes, JPG());
    tenantOk = false;
    assert.equal((await get(rutaCot.GET(new Request("http://x"), params({ id: "101" })))).status, 404);
    tenantOk = true;
    for (const id of ["abc", "-1", "0", "999", "1.5"]) assert.equal((await get(rutaCot.GET(new Request("http://x"), params({ id })))).status, 404, id);
  });
});

describe("#32 vistas previas autorizadas (portal propio e Aliados interno)", () => {
  test("portal: cada cuenta ve el logo de SU ficha (el agente ve el de su agencia); anónimo o inactivo ⇒ 404", async () => {
    await conLogos();
    const ver = async (quien: string | null) => { sesion = quien; return get(rutaPortal.GET()); };
    assert.deepEqual((await ver("laura")).bytes, PNG(1));
    assert.deepEqual((await ver("sol")).bytes, JPG());
    assert.deepEqual((await ver("agente")).bytes, JPG());
    for (const quien of [null, "inactivo", "staff"]) assert.equal((await ver(quien)).status, 404, String(quien));
  });
  test("Aliados: solo superadmin/gerencia ven el logo de un aliado por id; el resto 404 idéntico", async () => {
    await conLogos();
    const ver = async (quien: string | null, id: string) => { sesion = quien; return get(rutaInterna.GET(new Request("http://x"), params({ id }))); };
    assert.deepEqual((await ver("staff", "1")).bytes, PNG(1));
    assert.deepEqual((await ver("gerente", "2")).bytes, JPG());
    for (const quien of ["admin", "vendedor", "laura", "sol", null]) assert.equal((await ver(quien, "1")).status, 404, String(quien));
    assert.equal((await ver("staff", "xyz")).status, 404);
  });
});

describe("#32 lo que usan los documentos", () => {
  test("`logoParaDocumento`: ruta autorizada de ESA cotización + nombre; sin aliado o sin logo ⇒ null (documento de siempre)", async () => {
    await conLogos();
    const a = admin() as never;
    assert.deepEqual(await logoParaDocumento(a, { id: 101, aliado_id: 1 }, "/cot/tok-a"), { src: "/cot/tok-a/logo?v=1", nombre: "Laura Gómez" });
    assert.equal((await logoParaDocumento(a, { id: 104 }, "/cot/tok-plan"))?.nombre, "Viajes Sol SAS", "por plan de comisión");
    assert.equal(await logoParaDocumento(a, { id: 105 }, "/cot/tok-b2c"), null);
    sesion = "sol"; await portal.retirarLogoPortal();
    assert.equal(await logoParaDocumento(a, { id: 102, aliado_id: 2 }, "/cot/tok-b"), null);
  });
  test("`guardarLogo` directo: un actor sin permiso para ESA ficha no persiste nada aunque suba el archivo (segunda llave en la base)", async () => {
    const r = await guardarLogo(admin() as never, { actorId: "laura", aliadoId: 2, bytes: PNG() });
    assert.equal(r.ok, false);
    assert.equal(db.aliado_logos.length, 0);
  });
});

describe("#32 enlace público: la cotización se relee por token en una consulta aparte", () => {
  test("`logoParaDocumentoPorToken`: aliado de ESA cotización; token desconocido o sin aliado ⇒ null", async () => {
    await conLogos();
    const { logoParaDocumentoPorToken } = await import("../lib/aliados/logoServidor.ts");
    const a = admin() as never;
    assert.deepEqual(await logoParaDocumentoPorToken(a, "tok-a"), { src: "/cot/tok-a/logo?v=1", nombre: "Laura Gómez" });
    assert.equal((await logoParaDocumentoPorToken(a, "tok-carrito"))?.nombre, "Laura Gómez");
    assert.equal(await logoParaDocumentoPorToken(a, "tok-b2c"), null);
    assert.equal(await logoParaDocumentoPorToken(a, "desconocido"), null);
  });
});

describe("#32 cableado: el logo del aliado solo llega a documentos de COTIZACIÓN", () => {
  test("solo las páginas de cotización y la comparativa pasan `logoAliado`; ninguna ruta de contrato lo menciona", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, sep } = await import("node:path");
    const raiz = join(import.meta.dirname, "..");
    const usan: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (["node_modules", ".next", ".worktrees", "pruebas", "supabase", "docs"].includes(n)) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { recorrer(p); continue; }
        if (!/\.(tsx?|jsx?)$/.test(n)) continue;
        if (/logoAliado=\{/.test(readFileSync(p, "utf8"))) usan.push(p.slice(raiz.length + 1).split(sep).join("/"));
      }
    };
    for (const d of ["app", "components", "lib"]) recorrer(join(raiz, d));
    assert.deepEqual(usan.sort(), ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx", "lib/cotizacion/comparativaDocumento.tsx"]);
  });
  test("el bucket nunca se expone: ningún componente ni página arma una URL pública de storage del logo", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["lib/aliados/logoServidor.ts", "components/cotizacion/MarcaAliado.tsx", "components/portal/LogoAliado.tsx"]) {
      const s = readFileSync(join(import.meta.dirname, "..", f), "utf8");
      assert.doesNotMatch(s, /getPublicUrl|createSignedUrl|storage\/v1\/object/, f);
    }
  });
});

// Regresión (hallada en la regresión por nombre del bloque): la búsqueda del logo es presentación; si el almacén falla NO puede tumbar el documento legal.
describe("el logo nunca bloquea el documento: una lectura que falla emite el documento sin logo", () => {
  test("los tres ayudantes de documento devuelven null (sin lanzar) cuando la base lanza", async () => {
    const { logoParaDocumento, logoParaDocumentoPorToken, logoParaDocumentoPorId } = await import("../lib/aliados/logoServidor.ts");
    const roto = { from() { throw new Error("falla de base"); }, rpc() { throw new Error("falla de base"); }, storage: { from() { throw new Error("falla de storage"); } } } as never;
    const consola = mock.method(console, "error", () => {});
    try {
      assert.equal(await logoParaDocumento(roto, { id: 1, aliado_id: 7 }, "/cotizacion/1"), null);
      assert.equal(await logoParaDocumentoPorToken(roto, "tok"), null);
      assert.equal(await logoParaDocumentoPorId(roto, 1, "/cotizacion/1"), null);
      assert.equal(consola.mock.callCount(), 3, "cada falla queda registrada, no se traga en silencio");
    } finally { consola.mock.restore(); }
  });
});
