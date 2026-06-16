import { notFound } from 'next/navigation';
import PaginaRenderer from '@/components/sitio/secciones/PaginaRenderer';
import { getPagina } from '@/lib/sitio/paginas';
import { getConfig } from '@/lib/sitio/cms';

export async function generateMetadata() {
  const pagina = await getPagina('blog');
  if (!pagina) return {};
  return {
    title: pagina.seoTitulo || pagina.titulo,
    description: pagina.seoDescripcion || undefined,
  };
}

export default async function BlogListado() {
  const [pagina, config] = await Promise.all([getPagina('blog'), getConfig()]);
  if (!pagina) notFound();

  return <PaginaRenderer pagina={pagina} config={config} />;
}
