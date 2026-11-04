-- Rollback de la 278. Borra solo las reglas EBB/Long Stay (el motor vuelve a la tarifa base). No toca tarifas, temporadas ni precios publicados.
drop table if exists public.hotel_reglas_descuento;
