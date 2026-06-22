"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { urlEmbebible, requiereIframe } from '@/lib/sitio/flyers';
import { EditableText } from '@/components/sitio/edicion/Editable';
import { useEdicion } from '@/components/sitio/edicion/EdicionContext';

// Sección FLYERS. datos: { titulo?, items: [{ titulo, tipo: 'imagen'|'pdf', url }] }
// Botones tipo "pill" que abren el flyer en un MODAL dentro de la misma página
// (sin redirigir). Drive → iframe /preview; Storage → <img> o <iframe> según tipo.
const Flyers = ({ datos = {} }) => {
  const editable = !!useEdicion()?.editable;
  const titulo = typeof datos.titulo === 'string' ? datos.titulo : '';
  const items = (Array.isArray(datos.items) ? datos.items : []).filter(
    (it) => it && typeof it.url === 'string' && it.url.trim()
  );
  const [abierto, setAbierto] = useState(null); // índice del flyer abierto

  if (items.length === 0 && !editable) return null;

  const item = abierto != null ? items[abierto] : null;

  return (
    <section className="bg-[#120573] pb-12 pt-8">
      <div className="container mx-auto px-4">
        {(titulo || editable) ? (
          <EditableText as="h2" campo="titulo" placeholder="Título (opcional)" className="mb-5 text-2xl font-extrabold text-white">{titulo}</EditableText>
        ) : null}
        {items.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-white/40 py-12 text-center text-white/70">
            Sin flyers. Abre <strong>⚙ Campos</strong> (barra del bloque) para subir tus flyers (imagen o PDF).
          </div>
        ) : (
        <div className="flex flex-wrap gap-3">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { if (!editable) setAbierto(i); }}
              className="rounded-full bg-[#d8f511] px-6 py-3 font-bold text-[#120573] shadow-lg transition-transform hover:scale-105"
            >
              {it.titulo || `Flyer ${i + 1}`}
            </button>
          ))}
        </div>
        )}
      </div>

      {item ? (
        <FlyerModal item={item} onClose={() => setAbierto(null)} />
      ) : null}
    </section>
  );
};

function FlyerModal({ item, onClose }) {
  const onEsc = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = prev;
    };
  }, [onEsc]);

  const tipo = item.tipo === 'pdf' ? 'pdf' : 'imagen';
  const src = urlEmbebible(item.url, tipo);
  const iframe = requiereIframe(item.url, tipo);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.titulo || 'Flyer'}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-[#120573] hover:bg-white"
      >
        ×
      </button>
      <div
        className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {iframe ? (
          <iframe
            src={src}
            title={item.titulo || 'Flyer'}
            className="h-[85vh] w-full rounded-xl border-0"
            allow="autoplay"
          />
        ) : (
          <img
            src={src}
            alt={item.titulo || 'Flyer'}
            className="mx-auto block max-h-[85vh] w-auto max-w-full rounded-xl"
          />
        )}
      </div>
    </div>
  );
}

export default Flyers;
