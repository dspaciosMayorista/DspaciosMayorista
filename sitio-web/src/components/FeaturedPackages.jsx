import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { packages } from '@/lib/data';

const FeaturedPackages = () => {
  const featured = packages.filter(p => p.featured).slice(0, 3);

  return (
    <section id="packages" className="py-24 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-4">
              Paquetes Destacados
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl">
              Selección exclusiva de nuestras mejores ofertas
            </p>
          </motion.div>
          
          <Link to="/paquetes">
            <Button variant="outline" className="text-[#120573] border-[#120573] hover:bg-[#120573] hover:text-white transition-all">
              Ver Todos los Paquetes <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {featured.map((pkg, index) => (
            <motion.div
              key={pkg.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300"
            >
              <div className="relative h-72 overflow-hidden">
                <img 
                  src={pkg.image} 
                  alt={pkg.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute top-4 right-4 bg-[#d8f511] text-[#120573] px-4 py-2 rounded-full font-bold text-sm shadow-lg z-10">
                  Desde USD ${pkg.priceFrom}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#120573] via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
              </div>
              
              <div className="p-6 relative">
                <h3 className="text-2xl font-bold text-[#120573] mb-3 group-hover:text-[#1a0a9e] transition-colors">
                  {pkg.title}
                </h3>
                <p className="text-gray-600 mb-6 line-clamp-2 text-sm leading-relaxed">
                  {pkg.description}
                </p>
                
                <div className="flex items-center gap-4 mb-6 text-sm text-gray-500 font-medium">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-[#d8f511]" />
                    {pkg.destination.split(',')[0]}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#d8f511]" />
                    {pkg.duration.split('/')[0]}
                  </div>
                </div>

                <Link to={`/paquetes/${pkg.id}`}>
                  <Button className="w-full bg-[#120573] hover:bg-[#0d0459] text-white font-bold py-6 text-lg rounded-xl group/btn">
                    Ver Detalles
                    <ArrowRight className="ml-2 w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturedPackages;