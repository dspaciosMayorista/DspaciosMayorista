import DestinosGrid from '@/components/sitio/DestinosGrid';
import { getDestinos } from '@/lib/sitio/cms';

export default async function DestinationsPage() {
  const destinos = await getDestinos();

  return (
    <div className="pt-28 pb-24 bg-white min-h-screen">
      <div className="container mx-auto px-4">
        <div className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Explora el Mundo</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Descubre lugares fascinantes y vive experiencias que cambiarán tu forma de ver la vida.
          </p>
        </div>

        <DestinosGrid items={destinos} />
      </div>
    </div>
  );
}
