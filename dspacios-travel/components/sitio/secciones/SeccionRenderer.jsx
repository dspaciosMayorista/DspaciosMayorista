import React from 'react';
import Hero from '@/components/sitio/secciones/Hero';
import Texto from '@/components/sitio/secciones/Texto';
import Galeria from '@/components/sitio/secciones/Galeria';
import DestinosGrid from '@/components/sitio/secciones/DestinosGrid';
import Experiencias from '@/components/sitio/secciones/Experiencias';
import Testimonios from '@/components/sitio/secciones/Testimonios';
import BlogGrid from '@/components/sitio/secciones/BlogGrid';
import Cta from '@/components/sitio/secciones/Cta';
import Contacto from '@/components/sitio/secciones/Contacto';

// Mapa tipo de sección → componente. Exportado para que el CMS reúse el mismo
// renderer en su vista previa.
export const SECCION_COMPONENTES = {
  hero: Hero,
  texto: Texto,
  galeria: Galeria,
  destinos_grid: DestinosGrid,
  experiencias: Experiencias,
  testimonios: Testimonios,
  blog_grid: BlogGrid,
  cta: Cta,
  contacto: Contacto,
};

// Renderiza UNA sección. `contexto` agrupa los datos auxiliares (hijos,
// testimonios, blog, config, destinos) que algunas secciones necesitan.
export default function SeccionRenderer({ seccion, contexto = {} }) {
  if (!seccion) return null;
  const Componente = SECCION_COMPONENTES[seccion.tipo];
  if (!Componente) return null;

  const datos = seccion.datos || {};
  const { hijos = [], testimonios = [], blog = [], config = null, destinos = [] } = contexto;

  switch (seccion.tipo) {
    case 'hero':
      return <Componente datos={datos} config={config} />;
    case 'destinos_grid':
      return <Componente datos={datos} hijos={hijos} destinos={destinos} />;
    case 'testimonios':
      return <Componente datos={datos} items={testimonios} />;
    case 'blog_grid':
      return <Componente datos={datos} items={blog} />;
    case 'contacto':
      return <Componente datos={datos} config={config} />;
    default:
      return <Componente datos={datos} config={config} />;
  }
}
