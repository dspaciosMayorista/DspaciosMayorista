-- ───────────────────────────────────────────────────────────────────────────
-- SEED · Ejemplo de programa en modo SALIDA (Cibeles — Amazonas)
--
-- Llena UN programa completo para ver por dentro cómo se monta un circuito
-- tipo Cibeles (precio por fecha de salida, noches variables, hotel como
-- columna). Corre este script en el SQL editor de Supabase (requiere la
-- migración 068 ya aplicada).
--
-- Es idempotente: borra el ejemplo anterior (por nombre) antes de recrearlo.
-- Para quitarlo: delete from programas where nombre = 'AMAZONAS 2026 (EJEMPLO)';
-- ───────────────────────────────────────────────────────────────────────────

delete from public.programas where nombre = 'AMAZONAS 2026 (EJEMPLO)';

do $$
declare
  pid bigint;
begin
  -- ── Cabecera (pestaña General) ──────────────────────────────────────────────
  insert into public.programas (
    nombre, subtitulo, moneda, dias, noches,
    modo_precio, incluye_aereo,
    pct_mk, pct_fee_tarjeta, asistencia_medica_dia,
    salidas, vigencia_desde, vigencia_hasta,
    min_pax, max_pax, activo, publicado, notas
  ) values (
    'AMAZONAS 2026 (EJEMPLO)',
    'Leticia · Puerto Nariño · Tabatinga',
    'COP', null, null,                       -- dias/noches: null porque varían por salida
    'salida', true,                          -- modo por salida · con aéreo (Medellín–Leticia–Medellín)
    0, 0, 0,                                 -- markup / fee bancario / asistencia: AJÚSTALOS en General.
                                             --   (en 0, el PVP = el neto, para que veas la tarifa tal cual)
    'Según calendario (3 ó 4 noches)', '2026-05-29', '2026-12-31',
    2, 19, true, true,
    'EJEMPLO de montaje en modo SALIDA. Notas del proveedor: sencilla +45%; ' ||
    'niños 0–23m $85.000 (solo seguro); 2–3 años seguro+tiquete; 4–9 años 90% tarifa; ' ||
    '10+ como adulto. Tarifa base para acomodación doble o múltiple.'
  ) returning id into pid;

  -- ── Ruta (pestaña Ruta) ─────────────────────────────────────────────────────
  insert into public.programa_ciudades (programa_id, orden, nombre, noches) values
    (pid, 0, 'LETICIA',        3),
    (pid, 1, 'PUERTO NARIÑO',  0),
    (pid, 2, 'TABATINGA',      0);

  -- ── Itinerario (pestaña Itinerario) ─────────────────────────────────────────
  insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion) values
    (pid, 1, 'LLEGADA A LETICIA',        false, false, false,
      'Recepción en el aeropuerto Alfredo Vásquez Cobo y traslado al hotel. Recorrido caminando por las principales calles de Leticia, conociendo los parques y el malecón. Alojamiento.'),
    (pid, 2, 'PARQUE MUNDO AMAZÓNICO',   true,  false, true,
      'Desayuno en el hotel. Traslado al parque Mundo Amazónico. En la tarde, visita a la Isla de los Micos y a una comunidad indígena. Regreso al hotel. Cena.'),
    (pid, 3, 'PUERTO NARIÑO',            true,  false, true,
      'Desayuno. Navegación por el río Amazonas hacia Puerto Nariño. Visita al pueblo y a los lagos de Tarapoto. Regreso a Leticia. Cena.'),
    (pid, 4, 'TABATINGA (BRASIL)',       true,  false, true,
      'Desayuno. City tour por Tabatinga (Brasil). Tarde libre. *Plan 4 noches: caminata por la selva y alojamiento en la reserva natural peruana, cena y descanso.'),
    (pid, 5, 'DÍA LIBRE / REGRESO',      true,  false, false,
      'Desayuno. Día libre para actividades opcionales o traslado al aeropuerto según el vuelo de regreso. (Aplica según el plan de noches).');

  -- ── Incluye / No incluye (pestaña Incluye / No incluye) ─────────────────────
  insert into public.programa_inclusiones (programa_id, tipo, texto, orden) values
    (pid, 'incluye', 'Tiquete aéreo Medellín – Leticia – Medellín, con escala en Bogotá.', 0),
    (pid, 'incluye', 'Equipaje artículo personal e impuestos del tiquete.', 1),
    (pid, 'incluye', 'Traslados aeropuerto – hotel – aeropuerto.', 2),
    (pid, 'incluye', 'Alojamiento por 3 o 4 noches según el plan elegido.', 3),
    (pid, 'incluye', 'Recorrido por Leticia, parque Mundo Amazónico, Isla de los Micos y comunidad indígena.', 4),
    (pid, 'incluye', 'Visita a Puerto Nariño y city tour por Tabatinga (Brasil).', 5),
    (pid, 'incluye', 'Traslados terrestres y fluviales en destino, con acompañamiento.', 6),
    (pid, 'incluye', 'Alimentación (desayunos y cenas según número de noches) y 2 almuerzos.', 7),
    (pid, 'incluye', 'Asistencia médica.', 8),
    (pid, 'no_incluye', 'Impuesto de ingreso a Leticia $45.000 y a Puerto Nariño $20.000 (netos) por persona.', 0),
    (pid, 'no_incluye', 'Lavado y planchado de ropa ni llamadas telefónicas.', 1),
    (pid, 'no_incluye', 'Equipaje de bodega.', 2),
    (pid, 'no_incluye', 'Alimentación y gastos no especificados.', 3);

  -- ── Salidas y precios (pestaña Salidas y precios) ───────────────────────────
  --   Una fila por (fecha × hotel). neto_doble = neto_multiple (tarifa base);
  --   neto_sencilla = +45%; neto_nino = 90% (tier 4–9 años). columna = hotel.
  insert into public.programa_salidas
    (programa_id, orden, etiqueta, fecha_desde, fecha_hasta, noches, columna, neto_doble, neto_multiple, neto_sencilla, neto_nino) values
    -- MAY 29 AL 01 JUN · 3N
    (pid,  0, 'MAY 29 AL 01 JUN', '2026-05-29', '2026-06-01', 3, 'HOTEL ZURUMA', 2335000, 2335000, 3385750, 2101500),
    (pid,  1, 'MAY 29 AL 01 JUN', '2026-05-29', '2026-06-01', 3, 'HOTEL SIAMI',  2455000, 2455000, 3559750, 2209500),
    (pid,  2, 'MAY 29 AL 01 JUN', '2026-05-29', '2026-06-01', 3, 'HOTEL WAIRA',  2835000, 2835000, 4110750, 2551500),
    -- JUNIO 01 AL 05 · 4N
    (pid,  3, 'JUNIO 01 AL 05',   '2026-06-01', '2026-06-05', 4, 'HOTEL ZURUMA', 2975000, 2975000, 4313750, 2677500),
    (pid,  4, 'JUNIO 01 AL 05',   '2026-06-01', '2026-06-05', 4, 'HOTEL SIAMI',  3095000, 3095000, 4487750, 2785500),
    (pid,  5, 'JUNIO 01 AL 05',   '2026-06-01', '2026-06-05', 4, 'HOTEL WAIRA',  3465000, 3465000, 5024250, 3118500),
    -- JUNIO 05 AL 08 · 3N
    (pid,  6, 'JUNIO 05 AL 08',   '2026-06-05', '2026-06-08', 3, 'HOTEL ZURUMA', 2635000, 2635000, 3820750, 2371500),
    (pid,  7, 'JUNIO 05 AL 08',   '2026-06-05', '2026-06-08', 3, 'HOTEL SIAMI',  2755000, 2755000, 3994750, 2479500),
    (pid,  8, 'JUNIO 05 AL 08',   '2026-06-05', '2026-06-08', 3, 'HOTEL WAIRA',  3135000, 3135000, 4545750, 2821500),
    -- JUNIO 08 AL 12 · 4N
    (pid,  9, 'JUNIO 08 AL 12',   '2026-06-08', '2026-06-12', 4, 'HOTEL ZURUMA', 2975000, 2975000, 4313750, 2677500),
    (pid, 10, 'JUNIO 08 AL 12',   '2026-06-08', '2026-06-12', 4, 'HOTEL SIAMI',  3095000, 3095000, 4487750, 2785500),
    (pid, 11, 'JUNIO 08 AL 12',   '2026-06-08', '2026-06-12', 4, 'HOTEL WAIRA',  3465000, 3465000, 5024250, 3118500),
    -- JUNIO 12 AL 15 · 3N
    (pid, 12, 'JUNIO 12 AL 15',   '2026-06-12', '2026-06-15', 3, 'HOTEL ZURUMA', 2635000, 2635000, 3820750, 2371500),
    (pid, 13, 'JUNIO 12 AL 15',   '2026-06-12', '2026-06-15', 3, 'HOTEL SIAMI',  2755000, 2755000, 3994750, 2479500),
    (pid, 14, 'JUNIO 12 AL 15',   '2026-06-12', '2026-06-15', 3, 'HOTEL WAIRA',  3135000, 3135000, 4545750, 2821500);

  raise notice 'Programa de ejemplo creado con id %', pid;
end $$;
