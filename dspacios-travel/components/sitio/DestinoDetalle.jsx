"use client";

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/sitio/ui/button';
import { ArrowLeft, Info, MapPin, Camera } from 'lucide-react';

export default function DestinoDetalle({ destination, relatedPackages, whatsappNumero }) {
  const router = useRouter();
  const waNumero = whatsappNumero || '573212150582';

  if (!destination) return <div className="pt-32 text-center">Destino no encontrado</div>;

  return (
    <div className="pt-20 bg-white pb-24">
      {/* Header */}
      <div className="relative h-[50vh]">
        <img src={destination.image} alt={destination.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-[#120573]/50 flex flex-col items-center justify-center text-white">
          <h1 className="text-6xl md:text-7xl font-bold mb-4 tracking-tight">{destination.name}</h1>
          <span className="bg-[#d8f511] text-[#120573] px-6 py-2 rounded-full font-bold uppercase text-sm tracking-wider">
            {destination.region}
          </span>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 -mt-20 relative z-10">
        <Link href="/destinos" className="inline-flex items-center text-white hover:text-[#d8f511] mb-8 font-medium">
          <ArrowLeft className="w-5 h-5 mr-2" /> Volver a destinos
        </Link>

        <div className="grid lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-3xl p-10 shadow-xl mb-12">
              <h2 className="text-3xl font-bold text-[#120573] mb-6 flex items-center gap-3">
                <MapPin className="w-8 h-8 text-[#d8f511]" />
                Descubre {destination.name}
              </h2>
              <p className="text-lg text-gray-600 leading-relaxed mb-8">
                Sumérgete en la cultura vibrante de {destination.name}. Un destino que combina a la perfección historia, gastronomía y paisajes inolvidables. Ideal para quienes buscan experiencias auténticas.
              </p>

              {destination.tips && destination.tips.length > 0 && (
                <div className="bg-blue-50 rounded-2xl p-8 border border-blue-100">
                  <h3 className="font-bold text-[#120573] mb-4 flex items-center gap-2">
                    <Info className="w-5 h-5 text-[#120573]" />
                    Tips de Viajero
                  </h3>
                  <ul className="space-y-3">
                    {destination.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-3 text-gray-700">
                        <span className="w-6 h-6 rounded-full bg-[#120573] text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {i + 1}
                        </span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <h2 className="text-3xl font-bold text-[#120573] mb-8">Paquetes a {destination.name}</h2>
            {relatedPackages.length > 0 ? (
              <div className="space-y-6">
                {relatedPackages.map(pkg => (
                  <div key={pkg.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all flex flex-col md:flex-row">
                    <div className="w-full md:w-1/3 h-48 md:h-auto relative">
                      <img src={pkg.image} alt={pkg.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-6 md:p-8 flex-1 flex flex-col justify-center">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl font-bold text-[#120573]">{pkg.title}</h3>
                        <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">
                          Desde ${pkg.priceFrom}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm mb-6 line-clamp-2">{pkg.description}</p>
                      <Link href={`/paquetes/${pkg.id}`}>
                        <Button className="bg-[#120573] hover:bg-[#0d0459] text-white w-full md:w-auto">
                          Ver Detalles del Paquete
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-gray-50 rounded-3xl border border-dashed border-gray-300">
                <p className="text-gray-500 mb-6 text-lg">Estamos diseñando nuevas experiencias para este destino.</p>
                <Button
                  className="bg-[#25D366] hover:bg-[#1ebc57] text-white font-bold px-8 py-6 rounded-xl"
                  onClick={() => window.open(`https://wa.me/${waNumero}`, '_blank')}
                >
                  Preguntar disponibilidad por WhatsApp
                </Button>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-8">
              <div className="bg-[#120573] rounded-3xl p-8 text-white text-center relative overflow-hidden">
                <div className="relative z-10">
                  <Camera className="w-12 h-12 mx-auto mb-4 text-[#d8f511]" />
                  <h3 className="text-2xl font-bold mb-4">¿Te gusta lo que ves?</h3>
                  <p className="mb-8 text-white/80">
                    Nuestros asesores pueden crear un itinerario personalizado para ti en {destination.name}.
                  </p>
                  <Button
                    className="w-full bg-[#d8f511] text-[#120573] hover:bg-white font-bold"
                    onClick={() => router.push('/tarifario')}
                  >
                    Ver Tarifario
                  </Button>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-12 -mb-12"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
