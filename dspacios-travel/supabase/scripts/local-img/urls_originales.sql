-- Restores the original-size fixture URLs set by semilla_img.sql.
update public.programas set portada_url = 'http://127.0.0.1:54371/img/' ||
  case when id - 916000 <= 6 then 'huge-' || (id - 916000) when id - 916000 <= 9 then 'large-' || (id - 916006) else 'ok-' || (id - 916009) end || '.jpg?p=' || id where id between 916001 and 916012;
update public.servicios_adicionales set foto_url = 'http://127.0.0.1:54371/img/large-' || (1 + (id - 916000) % 6) || '.jpg?s=' || id where id between 916001 and 916045;
