import { notFound } from 'next/navigation';
import PaginaRenderer from '@/components/sitio/secciones/PaginaRenderer';
import { getPagina } from '@/lib/sitio/paginas';
import { getConfig } from '@/lib/sitio/cms';

export default async function Home() {
  const [pagina, config] = await Promise.all([getPagina('inicio'), getConfig()]);
  if (!pagina) notFound();
  return <PaginaRenderer pagina={pagina} config={config} />;
}
