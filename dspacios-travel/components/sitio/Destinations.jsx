"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe2, MapPin } from 'lucide-react';

const NATIONAL_REGIONS = ['nacional', 'nacionales', 'colombia', 'caribe'];

const Destinations = ({ items }) => {
  const [activeTab, setActiveTab] = useState('nacional');

  const defaultNationalDestinations = [
    {
      name: 'Cartagena',
      image: 'Historic walled city of Cartagena Colombia with colorful colonial buildings'
    },
    {
      name: 'San Andrés',
      image: 'San Andres island with seven colors sea and white sand beach'
    },
    {
      name: 'Eje Cafetero',
      image: 'Coffee plantations in Colombia with traditional hacienda'
    },
    {
      name: 'Santa Marta',
      image: 'Beautiful beach in Santa Marta with mountains in background'
    },
    {
      name: 'Bogotá',
      image: 'Modern skyline of Bogota Colombia with mountains'
    },
    {
      name: 'Medellín',
      image: 'Medellin city view with cable cars and green mountains'
    }
  ];

  const defaultInternationalDestinations = [
    {
      name: 'Punta Cana',
      image: 'Luxury resort in Punta Cana Dominican Republic with beach'
    },
    {
      name: 'Cancún',
      image: 'Cancun Mexico turquoise beach with resort hotels'
    },
    {
      name: 'Miami',
      image: 'Miami Beach Florida with art deco buildings and ocean'
    },
    {
      name: 'Madrid',
      image: 'Plaza Mayor in Madrid Spain with historic architecture'
    },
    {
      name: 'París',
      image: 'Eiffel Tower in Paris France at sunset'
    },
    {
      name: 'Roma',
      image: 'Colosseum in Rome Italy ancient architecture'
    },
    {
      name: 'New York',
      image: 'New York City skyline with Empire State Building'
    },
    {
      name: 'Buenos Aires',
      image: 'Colorful Caminito street in Buenos Aires Argentina'
    }
  ];

  const hasItems = items && items.length;
  const nationalDestinations = hasItems
    ? items.filter((d) => NATIONAL_REGIONS.includes((d.region || '').toLowerCase()))
    : defaultNationalDestinations;
  const internationalDestinations = hasItems
    ? items.filter((d) => !NATIONAL_REGIONS.includes((d.region || '').toLowerCase()))
    : defaultInternationalDestinations;

  const destinations = activeTab === 'nacional' ? nationalDestinations : internationalDestinations;

  return (
    <section id="destinations" className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-4">
            Nuestros Destinos
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Explora el mundo con nosotros
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex bg-gray-100 rounded-full p-1">
            <button
              onClick={() => setActiveTab('nacional')}
              className={`px-8 py-3 rounded-full font-bold transition-all ${
                activeTab === 'nacional'
                  ? 'bg-[#120573] text-white shadow-lg'
                  : 'text-gray-600 hover:text-[#120573]'
              }`}
            >
              <MapPin className="inline-block w-5 h-5 mr-2" />
              Nacional
            </button>
            <button
              onClick={() => setActiveTab('internacional')}
              className={`px-8 py-3 rounded-full font-bold transition-all ${
                activeTab === 'internacional'
                  ? 'bg-[#120573] text-white shadow-lg'
                  : 'text-gray-600 hover:text-[#120573]'
              }`}
            >
              <Globe2 className="inline-block w-5 h-5 mr-2" />
              Internacional
            </button>
          </div>
        </div>

        {/* Destinations Grid */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
        >
          {destinations.map((destination, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.05 }}
              className="group cursor-pointer"
            >
              <div className="relative rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2">
                <div className="aspect-square">
                  <img
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    alt={destination.name}
                   src={destination.image || "https://images.unsplash.com/photo-1595872018818-97555653a011"} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#120573]/80 via-[#120573]/40 to-transparent flex items-end">
                  <div className="p-4 w-full">
                    <h3 className="text-white font-bold text-xl">{destination.name}</h3>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default Destinations;
