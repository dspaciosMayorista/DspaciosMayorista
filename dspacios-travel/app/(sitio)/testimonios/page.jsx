import TestimoniosLista from '@/components/sitio/TestimoniosLista';
import { getTestimonios, getConfig } from '@/lib/sitio/cms';

export default async function TestimonialsPage() {
  const [testimonios, config] = await Promise.all([getTestimonios(), getConfig()]);

  return (
    <div className="pt-28 pb-24 bg-gray-50 min-h-screen">
      <div className="container mx-auto px-4">
        <div className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Historias de Viajeros Felices</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            No confíes solo en nuestra palabra. Lee lo que nuestros viajeros tienen para decir sobre sus experiencias con D'Spacios Travel.
          </p>
        </div>

        <TestimoniosLista items={testimonios} whatsappNumero={config.whatsappNumero} />
      </div>
    </div>
  );
}
