import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const migracion = leer("supabase/migrations/20260601000202_crm_leads.sql");
const acciones = leer("app/(crm)/crm/leads/actions.ts");
const layoutCrm = leer("app/(crm)/layout.tsx");
const catalogos = leer("lib/crm/leads.ts");
const tipos = leer("types/database.ts");
const paginaLista = leer("app/(crm)/crm/leads/page.tsx");
const paginaDetalle = leer("app/(crm)/crm/leads/[id]/page.tsx");

describe("CRM leads MVP: wiring de seguridad", () => {
  test("las acciones usan cliente de sesion, nunca service-role", () => {
    assert.match(acciones, /import \{ createClient \} from "@\/lib\/supabase\/server";/);
    assert.doesNotMatch(acciones, /createAdminClient|service_role|SUPABASE_SERVICE_ROLE/);
  });

  test("roles del MVP excluyen operaciones, control_vuelo y roles externos", () => {
    assert.match(catalogos, /CRM_LEAD_ROLES = \["superadmin", "gerencia", "administracion", "venta"\]/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*operaciones/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*control_vuelo/);
    assert.doesNotMatch(catalogos, /CRM_LEAD_ROLES = \[[^\]]*agencia/);
  });

  test("la migracion no repite la policy amplia de crm_contactos", () => {
    assert.doesNotMatch(migracion, /auth\.uid\(\)\s+is\s+not\s+null/);
    assert.doesNotMatch(migracion, /using\s*\(\s*true\s*\)/);
    assert.match(migracion, /crm_lead_puede_ver\(tenant, responsable_id\)/);
  });

  test("sin borrado fisico: leads bloquean delete y actividades son append-only", () => {
    assert.match(migracion, /Los leads no se eliminan fisicamente/);
    assert.match(migracion, /crm_lead_actividades_append_only/);
    assert.doesNotMatch(migracion, /create policy "crm_leads: eliminar"/);
  });

  test("catalogos de TypeScript coinciden con los CHECK de SQL", () => {
    assert.match(catalogos, /CRM_LEAD_ETAPAS = \["nuevo", "en_contacto", "calificado", "descartado", "archivado"\]/);
    assert.match(migracion, /check \(etapa in \('nuevo', 'en_contacto', 'calificado', 'descartado', 'archivado'\)\)/);
    assert.match(catalogos, /CRM_LEAD_CANALES = \["whatsapp", "instagram", "otro"\]/);
    assert.match(migracion, /check \(canal in \('whatsapp', 'instagram', 'otro'\)\)/);
  });

  test("la NAV del CRM expone la bandeja de leads", () => {
    assert.match(layoutCrm, /href: "\/crm\/leads", label: "Leads"/);
  });

  test("types/database.ts declara las dos tablas nuevas", () => {
    assert.match(tipos, /crm_leads: \{/);
    assert.match(tipos, /crm_lead_actividades: \{/);
  });
});

// ---------------------------------------------------------------------------
// Autorización propia. El layout `/crm` solo exige sesión: si estas pruebas
// fallan, la pantalla queda abierta para cualquier usuario autenticado.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: cada ruta y cada action autorizan por si mismas", () => {
  test("las DOS rutas validan rol, no solo la sesion del layout", () => {
    for (const [nombre, src] of [["bandeja", paginaLista], ["detalle", paginaDetalle]] as const) {
      assert.match(src, /auth\.getUser\(\)/, `${nombre} no valida sesion`);
      assert.match(src, /from\("usuarios"\)/, `${nombre} no lee el rol`);
      assert.match(src, /CRM_LEAD_ROLES\.includes/, `${nombre} no comprueba el rol`);
      // El perfil se lee del cliente de SESION, no de un cliente privilegiado.
      assert.match(src, /createClient\(\)/, `${nombre} no usa el cliente de servidor`);
      assert.doesNotMatch(src, /createAdminClient|service_role/, `${nombre} usa cliente privilegiado`);
    }
  });

  test("el layout /crm NO es la autorizacion: no filtra por rol", () => {
    // Si el layout llegara a filtrar por rol, el test passaria mientras una
    // ruta nueva colada se saltaria el control. Se afirma lo contrario a
    // proposito: el layout solo pide sesion.
    assert.doesNotMatch(layoutCrm, /CRM_LEAD_ROLES/, "el layout no debe autorizar leads");
    assert.doesNotMatch(layoutCrm, /redirect\("\/dashboard"\)/, "el layout no debe expulsar por rol");
  });

  test("toda action que toca datos comprueba el rol antes de actuar", () => {
    const exports = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.ok(exports.length >= 5, `solo hay ${exports.length} actions`);

    // Las que SI escriben o leen de la base deben filtrar por rol.
    const cuerpos = acciones.split(/export async function /).slice(1);
    for (const c of cuerpos) {
      const nombre = c.slice(0, c.indexOf("("));
      const tocaBase = /\.from\("crm_leads"\)|\.from\("usuarios"\)|\.from\("crm_lead_actividades"\)/.test(c);
      if (!tocaBase) {
        // Un getter de constante no filtra datos de la BD: no necesita auth.
        // Se admite solo si no escribe nada.
        assert.doesNotMatch(c, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, `${nombre} escribe sin ser de lectura`);
        continue;
      }
      assert.match(
        c,
        /autorizado\(perfil\)|CRM_LEAD_ROLES/,
        `${nombre} lee o escribe sin comprobar el rol`,
      );
    }
  });

  test("los getters publicos de catalogos no exponen datos", () => {
    // `proximasEtapas` devuelve una constante de `lib/crm/leads`, que es
    // importable por cualquiera: no filtra nada y por eso no necesita auth.
    const cuerpo = acciones.slice(acciones.indexOf("export async function proximasEtapas"));
    // Desde 1: en 0 está la propia función que delimita el bloque.
    const fin = cuerpo.indexOf("export async function", 1);
    const fn = fin > 0 ? cuerpo.slice(0, fin) : cuerpo;
    assert.match(fn, /CRM_LEAD_ETAPAS/);
    assert.doesNotMatch(fn, /\.from\(/, "un getter de constante no debe tocar la base");
  });

  test("reasignar a terceros queda limitado a gerencia/administracion/superadmin", () => {
    assert.match(acciones, /function puedeAsignar/);
    const fn = acciones.slice(acciones.indexOf("function puedeAsignar"));
    assert.match(fn, /\["superadmin", "gerencia", "administracion"\]/);
    // Y las dos rutas de reasignacion (crear y actualizar) la consultan.
    const rechecks = (acciones.match(/!puedeAsignar\(perfil\)/g) ?? []).length;
    assert.ok(rechecks >= 2, `solo ${rechecks} guards de reasignacion; se esperan crear y actualizar`);
  });
});

// ---------------------------------------------------------------------------
// Matriz de roles en RLS. Esto es lo que impide que `venta` vea la cartera
// completa o se robe leads de otro.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: RLS codifica la matriz de roles", () => {
  test("venta solo ve su tenant y leads sin responsable o suyos", () => {
    // Aparece en las tres funciones de policy: ver, insertar y actualizar.
    const ramas = (migracion.match(/when public\.mi_rol\(\) = 'venta' then/g) ?? []).length;
    assert.ok(ramas >= 3, `la rama 'venta' aparece ${ramas} veces; se esperan ver/insertar/actualizar`);
    assert.match(
      migracion,
      /when public\.mi_rol\(\) = 'venta' then public\.mi_tenant\(\) = p_tenant and \(p_responsable is null or p_responsable = auth\.uid\(\)\)/,
      "venta debe limitarse a su tenant y a leads sin responsable o propios",
    );
  });

  test("venta no puede reasignar a terceros", () => {
    assert.match(
      migracion,
      /and p_responsable_nuevo = auth\.uid\(\)/,
      "al actualizar, venta solo puede quedar como responsable",
    );
  });

  test("superadmin, gerencia y administracion tienen alcances distintos", () => {
    assert.match(migracion, /when public\.mi_rol\(\) = 'superadmin' then true/);
    assert.match(migracion, /when public\.mi_rol\(\) = 'gerencia' then public\.puede_ver_tenant\(p_tenant\)/);
    assert.match(migracion, /when public\.mi_rol\(\) = 'administracion' then public\.mi_tenant\(\) = p_tenant/);
  });

  test("operaciones, control_vuelo y externos caen en el else (false)", () => {
    // La rama `else false` es la negacion por defecto de cada policy.
    const falsos = (migracion.match(/else\s+false\s+end/g) ?? []).length;
    assert.ok(falsos >= 3, `solo ${falsos} cierres 'else false'; se esperan ver/insertar/actualizar`);
  });

  test("el responsable debe existir, estar activo y tener rol comercial", () => {
    assert.match(migracion, /u\.rol in \('gerencia', 'administracion', 'venta'\)/);
    assert.match(migracion, /u\.activo is true/);
  });

  test("RLS habilitado y sin policy de delete", () => {
    assert.match(migracion, /alter table public\.crm_leads enable row level security/);
    assert.match(migracion, /alter table public\.crm_lead_actividades enable row level security/);
    assert.doesNotMatch(migracion, /for delete to authenticated/);
  });

  test("tenant obligatorio e inmutable", () => {
    assert.match(migracion, /tenant text not null default 'mayorista' check \(tenant in \('mayorista', 'minorista'\)\)/);
    assert.match(migracion, /No se puede cambiar el tenant de un lead existente/);
  });
});

// ---------------------------------------------------------------------------
// El MVP no hace una cosa mas de lo pactado.
// ---------------------------------------------------------------------------

describe("CRM leads MVP: alcance cerrado", () => {
  test("no reutiliza crm_contactos ni convierte leads en contactos", () => {
    for (const [nombre, src] of [
      ["acciones", acciones],
      ["lib/crm/leads.ts", catalogos],
      ["migracion", migracion],
      ["bandeja", paginaLista],
      ["detalle", paginaDetalle],
    ] as const) {
      assert.doesNotMatch(src, /from\("crm_contactos"\)/, `${nombre} escribe en crm_contactos`);
      assert.doesNotMatch(src, /insertar_contacto|convertirLead|convertir lead/i, `${nombre} convierte a contacto`);
    }
  });

  test("no toca cotizaciones, contratos ni ventas", () => {
    for (const [nombre, src] of [
      ["acciones", acciones],
      ["migracion", migracion],
      ["bandeja", paginaLista],
      ["detalle", paginaDetalle],
    ] as const) {
      assert.doesNotMatch(src, /from\("cotizaciones"\)|from\("contratos"\)|from\("ventas"\)/, `${nombre} toca ventas`);
    }
  });

  test("sin Meta, API externa, envio de mensajes ni bot", () => {
    const codigo = [acciones, paginaLista, paginaDetalle, catalogos, migracion]
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const token of [
      "graph.facebook",
      "api.whatsapp",
      "instagram.com",
      "webhook",
      "sendMessage",
      "wamid",
      "openai",
      "anthropic",
    ]) {
      assert.ok(!codigo.toLowerCase().includes(token.toLowerCase()), `aparece ${token}`);
    }
    // `instagram` sí aparece, pero SOLO como origen manual del lead.
    assert.match(catalogos, /CRM_LEAD_CANALES = \["whatsapp", "instagram", "otro"\]/);
  });
});
