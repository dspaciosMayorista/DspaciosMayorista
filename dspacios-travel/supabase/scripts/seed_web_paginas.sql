-- Seed del árbol de páginas del sitio (estructura de la web de Hostinger).
-- Idempotente: solo si web_paginas está vacía. Correr DESPUÉS de la migración 079.
-- NOTA: algunos nombres venían recortados en las capturas (marcados con ⚠ en
-- comentario); ajústalos desde el CMS si hace falta.

do $$
declare
  nac bigint;
  intl bigint;
begin
  if exists (select 1 from public.web_paginas) then
    return;
  end if;

  -- ── Páginas principales ────────────────────────────────────────────────
  insert into public.web_paginas (slug, titulo, tipo, es_grupo_menu, en_menu, orden) values
    ('inicio', 'Inicio', 'home', false, true, 0),
    ('destinos-nacionales', 'Destinos Nacionales', 'destinos_nacionales', true, true, 1),
    ('destinos-internacionales', 'Destinos Internacionales', 'destinos_internacionales', true, true, 2),
    ('experiencias', 'Experiencias', 'experiencias', false, true, 3),
    ('sobre-nosotros', 'Sobre Nosotros', 'nosotros', false, true, 4),
    ('contacto', 'Contacto', 'contacto', false, true, 5),
    ('blog', 'Blog', 'blog', false, true, 6);

  select id into nac  from public.web_paginas where slug = 'destinos-nacionales';
  select id into intl from public.web_paginas where slug = 'destinos-internacionales';

  -- ── Destinos Nacionales (subpáginas) ───────────────────────────────────
  insert into public.web_paginas (parent_id, slug, titulo, tipo, orden) values
    (nac, 'san-andres',        'San Andrés',            'destino', 0),
    (nac, 'cartagena',         'Cartagena',             'destino', 1),
    (nac, 'santa-marta',       'Santa Marta',           'destino', 2),
    (nac, 'la-guajira-aereo',     'La Guajira Aéreo',    'destino', 3),
    (nac, 'la-guajira-terrestre', 'La Guajira Terrestre','destino', 4),
    (nac, 'tolu-covenas',      'Tolú & Coveñas',        'destino', 5),
    (nac, 'capurgana',         'Capurganá',             'destino', 6),
    (nac, 'bahia-solano',      'Bahía Solano',          'destino', 7),
    (nac, 'nuqui',             'Nuquí',                 'destino', 8),
    (nac, 'cano-cristales',    'Caño Cristales',        'destino', 9),
    (nac, 'eje-cafetero',      'Eje Cafetero',          'destino', 10),
    (nac, 'sur-de-colombia',   'Sur de Colombia',       'destino', 11),
    (nac, 'llanos-orientales', 'Llanos Orientales',     'destino', 12),
    (nac, 'boyaca',            'Boyacá',                'destino', 13),
    (nac, 'santander',         'Santander',             'destino', 14),
    (nac, 'huila-al-limite',   'Huíla al Límite',       'destino', 15),
    (nac, 'desierto-tatacoa',  'Desierto de la Tatacoa','destino', 16),
    (nac, 'amazonas',          'Amazonas',              'destino', 17);

  -- ── Destinos Internacionales (subpáginas) ──────────────────────────────
  insert into public.web_paginas (parent_id, slug, titulo, tipo, orden) values
    (intl, 'mar-caribe',     'Mar Caribe',        'destino', 0),
    (intl, 'eeuu-canada',    'EEUU y Canadá',     'destino', 1),
    (intl, 'suramerica',     'Suramérica',        'destino', 2),
    (intl, 'centroamerica',  'Centroamérica',     'destino', 3),
    (intl, 'paises-arabes',  'Países Árabes',     'destino', 4),
    (intl, 'turquia',        'Turquía',           'destino', 5),
    (intl, 'europa',         'Europa',            'destino', 6),
    (intl, 'africa',         'África',            'destino', 7),
    (intl, 'asia-oceania',   'Asia y Oceanía',    'destino', 8),
    (intl, 'cruceros',       'Cruceros',          'destino', 9);

  -- ── Secciones base (hero) para Inicio y cada subpágina ─────────────────
  -- Inicio: hero principal con el texto de la web actual.
  insert into public.web_secciones (pagina_id, tipo, orden, datos)
  select id, 'hero', 0, jsonb_build_object(
    'titulo', 'Explora el mundo de una forma única con D''SPACIOS TRAVEL',
    'subtitulo', 'Creamos itinerarios personalizados que superan tus expectativas y transforman tus sueños en realidad.',
    'cta_texto', 'Ver Tarifario', 'cta_url', '/tarifario', 'imagen', ''
  ) from public.web_paginas where slug = 'inicio';

  -- Cada destino arranca con un hero usando su título (editable luego).
  insert into public.web_secciones (pagina_id, tipo, orden, datos)
  select id, 'hero', 0, jsonb_build_object(
    'titulo', titulo, 'subtitulo', '', 'cta_texto', 'Cotizar', 'cta_url', '/tarifario', 'imagen', coalesce(imagen_portada,'')
  ) from public.web_paginas where tipo = 'destino';

  -- Botón "Consulta Disponibilidad" al final de cada destino → vista booking del portal.
  insert into public.web_secciones (pagina_id, tipo, orden, datos)
  select id, 'consulta_disponibilidad', 90, jsonb_build_object(
    'titulo', 'Elige tu fecha Favorita aquí', 'boton_texto', 'Consulta Disponibilidad',
    'url', '/tarifario', 'destino', titulo
  ) from public.web_paginas where tipo = 'destino';
end $$;
