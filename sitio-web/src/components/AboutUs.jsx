import React from 'react';
import { motion } from 'framer-motion';
import { Award, Target, Heart, TrendingUp } from 'lucide-react';

const AboutUs = () => {
  const values = [
    {
      icon: Award,
      title: 'Experiencia',
      description: 'Más de 15 años en la industria turística mayorista'
    },
    {
      icon: Target,
      title: 'Compromiso',
      description: 'Dedicados a superar tus expectativas en cada viaje'
    },
    {
      icon: Heart,
      title: 'Pasión',
      description: 'Amamos lo que hacemos y se nota en cada detalle'
    },
    {
      icon: TrendingUp,
      title: 'Crecimiento',
      description: 'Innovación constante para ofrecerte lo mejor'
    }
  ];

  return (
    <section id="about" className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">
              Quiénes Somos
            </h2>
            <p className="text-lg text-gray-700 mb-6 leading-relaxed">
              En <span className="font-bold text-[#120573]">D'Spacios Travel</span>, somos una agencia mayorista de viajes especializada en crear experiencias únicas e inolvidables. Nuestro compromiso es brindarte el mejor servicio, los mejores precios y la mayor variedad de destinos nacionales e internacionales.
            </p>
            <p className="text-lg text-gray-700 mb-8 leading-relaxed">
              Trabajamos con los principales proveedores turísticos del mundo para garantizarte la mejor calidad en hoteles, vuelos, excursiones y servicios complementarios. Tu satisfacción es nuestra prioridad.
            </p>

            <div className="grid grid-cols-2 gap-6">
              {values.map((value, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="flex flex-col items-center text-center p-4 bg-gray-50 rounded-xl hover:shadow-lg transition-shadow"
                >
                  <div className="w-12 h-12 bg-[#120573] rounded-full flex items-center justify-center mb-3">
                    <value.icon className="w-6 h-6 text-[#d8f511]" />
                  </div>
                  <h4 className="font-bold text-[#120573] mb-2">{value.title}</h4>
                  <p className="text-sm text-gray-600">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <img 
                className="w-full h-[600px] object-cover"
                alt="Equipo de D'Spacios Travel"
               src="https://images.unsplash.com/photo-1703495892326-60cb1a6e6594" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#120573]/60 to-transparent"></div>
            </div>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="absolute -bottom-6 -left-6 bg-[#d8f511] p-8 rounded-2xl shadow-2xl"
            >
              <div className="text-center">
                <div className="text-4xl font-bold text-[#120573]">15+</div>
                <div className="text-sm font-semibold text-[#120573]">Años de Experiencia</div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default AboutUs;