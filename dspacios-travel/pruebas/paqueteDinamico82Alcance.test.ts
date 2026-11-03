// #82 — alcance por agencia de la pestaña «Dinámicos» y destinos_extra (reglas puras + cableado de código).
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Pestaña «Dinámicos»: qué agencia se muestra", async () => {
  const { tenantDinamicosVisibles } = await import("../lib/paqueteDinamico/solicitud.ts");
  const p = (rol: string, tenant: string | null, activo = true) => ({ rol, activo, tenant });

  test("visitante sin sesión → públicos de Mayorista", () => assert.equal(tenantDinamicosVisibles(null, "minorista"), "mayorista"));
  test("aliado B2B → los de SU agencia (Mayorista o Minorista)", () => {
    assert.equal(tenantDinamicosVisibles(p("agencia", "mayorista"), "minorista"), "mayorista");
    assert.equal(tenantDinamicosVisibles(p("freelance", "minorista"), "mayorista"), "minorista");
    assert.equal(tenantDinamicosVisibles(p("agencia", "minorista"), "mayorista"), "minorista");
  });
  test("personal interno → la agencia activa", () => {
    assert.equal(tenantDinamicosVisibles(p("venta", "mayorista"), "mayorista"), "mayorista");
    assert.equal(tenantDinamicosVisibles(p("administracion", "minorista"), "minorista"), "minorista");
  });
  test("usuario inactivo o sin canal (cliente_final, control_vuelo) → como visitante", () => {
    for (const x of [p("agencia", "minorista", false), p("cliente_final", "minorista"), p("control_vuelo", "minorista")]) assert.equal(tenantDinamicosVisibles(x, "minorista"), "mayorista");
  });
  test("un tenant desconocido nunca abre otra agencia", () => assert.equal(tenantDinamicosVisibles(p("agencia", "otra"), "x"), "mayorista"));
});

describe("Cableado", () => {
  test("el cargador público filtra por la agencia de la sesión y no por «mayorista» fijo", () => {
    const src = sinComentarios(leer("lib/paqueteDinamico/cargarPublico.ts"));
    assert.match(src, /tenantDinamicosVisibles\(/);
    assert.match(src, /\.eq\("tenant", tenant\)/);
    assert.doesNotMatch(src, /\.eq\("tenant", "mayorista"\)/);
  });
  test("la salida del cargador sigue siendo la vista solo-PVP", () => {
    const src = sinComentarios(leer("lib/paqueteDinamico/cargarPublico.ts"));
    assert.match(src, /vistaPublica\(/);
  });
  test("la cotización exige la misma agencia: B2B por su tenant, visitante solo Mayorista", () => {
    const src = sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts"));
    assert.match(src, /canal === "publico" \? p\.tenant === "mayorista"/);
    assert.match(src, /sesion\.tenant === p\.tenant/);
  });
});

describe("destinos_extra (arreglo sin FK) en la migración 275", () => {
  const sql = sinComentarios(leer("supabase/migrations/20260601000275_paquete_dinamico_auditoria.sql"));
  test("el conteo de uso incluye el destino adicional", () => assert.match(sql, /p_destino = any \(destinos_extra\)/));
  test("borrar un destino adicional en uso se rechaza (guarda en destinos)", () => {
    assert.match(sql, /create trigger trg_din_destino_extra_guard before delete on public\.destinos/);
    assert.match(sql, /DIN_82_DESTINO_EN_USO/);
  });
  test("la fusión reapunta destinos_extra antes de borrar el origen", () => {
    const f = sql.slice(sql.search(/create or replace function public\.fn_fusionar_destino/i));
    assert.ok(f.indexOf("update public.paquete_din p") > 0 && f.indexOf("update public.paquete_din p") < f.indexOf("delete from public.destinos where id = p_origen"));
  });
});

describe("destinos_extra: cada id debe existir (validación en la base)", () => {
  const sql = sinComentarios(leer("supabase/migrations/20260601000275_paquete_dinamico_auditoria.sql"));
  test("trigger en la tabla (cubre guardar_paquete_din y escrituras directas) antes de insertar o actualizar el arreglo", () => {
    assert.match(sql, /create trigger trg_din_destinos_extra_validos before insert or update of destinos_extra on public\.paquete_din/);
    assert.match(sql, /DIN_82_DESTINO: los destinos adicionales/);
  });
  test("bloquea el borrado concurrente (FOR SHARE) y rechaza valores vacíos", () => {
    assert.match(sql, /from public\.destinos where id = any \(v_ids\) for share/);
    assert.match(sql, /array_position\(new\.destinos_extra, null\)/);
  });
  test("guardar_paquete_din no esquiva la tabla: escribe destinos_extra con INSERT/UPDATE sobre paquete_din", () => {
    const g = sql.slice(sql.search(/create or replace function public\.guardar_paquete_din/));
    assert.match(g, /insert into public\.paquete_din/);
    assert.match(g, /update public\.paquete_din t/);
  });
});

describe("CRM del titular según el canal (hallazgo de la verificación en local)", () => {
  const src = sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts"));
  test("el visitante va al contacto de CRM del checkout (el registro de personas rechaza anónimos que no sean carrito)", () => {
    assert.match(src, /canal === "publico"[\s\S]{0,400}from\("crm_contactos"\)\.insert\(/);
    assert.match(src, /tenant: "mayorista"/);
  });
  test("con sesión (B2B o personal) sigue el registro de personas", () => {
    assert.match(src, /else \{\s*alta = await altaPersonasCotizacion\(/);
  });
});

describe("Documento público por token de una cotización manual", () => {
  const src = sinComentarios(leer("app/cot/[token]/page.tsx"));
  test("/cot/[token] usa el documento de cotización manual (ContratoDocumento mostraba «$ NaN» con esos ítems)", () => {
    assert.match(src, /const esManual = esSnapshotManual\(itemsSnap\);/);
    assert.match(src, /esManual \? \(\s*<CotizacionManualDocumento/);
  });
  test("la consulta del enlace público no cambió y no lee `payload` (datos internos)", () => {
    assert.doesNotMatch(src, /payload/);
  });
});

describe("la pestaña «Dinámicos» no importa código de servidor", () => {
  test("PorDinamicos recibe la Server Action por prop (import solo de tipo); la pasa la página", () => {
    const ui = sinComentarios(leer("app/tarifario/PorDinamicos.tsx"));
    assert.doesNotMatch(ui, /import \{[^}]*crearCotizacionDin[^}]*\} from/);
    assert.match(ui, /import type \{ CrearCotizacionDinInput \}/);
    assert.match(sinComentarios(leer("app/tarifario/page.tsx")), /cotizarDinamico=\{crearCotizacionDin\}/);
    assert.match(sinComentarios(leer("app/tarifario/TarifarioPublic.tsx")), /<PorDinamicos dinamicos=\{dinamicos\} cotizar=\{/);
  });
});
