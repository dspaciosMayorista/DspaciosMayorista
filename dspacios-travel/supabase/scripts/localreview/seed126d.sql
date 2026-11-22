-- #126 V1 · ofertas RECOMENDADAS para que Vista Booking muestre tarjeta, popup «Ver opciones» y tabla de resultados.
-- SOLO COPIA DESECHABLE (#126). Rehúsa correr fuera de una base cuyo nombre empiece por «rev_verif» y nunca toca la base de revisión del dueño ni producción.
-- Orden de preparación de la copia (ver docs/tecnico/followup-126-acceptance-matrix-2026-11-18.md §9): crear la copia desde rev_verif_corr → aplicar las migraciones 312 y 313 → seed126.sql, seed126b.sql, seed126c.sql, seed126d.sql.
-- Requisito: existen en la copia las ofertas publicadas del destino «DEMO 125» (paquetes 912501, 912503, 912504, 912512; fixture de #125). Si no, el update no cambia nada y el SELECT final queda vacío.

do $$
begin
  if current_database() !~ '^rev_verif' then
    raise exception 'seed126: solo en copias desechables rev_verif_*; base actual: %. No se cambió nada.', current_database();
  end if;
end $$;
-- #126 V1: la grilla inicial de Vista Booking solo muestra OFERTAS RECOMENDADAS (armado_hoteles.prioridad 1-6 por paquete). La copia desechable no tenia ninguna (0 de 21): por eso "(0)" tarjetas.
-- Se marcan como recomendadas (prioridad 1) las ofertas publicadas de DEMO 125 para ejercitar tarjeta, popup y tabla. SOLO en la copia desechable rev_verif_126.
update public.armado_hoteles set prioridad = 1 where paquete_id in (912501, 912503, 912504, 912512) and prioridad is null;
select paquete_id, hotel_id, prioridad from public.armado_hoteles where prioridad is not null order by 1;
