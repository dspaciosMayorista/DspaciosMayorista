// #98 — guardas de cableado (complementan, no sustituyen, las pruebas de comportamiento de cuentaCobro98.test.ts / .react.ts):
// la firma nunca sale por una URL pública, y el documento/aceptación solo se leen/escriben DESPUÉS de la autorización del documento por el mismo resolvedor de siempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PAGINA = "app/portal/comision/[numero]/page.tsx";
const ACCION = "app/portal/comision/[numero]/acciones.ts";
const FIRMA_ACCION = "app/portal/b2b/perfil/firma-actions.ts";
const ARCHIVOS = ["lib/cuentaCobro/snapshot.ts", "lib/cuentaCobro/servidor.ts", PAGINA, ACCION, FIRMA_ACCION, "components/portal/CuentaCobroDocumento.tsx", "components/portal/AceptarCuenta.tsx", "components/portal/FirmaAliado.tsx", "components/portal/FirmaAliadoSeccion.tsx"];

test("la imagen de firma no sale por una URL pública ni firmada: solo data URI tras autorizar", () => {
  for (const f of ARCHIVOS) {
    const src = leer(f);
    assert.doesNotMatch(src, /getPublicUrl|createSignedUrl|createSignedUrls/, `${f} expone una URL de Storage`);
  }
  assert.match(leer("lib/cuentaCobro/servidor.ts"), /data:\$\{f\.mime\};base64/);
  assert.match(leer("supabase/migrations/20260601000318_cuenta_cobro_firma_aceptacion.sql"), /'aliado-firmas', 'aliado-firmas', false/, "el bucket debe ser PRIVADO");
});

test("la página resuelve (y autoriza) el documento ANTES de leer aceptaciones, y lee solo la clave derivada de ese documento", () => {
  const src = leer(PAGINA);
  assert.ok(src.indexOf("resolverComisionB2B(numero") < src.indexOf("leerAceptaciones("), "primero el resolvedor con control de acceso");
  assert.match(src, /leerAceptaciones\(admin, vivo\.clave\)/);
  assert.doesNotMatch(src, /searchParams[^;]*clave|sp\.clave/, "la clave nunca sale de la URL");
});

test("la acción de aceptar vuelve a resolver el documento con la sesión, y de la petición solo toma número, comisión y hash", () => {
  const src = leer(ACCION);
  assert.ok(src.indexOf("resolverComisionB2B(") < src.indexOf("aceptarCuentaServidor("));
  assert.match(src, /auth\.getUser\(\)/);
  assert.doesNotMatch(src, /entrada\??\.(clave|aliado|aliadoId|userId|usuario|firma)/, "la identidad/ficha no se lee del formulario");
});

test("la acción de subir la firma toma la ficha de la sesión, no del formulario, y limita el tamaño antes de leer el archivo", () => {
  const src = leer(FIRMA_ACCION);
  assert.match(src, /auth\.getUser\(\)/);
  assert.match(src, /form\?\.get\("firma"\)/);
  assert.doesNotMatch(src, /form\??\.get\("(aliado|aliado_id|aliadoId|usuario|userId)"\)/);
  assert.ok(src.indexOf("TAM_MAX_FIRMA") < src.indexOf("arrayBuffer()"));
});

test("el documento aceptado se dibuja desde el snapshot guardado, no se recalcula en vivo", () => {
  const src = leer(PAGINA);
  assert.match(src, /snap = mostrada\.snapshot/);
  const doc = leer("components/portal/CuentaCobroDocumento.tsx");
  assert.doesNotMatch(doc, /resolverComisionB2B|createAdminClient|createClient|new Date\(\)\.toISOString/, "el componente es puro: solo pinta el snapshot");
});

test("ningún texto de la interfaz presenta la aceptación como firma digital certificada", () => {
  for (const f of ["components/portal/CuentaCobroDocumento.tsx", "components/portal/AceptarCuenta.tsx", "components/portal/FirmaAliado.tsx"]) {
    const src = leer(f);
    assert.match(src, /no es una firma digital certificada|no una firma digital certificada/i, `${f} debe aclararlo`);
    assert.doesNotMatch(src.replace(/no (es )?una firma digital certificada/gi, ""), /firma digital|certificad|criptogr/i, `${f} sugiere una firma certificada`);
  }
});
