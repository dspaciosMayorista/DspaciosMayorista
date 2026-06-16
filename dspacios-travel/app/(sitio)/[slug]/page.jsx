import { notFound } from 'next/navigation';
import PaginaRenderer from '@/components/sitio/secciones/PaginaRenderer';
import { getPagina } from '@/lib/sitio/paginas';
import { getConfig } from '@/lib/sitio/cms';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const pagina = await getPagina(slug);
  if (!pagina) return {};
  return {
    title: pagina.seoTitulo || pagina.titulo,
    description: pagina.seoDescripcion || undefined,
  };
}

export default async function PaginaDinamica({ params }) {
  const { slug } = await params;
  // 'inicio' vive en la home (/), no en /inicio.
  if (slug === 'inicio') notFound();

  const [pagina, config] = await Promise.all([getPagina(slug), getConfig()]);
  if (!pagina) notFound();

  return <PaginaRenderer pagina={pagina} config={config} />;
}
