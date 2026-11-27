// #18 / Codex F2 — cableado del voucher aéreo atómico (el comportamiento real contra Postgres está en supabase/scripts/recorrido_block1.mjs (V1–V6)
// y supabase/scripts/test_336_337_conversion_voucher.sql (V1–V9)).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const acciones = leer("app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
const i = acciones.indexOf("export async function generarVoucherVuelo");
const cuerpo = acciones.slice(i, acciones.indexOf("export async function actualizarVoucher"));

describe("generarVoucherVuelo", () => {
  test("guarda con UNA llamada atómica para todos los servicios (rpc guardar_vouchers_vuelo) y no borra ni inserta por separado", () => {
    assert.ok(cuerpo.includes('sb.rpc("guardar_vouchers_vuelo"'));
    assert.ok(!/\.delete\(\)/.test(cuerpo), "no hay DELETE previo");
    assert.ok(!/from\("vouchers"\)\.insert/.test(cuerpo), "no hay INSERT directo");
  });
  test("las tres lecturas obligatorias se comprueban (contrato, vuelos, pasajeros) antes de construir", () => {
    assert.ok(cuerpo.includes("error: errVenta"));
    assert.ok(cuerpo.includes("error: errPasajeros"));
    assert.ok(cuerpo.indexOf("if (errPasajeros)") < cuerpo.indexOf("construirVouchersVuelo("));
    assert.ok(cuerpo.indexOf("if (errVuelos)") < cuerpo.indexOf("construirVouchersVuelo("));
  });
  test("la regeneración de los vouchers de servicios sigue sin tocar hotel ni vuelo", () => {
    assert.ok(acciones.includes('.not("tipo", "in", "(hotel,vuelo)")'));
  });
});

describe("migración 337 (estado intermedio: la 338 reemplaza su índice y su función)", () => {
  const mig = leer("supabase/migrations/20260601000337_voucher_vuelo_atomico.sql");
  test("índice único parcial por contrato y función INVOKER de una sola sentencia", () => {
    assert.ok(/create unique index vouchers_vuelo_uno_por_contrato on public\.vouchers \(numero_contrato\) where tipo = 'vuelo'/.test(mig));
    assert.ok(/security invoker/.test(mig));
    assert.ok(/on conflict \(numero_contrato\) where tipo = 'vuelo'\s+do update set contenido = excluded\.contenido/.test(mig));
    assert.ok(!/delete from|drop /i.test(mig.replace(/--.*$/gm, "")), "no borra nada");
  });
  test("se niega a instalarse si hay duplicados (no los borra)", () => {
    assert.ok(mig.includes("having count(*) > 1"));
  });
});

describe("migración 336", () => {
  const mig = leer("supabase/migrations/20260601000336_conversion_cotizacion_reclamo.sql");
  test("reclamo atómico con vencimiento y solo service_role", () => {
    assert.ok(mig.includes("on conflict (cotizacion_id) do update"));
    assert.ok(mig.includes("where r.expira_en <= now()"));
    assert.ok(mig.includes("grant execute on function public.reclamar_conversion_cotizacion(bigint, integer) to service_role"));
    assert.ok(!/grant execute[^;]*to (anon|authenticated)/.test(mig));
  });
});

describe("texto del voucher (Codex F4)", () => {
  const doc = leer("components/voucher/VoucherVueloDocumento.tsx");
  test("no afirma que todos los pasajeros viajen todos los tramos", () => {
    assert.ok(!/aplican a la reserva completa/i.test(doc));
    // Rev2: el texto vive en UN solo lugar (lib/voucher/vuelo.ts) y el documento lo renderiza para cualquier visitante.
    assert.ok(leer("lib/voucher/vuelo.ts").includes("no hay registrada una asignación de pasajero a tramo"));
    assert.ok(doc.includes("NOTA_PASAJEROS_TRAMOS"));
  });
});
