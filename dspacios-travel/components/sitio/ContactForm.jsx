"use client";

import React from 'react';
import { Button } from '@/components/sitio/ui/button';
import { Send, MapPin, Phone, Mail } from 'lucide-react';

const ContactForm = ({ config }) => {
  const direccion = config?.direccion || "Calle 123 # 45-67, Oficina 301\nBogotá, Colombia";
  const telefono = config?.contactoTelefono || "+57 123 456 7890";
  const email = config?.contactoEmail || "info@dspaciostravel.com";
  return (
    <section className="py-24 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Info */}
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">
              ¿Listo para tu próxima aventura?
            </h2>
            <p className="text-xl text-gray-600 mb-12 leading-relaxed">
              Déjanos tus datos y un asesor experto te contactará para diseñar el viaje de tus sueños.
            </p>

            <div className="space-y-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#120573]/10 rounded-full flex items-center justify-center shrink-0">
                  <MapPin className="w-6 h-6 text-[#120573]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#120573] text-lg">Visítanos</h3>
                  <p className="text-gray-600 whitespace-pre-line">{direccion}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#120573]/10 rounded-full flex items-center justify-center shrink-0">
                  <Phone className="w-6 h-6 text-[#120573]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#120573] text-lg">Llámanos</h3>
                  <p className="text-gray-600">{telefono}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#120573]/10 rounded-full flex items-center justify-center shrink-0">
                  <Mail className="w-6 h-6 text-[#120573]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#120573] text-lg">Escríbenos</h3>
                  <p className="text-gray-600">{email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white p-8 md:p-10 rounded-3xl shadow-xl border border-gray-100">
            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Nombre</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50" placeholder="Tu nombre" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Apellido</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50" placeholder="Tu apellido" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Correo Electrónico</label>
                <input type="email" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50" placeholder="tucorreo@ejemplo.com" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Teléfono / WhatsApp</label>
                <input type="tel" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50" placeholder="+57 300..." />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Mensaje</label>
                <textarea rows="4" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50" placeholder="Cuéntanos qué destino te interesa..."></textarea>
              </div>

              <Button className="w-full bg-[#120573] hover:bg-[#0d0459] text-white font-bold py-4 text-lg rounded-xl shadow-lg">
                Enviar Mensaje <Send className="ml-2 w-5 h-5" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactForm;
