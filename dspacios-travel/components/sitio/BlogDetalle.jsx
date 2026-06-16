"use client";

import React from 'react';
import Link from 'next/link';
import { Calendar, ArrowLeft, MessageCircle, User, Share2 } from 'lucide-react';
import { Button } from '@/components/sitio/ui/button';

export default function BlogDetalle({ post, whatsappNumero }) {
  const waNumero = whatsappNumero || '573212150582';

  if (!post) return <div className="pt-32 text-center">Artículo no encontrado</div>;

  return (
    <div className="pt-28 pb-24 bg-white min-h-screen">
      <article className="container mx-auto px-4 max-w-4xl">
        <Link href="/blog" className="inline-flex items-center text-gray-500 hover:text-[#120573] mb-8 font-medium transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" /> Volver a la revista
        </Link>

        <header className="mb-10 text-center">
          <span className="text-[#120573] bg-[#d8f511] px-4 py-1 rounded-full text-xs font-bold mb-6 inline-block uppercase tracking-widest">
            {post.category}
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-[#120573] mb-8 leading-tight">
            {post.title}
          </h1>
          <div className="flex items-center justify-center text-gray-500 gap-6 text-sm border-y border-gray-100 py-6">
            <span className="flex items-center gap-2"><Calendar className="w-4 h-4" /> {post.date}</span>
            <span className="flex items-center gap-2"><User className="w-4 h-4" /> Equipo D'Spacios</span>
            <span className="flex items-center gap-2 cursor-pointer hover:text-[#120573]"><Share2 className="w-4 h-4" /> Compartir</span>
          </div>
        </header>

        <div className="rounded-3xl overflow-hidden mb-12 shadow-2xl">
          <img src={post.image} alt={post.title} className="w-full h-auto object-cover max-h-[600px]" />
        </div>

        <div className="prose prose-lg max-w-none text-gray-700 mb-16">
          <p className="text-2xl leading-relaxed font-medium text-[#120573] mb-8 border-l-4 border-[#d8f511] pl-6 italic">
            {post.summary}
          </p>
          <div className="whitespace-pre-line mb-8">{post.content}</div>

          <h3 className="text-2xl font-bold text-[#120573] mt-12 mb-6">Lo que debes saber antes de ir</h3>
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>

          <h3 className="text-2xl font-bold text-[#120573] mt-8 mb-6">Recomendaciones de nuestros expertos</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Reserva con al menos 3 meses de antelación.</li>
            <li>Lleva siempre un seguro de viaje internacional.</li>
            <li>Verifica la vigencia de tu pasaporte.</li>
          </ul>
        </div>

        {/* CTA Banner */}
        <div className="bg-[#120573] p-10 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-8 text-white shadow-xl">
          <div>
            <h3 className="text-2xl font-bold mb-2">¿Te inspiró este artículo?</h3>
            <p className="text-white/80">Nuestros expertos pueden hacer realidad este viaje para ti.</p>
          </div>
          <Button
            className="bg-[#25D366] hover:bg-[#1ebc57] text-white font-bold px-8 py-6 rounded-xl shadow-lg whitespace-nowrap"
            onClick={() => window.open(`https://wa.me/${waNumero}`, '_blank')}
          >
            <MessageCircle className="mr-2 w-5 h-5" /> Planear mi Viaje
          </Button>
        </div>
      </article>
    </div>
  );
}
