// #65 — /portal ya no es una pantalla de elección: redirige según la sesión, sin bucles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { destinoPortal } from "../lib/portal/b2bPortal.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const interno = (rol: string | null, activo: boolean | null = true) => ({ estado: "interno" as const, perfil: { rol, activo } });

test("destino por estado: aliado y registro en revisión → inicio B2B; visitante → acceso", () => {
  assert.equal(destinoPortal({ estado: "ok" }), "/portal/b2b");
  assert.equal(destinoPortal({ estado: "pendiente" }), "/portal/b2b");
  assert.equal(destinoPortal({ estado: "visitante" }), "/login");
});

test("solo los roles internos autorizados van a /dashboard (todos los de ROLES_INTERNOS)", () => {
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta", "control_vuelo"]) {
    assert.equal(destinoPortal(interno(rol)), "/dashboard", rol);
    assert.equal(destinoPortal(interno(rol, null)), "/dashboard", `${rol} con activo sin definir (igual que el proxy)`);
  }
});

test("cliente_final autenticado → /tarifario (ruta pública); nunca al dashboard", () => {
  assert.equal(destinoPortal(interno("cliente_final")), "/tarifario");
});

test("cuenta desactivada → /login?inactivo=1, también si el rol es interno", () => {
  for (const rol of ["superadmin", "venta", "cliente_final", null]) assert.equal(destinoPortal(interno(rol, false)), "/login?inactivo=1", String(rol));
});

test("sin perfil (sin fila en usuarios), rol vacío o desconocido → /login?sinperfil=1, nunca /dashboard", () => {
  assert.equal(destinoPortal({ estado: "interno", perfil: null }), "/login?sinperfil=1");
  for (const rol of [null, "", "publico", "admin", "SUPERADMIN"]) assert.equal(destinoPortal(interno(rol)), "/login?sinperfil=1", String(rol));
});

test("ningún destino vuelve a /portal (sin bucle) y los destinos no redirigen de regreso", () => {
  const casos = [{ estado: "ok" as const }, { estado: "pendiente" as const }, { estado: "visitante" as const }, interno("venta"), interno("cliente_final"), interno(null, false), interno(null), { estado: "interno" as const, perfil: null }];
  for (const c of casos) {
    const d = destinoPortal(c);
    assert.ok(!/^\/portal\/?(\?|$)/.test(d), d);
  }
  // /login, /tarifario y /portal/b2b son páginas que se muestran (el proxy no las redirige a /portal).
  assert.doesNotMatch(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"), /redirect\(new URL\("\/portal"[,)]/);
});

test("la página /portal solo redirige: sin tarjetas Portal Admin / Portal B2B ni emojis", () => {
  const s = leer("app/portal/page.tsx");
  assert.match(s, /redirect\(destinoPortal\(ctx\)\)/);
  assert.doesNotMatch(s, /Portal Admin|Portal B2B|Elige cómo/);
  assert.doesNotMatch(s, /\p{Extended_Pictographic}/u);
});

test("el logo del portal B2B lleva a /portal/b2b y nada enlaza ya a /portal a secas", () => {
  assert.match(leer("components/portal/PortalShell.tsx"), /href="\/portal\/b2b" aria-label="D'spacios Travel, inicio del portal"/);
  for (const f of ["components/portal/PortalShell.tsx", "components/portal/PortalGate.tsx", "app/pagar/page.tsx", "app/portal/b2b/page.tsx"]) {
    assert.doesNotMatch(leer(f), /href="\/portal"/, f);
  }
});
