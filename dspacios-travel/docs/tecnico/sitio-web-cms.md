# Sitio web público + CMS — hoja técnica

> Índice: [`README.md`](./README.md)

Sitio de marketing (`/sitio_web/*`) y su CMS de edición **in-situ** (`/cms`, estilo Webflow:
clic sobre el texto real y editarlo ahí mismo, no un panel/lista aparte).

---

## 1. Rutas del sitio público

- `app/sitio_web/layout.tsx` — shell, carga `getConfig()` + `getMenu()`.
- `app/sitio_web/page.jsx` — home vía `getPagina('inicio')`.
- `app/sitio_web/[slug]/page.jsx` — genérica; `slug==='inicio'` → `notFound()` (el home vive en
  `/sitio_web`, no en `/sitio_web/inicio`).
- `app/sitio_web/blog/page.jsx` — solo `getPagina('blog')` con una sección `blog_grid`, no es
  una página a medida.
- `app/sitio_web/blog/[id]/page.jsx` — `getBlogPost(id)` matchea por id O slug, renderiza
  `BlogDetalle` (no `PaginaRenderer`).
- `app/sitio_web/cotizar/page.jsx` + `CotizarClient.jsx`.

**Nota:** pese a que comentarios en el código mencionan `app/(sitio)`, la carpeta real es el
segmento plano `app/sitio_web/` (no un route group); `lib/sitio/rutas.ts` hardcodea `SITIO_BASE
= "/sitio_web"`.

## 2. Modelo de datos

- **`web_paginas`** (migración 079): `id, parent_id` (árbol), `slug` (único, UN solo segmento),
  `titulo, etiqueta_menu, tipo` (enum), `es_grupo_menu, en_menu, orden, seo_titulo,
  seo_descripcion, imagen_portada, activo`. RLS: select público donde `activo`, escritura solo
  superadmin.
- **`web_secciones`**: `id, pagina_id` (FK cascade), `tipo` (hero/texto/galeria/destinos_grid/
  experiencias/testimonios/blog_grid/cta/contacto de la migración, extendido en código con
  actividades/plan/flyers/consulta_disponibilidad), `orden, datos` (jsonb), `visible`. Misma RLS.
- **`web_blog`**, **`web_testimonios`**, **`web_config`** (migración 078, fila única `id=1`,
  incluye `extra jsonb` catch-all para campos agregados sin migración: `youtube_url,
  telefono_fijo, lineas_atencion`).
- **`web_paquetes`** (legacy, migración 078) — parece **SIN USO** en el código actual.
- **`web_destinos`** (migración 078) — leído por `getDestinos()` como fallback para secciones
  `destinos_grid` cuando una página no tiene subpáginas hijas.

## 3. Capa de lectura

- **`lib/sitio/paginas.ts`**: `getMenu`, `getPagina(slug)`, `getHijos(slug)` — cada función
  envuelve en try/catch + chequea `error||!data`, cayendo a contenido estático
  `PAGINAS_FALLBACK` ("El sitio nunca se ve vacío", comentario del código).
- **`lib/sitio/cms.ts`**: `getDestinos/getTestimonios/getBlog/getBlogPost/getConfig` — re-forma
  las columnas en español de la BD a la forma en inglés que ya esperan los componentes; mismo
  patrón de fallback a los arrays estáticos de `lib/sitio/data.js`/`CONFIG_FALLBACK`.
- **`lib/sitio/paginasFallback.ts`**: árbol de fallback estático (espeja
  `supabase/scripts/seed_web_paginas.sql`); define los tipos union canónicos
  `SeccionTipo`/`PaginaTipo`; contenido completo de seed para inicio/destinos-nacionales (+18
  subpáginas)/destinos-internacionales (+10 subpáginas)/experiencias/sobre-nosotros/contacto/blog.

## 4. Componentes de sección (`components/sitio/secciones/*`, 15 en total)

Hero, Texto, Galeria, DestinosGrid, Experiencias, Testimonios, BlogGrid, Cta, Contacto,
Actividades, Plan, Flyers, ConsultaDisponibilidad, **PaginaRenderer** (orquestador — regla
especial: una sección `actividades` seguida inmediatamente de `plan` renderiza ambas en un
grid a 2 columnas), **SeccionRenderer** (dispatcher, exporta el mapa `SECCION_COMPONENTES`,
reutilizado tal cual por la vista previa del CMS).

## 5. CMS — arquitectura de edición in-situ

Patrón central a entender:

- **`components/sitio/edicion/EdicionContext.jsx`**: provider `EdicionSeccion({value, children})`
  (`value = {editable, datos, set(campo, valor)}`) + hook `useEdicion()`. El sitio público
  **nunca** monta el provider, así que `editable` siempre es `false` ahí — cero cambio de
  comportamiento fuera del CMS.
- **`app/cms/editors/LienzoVivo.tsx`**: su `BloqueVivo` envuelve cada sección renderizada en
  `<EdicionSeccion value={{editable:true, datos, set:setCampo}}><SeccionRenderer .../></EdicionSeccion>`
  — el MISMO árbol de componentes que el sitio público, solo con `editable:true`.
- **`components/sitio/edicion/Editable.jsx`** — 3 primitivas:
  - `EditableText`: passthrough inerte fuera del CMS; `contentEditable` + `onBlur→ctx.set`
    dentro del CMS; detiene la propagación para que editar texto no dispare selección de
    bloque ni navegación.
  - `EditableImage`: `<img>` plano fuera del CMS (null en 404); dentro del CMS overlay
    "Cambiar imagen" usando la server action `subirArchivoWeb` + botón "pegar URL".
  - `EditableUrl`: no renderiza nada fuera del CMS; dentro, una pill "Enlace" que pide la URL
    con `window.prompt`.
- Estado de `LienzoVivo`: `orden` (drive de `Reorder.Group` de framer-motion), `datosLocal`
  (buffer de edición por sección), `sel`, `campos` (panel ⚙ abierto), `vista`
  ("escritorio"|"movil"), `estado`.
- **Reordenar** solo arranca desde un handle explícito de arrastre (`dragListener={false}` +
  `useDragControls()`), no al hacer clic en el bloque; al soltar llama
  `reordenarSecciones(pagina.id, ids)`.
- **Guardado con debounce**: `setCampo()` programa `actualizarSeccion(id, nuevo)` tras 700ms de
  inactividad por sección.
- **Barra por bloque**: drag handle, ⚙ (abre `SeccionForm` en slide-over), Copiar
  (`duplicarSeccion`), Ojo/OjoTachado (`toggleSeccionVisible`), Papelera (`eliminarSeccion`).
- `BloqueVivo.onClickCapture` guarda: ignora clics en la barra/`contentEditable`; bloquea clics
  en elementos de navegación (`preventDefault`/`stopPropagation`, los botones quedan inertes en
  el CMS); si no, selecciona el bloque.

### Secciones con edición inline (título/subtítulo/cuerpo/texto de botón/link)
Hero, Texto, Cta, Contacto, Actividades (solo titulo/intro), Plan (solo títulos de sección),
ConsultaDisponibilidad, DestinosGrid/Testimonios/BlogGrid/Experiencias/Galeria/Flyers (solo
texto de encabezado).

### Aún requieren el panel ⚙ `SeccionForm` (contenido tipo lista/array estructurado)
Galeria (`imagenes[]`), Experiencias (`items[]` con selector de ícono), Actividades (`items[]` +
`imagen_fondo`), Plan (arrays de viñetas incluye/no incluye), Flyers (`items[]`),
DestinosGrid/Testimonios/BlogGrid (el CONTENIDO de sus tarjetas se jala en vivo de los hijos de
`web_paginas`/`web_testimonios`/`web_blog` respectivamente, gestionado en las pestañas separadas
Testimonios/Blog del CMS — NO por sección), ConsultaDisponibilidad
(`destino`/`imagen_fondo`/`nueva_pestana`).

## 6. `app/cms/actions.ts`

Toda función llama primero `exigirSuperadmin()` ("No confiamos en la UI") y `revalidarSitio(slug?)`
al mutar. Clave: `crearSeccion`, `actualizarSeccion` (único camino de guardado para TODAS las
ediciones inline + los guardados de `SeccionForm`), `eliminarSeccion`, `toggleSeccionVisible`,
`reordenarSecciones` (valida que el set de ids enviado coincida exactamente con las secciones de
la página), `duplicarSeccion`, `moverSeccion` (alternativa legacy/sin uso al drag). Árbol de
páginas: `crearPagina`/`actualizarPagina`/`eliminarPagina` (cascade)/`togglePaginaActivo`/
`togglePaginaEnMenu`/`moverPagina`. `normalizarSlug()` obliga a un solo segmento URL-safe (sin `/`).

## 7. Contenedores

- `app/cms/page.tsx` (server, `force-dynamic`, chequea superadmin, carga TODAS las páginas/
  secciones incl. inactivas/ocultas + testimonios/blog/config crudos Y las versiones
  públicas-formadas `getConfig/getTestimonios/getBlog/getDestinos` para el contexto `sitio` de
  `LienzoVivo`).
- `app/cms/CmsClient.tsx` (4 pestañas: paginas/blog/testimonios/config).
- `app/cms/layout.tsx` (solo chequea que exista sesión — el candado real de superadmin está en
  `page.tsx`).

## 8. Storage

Bucket `web-cms` (migración 080, lectura pública, escritura solo superadmin vía RLS).
`app/cms/upload.ts::subirArchivoWeb(formData)`: re-valida superadmin, valida tamaño ≤15MB y
allowlist de mime, sanitiza el nombre de archivo, sube vía `createAdminClient()` (service-role)
— devuelve la URL pública. Llamado desde "Cambiar imagen" de `EditableImage` y desde
`app/cms/editors/SubirArchivo.tsx` (widget reusable).

**Fix confirmado de límite de body**: `next.config.ts` →
`experimental.serverActions.bodySizeLimit: "16mb"` — 1MB por encima del chequeo de 15MB de
`upload.ts` (el límite default de Next de 1MB para Server Actions rompía las subidas antes de
llegar a esa validación).

## 9. Toggle escritorio/móvil

"Escritorio" = árbol in-situ en vivo (default). "Móvil" **no** reutiliza ese árbol — renderiza un
`<iframe src={previewSrc}>` (374×680 dentro de un marco de 390px) apuntando a la ruta pública
REAL, mostrando el último estado **guardado** (no las teclas en vivo), con el pie "Vista móvil
de la página publicada (refleja lo guardado)".

## 10. WhatsApp de `/cotizar`

`getConfig()` → `web_config.whatsapp_numero`; el hardcodeado `'573212150582'` es solo un
fallback de último recurso (mismo patrón repetido independientemente en `Hero.jsx` y
`WhatsAppButton.jsx`), editable centralmente desde la pestaña "Configuración" del CMS
(`guardarConfig`).

## Enlaces cruzados

- Ninguno directo hoy — módulo autocontenido; el único cruce es con el motor de subida a
  Storage (mismo patrón que otros buckets del proyecto).
