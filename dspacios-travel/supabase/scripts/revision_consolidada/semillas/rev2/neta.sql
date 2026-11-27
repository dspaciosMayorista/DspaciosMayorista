-- rev2 · NETA-05/06 — la corrección de la TRM de costos se prueba sobre un contrato PENDIENTE en USD que el propio dueño crea con el formulario (NETA-05).
-- Cada contrato de NTU303 toma 2 sillas; el bloqueo sembrado tenía 6 y los pasos de la primera ronda ya consumieron las de un contrato. Esta semilla (aditiva, idempotente)
-- solo garantiza 8 sillas DISPONIBLES adicionales para poder repetir el recorrido sin tocar la neta (100), la reventa (120) ni ninguna tarifa.
-- NO se ejecuta contra rev_consolidada sin avisar: la carga la decide la coordinación.
do $$
declare b constant bigint := 91203; v_max integer; v_disp integer;
begin
  if not exists (select 1 from public.bloqueos_vuelo where id = b) then return; end if;
  select coalesce(max(numero_silla), 0) into v_max from public.sillas where bloqueo_id = b;
  select count(*) into v_disp from public.sillas where bloqueo_id = b and estado = 'disponible';
  if v_disp < 8 then
    insert into public.sillas (bloqueo_id, numero_silla, estado)
    select b, v_max + n, 'disponible' from generate_series(1, 8 - v_disp) n;
    update public.bloqueos_vuelo set cupos_total = (select count(*) from public.sillas where bloqueo_id = b) where id = b;
  end if;
end $$;
