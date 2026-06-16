"use client";

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { destinations } from '@/lib/sitio/data';
import { ArrowRight } from 'lucide-react';

export default function DestinationsPage() {
  const regions = ['Caribe', 'Europa', 'Sudamérica', 'Internacional'];

  return (
    <div className="pt-28 pb-24 bg-white min-h-screen">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-20"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Explora el Mundo</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Descubre lugares fascinantes y vive experiencias que cambiarán tu forma de ver la vida.
          </p>
        </motion.div>

        {regions.map((region) => {
          const regionDestinations = destinations.filter(d => d.region === region);
          if (regionDestinations.length === 0) return null;

          return (
            <div key={region} className="mb-24 last:mb-0">
              <div className="flex items-center gap-4 mb-10">
                <div className="h-10 w-2 bg-[#d8f511] rounded-full"></div>
                <h2 className="text-3xl font-bold text-[#120573]">
                  {region}
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {regionDestinations.map((dest) => (
                  <motion.div
                    key={dest.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="group relative overflow-hidden rounded-3xl aspect-[3/4] cursor-pointer shadow-lg hover:shadow-2xl transition-all duration-500"
                  >
                    <Link href={`/destinos/${dest.id}`}>
                      <img
                        src={dest.image}
                        alt={dest.name}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#120573] via-[#120573]/20 to-transparent opacity-90 group-hover:opacity-100 transition-opacity" />

                      <div className="absolute bottom-0 left-0 w-full p-8 text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                        <h3 className="text-3xl font-bold mb-3">{dest.name}</h3>
                        <div className="flex items-center text-[#d8f511] font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-4 group-hover:translate-y-0">
                          Ver Más <ArrowRight className="ml-2 w-5 h-5" />
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
