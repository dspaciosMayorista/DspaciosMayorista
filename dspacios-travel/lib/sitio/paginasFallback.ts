// ─────────────────────────────────────────────────────────────────────────
// FALLBACK del árbol de páginas/secciones del sitio.
//
// Replica el seed de supabase/scripts/seed_web_paginas.sql para que el sitio
// NUNCA se vea vacío cuando la migración 079 todavía no se corrió (tablas
// web_paginas / web_secciones inexistentes o vacías). Centraliza aquí todo el
// contenido estático de respaldo; lib/sitio/paginas.ts cae a estas estructuras.
// ─────────────────────────────────────────────────────────────────────────

export type SeccionTipo =
  | "hero"
  | "texto"
  | "galeria"
  | "destinos_grid"
  | "experiencias"
  | "testimonios"
  | "blog_grid"
  | "cta"
  | "contacto";

export type PaginaTipo =
  | "home"
  | "destinos_nacionales"
  | "destinos_internacionales"
  | "destino"
  | "experiencias"
  | "nosotros"
  | "contacto"
  | "blog"
  | "generica";

export type SeccionFallback = {
  id: string;
  tipo: SeccionTipo;
  orden: number;
  datos: Record<string, unknown>;
};

export type PaginaFallback = {
  id: string;
  parentSlug: string | null;
  slug: string;
  titulo: string;
  etiquetaMenu: string | null;
  tipo: PaginaTipo;
  esGrupoMenu: boolean;
  enMenu: boolean;
  orden: number;
  imagenPortada: string | null;
  secciones: SeccionFallback[];
};

// Subpáginas de Destinos Nacionales (del seed) ──────────────────────────────
const NACIONALES: { slug: string; titulo: string }[] = [
  { slug: "san-andres", titulo: "San Andrés" },
  { slug: "cartagena", titulo: "Cartagena" },
  { slug: "santa-marta", titulo: "Santa Marta" },
  { slug: "la-guajira-aereo", titulo: "La Guajira Aéreo" },
  { slug: "la-guajira-terrestre", titulo: "La Guajira Terrestre" },
  { slug: "tolu-covenas", titulo: "Tolú & Coveñas" },
  { slug: "capurgana", titulo: "Capurganá" },
  { slug: "bahia-solano", titulo: "Bahía Solano" },
  { slug: "nuqui", titulo: "Nuquí" },
  { slug: "cano-cristales", titulo: "Caño Cristales" },
  { slug: "eje-cafetero", titulo: "Eje Cafetero" },
  { slug: "sur-de-colombia", titulo: "Sur de Colombia" },
  { slug: "llanos-orientales", titulo: "Llanos Orientales" },
  { slug: "boyaca", titulo: "Boyacá" },
  { slug: "santander", titulo: "Santander" },
  { slug: "huila-al-limite", titulo: "Huíla al Límite" },
  { slug: "desierto-tatacoa", titulo: "Desierto de la Tatacoa" },
  { slug: "amazonas", titulo: "Amazonas" },
];

// Subpáginas de Destinos Internacionales (del seed) ──────────────────────────
const INTERNACIONALES: { slug: string; titulo: string }[] = [
  { slug: "mar-caribe", titulo: "Mar Caribe" },
  { slug: "eeuu-canada", titulo: "EEUU y Canadá" },
  { slug: "suramerica", titulo: "Suramérica" },
  { slug: "centroamerica", titulo: "Centroamérica" },
  { slug: "paises-arabes", titulo: "Países Árabes" },
  { slug: "turquia", titulo: "Turquía" },
  { slug: "europa", titulo: "Europa" },
  { slug: "africa", titulo: "África" },
  { slug: "asia-oceania", titulo: "Asia y Oceanía" },
  { slug: "cruceros", titulo: "Cruceros" },
];

// Cada destino arranca con un hero usando su título (igual que el seed).
function destinoPaginas(
  hijos: { slug: string; titulo: string }[],
  parentSlug: string,
  prefix: string
): PaginaFallback[] {
  return hijos.map((h, i) => ({
    id: `fb-${prefix}-${h.slug}`,
    parentSlug,
    slug: h.slug,
    titulo: h.titulo,
    etiquetaMenu: null,
    tipo: "destino" as const,
    esGrupoMenu: false,
    enMenu: false,
    orden: i,
    imagenPortada: null,
    secciones: [
      {
        id: `fb-sec-${h.slug}-hero`,
        tipo: "hero" as const,
        orden: 0,
        datos: {
          titulo: h.titulo,
          subtitulo: "",
          cta_texto: "Cotizar",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
    ],
  }));
}

export const PAGINAS_FALLBACK: PaginaFallback[] = [
  {
    id: "fb-inicio",
    parentSlug: null,
    slug: "inicio",
    titulo: "Inicio",
    etiquetaMenu: null,
    tipo: "home",
    esGrupoMenu: false,
    enMenu: true,
    orden: 0,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-inicio-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo:
            "Explora el mundo de una forma única con D'SPACIOS TRAVEL",
          subtitulo:
            "Creamos itinerarios personalizados que superan tus expectativas y transforman tus sueños en realidad.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-inicio-experiencias",
        tipo: "experiencias",
        orden: 1,
        datos: {
          titulo: "¿Por Qué Elegirnos?",
          subtitulo:
            "Más que una agencia, somos tu socio de confianza en cada aventura.",
        },
      },
      {
        id: "fb-inicio-destinos",
        tipo: "destinos_grid",
        orden: 2,
        datos: {
          titulo: "Nuestros Destinos",
          subtitulo: "Explora el mundo con nosotros",
          fuente: "destinos_principales",
        },
      },
      {
        id: "fb-inicio-testimonios",
        tipo: "testimonios",
        orden: 3,
        datos: {
          titulo: "Lo Que Dicen Nuestros Clientes",
          subtitulo: "Testimonios reales de viajeros satisfechos",
        },
      },
      {
        id: "fb-inicio-contacto",
        tipo: "contacto",
        orden: 4,
        datos: {
          titulo: "¿Listo para tu próxima aventura?",
          texto:
            "Déjanos tus datos y un asesor experto te contactará para diseñar el viaje de tus sueños.",
        },
      },
    ],
  },
  {
    id: "fb-nacionales",
    parentSlug: null,
    slug: "destinos-nacionales",
    titulo: "Destinos Nacionales",
    etiquetaMenu: null,
    tipo: "destinos_nacionales",
    esGrupoMenu: true,
    enMenu: true,
    orden: 1,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-nacionales-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Destinos Nacionales",
          subtitulo: "Descubre la magia de Colombia con nosotros.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-nacionales-grid",
        tipo: "destinos_grid",
        orden: 1,
        datos: { titulo: "Explora Colombia", fuente: "hijos" },
      },
    ],
  },
  {
    id: "fb-internacionales",
    parentSlug: null,
    slug: "destinos-internacionales",
    titulo: "Destinos Internacionales",
    etiquetaMenu: null,
    tipo: "destinos_internacionales",
    esGrupoMenu: true,
    enMenu: true,
    orden: 2,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-internacionales-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Destinos Internacionales",
          subtitulo: "El mundo te espera. Lleva tu viaje más lejos.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-internacionales-grid",
        tipo: "destinos_grid",
        orden: 1,
        datos: { titulo: "Explora el mundo", fuente: "hijos" },
      },
    ],
  },
  {
    id: "fb-experiencias",
    parentSlug: null,
    slug: "experiencias",
    titulo: "Experiencias",
    etiquetaMenu: null,
    tipo: "experiencias",
    esGrupoMenu: false,
    enMenu: true,
    orden: 3,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-experiencias-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Experiencias",
          subtitulo: "Viajes pensados para cada tipo de viajero.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-experiencias-items",
        tipo: "experiencias",
        orden: 1,
        datos: {
          titulo: "Nuestras Experiencias",
          subtitulo: "Diseñamos cada viaje a tu medida.",
        },
      },
    ],
  },
  {
    id: "fb-nosotros",
    parentSlug: null,
    slug: "sobre-nosotros",
    titulo: "Sobre Nosotros",
    etiquetaMenu: null,
    tipo: "nosotros",
    esGrupoMenu: false,
    enMenu: true,
    orden: 4,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-nosotros-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Más que una agencia, somos tus compañeros de viaje",
          subtitulo:
            "Desde 2008, D'Spacios Travel ha sido sinónimo de confianza, calidad y experiencias inolvidables.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-nosotros-texto",
        tipo: "texto",
        orden: 1,
        datos: {
          titulo: "Nuestra Misión",
          cuerpo:
            "Brindar experiencias turísticas integrales de alta calidad, superando las expectativas de nuestros clientes a través de un servicio personalizado, innovador y confiable, fomentando el turismo responsable y sostenible.",
        },
      },
    ],
  },
  {
    id: "fb-contacto",
    parentSlug: null,
    slug: "contacto",
    titulo: "Contacto",
    etiquetaMenu: null,
    tipo: "contacto",
    esGrupoMenu: false,
    enMenu: true,
    orden: 5,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-contacto-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Contáctanos",
          subtitulo: "Estamos listos para ayudarte a planear tu próximo viaje.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-contacto-form",
        tipo: "contacto",
        orden: 1,
        datos: {
          titulo: "¿Listo para tu próxima aventura?",
          texto:
            "Déjanos tus datos y un asesor experto te contactará para diseñar el viaje de tus sueños.",
        },
      },
    ],
  },
  {
    id: "fb-blog",
    parentSlug: null,
    slug: "blog",
    titulo: "Blog",
    etiquetaMenu: null,
    tipo: "blog",
    esGrupoMenu: false,
    enMenu: true,
    orden: 6,
    imagenPortada: null,
    secciones: [
      {
        id: "fb-blog-hero",
        tipo: "hero",
        orden: 0,
        datos: {
          titulo: "Revista del Viajero",
          subtitulo:
            "Consejos expertos, guías detalladas y todo lo que necesitas saber para tu próxima aventura.",
          cta_texto: "Ver Tarifario",
          cta_url: "/tarifario",
          imagen: "",
        },
      },
      {
        id: "fb-blog-grid",
        tipo: "blog_grid",
        orden: 1,
        datos: { titulo: "Últimos artículos" },
      },
    ],
  },
  ...destinoPaginas(NACIONALES, "destinos-nacionales", "nac"),
  ...destinoPaginas(INTERNACIONALES, "destinos-internacionales", "intl"),
];
