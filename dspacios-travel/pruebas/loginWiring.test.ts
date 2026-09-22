import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Rediseño de /login (fase 1 del rediseño integral de UI, ronda 3 —
// reconstrucción fiel a la referencia Stitch) — verificación por inspección
// de fuente (no hay React Testing Library en este repo; el patrón
// establecido para páginas/componentes es confirmar el cableado real leyendo
// el archivo compilado en TypeScript/TSX, igual que el resto de
// `pruebas/*Wiring.test.ts`).
//
// Corrección de esta ronda: "Portal B2B"/"Portal interno" NO son tarjetas del
// panel azul — son el selector de tipo de cuenta del panel blanco
// (presentación only, nunca autorización). El panel azul es puramente
// informativo (eyebrow, titular, descripción, tres capacidades reales, cierre
// de seguridad).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const page = leer("app/(auth)/login/page.tsx");
const client = leer("app/(auth)/login/LoginClient.tsx");
const actions = leer("app/(auth)/login/actions.ts");
const css = leer("app/(auth)/login/LoginClient.module.css");
const rootLayout = leer("app/layout.tsx");
const authLayout = leer("app/(auth)/layout.tsx");

// Bloque del selector (desde el comentario que lo introduce hasta el título
// de bienvenida) — se reutiliza en varias pruebas para acotar el contexto.
const idxSelector = client.indexOf('role="tablist"');
const bloqueSelector = client.slice(Math.max(0, idxSelector - 400), idxSelector + 2200);

// Bloque del panel azul (columna de contexto) completo — se ancla en la
// ETIQUETA real (nunca en el comentario de arriba, que a propósito nombra
// "Portal B2B"/"Portal interno" para explicar qué NO debe haber ahí).
const idxPanelAzul = client.indexOf('<section className="hidden flex-col');
const bloquePanelAzul = client.slice(idxPanelAzul, idxPanelAzul + 2600);

describe("1-3. page.tsx — Server Component que resuelve quickLoginEnabled/inactivo en el servidor", () => {
  test("es Server Component (sin 'use client'), lee QUICK_LOGIN_ENABLED e inactivo de searchParams, y los pasa a LoginClient", () => {
    assert.doesNotMatch(page.slice(0, 200), /use client/);
    assert.match(page, /quickLoginEnabled=\{process\.env\.QUICK_LOGIN_ENABLED === "1"\}/);
    assert.match(page, /searchParams:\s*Promise<\{\s*inactivo\?:\s*string\s*\}>/);
    assert.match(page, /const sp = await searchParams;/);
    assert.match(page, /inactivoInicial=\{sp\.inactivo === "1"\}/);
  });
});

describe("4-8. Selector de tipo de cuenta — estado inicial, dos tabs, aria-selected, type=button", () => {
  test("el estado inicial es 'b2b'", () => {
    assert.match(client, /useState<PortalSeleccionado>\("b2b"\)/);
  });

  test("existen EXACTAMENTE dos elementos role=\"tab\" dentro de un role=\"tablist\"", () => {
    assert.match(client, /role="tablist"\s+aria-label="Tipo de cuenta"/);
    assert.equal((bloqueSelector.match(/role="tab"/g) ?? []).length, 2);
  });

  test("B2B y Admin reflejan aria-selected atado al estado real (nunca un valor fijo)", () => {
    assert.match(bloqueSelector, /aria-selected=\{portalSeleccionado === "b2b"\}/);
    assert.match(bloqueSelector, /aria-selected=\{portalSeleccionado === "admin"\}/);
  });

  test("ambos botones del selector son type=\"button\" (nunca envían el formulario)", () => {
    assert.equal((bloqueSelector.match(/type="button"/g) ?? []).length >= 2, true);
  });

  test("cada botón usa un ícono Lucide (Users/Settings), nunca un <svg> dibujado a mano", () => {
    assert.match(bloqueSelector, /<Users size=\{16\}/);
    assert.match(bloqueSelector, /<Settings size=\{16\}/);
    assert.doesNotMatch(bloqueSelector, /<svg/);
  });
});

describe("9-10. Contenido por portal — títulos, descripciones, placeholders y CTA exactos", () => {
  test("B2B: título, descripción, placeholder y CTA", () => {
    assert.match(client, /etiquetaSelector: "Portal B2B Agencias"/);
    assert.match(client, /titulo: "Bienvenido al Portal Agencias & Freelance"/);
    assert.match(client, /descripcion: "Consulta tarifas, prepara cotizaciones y gestiona tus solicitudes desde el portal B2B\."/);
    assert.match(client, /placeholderCorreo: "agente@agencia\.com"/);
    assert.match(client, /cta: "Acceder al Portal B2B"/);
  });

  test("Admin: título, descripción, placeholder y CTA", () => {
    assert.match(client, /etiquetaSelector: "Portal Admin"/);
    assert.match(client, /titulo: "Portal Admin & Operaciones Centrales"/);
    assert.match(client, /descripcion: "Acceso para el equipo interno de operación, administración y gestión comercial\."/);
    assert.match(client, /placeholderCorreo: "operaciones@dspacios\.com"/);
    assert.match(client, /cta: "Ingresar al Panel Administrativo"/);
  });

  test("el título/descripción/placeholder/CTA renderizados leen del mapa por `portalSeleccionado` (una sola fuente, nunca duplicados a mano)", () => {
    assert.match(client, /const contenido = CONTENIDO_PORTAL\[portalSeleccionado\];/);
    assert.match(client, /\{contenido\.titulo\}/);
    assert.match(client, /\{contenido\.descripcion\}/);
    assert.match(client, /placeholder=\{contenido\.placeholderCorreo\}/);
    assert.match(client, /\{contenido\.cta\}/);
  });
});

describe("11-13. El selector es SOLO presentación — nunca autorización", () => {
  test("handleSubmit nunca lee `portalSeleccionado` (el destino depende exclusivamente de perfil.rol)", () => {
    const idx = client.indexOf("async function handleSubmit");
    const fin = client.indexOf("async function handleGoogle");
    const cuerpo = client.slice(idx, fin);
    assert.doesNotMatch(cuerpo, /portalSeleccionado/, "handleSubmit no debe consultar el selector para decidir nada");
  });

  test("el destino real sigue calculándose solo por perfil.rol: agencia/freelance/cliente_final -> /portal/b2b, el resto -> /dashboard", () => {
    assert.match(client, /let destino = "\/dashboard";/);
    assert.match(client, /perfil\?\.rol === "agencia" \|\| perfil\?\.rol === "freelance" \|\| perfil\?\.rol === "cliente_final"\) destino = "\/portal\/b2b";/);
  });

  test("cambiar de opción solo llama setPortalSeleccionado (nunca toca email/password/error, así que no los reinicia)", () => {
    assert.match(client, /onClick=\{\(\) => setPortalSeleccionado\("b2b"\)\}/);
    assert.match(client, /onClick=\{\(\) => setPortalSeleccionado\("admin"\)\}/);
    // Los setters de email/password/error NUNCA aparecen ligados al cambio de portal.
    assert.doesNotMatch(bloqueSelector, /setEmail|setPassword|setError/);
  });
});

describe("14-16. Google, cuenta inactiva y acceso de pruebas se conservan intactos", () => {
  test("Google: mismo provider, mismo callback, mismo mensaje de error", () => {
    assert.match(client, /provider:\s*"google"/);
    assert.match(client, /redirectTo:\s*`\$\{window\.location\.origin\}\/auth\/callback\?next=\/dashboard`/);
    assert.match(client, /No se pudo iniciar con Google\. Avisa al administrador\./);
  });

  test("cuenta inactiva: signOut() + mensaje exacto, más el aviso de ?inactivo=1 resuelto en servidor", () => {
    assert.match(client, /perfil && perfil\.activo === false/);
    assert.match(client, /await supabase\.auth\.signOut\(\);/);
    assert.match(client, /Tu cuenta está desactivada\. Comunícate con el administrador para reactivarla\./);
    assert.match(client, /const \[inactivo\] = useState\(inactivoInicial\);/);
  });

  test("acceso de pruebas sigue oculto/visible según quickLoginEnabled (servidor), dentro de <details>, sin tocar loginConCodigo", () => {
    const idx = client.indexOf("quickLoginEnabled && (");
    assert.notEqual(idx, -1);
    const bloque = client.slice(idx, idx + 900);
    assert.match(bloque, /<details/);
    assert.match(bloque, /handleCodigo/);
    assert.equal((client.match(/quickLoginEnabled &&/g) ?? []).length, 1);
    assert.match(actions, /process\.env\.QUICK_LOGIN_ENABLED !== "1"/);
    assert.match(actions, /export async function loginConCodigo\(\s*codigo: string\s*\)/);
  });
});

describe("17-18. Panel azul — capacidades reales, SIN los botones/tarjetas del selector", () => {
  test("las tres capacidades reales (Tarifario, Reservas, Contratos) están definidas con su ícono Lucide, y el panel las renderiza desde esa única fuente", () => {
    assert.match(client, /icon: Tags, titulo: "Tarifario y oferta publicada", descripcion: "Consulta paquetes, porciones terrestres y programas disponibles\."/);
    assert.match(client, /icon: CalendarCheck, titulo: "Reservas y seguimiento"/);
    assert.match(client, /icon: FileCheck2, titulo: "Contratos y documentos"/);
    // El panel azul renderiza el arreglo (no repite los textos a mano).
    assert.match(bloquePanelAzul, /CAPACIDADES\.map\(\(\{ icon: Icon, titulo, descripcion \}\) => \(/);
    assert.match(bloquePanelAzul, /\{titulo\}/);
    assert.match(bloquePanelAzul, /\{descripcion\}/);
  });

  test("NO contiene tarjetas 'Portal B2B'/'Portal interno' ni ningún <button> (es informativo, no un selector duplicado)", () => {
    assert.doesNotMatch(bloquePanelAzul, /Portal B2B/);
    assert.doesNotMatch(bloquePanelAzul, /Portal interno/);
    assert.doesNotMatch(bloquePanelAzul, /Portales según tu perfil/);
    assert.doesNotMatch(bloquePanelAzul, /<button/);
  });

  test("las tres capacidades viven en UN solo contenedor con divide-y (nunca cards individuales anidadas)", () => {
    assert.match(bloquePanelAzul, /divide-y overflow-hidden rounded-md border/);
    assert.equal((bloquePanelAzul.match(/divide-y overflow-hidden rounded-md border/g) ?? []).length, 1);
  });

  test("cierra con el mensaje de seguridad/permisos, con ícono ShieldCheck", () => {
    assert.match(bloquePanelAzul, /<ShieldCheck size=\{15\}/);
    assert.match(bloquePanelAzul, /Acceso protegido y permisos definidos por perfil\./);
  });
});

describe("19. Sin afirmaciones inventadas (Stitch y ronda 1/2)", () => {
  const prohibido: [RegExp, string][] = [
    [/Sabre|Amadeus/i, "Sabre/Amadeus"],
    [/\bGDS\b|\bNDC\b/, "GDS/NDC integrado"],
    [/\bv4\.8\b/, "versión v4.8"],
    [/\b99\.98\b/, "SLA 99.98%"],
    [/SSL\s*256/i, "SSL 256-bit Encrypted"],
    [/[Oo]perador [Mm]ayorista [Cc]ertificado/, "Operador Mayorista Certificado"],
    [/B2B\s*NETWORK/i, "B2B Network como certificación"],
    [/\+57/, "número de soporte inventado"],
    [/afiliaci[oó]n/i, "solicitud de afiliación sin ruta funcional"],
    [/[Oo]lvidaste tu contrase/, "recuperación de contraseña sin flujo real"],
    [/Recordar sesión/i, "recordar sesión sin implementación real"],
    [/Google Workspace/, "Google Workspace (la integración real solo se llama Google)"],
    [/cupos? (garantizados|en vivo)|tarifario.{0,15}en vivo/i, "cupos/tarifario en vivo ficticios"],
    [/[Ss]incronizaci[oó]n.{0,10}24\/7/, "sincronización 24/7 inventada"],
    [/\bwallet\b/i, "wallet inventado"],
    [/cr[eé]dito mayorista/i, "crédito mayorista inventado"],
    [/autofacturaci[oó]n/i, "autofacturación DIAN inventada"],
    [/Bogot[aá].{0,15}Miami|Miami.{0,15}Bogot[aá]/i, "servidores Bogotá/Miami inventados"],
    [/D['’]SPACIOS CORE/, "nombre de producto inventado"],
  ];

  for (const [re, etiqueta] of prohibido) {
    test(`no aparece: ${etiqueta}`, () => {
      assert.doesNotMatch(client, re);
    });
  }
});

describe("20. Logo oficial — único logo de D'Spacios, nunca reconstruido", () => {
  test("usa components/Logo.tsx (variant=\"full\", proporción real, sin viewBox/gradientes de isotipo inventados)", () => {
    assert.match(client, /import \{ Logo \} from "@\/components\/Logo";/);
    assert.match(client, /<Logo variant="full" height=\{64\}[^>]*className="h-14 w-auto sm:h-16"/);
    assert.doesNotMatch(client, /viewBox="0 0 100 100"/);
    assert.doesNotMatch(client, /swirlGrad|planeGrad/);
    assert.match(client, /href="\/tarifario" aria-label="Volver al tarifario"/);
  });

  test("el único <svg> dibujado a mano en todo el archivo es el logo de Google (24x24, 4 colores) — nunca la marca propia", () => {
    const svgs = [...client.matchAll(/<svg[\s\S]{0,60}viewBox="0 0 24 24"[\s\S]*?<\/svg>/g)];
    assert.equal(svgs.length, 1);
    assert.match(svgs[0][0], /#4285F4/);
    assert.match(svgs[0][0], /#34A853/);
    assert.match(svgs[0][0], /#FBBC05/);
    assert.match(svgs[0][0], /#EA4335/);
  });
});

describe("Estilo y proporciones — tokens aislados, sin globals, marco/columnas/radios", () => {
  test("las variables --login-* (incluida --login-selector-bg) viven en el CSS module bajo .root, nunca en :root global ni en styles/globals.css", () => {
    assert.doesNotMatch(css, /^:root\s*\{/m);
    assert.match(css, /\.root\s*\{/);
    assert.match(css, /--login-selector-bg:/);
    assert.match(css, /--login-primary:\s*#1d7c9a/i);
    assert.match(css, /--login-cyan:\s*#26bbd9/i);
    assert.match(css, /--login-green:\s*#66b596/i);
    assert.match(css, /--login-lime:\s*#aef44a/i);
    const globals = leer("styles/globals.css");
    assert.doesNotMatch(globals, /--login-/);
  });

  test("respeta prefers-reduced-motion dentro del módulo aislado (sin tocar globals)", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test("marco ~1080-1180px (max-w-6xl) y columnas ~58/42 (lg:grid-cols-[1.4fr_1fr])", () => {
    assert.match(client, /max-w-6xl/);
    assert.match(client, /lg:grid-cols-\[1\.4fr_1fr\]/);
  });

  test("radios acotados: sin rounded-2xl/3xl en paneles/controles (rounded-full solo para círculos de estado/íconos)", () => {
    assert.doesNotMatch(client, /rounded-2xl|rounded-3xl/);
  });

  test("panel de contexto oculto en móvil/tablet estrecha (hidden ... lg:flex) para no apilarse bajo el formulario", () => {
    assert.match(bloquePanelAzul, /^<section className="hidden flex-col[^"]*lg:flex">/);
  });
});

describe("Layout raíz — sin selector de temas (UI única)", () => {
  test("app/layout.tsx no monta ningún selector de temas ni script de inicialización de data-theme", () => {
    assert.doesNotMatch(rootLayout, /ThemeSwitcher/);
    assert.doesNotMatch(rootLayout, /data-theme/);
    assert.doesNotMatch(rootLayout, /dsp-theme/);
  });

  test("app/(auth)/layout.tsx sigue siendo un pass-through simple", () => {
    assert.match(authLayout, /return <>\{children\}<\/>;/);
  });
});
