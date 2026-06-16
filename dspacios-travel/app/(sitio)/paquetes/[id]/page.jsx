import PaqueteDetalle from '@/components/sitio/PaqueteDetalle';
import { getPaquete, getConfig } from '@/lib/sitio/cms';

export default async function PackageDetail({ params }) {
  const { id } = await params;
  const [pkg, config] = await Promise.all([getPaquete(id), getConfig()]);

  return <PaqueteDetalle pkg={pkg} whatsappNumero={config.whatsappNumero} />;
}
