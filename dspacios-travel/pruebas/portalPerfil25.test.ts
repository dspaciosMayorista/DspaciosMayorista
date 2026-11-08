// #25 (bloque B) — Mi perfil, solo consulta. FIXTURES LOCALES inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarPerfil, enmascararCuenta, CAMPOS_PERFIL, type AliadoFicha } from "../lib/portal/perfilPortal.ts";

const ficha: AliadoFicha = {
  nombre: "Viajes Prueba SAS", nit: "900123456-7", tipo_documento: "NIT", contacto: "Ana Prueba", email: "contacto@prueba.test", telefono: "3000000000",
  direccion: "Calle 1 # 2-3", banco: "Banco Falso", tipo_cuenta: "Ahorros", numero_cuenta: "1234567890", aplica_retencion: true, pct_retencion: 0.11,
};
const perfil = { nombre: "Viajes Prueba SAS", email: "acceso@prueba.test", rol: "agencia", pct_comision: 0.12 };
const items = (p: ReturnType<typeof armarPerfil>) => p.grupos.flatMap((g) => g.items);

test("la cuenta bancaria sale enmascarada: el número completo no llega al DTO", () => {
  assert.equal(enmascararCuenta("1234 5678 90"), "•••• 7890");
  assert.equal(enmascararCuenta("12"), "••••");
  assert.equal(enmascararCuenta(null), null);
  assert.ok(!JSON.stringify(armarPerfil(perfil, ficha, "agencia")).includes("1234567890"));
});

test("agencia muestra persona de contacto; freelance no", () => {
  assert.ok(items(armarPerfil(perfil, ficha, "agencia")).some((i) => i.id === "contacto" && i.valor === "Ana Prueba"));
  assert.ok(!items(armarPerfil({ ...perfil, rol: "freelance" }, ficha, "freelance")).some((i) => i.id === "contacto"));
  assert.equal(armarPerfil(perfil, ficha, "freelance").titulo, "Perfil de freelance");
});

test("sin ficha: datos ausentes explícitos (null), nada inventado", () => {
  const p = armarPerfil(perfil, null, "freelance");
  assert.equal(p.sinFicha, true);
  assert.equal(items(p).find((i) => i.id === "documento")!.valor, null);
  assert.equal(items(p).find((i) => i.id === "retencion")!.valor, null);
});

test("política: rol, activo, tenant, comisión, acceso legacy y vínculo de ficha son internos; identidad, documento y banco exigen aprobación", () => {
  const q = (id: string) => CAMPOS_PERFIL.find((c) => c.id === id)!.quien;
  for (const id of ["rol_activo_tenant", "categoria", "acceso_legacy", "vinculo_ficha", "retencion", "tipo"]) assert.equal(q(id), "interno", id);
  for (const id of ["nombre", "documento", "banco", "email_acceso"]) assert.equal(q(id), "aprobacion", id);
  assert.ok(!CAMPOS_PERFIL.some((c) => ["rol_activo_tenant", "categoria", "acceso_legacy", "vinculo_ficha"].includes(c.id) && c.quien === "editable_propuesto"));
});

test("la página solo lee: sin escrituras y con la ficha resuelta en servidor (no por parámetros del navegador)", () => {
  const s = readFileSync(new URL("../app/portal/b2b/perfil/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(s, /\.(insert|update|upsert|delete)\(|"use server"|searchParams|params/);
  assert.match(s, /ctx\.aliadoId/);
  assert.doesNotMatch(s, /\.select\("\*"\)/);
});
