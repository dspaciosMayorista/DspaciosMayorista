-- ROLLBACK 331 (duplicar paquete armado). Solo la corre el dueño. Solo borra la función: los borradores ya creados con ella son paquetes normales (inactivos) y NO se tocan.
drop function if exists public.duplicar_paquete_armado(bigint);
