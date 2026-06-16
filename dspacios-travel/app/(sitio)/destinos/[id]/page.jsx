import DestinoDetalle from '@/components/sitio/DestinoDetalle';
import { getDestino, getPaquetes, getConfig } from '@/lib/sitio/cms';

export default async function DestinationDetail({ params }) {
  const { id } = await params;
  const [destination, paquetes, config] = await Promise.all([
    getDestino(id),
    getPaquetes(),
    getConfig(),
  ]);

  const relatedPackages = destination
    ? paquetes.filter((p) => (p.destination || '').includes(destination.name))
    : [];

  return (
    <DestinoDetalle
      destination={destination}
      relatedPackages={relatedPackages}
      whatsappNumero={config.whatsappNumero}
    />
  );
}
