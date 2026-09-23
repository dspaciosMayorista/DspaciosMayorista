// ─────────────────────────────────────────────────────────────────────────
// Indicador de carga de marca (`components/LoadingScreen.tsx`). Wiring por
// texto/regex contra el código fuente real: este repo no tiene entorno de
// DOM (`node --test` plano, sin jsdom/React Testing Library), mismo criterio
// que el resto de la suite para componentes React de este proyecto (ver
// `pruebas/tarjetaHotelExpandible.test.ts`).
//
// Cubre, además del componente: los CINCO puntos donde se monta hoy
// (`app/loading.tsx` raíz, `app/(dashboard)/loading.tsx`, `app/tarifario/
// loading.tsx`, `app/(dashboard)/dashboard/reservar/loading.tsx`,
// `app/(dashboard)/dashboard/tarifario/loading.tsx`), el guard de
// `prefers-reduced-motion` en el módulo CSS, y el alcance real de cada
// fallback (para que una regresión futura — ej. volver a poner una animación
// infinita bajo reduced-motion, que un `loading.tsx` deje de renderizar el
// componente, que un fallback dentro del dashboard vuelva a apilar el
// isotipo sobre el sidebar/topbar, o que alguien vuelva a afirmar que un
// `loading.tsx` cubre algo que no demostró cubrir — falle la suite en vez de
// pasar desapercibida).
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const fuenteComponente = leer("components/LoadingScreen.tsx");
const fuenteCss = leer("components/LoadingScreen.module.css");
const fuenteRootLoading = leer("app/loading.tsx");
const fuenteRootLayout = leer("app/layout.tsx");
const fuenteDashboardLoading = leer("app/(dashboard)/loading.tsx");
const fuenteDashboardLayout = leer("app/(dashboard)/layout.tsx");
const fuenteTarifarioLoading = leer("app/tarifario/loading.tsx");
const fuenteReservarLoading = leer("app/(dashboard)/dashboard/reservar/loading.tsx");
const fuenteTarifarioInternoLoading = leer("app/(dashboard)/dashboard/tarifario/loading.tsx");

describe("LoadingScreen — accesibilidad y contrato del componente", () => {
  test("el contenedor anuncia el estado de carga a lectores de pantalla (role=status + aria-live=polite)", () => {
    assert.match(fuenteComponente, /role="status"/);
    assert.match(fuenteComponente, /aria-live="polite"/);
  });

  test("el isotipo es puramente decorativo: alt vacío + aria-hidden, para no duplicar el anuncio del role=status", () => {
    assert.match(fuenteComponente, /<Image src=\{ISOTIPO_SRC\[variant\]\} alt="" aria-hidden fill/);
  });

  test("existe un texto para lectores de pantalla (`label`, visualmente oculto vía styles.label), con default 'Cargando…'", () => {
    assert.match(fuenteComponente, /label = "Cargando…"/);
    assert.match(fuenteComponente, /<span className=\{styles\.label\}>\{label\}<\/span>/);
  });

  test("por defecto cubre pantalla completa (`fullScreen = true`); `false` cae al modo contenido (sección/tarjeta)", () => {
    assert.match(fuenteComponente, /fullScreen = true/);
    assert.match(fuenteComponente, /fullScreen \? styles\.fullScreen : styles\.contained/);
  });

  test("las 3 variantes de color apuntan a archivos que existen de verdad en public/marca/ (full/black/white)", () => {
    const mapa: Record<string, string> = {};
    const bloque = fuenteComponente.slice(
      fuenteComponente.indexOf("const ISOTIPO_SRC"),
      fuenteComponente.indexOf("} as const;") + "} as const;".length,
    );
    for (const m of bloque.matchAll(/(\w+):\s*"([^"]+)"/g)) {
      mapa[m[1]] = m[2];
    }
    assert.deepEqual(Object.keys(mapa).sort(), ["black", "full", "white"]);
    for (const ruta of Object.values(mapa)) {
      // Las rutas del componente son públicas (/marca/...) — el archivo real
      // vive bajo public/.
      const rutaDisco = join(raiz, "public", ruta);
      assert.ok(existsSync(rutaDisco), `falta el archivo referenciado ${ruta} (esperado en ${rutaDisco})`);
    }
  });

  test("variante por defecto es 'full' (degradado de marca, pensado para fondos claros)", () => {
    assert.match(fuenteComponente, /variant = "full"/);
  });

  test("no tiene temporizador ni estado propio: se retira solo con dejar de renderizarla (nunca un setTimeout/useState de visibilidad)", () => {
    assert.doesNotMatch(fuenteComponente, /setTimeout|useState|useEffect/);
  });
});

describe("LoadingScreen.module.css — prefers-reduced-motion deja el isotipo ESTÁTICO", () => {
  test("bajo reduced-motion, la animación se apaga por completo (`animation: none`) — nunca otra animación infinita de reemplazo", () => {
    const bloqueReducido = fuenteCss.slice(fuenteCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(bloqueReducido, /\.mark\s*\{\s*animation:\s*none;\s*\}/, "el bloque de reduced-motion debe fijar animation: none en .mark");
  });

  test("no queda ningún @keyframes de fallback (fade/pulse) para el caso reduced-motion — la única animación con @keyframes es la normal", () => {
    const ocurrenciasKeyframes = [...fuenteCss.matchAll(/@keyframes\s+[\w-]+/g)];
    assert.equal(ocurrenciasKeyframes.length, 1, "debe existir un único @keyframes (el de movimiento normal); un segundo @keyframes sugiere que reduced-motion volvió a animar algo");
    assert.match(fuenteCss, /@keyframes dspacios-loading-pulse/);
  });

  test("el movimiento normal (sin reduced-motion) sigue existiendo — esta prueba no exige quitar la animación por defecto, solo la de reduced-motion", () => {
    assert.match(fuenteCss, /\.mark\s*\{\s*object-fit: contain;\s*animation: dspacios-loading-pulse 1\.6s ease-in-out infinite;\s*\}/);
  });
});

describe("Puntos de montaje — los cinco fallbacks de pantalla/vista completa (raíz, Dashboard, Tarifario público, Reservar, Tarifario interno)", () => {
  test("app/loading.tsx (raíz) importa y renderiza <LoadingScreen /> sin props (fullScreen por defecto)", () => {
    assert.match(fuenteRootLoading, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
    assert.match(fuenteRootLoading, /return <LoadingScreen \/>;/);
  });

  test("app/(dashboard)/loading.tsx importa <LoadingScreen /> y la renderiza con fullScreen={false} — NUNCA sin esa prop (evita re-tapar el sidebar/topbar ya visible)", () => {
    assert.match(fuenteDashboardLoading, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
    assert.match(fuenteDashboardLoading, /return <LoadingScreen fullScreen=\{false\} \/>;/);
    assert.doesNotMatch(fuenteDashboardLoading, /return <LoadingScreen \/>;/, "no debe volver a la variante fullScreen (taparía el chrome del dashboard ya renderizado)");
  });

  test("app/tarifario/loading.tsx importa y renderiza <LoadingScreen /> sin props (sigue fullScreen: su layout no tiene chrome propio que proteger)", () => {
    assert.match(fuenteTarifarioLoading, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
    assert.match(fuenteTarifarioLoading, /return <LoadingScreen \/>;/);
  });

  test("dashboard/reservar/loading.tsx: LoadingScreen con fullScreen={false} — ya NO el esqueleto gris de barras, y nunca vuelve a la variante fullScreen (taparía sidebar/topbar)", () => {
    assert.match(fuenteReservarLoading, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
    assert.match(fuenteReservarLoading, /return <LoadingScreen fullScreen=\{false\} \/>;/);
    assert.doesNotMatch(fuenteReservarLoading, /animate-pulse/, "ya no debe quedar el esqueleto gris de barras");
    assert.doesNotMatch(fuenteReservarLoading, /return <LoadingScreen \/>;/, "no debe usar la variante fullScreen dentro del dashboard");
  });

  test("dashboard/tarifario/loading.tsx (interno): LoadingScreen con fullScreen={false} — ya NO el esqueleto gris de barras, y nunca vuelve a la variante fullScreen", () => {
    assert.match(fuenteTarifarioInternoLoading, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
    assert.match(fuenteTarifarioInternoLoading, /return <LoadingScreen fullScreen=\{false\} \/>;/);
    assert.doesNotMatch(fuenteTarifarioInternoLoading, /animate-pulse/, "ya no debe quedar el esqueleto gris de barras");
    assert.doesNotMatch(fuenteTarifarioInternoLoading, /return <LoadingScreen \/>;/, "no debe usar la variante fullScreen dentro del dashboard");
  });

  test("ningún loading.tsx bajo app/(dashboard)/dashboard/** usa la variante fullScreen (evita apilar el isotipo sobre sidebar/topbar en cualquier ruta interna, no solo las dos revisadas a mano)", () => {
    const dashboardDir = join(raiz, "app/(dashboard)/dashboard");
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (entrada.name === "loading.tsx") archivos.push(ruta);
      }
    };
    recorrer(dashboardDir);
    assert.ok(archivos.length >= 2, "deben existir al menos los dos loading.tsx conocidos (reservar, tarifario)");
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      assert.match(fuente, /LoadingScreen fullScreen=\{false\}/, `${archivo} debe usar fullScreen={false} (vive dentro del chrome del dashboard)`);
      assert.doesNotMatch(fuente, /animate-pulse/, `${archivo} no debe usar el esqueleto gris de barras`);
    }
  });

  test("<main> de (dashboard)/layout.tsx es position:relative — condición para que el overlay fullScreen={false} de (dashboard)/loading.tsx quede acotado al área de contenido y no se escape al viewport", () => {
    assert.match(fuenteDashboardLayout, /<main data-dashboard-main className="relative min-w-0 flex-1 overflow-x-hidden"/);
  });

  test("app/layout.tsx (raíz) sigue siendo síncrono, sin await propio — es la premisa que justifica que app/loading.tsx cubra la resolución de layouts hijos async sin tocar auth", () => {
    // Si esta prueba falla, la justificación documentada en app/loading.tsx
    // (\"app/layout.tsx no hace ningún await propio\") dejó de ser cierta y
    // hay que re-auditar el mecanismo, no solo actualizar el comentario.
    assert.doesNotMatch(fuenteRootLayout, /export default async function RootLayout/);
    assert.match(fuenteRootLayout, /export default function RootLayout/);
  });

  test("el comentario de app/loading.tsx conserva el hecho clave: el middleware redirige a quien no tiene sesión ANTES de que exista árbol de React (por eso este fallback nunca se muestra en ese caso)", () => {
    assert.match(fuenteRootLoading, /proxy\.ts[\s\S]{0,40}redirige a \/login ANTES de que exista[\s\S]{0,20}árbol de React/, "debe mencionar que el middleware (proxy.ts) redirige antes de que exista árbol de React");
    assert.match(fuenteRootLoading, /PENDIENTE/, "debe conservar el aviso de validación pendiente en Preview con sesión real");
    // Guard contra la afirmación falsa detectada en una ronda previa de esta
    // misma tarea: la navegación SIN sesión a /dashboard NO muestra el
    // isotipo — nunca debe volver a decir lo contrario.
    assert.doesNotMatch(
      fuenteRootLoading,
      /pedir `\/dashboard` sin cookie[^.]*muestra el isotipo/i,
      "no debe afirmar que la navegación SIN sesión muestra el isotipo — el middleware (proxy.ts) redirige antes de que exista árbol de React",
    );
  });

  test("el comentario de app/(dashboard)/loading.tsx conserva el hecho clave: este fallback NO cubre la resolución de su propio layout.tsx (sesión/rol/tenant)", () => {
    assert.match(fuenteDashboardLoading, /NO cubre la resolución de `layout\.tsx`/);
    assert.doesNotMatch(
      fuenteDashboardLoading,
      /cubre la (primera entrada|carga inicial)[^.]*mientras `?layout\.tsx`? resuelve sesión/i,
      "no debe volver a afirmar que ESTE loading.tsx (sin ayuda de app/loading.tsx) cubre la resolución de layout.tsx",
    );
  });
});

describe("No se reintrodujo el mecanismo prohibido (pantalla bloqueante para acciones pequeñas)", () => {
  test("ningún otro componente de UI pequeña (botones/inputs) fue reemplazado por LoadingScreen en esta ronda — Login sigue con su spinner inline", () => {
    const fuenteLogin = leer("app/(auth)/login/LoginClient.tsx");
    assert.doesNotMatch(fuenteLogin, /LoadingScreen/, "el botón de login debe seguir con su spinner inline (Loader2), no un overlay de pantalla completa");
  });
});
