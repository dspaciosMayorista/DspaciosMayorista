// #97 — contrato manual ASISTIDO en PVP: la comisión del aliado debe quedar registrada al crear el contrato.
//
// Defecto reproducido (antes del arreglo): `crearContrato` solo aplicaba la comisión en NETO; en PVP el contrato nacía
// con la comisión "Por definir" y había que volver a ingresarla en Comisiones. Esta prueba lee el código (mismo estilo
// que contratoManualNeto.test.ts); la base (duplicados, concurrencia, permisos) la cubre la migración 205 y su prueba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(raiz, "app/(dashboard)/dashboard/contratos/actions.ts"), "utf8");
const cuerpo = src.slice(src.indexOf("export async function crearContrato"));

test("PVP B2B manual: valida aliado y % ANTES de numerar", () => {
  const iNumero = cuerpo.indexOf("// Número de contrato — se genera AQUÍ");
  const iValida = cuerpo.indexOf("resolverAliadoReserva(");
  assert.ok(iValida > 0, "falta resolverAliadoReserva en crearContrato");
  assert.ok(iValida < iNumero, "la validación del aliado debe ir antes de numerar");
});

test("PVP B2B manual: registra la comisión con la misma función que reservar, solo sin NETO", () => {
  const i = cuerpo.indexOf("registrarComisionReserva(sb, numero");
  assert.ok(i > 0, "crearContrato no registra la comisión del aliado en PVP");
  assert.match(cuerpo.slice(Math.max(0, i - 400), i), /!planNeto/, "no debe tocar el contrato NETO (su comisión ya la aplica aplicar_neto_contrato_manual)");
  assert.match(cuerpo, /const registraComisionPvp = modoCompraManual === "pvp" && tipoVenta !== "interno";/);
});

test("negociado B2B PVP: nace pendiente y se cierra SOLO después de copiar los costos; si no, se deshace", () => {
  assert.ok(cuerpo.includes('...(negociadoB2B ? { financiero_estado: "pendiente" } : {})'));
  const iCopia = cuerpo.indexOf("costosCopiados = {");
  const iCierre = cuerpo.indexOf("if (falloCopia) return deshacer(falloCopia);");
  const iFin = cuerpo.indexOf("costos: costosCopiados ?? {}, cxp: []");
  assert.ok(iCopia > 0 && iCierre > iCopia && iFin > iCierre, "el cierre va después de la copia y de comprobar que no falló");
  assert.ok(cuerpo.includes("requiereCopiaCostos && !process.env.SUPABASE_SERVICE_ROLE_KEY"));
});

test("PVP B2B manual: si la comisión falla se revierte el contrato (nunca B2B sin comisión)", () => {
  const i = cuerpo.indexOf("registrarComisionReserva(sb, numero");
  assert.match(cuerpo.slice(i, i + 900), /revertirContratoManual\((idc, )?numero, tenant\)/);
});

test("el asesor interno no es beneficiario: la RPC recibe el aliado del catálogo, no el asesor", () => {
  assert.match(cuerpo, /registrarComisionReserva\(sb, numero, input\.aliadoId as number\)/);
});
