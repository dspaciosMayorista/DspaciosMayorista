"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';

const Testimonials = () => {
  const testimonials = [
    {
      name: 'María González',
      location: 'Bogotá, Colombia',
      rating: 5,
      comment: 'Excelente servicio. Mi viaje a Cartagena fue inolvidable gracias a D\'Spacios Travel. Todo perfectamente organizado.',
      image: 'Happy woman traveler smiling at beach vacation'
    },
    {
      name: 'Carlos Ramírez',
      location: 'Medellín, Colombia',
      rating: 5,
      comment: 'Los mejores precios del mercado. Reservé un paquete a Cancún y superó todas mis expectativas. Totalmente recomendados.',
      image: 'Happy male tourist enjoying vacation at tropical resort'
    },
    {
      name: 'Ana Martínez',
      location: 'Cali, Colombia',
      rating: 5,
      comment: 'Atención personalizada de primer nivel. Me ayudaron a planificar cada detalle de mi luna de miel en Punta Cana.',
      image: 'Smiling female traveler on beach honeymoon vacation'
    }
  ];

  return (
    <section id="testimonials" className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-4">
            Lo Que Dicen Nuestros Clientes
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Testimonios reales de viajeros satisfechos
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full overflow-hidden">
                  <img
                    className="w-full h-full object-cover"
                    alt={testimonial.name}
                   src="https://images.unsplash.com/photo-1595872018818-97555653a011" />
                </div>
                <div>
                  <h4 className="font-bold text-[#120573]">{testimonial.name}</h4>
                  <p className="text-sm text-gray-600">{testimonial.location}</p>
                </div>
              </div>

              <div className="flex gap-1 mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-[#d8f511] text-[#d8f511]" />
                ))}
              </div>

              <div className="relative">
                <Quote className="absolute -top-2 -left-2 w-8 h-8 text-[#120573]/20" />
                <p className="text-gray-700 italic leading-relaxed pl-6">
                  {testimonial.comment}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-gray-600 text-lg">
            ¿Ya viajaste con nosotros? <span className="font-bold text-[#120573]">¡Comparte tu experiencia!</span>
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default Testimonials;
