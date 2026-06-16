import React from 'react';
import Link from 'next/link';
import { Calendar, ArrowRight, Tag } from 'lucide-react';

// Sección BLOG_GRID. datos: { titulo?, subtitulo? }
// items: SitioBlog[] (de web_blog) pasados por prop. Detalle en /blog/[id].
const BlogGrid = ({ datos = {}, items = [] }) => {
  const titulo = datos.titulo || "Revista del Viajero";
  const subtitulo = datos.subtitulo ||
    "Consejos expertos, guías detalladas y todo lo que necesitas saber para tu próxima aventura.";
  const posts = items || [];

  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <span className="text-[#120573] font-bold tracking-wider uppercase text-sm mb-4 block">Inspiración & Guías</span>
          <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">{titulo}</h2>
          {subtitulo ? (
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">{subtitulo}</p>
          ) : null}
        </div>

        {posts.length === 0 ? (
          <p className="text-center text-gray-500">Pronto publicaremos nuevos artículos.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            {posts.map((post) => (
              <article
                key={post.id}
                className="flex flex-col bg-white rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 group"
              >
                <div className="h-64 overflow-hidden relative">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  {post.category ? (
                    <div className="absolute top-4 left-4">
                      <span className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full text-[#120573] text-xs font-bold uppercase tracking-wide shadow-md flex items-center gap-2">
                        <Tag className="w-3 h-3" /> {post.category}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="p-8 flex-1 flex flex-col">
                  {post.date ? (
                    <div className="flex items-center text-xs text-gray-500 mb-4 font-medium">
                      <Calendar className="w-4 h-4 mr-2 text-[#d8f511]" />
                      {post.date}
                    </div>
                  ) : null}

                  <h3 className="text-2xl font-bold text-[#120573] mb-4 line-clamp-2 group-hover:text-[#1a0a9e] transition-colors">
                    {post.title}
                  </h3>

                  <p className="text-gray-600 mb-8 line-clamp-3 flex-1 leading-relaxed">{post.summary}</p>

                  <Link href={`/blog/${post.id}`} className="mt-auto inline-block">
                    <button className="text-[#120573] font-bold flex items-center text-sm uppercase tracking-wide group-hover:text-[#d8f511] transition-colors">
                      Leer Artículo Completo <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-2 transition-transform" />
                    </button>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default BlogGrid;
