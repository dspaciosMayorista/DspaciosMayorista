import React from 'react';
import SeccionRenderer from '@/components/sitio/secciones/SeccionRenderer';
import { getHijos } from '@/lib/sitio/paginas';
import { getTestimonios, getBlog, getDestinos } from '@/lib/sitio/cms';

// Server component: dada una `pagina` (con sus secciones) y la `config`, carga
// SOLO los datos auxiliares que sus secciones necesitan y renderiza todo en
// orden mediante SeccionRenderer.
export default async function PaginaRenderer({ pagina, config }) {
  if (!pagina) return null;
  const secciones = pagina.secciones || [];
  const tipos = new Set(secciones.map((s) => s.tipo));

  // ── Datos auxiliares por demanda ──
  let hijos = [];
  let testimonios = [];
  let blog = [];
  let destinos = [];

  const tareas = [];

  if (tipos.has('destinos_grid')) {
    // Las páginas grupo (destinos nacionales/internacionales) listan sus subpáginas.
    if (pagina.tipo === 'destinos_nacionales' || pagina.tipo === 'destinos_internacionales') {
      tareas.push(getHijos(pagina.slug).then((r) => { hijos = r; }));
    } else {
      // Otras páginas (p. ej. home) muestran los destinos del CMS.
      tareas.push(getDestinos().then((r) => { destinos = r; }));
    }
  }
  if (tipos.has('testimonios')) {
    tareas.push(getTestimonios().then((r) => { testimonios = r; }));
  }
  if (tipos.has('blog_grid')) {
    tareas.push(getBlog().then((r) => { blog = r; }));
  }

  await Promise.all(tareas);

  const contexto = { hijos, testimonios, blog, destinos, config };

  return (
    <>
      {secciones.map((seccion) => (
        <SeccionRenderer key={seccion.id} seccion={seccion} contexto={contexto} />
      ))}
    </>
  );
}
