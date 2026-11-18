-- LIKE-FOR-LIKE PROJECTION (private copy): the same fixtures after reducirImagen() — red-*.webp are the REAL outputs of the
-- shipped reducer run in Edge by medir_reductor.mjs (FIXTURES=<dir>). Sources <= 600 KB and <= 1920 px are returned untouched.
-- This models NEW uploads only; existing originals are not rewritten. Undo with urls_originales.sql.
update public.programas set portada_url = 'http://127.0.0.1:54371/img/' ||
  case when id - 916000 <= 6 then 'red-huge-' || (id - 916000) || '.webp' when id - 916000 <= 9 then 'red-large-' || (id - 916006) || '.webp' else 'ok-' || (id - 916009) || '.jpg' end || '?p=' || id
  where id between 916001 and 916012;
update public.servicios_adicionales set foto_url = 'http://127.0.0.1:54371/img/red-large-' || (1 + (id - 916000) % 6) || '.webp?s=' || id where id between 916001 and 916045;
