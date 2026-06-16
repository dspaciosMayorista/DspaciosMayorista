import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { packages } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { MapPin, Calendar, Users, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';

const Packages = () => {
  const [filter, setFilter] = useState('Todos');
  const filters = ['Todos', 'Nacionales', 'Internacionales', 'Caribe', 'Europa', 'Escapadas'];

  const filteredPackages = filter === 'Todos' 
    ? packages 
    : filter === 'Internacionales'
      ? packages.filter(p => ['Caribe', 'Europa', 'Sudamérica', 'Internacional'].includes(p.region))
      : packages.filter(p => p.region === filter);

  return (
    <div className="pt-28 pb-24 bg-gray-50 min-h-screen">
      <Helmet>
        <title>Paquetes Turísticos | D'Spacios Travel</title>
      </Helmet>
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Nuestros Paquetes</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Encuentra el viaje perfecto para ti, con la garantía y respaldo que necesitas.
          </p>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap justify-center gap-3 mb-16">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-6 py-3 rounded-full font-medium transition-all duration-300 ${
                filter === f 
                  ? 'bg-[#120573] text-white shadow-lg scale-105' 
                  : 'bg-white text-gray-600 hover:bg-[#d8f511] hover:text-[#120573] shadow-sm'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredPackages.map((pkg, index) => (
            <motion.div
              key={pkg.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="group bg-white rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1"
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
              <div className="p-8 relative">
                <div className="flex items-center gap-2 text-[#d8f511] mb-2 text-sm font-bold uppercase tracking-wide">
                   {pkg.region}
                </div>
                <h3 className="text-2xl font-bold text-[#120573] mb-3 group-hover:text-[#1a0a9e] transition-colors">
                  {pkg.title}
                </h3>
                <p className="text-gray-600 mb-6 line-clamp-2 text-sm leading-relaxed">
                  {pkg.description}
                </p>
                
                <div className="space-y-3 mb-8 text-sm text-gray-500">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-[#120573]" />
                    <span className="font-medium">{pkg.destination}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-[#120573]" />
                    <span className="font-medium">{pkg.duration}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-[#120573]" />
                    <span className="font-medium">{pkg.people}</span>
                  </div>
                </div>

                <Link to={`/paquetes/${pkg.id}`}>
                  <Button className="w-full bg-[#120573] hover:bg-[#0d0459] text-white font-bold h-12 text-lg rounded-xl group/btn">
                    Ver Detalle <ArrowRight className="ml-2 w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Packages;