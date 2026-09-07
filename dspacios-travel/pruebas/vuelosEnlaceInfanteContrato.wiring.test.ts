// Cableado del enlace "Editar en contrato" en los renglones SUBORDINADOS de
// infantes de los manifiestos de vuelo (detalle de bloqueo y listado global
// de pasajeros):
//   - La autorización ("¿puede ESTE usuario abrir ese contrato y de qué tenant
//     ES?") se decide con el cliente de SESIÓN y en LOTE, delegando en el
//     módulo compartido `lib/vuelos/enlaceContrato.ts`
//     (`contratosQuePuedeAbrir` → mapa número→tenant REAL de `ventas.tenant`).
//     Nunca se resuelve en la página con `.from("ventas")`, nunca con un
//     cliente admin/service-role, y nunca se deduce/antepone el prefijo "MIN-".
//   - El selector puro (`enlaceContratoEnVuelo`) falla cerrado ante el caso
//     cross-tenant: un contrato del OTRO tenant solo baja como enlace si quien
//     mira PUEDE cambiar la agencia activa (`tenantContext().puedeCambiar`, solo
//     superadmin). Quien no puede cambiar NO recibe el enlace (abrirlo lo
//     dejaría en la agencia equivocada).
//   - Cuando el enlace sí existe, el SERVIDOR baja el objeto
//     `{ numeroContrato, tenant }` (nunca un booleano) y el componente cliente
//     reutilizable `EnlaceEditarContrato` decide en el cliente la mecánica de
//     navegación: mismo tenant → enlace normal; distinto → llama (y espera) a
//     la Server Action `cambiarTenant` y navega con recarga COMPLETA solo si
//     responde `ok: true`; si no, error discreto y NO navega.
// La lógica pura/IO se prueba en pruebas/enlaceContrato.test.ts; acá se
// verifica el CABLEADO de ambas superficies + los dos componentes cliente.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";
const RUTA_PASAJEROS = "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx";
const RUTA_BUSCADOR = "app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx";
const RUTA_ENLACE = "components/vuelos/EnlaceEditarContrato.tsx";

const REG_IMPORT_MODULO = /import \{ contratosQuePuedeAbrir, enlaceContratoEnVuelo \} from "@\/lib\/vuelos\/enlaceContrato";/;
const REG_TENANT_CONTEXT = /const \{ tenant: tenantActivo, puedeCambiar: puedeCambiarTenant \} = await tenantContext\(\);/;
const REG_NUMEROS_BATCH = /const numerosContratosInfantes = \[\.\.\.infantesPorSillaId\.values\(\)\]\.flatMap\(\(infs\) =>\s*infs\.map\(\(inf\) => inf\.numeroContrato\)\s*\);/;

function esSuperficieServer(src: string): void {
  assert.match(src, REG_IMPORT_MODULO, "debe importar la autorización del módulo compartido lib/vuelos/enlaceContrato.ts");
  assert.match(src, REG_TENANT_CONTEXT, "debe leer el tenant ACTIVO y si puede cambiar la agencia desde tenantContext");
  assert.equal(src.split("contratosQuePuedeAbrir(").length - 1, 1, "debe haber exactamente UNA llamada en lote por página, nunca una por infante");
  assert.match(src, REG_NUMEROS_BATCH, "debe juntar en un solo arreglo el numeroContrato (el propio, real) de cada infante agrupado para el batch");
  assert.doesNotMatch(src, /\.from\(\s*["']ventas["']\s*\)/, "la página no debe consultar ventas directamente — la autorización vive en el módulo");
  assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/, "no debe tocar un cliente admin/service-role para decidir el enlace");
  assert.doesNotMatch(src, /["'`]MIN-["'`]\s*\+/, "la página no debe fabricar el prefijo de tenant — solo enlaza el numero_contrato interno real");
}

describe("vuelos/[id]/page.tsx — enlace 'Editar en contrato' autorizado en lote", () => {
  const src = leer(RUTA_BLOQUEO);

  test("importa la autorización del módulo compartido + el componente cliente + tenantContext (server surface correcta)", () => {
    esSuperficieServer(src);
    assert.match(src, /import \{ EnlaceEditarContrato \} from "@\/components\/vuelos\/EnlaceEditarContrato";/, "debe renderizar el componente cliente reutilizable");
    assert.match(src, /import \{ tenantContext \} from "@\/lib\/tenant\.server";/);
  });

  test("cada renglón de infante resuelve su enlace con el selector puro y su PROPIO numeroContrato contra el conjunto autorizado", () => {
    assert.ok(src.includes("enlaceContratoEnVuelo("), "debe llamar al selector puro en el renglón del infante");
    assert.ok(src.includes("inf.numeroContrato"), "el selector debe recibir el numero_contrato PROPIO del infante (real, no el heredado del adulto)");
    assert.ok(src.includes("contratosAutorizados"), "el selector debe decidir contra el conjunto autorizado por la RLS (mapa número→tenant)");
    assert.ok(src.includes("puedeCambiarTenant"), "el selector debe recibir si el usuario puede cambiar la agencia (fail-closed cross-tenant)");
  });

  test("el renglón renderiza EnlaceEditarContrato pasándole numeroContrato, tenant REAL y tenant activo", () => {
    const inicio = src.indexOf("<EnlaceEditarContrato");
    assert.ok(inicio > -1, "no encuentra el componente EnlaceEditarContrato en el renglón de infantes");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /numeroContrato=\{enlace\.numeroContrato\}/, "debe pasar el numero_contrato resuelto por el selector");
    assert.match(bloque, /tenantContrato=\{enlace\.tenant\}/, "debe pasar el tenant REAL del contrato (de ventas.tenant), no uno deducido del texto");
    assert.match(bloque, /tenantActivo=\{tenantActivo\}/, "debe pasar el tenant ACTIVO de la sesión para comparar");
  });

  test("el enlace vive en el renglón informativo del infante, que sigue sin asignar silla ni acciones de silla", () => {
    const inicio = src.indexOf("infantesPorSillaId.get(s.id)");
    assert.ok(inicio > -1, "no encuentra el renglón de infantes");
    const bloque = src.slice(inicio, inicio + 1500);
    assert.match(bloque, /No ocupa silla/, "debe conservar el distintivo 'No ocupa silla' en el mismo renglón");
    assert.doesNotMatch(bloque, /sillaId:/, "el infante sigue sin ocupar silla");
    assert.doesNotMatch(bloque, /PasajeroAcciones|SillaEstado|SillaContrato/, "el infante no gana acciones de silla con este enlace");
    assert.doesNotMatch(bloque, /<table/i, "el enlace no crea una tabla aparte");
  });
});

describe("vuelos/pasajeros/page.tsx — el servidor autoriza y el objeto {numeroContrato, tenant} baja al cliente", () => {
  const src = leer(RUTA_PASAJEROS);

  test("importa la autorización del MISMO módulo compartido + tenantContext y la resuelve en lote (server surface correcta)", () => {
    esSuperficieServer(src);
    assert.match(src, /import \{ tenantContext \} from "@\/lib\/tenant\.server";/);
  });

  test("cada fila de infante lleva enlaceEditarContrato = enlaceContratoEnVuelo(...) — objeto resuelto por el servidor, nunca un booleano", () => {
    const inicio = src.indexOf("const enlace = enlaceContratoEnVuelo(");
    assert.ok(inicio > -1, "no encuentra el selector puro en la construcción de filas de infantes");
    const bloque = src.slice(inicio, inicio + 400);
    assert.match(bloque, /inf\.numeroContrato/, "el selector debe recibir el numero_contrato PROPIO del infante");
    assert.match(bloque, /contratosAutorizados/, "debe decidir contra el conjunto autorizado por la RLS");
    assert.match(bloque, /tenantActivo,\s*puedeCambiarTenant/, "debe recibir tenant activo + permiso de cambiar (fail-closed cross-tenant)");
    assert.match(src, /enlaceEditarContrato: enlace \?\? undefined,/, "la fila debe exponer el objeto {numeroContrato, tenant} ya decidido por el servidor");
  });

  test("pasa el tenant ACTIVO a PasajerosBuscador para que el cliente sepa si hay que cambiar de agencia", () => {
    assert.match(src, /tenantActivo=\{tenantActivo\}/, "PasajerosBuscador debe recibir el tenant activo de la sesión");
  });
});

describe("PasajerosBuscador.tsx — el cliente renderiza SOLO lo que el servidor ya autorizó", () => {
  const src = leer(RUTA_BUSCADOR);

  test("usa el componente reutilizable EnlaceEditarContrato y le pasa numeroContrato, tenant REAL y tenant activo", () => {
    assert.match(src, /import \{ EnlaceEditarContrato \} from "@\/components\/vuelos\/EnlaceEditarContrato";/, "debe renderizar el componente compartido");
    const inicio = src.indexOf("<EnlaceEditarContrato");
    assert.ok(inicio > -1, "no encuentra el componente en el renglón de infantes");
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /numeroContrato=\{inf\.enlaceEditarContrato\.numeroContrato\}/, "debe pasar el numero_contrato que el servidor autorizó");
    assert.match(bloque, /tenantContrato=\{inf\.enlaceEditarContrato\.tenant\}/, "debe pasar el tenant REAL del contrato");
    assert.match(bloque, /tenantActivo=\{tenantActivo\}/, "debe pasar el tenant activo de la sesión");
  });

  test("el enlace está CONDICIONADO a que el servidor haya autorizado el objeto enlaceEditarContrato", () => {
    const inicio = src.indexOf("No ocupa silla");
    // Ventana ampliada (migración 168): entre el badge y el enlace ahora
    // también se renderiza el trigger de edición del infante
    // (InfanteVueloForm, condicionado a su propio candado) — el enlace
    // sigue siendo el siguiente condicional después de ese bloque.
    const bloque = src.slice(inicio, inicio + 1400);
    assert.match(bloque, /\{inf\.enlaceEditarContrato && \(/, "el enlace debe abrirse solo cuando el servidor resolvió el objeto autorizado");
  });

  test("el cliente NO autoriza ni decide cambiar de agencia: solo delega en EnlaceEditarContrato", () => {
    assert.doesNotMatch(src, /contratosQuePuedeAbrir|numeroContratoEnlazable|resolverManifiestoAutorizado|cambiarTenant/, "el listado no debe replicar la autorización del servidor ni el cambio de agencia");
    assert.doesNotMatch(src, /\bROLES_\w*|mi_rol|puede_ver/, "el cliente no debe decidir por rol");
    assert.doesNotMatch(src, /\.from\(\s*["']/, "el cliente no debe consultar la base");
  });

  test("el infante sigue sin ocupar silla ni tener acciones de silla en esta superficie", () => {
    const finTbody = src.indexOf("<tbody>");
    const inicio = src.indexOf("infantesPorPadre.get(p.id)", finTbody);
    const bloque = src.slice(inicio, inicio + 1400);
    assert.match(bloque, /No ocupa silla/, "debe conservar el distintivo 'No ocupa silla'");
    assert.doesNotMatch(bloque, /sillaId\s*:/, "el infante sigue sin ocupar silla");
    assert.doesNotMatch(bloque, /PasajeroAcciones|SillaEstado|SillaContrato/, "el infante no gana acciones de silla");
  });
});

describe("EnlaceEditarContrato.tsx — el cliente reutilizable decide SOLO la mecánica de navegación", () => {
  const src = leer(RUTA_ENLACE);

  test("recibe numeroContrato + tenantContrato + tenantActivo y decide si hace falta cambiar de agencia", () => {
    assert.match(src, /numeroContrato: string;\s*tenantContrato: Tenant;\s*tenantActivo: Tenant;/, "debe recibir el número, el tenant REAL del contrato y el tenant activo");
    assert.ok(src.includes("const requiereCambio = tenantContrato !== tenantActivo;"), "debe comparar el tenant real del contrato contra el activo (nunca el prefijo del texto)");
  });

  test("mismo tenant activo → navegación NORMAL (no intercepta el clic ni toca la cookie)", () => {
    const idxSinCambio = src.indexOf("if (!requiereCambio) return;");
    const idxPrevent = src.indexOf("e.preventDefault();");
    assert.ok(idxSinCambio > -1 && idxPrevent > -1, "debe tener la guarda de mismo-tenant y el preventDefault");
    assert.ok(idxSinCambio < idxPrevent, "cuando no hace falta cambiar, debe devolverse ANTES de interceptar la navegación del enlace");
  });

  test("el prefetch del Link queda DESACTIVADO solo cuando el contrato es cross-tenant (no precarga la ficha con la cookie de la agencia ANTERIOR); en el mismo tenant se deja el default", () => {
    assert.match(src, /prefetch=\{requiereCambio \? false : undefined\}/, "cross-tenant → prefetch=false; mismo tenant → default de Next");
  });

  test("tenant distinto → llama (y espera) a la Server Action existente cambiarTenant y navega con recarga COMPLETA solo si responde ok", () => {
    assert.match(src, /import \{ cambiarTenant \} from "@\/app\/\(dashboard\)\/tenant-actions";/, "debe reutilizar la Server Action EXISTENTE cambiarTenant (tenant-actions.ts)");
    const idxRes = src.indexOf("const res = await cambiarTenant(tenantContrato);");
    const idxAssign = src.indexOf("window.location.assign(");
    assert.ok(idxRes > -1, "debe esperar el resultado de cambiarTenant");
    assert.ok(idxAssign > -1 && idxAssign > idxRes, "debe navegar con recarga COMPLETA solo DESPUÉS de que cambiarTenant respondió");
    assert.ok(
      src.slice(idxAssign, idxAssign + 120).includes("window.location.origin"),
      "la URL de navegación debe armarse ABSOLUTA con window.location.origin (evita el warning no-location-assign-relative sin perder la recarga completa)"
    );
    assert.match(src, /if \(!res\.ok\) \{/, "debe manejar la respuesta no-ok antes de navegar");
  });

  test("si cambiarTenant responde ok:false o lanza, NO navega y muestra un error discreto", () => {
    assert.match(src, /No se pudo abrir/, "debe mostrar un error discreto (mensaje 'No se pudo abrir...') cuando no se puede cambiar");
    const idxNoOk = src.indexOf("if (!res.ok) {");
    const idxAssign = src.indexOf("window.location.assign(");
    assert.ok(idxNoOk > -1 && idxAssign > idxNoOk, "el camino no-ok debe terminar antes de alcanzar la navegación");
  });

  test("el componente NO autoriza por rol ni usa un cliente admin — solo ejecuta el cambio cuando el servidor ya lo permitió", () => {
    assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY|\.from\(\s*["']/, "no debe tocar la base ni un cliente service-role");
    assert.doesNotMatch(src, /\bROLES_\w*|mi_rol|puede_ver/, "no debe decidir por rol");
    assert.doesNotMatch(src, /["'`]MIN-["'`]/, "no debe fabricar ni leer el prefijo de tenant del número");
  });
});
