// #98 — firma + aceptación electrónica de una versión congelada de la cuenta de cobro: reglas puras y acciones de servidor.
// El «admin» es un MODELO en memoria del contrato de las RPC `aceptar_cuenta_cobro` / `registrar_firma_aliado` (unicidad (clave,hash) y (clave,versión), versión asignada en serie,
// idempotencia por hash). La semántica REAL de la base (triggers de inmutabilidad, grants, concurrencia entre sesiones) se prueba en supabase/scripts/test_318_*.sql.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveCuenta, construirSnapshot, elegirVersion, hashSnapshot, puedeFirmar, validarImagenFirma, sha256Hex, MENSAJE_NO_FIRMA, type SnapshotCuenta } from "@/lib/cuentaCobro/snapshot";
import { aceptarCuentaServidor, firmaDataUri, guardarFirmaServidor, leerAceptaciones, type AdminFirmas } from "@/lib/cuentaCobro/servidor";

// ── Fixtures (cifras a mano, no producidas por el código bajo prueba) ──────
// PVP 5.000.000 · base 4.000.000 · 12 % = 480.000 · retención 11 % de 480.000 = 52.800 · a cobrar 427.200
// Con retención 10 %: 48.000 → 432.000.
const detalleBase = { pvp: 5_000_000, baseComisionable: 4_000_000, pctComision: 0.12, esPctEfectivo: false, esPctPactado: false, comisionBase: 480_000, recobroAliado: null, aplicaRetencion: true, pctRetencion: 0.11, retencion: 52_800, totalPagar: 427_200 };
const ficha = (id: number, nombre = "Laura Pérez") => ({ id, nombre, tipo_documento: "CC", nit: "52111222", direccion: "Calle 1 # 2-3", telefono: "+573001112233", email: "laura@test.co", banco: "Bancolombia", tipo_cuenta: "Ahorros", numero_cuenta: "000123456" });
const comision = (over: Record<string, unknown> = {}) => ({
  tipo: "comision" as const, numeroContrato: "00-0451", cliente: "Ana Gómez", destino: "San Andrés", fechaSalida: "2027-01-10", moneda: "COP", tenant: "mayorista",
  aliado: "Laura Pérez", aliadoInfo: ficha(7), tipoAsesorEfectivo: "freelance", detalle: { ...detalleBase }, esInterno: false, esDueno: true, aliadoB2bId: 31, contratoUid: "uid-aaa", ...over,
});
const compania = { nombre: "D'SPACIOS TRAVEL", nit: "900.111.222-3", direccion: "Cra 7 # 1-1" };
const vivoDe = (r = comision(), dia = "2026-11-20") => construirSnapshot(r as never, compania, dia);
const ctxLaura = (over: Record<string, unknown> = {}, perm: Record<string, unknown> = {}) => ({
  lecturaOk: true, usuario: { id: "u-laura", aliado_id: 7, rol: "freelance", activo: true, agencia_id: null, acceso_legacy_nombre: false, nombre: "Laura", email: "l@t.co" }, ficha: null,
  permisos: { valido: true, tipo: "freelance", esAgente: false, puedeNombreUsuario: false, motivoNombreUsuario: null, puedeFicha: true, motivoFicha: null, camposFicha: [], ...perm }, ...over,
}) as never;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

// ── Modelo en memoria ──────────────────────────────────────────────────────
type Fila = Record<string, any>;
function crearBase(opts: { fallaRpc?: boolean; fallaSubida?: boolean } = {}) {
  const firmas: Fila[] = []; const aceptaciones: Fila[] = []; const objetos = new Map<string, Uint8Array>(); const rpcs: string[] = []; let id = 0;
  const tablas: Record<string, Fila[]> = { aliado_firmas: firmas, cuenta_cobro_aceptaciones: aceptaciones };
  const consulta = (filas: Fila[]) => {
    const f: [string, unknown][] = [];
    const sel = () => filas.filter((x) => f.every(([c, v]) => x[c] === v));
    const q: any = { select: () => q, eq: (c: string, v: unknown) => { f.push([c, v]); return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: sel()[0] ?? null, error: null }), then: (res: (x: unknown) => unknown) => res({ data: sel(), error: null }) };
    return q;
  };
  const admin: AdminFirmas = {
    from: (t) => consulta(tablas[t] ?? []),
    storage: { from: () => ({
      upload: async (p: string, b: Uint8Array) => { if (opts.fallaSubida) return { error: { message: "x" } }; objetos.set(p, b); return { error: null }; },
      remove: async (ps: string[]) => { ps.forEach((p) => objetos.delete(p)); return { error: null }; },
      download: async (p: string) => (objetos.has(p) ? { data: new Blob([objetos.get(p)! as BlobPart]), error: null } : { data: null, error: { message: "no" } }),
    }) },
    rpc: async (fn, a: any) => {
      rpcs.push(fn);
      if (opts.fallaRpc) return { data: null, error: { message: "boom" } };
      // modelos síncronos (sin await entre lectura y escritura) = serialización que el bloqueo consultivo da en la base
      if (fn === "registrar_firma_aliado") {
        const v = firmas.find((x) => x.aliado_id === a.p_aliado_id && x.vigente);
        if (v && v.sha256 === a.p_sha) return { data: { ok: true, id: v.id, repetida: true }, error: null };
        firmas.filter((x) => x.aliado_id === a.p_aliado_id && x.vigente).forEach((x) => { x.vigente = false; });
        firmas.push({ id: ++id, aliado_id: a.p_aliado_id, storage_path: a.p_path, sha256: a.p_sha, mime: a.p_mime, vigente: true, creado_en: "2026-11-20T10:00:00Z" });
        return { data: { ok: true, id, repetida: false }, error: null };
      }
      if (a.p_snapshot?.v !== 1 || a.p_snapshot?.clave !== a.p_clave || String(a.p_snapshot?.aliado?.id) !== String(a.p_aliado_id)) return { data: { ok: false, codigo: "datos" }, error: null };
      const igual = aceptaciones.find((x) => x.clave === a.p_clave && x.snapshot_hash === a.p_hash);
      if (igual) return { data: { ok: true, repetida: true, version: igual.version, id: igual.id }, error: null };
      const f = firmas.find((x) => x.aliado_id === a.p_aliado_id && x.vigente);
      if (!f) return { data: { ok: false, codigo: "sin_firma" }, error: null };
      const version = Math.max(0, ...aceptaciones.filter((x) => x.clave === a.p_clave).map((x) => x.version)) + 1;
      aceptaciones.push({ id: ++id, clave: a.p_clave, aliado_id: a.p_aliado_id, version, snapshot: a.p_snapshot, snapshot_hash: a.p_hash, firma_id: f.id, firma_sha256: f.sha256, aceptada_por: a.p_user, aceptada_en: "2026-11-20T15:00:00Z" });
      return { data: { ok: true, repetida: false, version, id }, error: null };
    },
  };
  return { admin, firmas, aceptaciones, objetos, rpcs };
}
const aceptar = (admin: AdminFirmas, e: Record<string, unknown> = {}) => {
  const vivo = (e.vivo as SnapshotCuenta | undefined) ?? vivoDe();
  return aceptarCuentaServidor(admin, { userId: "u-laura", r: comision() as never, ctx: ctxLaura(), vivo, hashVisto: hashSnapshot(vivo), ahoraNegocio: "2026-11-20", ...e } as never);
};
async function conFirma(b: ReturnType<typeof crearBase>) { const r = await guardarFirmaServidor(b.admin, "u-laura", ctxLaura(), { bytes: PNG, mime: "image/png" }); assert.equal(r.ok, true); }

describe("snapshot y hash: una versión es TODO lo que el documento imprime", () => {
  test("misma versión → mismo hash; la fecha de elaboración NO cambia el hash", () => {
    assert.equal(hashSnapshot(vivoDe(comision(), "2026-11-20")), hashSnapshot(vivoDe(comision(), "2027-03-01")));
    assert.match(hashSnapshot(vivoDe()), /^[0-9a-f]{64}$/);
  });
  test("el orden de las llaves no cambia el hash", () => {
    const a = vivoDe(); const b = { ...a, detalle: Object.fromEntries(Object.entries(a.detalle).reverse()) } as SnapshotCuenta;
    assert.equal(hashSnapshot(a), hashSnapshot(b));
  });
  test("cambia la comisión, la retención o un dato del aliado → hash distinto (versión nueva)", () => {
    const h0 = hashSnapshot(vivoDe());
    const retencion10 = { ...detalleBase, pctRetencion: 0.10, retencion: 48_000, totalPagar: 432_000 };
    const cambios: Record<string, unknown>[] = [
      { detalle: retencion10 },
      { detalle: { ...detalleBase, pctComision: 0.1, comisionBase: 400_000, retencion: 44_000, totalPagar: 356_000 } },
      { detalle: { ...detalleBase, aplicaRetencion: false, retencion: 0, totalPagar: 480_000 } },
      { aliadoInfo: { ...ficha(7), numero_cuenta: "999" } },
      { aliadoInfo: { ...ficha(7), banco: "Davivienda" } },
      { aliado: "Laura P. Pérez" },
      { cliente: "Otro Cliente" },
    ];
    const hashes = new Set([h0, ...cambios.map((c) => hashSnapshot(vivoDe(comision(c))))]);
    assert.equal(hashes.size, cambios.length + 1, "cada cambio produce un hash propio");
  });
  test("clave: fila de aliados_b2b o, sin fila, la vida del contrato; nunca el número ni el nombre", () => {
    assert.equal(claveCuenta({ aliadoB2bId: 31, contratoUid: "u" }), "ab:31");
    assert.equal(claveCuenta({ aliadoB2bId: null, contratoUid: "uid-zzz" }), "cu:uid-zzz");
    assert.equal(claveCuenta({ aliadoB2bId: null, contratoUid: null }), null);
    assert.equal(vivoDe(comision({ aliadoB2bId: null, contratoUid: null })).clave, "");
  });
});

describe("qué versión se dibuja", () => {
  const filas = [{ version: 1, snapshot_hash: "a" }, { version: 2, snapshot_hash: "b" }];
  test("la que coincide con el contenido vigente (aunque no sea la última); ninguna → sin aceptar", () => {
    assert.equal(elegirVersion(filas, "a", undefined)?.version, 1);
    assert.equal(elegirVersion(filas, "b", null)?.version, 2);
    assert.equal(elegirVersion(filas, "zzz", undefined), null);
    assert.equal(elegirVersion([], "a", undefined), null);
  });
  test("?v= pide una versión concreta; un valor inexistente o mal formado se ignora (nunca rompe ni inventa)", () => {
    assert.equal(elegirVersion(filas, "b", "1")?.version, 1);
    assert.equal(elegirVersion(filas, "zzz", "2")?.version, 2);
    assert.equal(elegirVersion(filas, "zzz", "9"), null);
    for (const malo of ["x", "1; drop", "-1", "1.5", ""]) assert.equal(elegirVersion(filas, "zzz", malo), null, malo);
  });
});

describe("quién puede firmar", () => {
  const ok = (r: Record<string, unknown>, ctx: Record<string, unknown> | null) => puedeFirmar(r as never, ctx as never);
  const ctx = { valido: true, tipo: "freelance", puedeFicha: true, motivoFicha: null, aliadoId: 7 };
  test("el freelance dueño de su ficha", () => assert.deepEqual(ok(comision(), ctx), { ok: true, aliadoId: 7 }));
  test("el personal interno, no dueño, agencia, agente/otro tipo, otra ficha, ficha compartida, sin ficha y sin sesión NO", () => {
    const casos: [Record<string, unknown>, Record<string, unknown> | null, string][] = [
      [comision({ esInterno: true }), ctx, "interno"],
      [comision({ esDueno: false }), ctx, "no_dueno"],
      [comision({ tipoAsesorEfectivo: "agencia" }), ctx, "agencia"],
      [comision(), { ...ctx, tipo: "agencia" }, "no_freelance"],
      [comision(), { ...ctx, valido: false }, "no_freelance"],
      [comision(), null, "no_freelance"],
      [comision(), { ...ctx, aliadoId: 8 }, "ficha_distinta"],
      [comision(), { ...ctx, aliadoId: null }, "sin_ficha"],
      [comision(), { ...ctx, puedeFicha: false }, "ficha_compartida"],
      [comision({ aliadoInfo: null }), ctx, "sin_aliado"],
      [comision({ aliadoB2bId: null, contratoUid: null }), ctx, "sin_clave"],
    ];
    for (const [r, c, motivo] of casos) assert.deepEqual(ok(r, c), { ok: false, motivo }, motivo);
    for (const m of Object.keys(MENSAJE_NO_FIRMA)) assert.ok(MENSAJE_NO_FIRMA[m as keyof typeof MENSAJE_NO_FIRMA].length > 10);
  });
});

describe("imagen de firma: se decide por los bytes", () => {
  test("PNG y JPG reales sí", () => {
    assert.deepEqual(validarImagenFirma(PNG, "image/png"), { ok: true, mime: "image/png", extension: "png" });
    assert.deepEqual(validarImagenFirma(JPG, null), { ok: true, mime: "image/jpeg", extension: "jpg" });
  });
  test("SVG, GIF, PDF, texto, vacío, grande y tipo declarado falso NO", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const b of [enc("<svg xmlns='http://www.w3.org/2000/svg'/>"), enc("GIF89a...."), enc("%PDF-1.4"), enc("hola")]) {
      assert.equal(validarImagenFirma(b, "image/png").ok, false);
      assert.equal(validarImagenFirma(b, null).ok, false, "sin tipo declarado también se rechaza por contenido");
    }
    assert.equal(validarImagenFirma(new Uint8Array(), null).ok, false);
    assert.equal(validarImagenFirma(PNG, "image/jpeg").ok, false, "PNG real declarado como JPG");
    const grande = new Uint8Array(512 * 1024 + 1); grande.set(PNG);
    assert.equal(validarImagenFirma(grande, "image/png").ok, false);
    const justo = new Uint8Array(512 * 1024); justo.set(PNG);
    assert.equal(validarImagenFirma(justo, "image/png").ok, true, "512 KB exactos sí");
  });
});

describe("subir la firma", () => {
  test("freelance titular: sube al bucket privado bajo SU ficha y registra; la misma imagen es idempotente y no deja huérfanos", async () => {
    const b = crearBase();
    assert.deepEqual(await guardarFirmaServidor(b.admin, "u-laura", ctxLaura(), { bytes: PNG, mime: "image/png" }), { ok: true, repetida: false });
    assert.equal(b.firmas.length, 1); assert.equal(b.objetos.size, 1);
    assert.match([...b.objetos.keys()][0], /^7\/[0-9a-f-]{36}\.png$/);
    assert.equal(b.firmas[0].sha256, sha256Hex(PNG));
    assert.deepEqual(await guardarFirmaServidor(b.admin, "u-laura", ctxLaura(), { bytes: PNG, mime: "image/png" }), { ok: true, repetida: true });
    assert.equal(b.firmas.length, 1); assert.equal(b.objetos.size, 1, "el objeto repetido se retiró");
  });
  test("reemplazar conserva la anterior (no vigente) y deja una sola vigente", async () => {
    const b = crearBase();
    await guardarFirmaServidor(b.admin, "u-laura", ctxLaura(), { bytes: PNG, mime: "image/png" });
    await guardarFirmaServidor(b.admin, "u-laura", ctxLaura(), { bytes: JPG, mime: "image/jpeg" });
    assert.deepEqual(b.firmas.map((f) => f.vigente), [false, true]); assert.equal(b.objetos.size, 2);
  });
  test("agencia, agente, ficha compartida, otro rol, sin sesión y archivo inválido: nada se sube", async () => {
    for (const [ctx, user, bytes] of [
      [ctxLaura({}, { tipo: "agencia" }), "u", PNG], [ctxLaura({}, { puedeFicha: false, motivoFicha: "compartida" }), "u", PNG], [ctxLaura({}, { valido: false }), "u", PNG],
      [ctxLaura(), null, PNG], [null, "u", PNG], [ctxLaura({ usuario: { aliado_id: null } }), "u", PNG], [ctxLaura(), "u", new TextEncoder().encode("<svg/>")],
    ] as [never, string | null, Uint8Array][]) {
      const b = crearBase();
      const r = await guardarFirmaServidor(b.admin, user, ctx, { bytes, mime: "image/png" });
      assert.equal(r.ok, false); assert.equal(b.objetos.size, 0); assert.equal(b.rpcs.length, 0); assert.equal(b.firmas.length, 0);
    }
  });
  test("si el registro falla se retira el objeto subido; si la subida falla no se registra", async () => {
    const a = crearBase({ fallaRpc: true });
    assert.equal((await guardarFirmaServidor(a.admin, "u", ctxLaura(), { bytes: PNG, mime: "image/png" })).ok, false);
    assert.equal(a.objetos.size, 0);
    const c = crearBase({ fallaSubida: true });
    assert.equal((await guardarFirmaServidor(c.admin, "u", ctxLaura(), { bytes: PNG, mime: "image/png" })).ok, false);
    assert.equal(c.rpcs.length, 0);
  });
});

describe("aceptar una versión", () => {
  test("freelance con firma: versión 1 congelada con la fecha de la aceptación, hash vivo y firma vigente", async () => {
    const b = crearBase(); await conFirma(b);
    const vivo = vivoDe(comision(), "2026-11-20");
    const r = await aceptar(b.admin, { vivo, ahoraNegocio: "2026-11-21" });
    assert.deepEqual(r, { ok: true, version: 1, repetida: false });
    const a = b.aceptaciones[0];
    assert.equal(a.clave, "ab:31"); assert.equal(a.snapshot_hash, hashSnapshot(vivo)); assert.equal(a.aceptada_por, "u-laura"); assert.equal(a.firma_sha256, sha256Hex(PNG));
    assert.equal(a.snapshot.elaboracion, "2026-11-21", "congela la fecha de la aceptación");
    assert.equal(a.snapshot.detalle.totalPagar, 427_200);
    assert.equal(hashSnapshot(a.snapshot), hashSnapshot(vivo), "la fecha congelada no altera el hash");
  });
  test("repetir (doble clic, recarga, reintento) es idempotente: una sola fila", async () => {
    const b = crearBase(); await conFirma(b);
    assert.deepEqual(await aceptar(b.admin), { ok: true, version: 1, repetida: false });
    assert.deepEqual(await aceptar(b.admin), { ok: true, version: 1, repetida: true });
    assert.equal(b.aceptaciones.length, 1);
  });
  test("dos aceptaciones simultáneas del mismo contenido → una fila", async () => {
    const b = crearBase(); await conFirma(b);
    const rs = await Promise.all([aceptar(b.admin), aceptar(b.admin), aceptar(b.admin)]);
    assert.equal(b.aceptaciones.length, 1);
    assert.equal(rs.filter((r) => r.ok && !r.repetida).length, 1);
  });
  test("versión desfasada (la persona vio otra): se rechaza y no se escribe nada", async () => {
    const b = crearBase(); await conFirma(b); const antes = b.rpcs.length;
    const visto = vivoDe(comision({ detalle: { ...detalleBase, pctRetencion: 0.10, retencion: 48_000, totalPagar: 432_000 } }));
    const r = await aceptar(b.admin, { hashVisto: hashSnapshot(visto) });
    assert.equal(r.ok, false); assert.equal((r as { desfasada?: boolean }).desfasada, true);
    for (const malo of [undefined, null, "", 123, "a".repeat(64)]) assert.equal((await aceptar(b.admin, { hashVisto: malo })).ok, false);
    assert.equal(b.aceptaciones.length, 0); assert.equal(b.rpcs.length, antes);
  });
  test("cambia la retención después de aceptar: la v1 queda intacta, la vigente exige v2 y ambas coexisten", async () => {
    const b = crearBase(); await conFirma(b);
    await aceptar(b.admin);
    const v1 = JSON.stringify(b.aceptaciones[0]);
    const cambiada = vivoDe(comision({ detalle: { ...detalleBase, pctRetencion: 0.10, retencion: 48_000, totalPagar: 432_000 } }));
    assert.notEqual(hashSnapshot(cambiada), b.aceptaciones[0].snapshot_hash, "la versión vigente ya no coincide con ninguna aceptada");
    assert.deepEqual(await aceptar(b.admin, { vivo: cambiada, hashVisto: hashSnapshot(cambiada) }), { ok: true, version: 2, repetida: false });
    assert.equal(JSON.stringify(b.aceptaciones[0]), v1, "la v1 no se tocó");
    assert.equal(b.aceptaciones[0].snapshot.detalle.totalPagar, 427_200); assert.equal(b.aceptaciones[1].snapshot.detalle.totalPagar, 432_000);
    // volver al contenido original reconoce la v1 (no crea una v3)
    assert.deepEqual(await aceptar(b.admin), { ok: true, version: 1, repetida: true });
  });
  test("sin imagen de firma no se acepta", async () => {
    const b = crearBase();
    const r = await aceptar(b.admin);
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /sube la imagen de tu firma/i); assert.equal(b.aceptaciones.length, 0);
  });
  test("aislamiento: B no acepta la cuenta de A; interno, agencia, no dueño y anónimo tampoco; la base no se toca", async () => {
    const b = crearBase(); await conFirma(b); const antes = b.rpcs.length;
    const ctxB = ctxLaura({ usuario: { id: "u-b", aliado_id: 8 } });
    for (const e of [{ ctx: ctxB }, { r: comision({ esInterno: true }) }, { r: comision({ esDueno: false }) }, { r: comision({ tipoAsesorEfectivo: "agencia" }) }, { ctx: ctxLaura({}, { tipo: "agencia" }) }, { ctx: null }, { userId: null }]) {
      const r = await aceptar(b.admin, e as never);
      assert.equal(r.ok, false, JSON.stringify(Object.keys(e)));
    }
    assert.equal(b.aceptaciones.length, 0); assert.equal(b.rpcs.length, antes);
  });
  test("la firma de A no se usa para aceptar una cuenta de B aunque se pida por la ficha de A (el servidor toma la ficha de la cuenta)", async () => {
    const b = crearBase(); await conFirma(b);
    const deB = comision({ aliadoInfo: ficha(8, "Otro"), aliado: "Otro" });
    const r = await aceptar(b.admin, { r: deB, vivo: vivoDe(deB) });
    assert.equal(r.ok, false); assert.equal(b.aceptaciones.length, 0);
  });
  test("fallo de la base → error genérico, nunca éxito", async () => {
    const b = crearBase({ fallaRpc: true });
    const r = await aceptar(b.admin);
    assert.equal(r.ok, false);
  });
});

describe("lectura: la imagen solo sale del aliado correcto y sin alterar", () => {
  test("data URI válida; firma de otro aliado, bytes alterados, firma inexistente o storage caído → null", async () => {
    const b = crearBase(); await conFirma(b);
    const id = b.firmas[0].id;
    const uri = await firmaDataUri(b.admin, id, 7);
    assert.equal(uri, `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    assert.equal(await firmaDataUri(b.admin, id, 8), null, "otro aliado");
    assert.equal(await firmaDataUri(b.admin, 999, 7), null);
    b.objetos.set(b.firmas[0].storage_path, new Uint8Array([1, 2, 3]));
    assert.equal(await firmaDataUri(b.admin, id, 7), null, "bytes alterados");
    b.objetos.clear();
    assert.equal(await firmaDataUri(b.admin, id, 7), null, "objeto ausente");
  });
  test("leerAceptaciones distingue «sin versiones» de «no se pudo leer»", async () => {
    const b = crearBase();
    assert.deepEqual(await leerAceptaciones(b.admin, "ab:31"), { ok: true, filas: [] });
    const roto = { ...b.admin, from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "x" } }) }) }) }) }) } as unknown as AdminFirmas;
    assert.deepEqual(await leerAceptaciones(roto, "ab:31"), { ok: false });
  });
});
