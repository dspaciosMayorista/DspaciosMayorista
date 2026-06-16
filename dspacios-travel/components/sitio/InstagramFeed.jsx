"use client";

import React from 'react';
import { Camera as Instagram } from 'lucide-react';

const InstagramFeed = () => {
  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Instagram className="w-6 h-6 text-[#120573]" />
            <span className="font-bold text-[#120573]">@dspaciostravel</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-[#120573]">
            Síguenos en Instagram
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            'Un hombre saltando al agua cristalina desde un barco',
            'Pareja brindando con copas al atardecer en la playa',
            'Vista aérea de una ciudad europea histórica',
            'Plato de comida exótica local colorido'
          ].map((alt, i) => (
            <div key={i} className="aspect-square relative overflow-hidden rounded-xl group cursor-pointer">
              <img
                alt={alt}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
               src="https://images.unsplash.com/photo-1615003380049-a716b685b98e" />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Instagram className="w-8 h-8 text-white" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default InstagramFeed;
