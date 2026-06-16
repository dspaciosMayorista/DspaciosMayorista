import PaquetesGrid from '@/components/sitio/PaquetesGrid';
import { getPaquetes } from '@/lib/sitio/cms';

export default async function Packages() {
  const paquetes = await getPaquetes();

  return (
    <div className="pt-28 pb-24 bg-gray-50 min-h-screen">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Nuestros Paquetes</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Encuentra el viaje perfecto para ti, con la garantía y respaldo que necesitas.
          </p>
        </div>

        <PaquetesGrid items={paquetes} />
      </div>
    </div>
  );
}
