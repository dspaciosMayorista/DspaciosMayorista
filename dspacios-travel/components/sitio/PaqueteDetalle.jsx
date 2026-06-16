"use client";

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/sitio/ui/button';
import { Check, X, MessageCircle, Calendar, MapPin, ArrowLeft, CreditCard, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PaqueteDetalle({ pkg, whatsappNumero }) {
  const router = useRouter();
  const waNumero = whatsappNumero || '573212150582';

  if (!pkg) return <div className="pt-32 text-center">Paquete no encontrado</div>;

  return (
    <div className="bg-gray-50 min-h-screen pb-24">
      {/* Hero Banner */}
      <div className="relative h-[60vh] w-full overflow-hidden">
        <img src={pkg.image} alt={pkg.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#120573] via-[#120573]/40 to-transparent opacity-90" />

        <div className="absolute inset-0 flex items-end pb-20">
          <div className="container mx-auto px-4">
            <Link href="/paquetes" className="inline-flex items-center text-white/80 hover:text-[#d8f511] mb-6 transition-colors">
              <ArrowLeft className="w-5 h-5 mr-2" /> Volver a paquetes
            </Link>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              <span className="bg-[#d8f511] text-[#120573] px-4 py-1 rounded-full font-bold uppercase text-sm mb-4 inline-block">
                {pkg.region}
              </span>
              <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 leading-tight max-w-4xl">
                {pkg.title}
              </h1>
              <div className="flex flex-wrap gap-6 text-white/90 text-lg font-medium">
                <span className="flex items-center gap-2"><MapPin className="w-5 h-5 text-[#d8f511]" /> {pkg.destination}</span>
                <span className="flex items-center gap-2"><Calendar className="w-5 h-5 text-[#d8f511]" /> {pkg.duration}</span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 -mt-10 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-3xl p-8 shadow-xl">
              <h2 className="text-2xl font-bold text-[#120573] mb-6 border-l-4 border-[#d8f511] pl-4">Descripción del Viaje</h2>
              <p className="text-gray-700 leading-relaxed text-lg">{pkg.longDescription}</p>
            </div>

            <div className="bg-white rounded-3xl p-8 shadow-xl">
              <h2 className="text-2xl font-bold text-[#120573] mb-6 border-l-4 border-[#d8f511] pl-4">Galería de Fotos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pkg.gallery && pkg.gallery.map((img, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden h-64 hover:shadow-lg transition-all">
                    <img src={img} alt={`Galería ${i}`} className="w-full h-full object-cover hover:scale-110 transition-transform duration-700" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-3xl shadow-xl border-t-4 border-green-500">
                <h3 className="text-xl font-bold text-[#120573] mb-6 flex items-center gap-3">
                  <div className="bg-green-100 p-2 rounded-full"><Check className="w-5 h-5 text-green-600" /></div>
                  Qué Incluye
                </h3>
                <ul className="space-y-4">
                  {pkg.includes.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-700">
                      <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-white p-8 rounded-3xl shadow-xl border-t-4 border-red-500">
                <h3 className="text-xl font-bold text-[#120573] mb-6 flex items-center gap-3">
                  <div className="bg-red-100 p-2 rounded-full"><X className="w-5 h-5 text-red-600" /></div>
                  No Incluye
                </h3>
                <ul className="space-y-4">
                  {pkg.notIncludes.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-700">
                      <X className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white p-8 rounded-3xl shadow-xl sticky top-24 border border-gray-100">
              <div className="text-center mb-8">
                <span className="text-gray-500 font-medium uppercase tracking-wide text-xs">Precio por persona desde</span>
                <div className="text-5xl font-extrabold text-[#120573] mt-2">USD ${pkg.priceFrom}</div>
                <div className="flex items-center justify-center gap-2 mt-4 text-sm text-green-600 bg-green-50 py-2 rounded-lg">
                  <CreditCard className="w-4 h-4" /> Facilidades de pago
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <Button
                  className="w-full bg-[#d8f511] text-[#120573] hover:bg-[#cbe610] font-bold h-14 text-lg rounded-xl shadow-lg transition-all"
                  onClick={() => router.push(pkg.ctaUrl || '/tarifario')}
                >
                  Ver Precios y Reservar
                </Button>
                <Button
                  className="w-full bg-[#25D366] hover:bg-[#1ebc57] text-white font-bold h-14 text-lg rounded-xl shadow-lg shadow-green-200 hover:shadow-green-300 transition-all"
                  onClick={() => window.open(`https://wa.me/${waNumero}?text=Hola, estoy interesado en el paquete ${pkg.title}`, '_blank')}
                >
                  <MessageCircle className="mr-2 h-6 w-6" /> Cotizar en WhatsApp
                </Button>
              </div>

              <div className="border-t border-gray-100 pt-6">
                <div className="flex items-center gap-3 mb-4">
                  <ShieldCheck className="w-8 h-8 text-[#d8f511]" />
                  <div>
                    <h4 className="font-bold text-[#120573] text-sm">Compra Segura</h4>
                    <p className="text-xs text-gray-500">Tus datos están protegidos</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center leading-relaxed">
                  * Precios sujetos a cambios y disponibilidad sin previo aviso. Aplican términos y condiciones generales.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
