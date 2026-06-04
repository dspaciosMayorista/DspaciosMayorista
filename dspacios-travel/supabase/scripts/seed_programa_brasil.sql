-- ───────────────────────────────────────────────────────────────────────────
-- SEED · Programa de prueba "LO MEJOR DE BRASIL 2025" (12d/11n)
--
-- Datos extraídos del PDF del proveedor (docs/programas/). Sirve para tener un
-- programa real cargado sin digitarlo a mano.
--   · Requiere haber corrido antes la migración 031_programas.sql.
--   · Es re-ejecutable: borra el programa con el mismo nombre y lo recrea.
--   · Queda PUBLICADO y con markup 0 (PVP = neto). Ajusta tu % de markup en
--     Producto → Programas → General. El proveedor queda sin asignar.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  pid bigint;
  c1 bigint;
  c2 bigint;
  c3 bigint;
begin
  delete from public.programas where nombre = 'LO MEJOR DE BRASIL 2025';

  insert into public.programas
    (nombre, subtitulo, dias, noches, moneda, salidas, vigencia_desde, vigencia_hasta,
     min_pax, max_pax, pct_mk, pct_fee_tarjeta, nino_edad_max, nino_valor_servicios,
     texto_condiciones, texto_cancelacion, texto_pagos, activo, publicado)
  values
    ('LO MEJOR DE BRASIL 2025',
     'Río de Janeiro – Foz do Iguazú – Manaus – Evolução Ecolodge – Salvador da Bahía',
     12, 11, 'USD', 'Diarias', '2025-01-02', '2025-12-20',
     2, 19, 0, 0.05, 2, 719,
     'Tarifas por persona en USD, base regular, servicio en español. Triples = dobles con cama extra. Los trayectos aéreos entre ciudades NO están incluidos. Máximo 19 pasajeros (reservas individuales). Sujeto a cambios y disponibilidad. No tiene adicional para 1 pasajero solo. Niño hasta 2 años free en hospedaje compartiendo cama de los padres (paga servicios USD 719); después paga como adulto.',
     'Por deportación o no admisión al país: 100%. 01–15 días antes: 100%. 16–29 días antes: 75%. 30–59 días antes: 40%. 60+ días antes: 0%.',
     'Pagos a la TRM oficial del día del abono. Separar con 30% del total. 60 días antes: 50% pagado. 45 días antes: 75%. 35 días antes: 100%. Suplemento 5% para pagos con TDC o link de pago.',
     true, true)
  returning id into pid;

  -- Ciudades (ruta) ─────────────────────────────────────────────────────────
  insert into public.programa_ciudades (programa_id, orden, nombre, codigo_iata, noches) values
    (pid, 0, 'RIO DE JANEIRO',     'GIG', 3),
    (pid, 1, 'FOZ DO IGUAZÚ',      'IGU', 2),
    (pid, 2, 'MANAUS',             'MAO', 2),
    (pid, 3, 'EVOLUÇÃO ECOLODGE',  NULL,  2),
    (pid, 4, 'SALVADOR DA BAHÍA',  'SSA', 2);

  -- Itinerario día por día ──────────────────────────────────────────────────
  insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion) values
    (pid, 1,  'LLEGADA A RIO DE JANEIRO', false, false, false, 'Llegada al aeropuerto internacional de Río de Janeiro (GIG). Recepción y traslado privado al hotel seleccionado. Resto del día libre. Alojamiento.'),
    (pid, 2,  'RIO DE JANEIRO', true, false, false, 'Tour compartido al Pan de Azúcar: teleférico al cerro Urca y luego a la cima del Pan de Azúcar (vista 360° de la ciudad). Incluye visitas panorámicas a las playas de la Zona Sur. Regreso al hotel.'),
    (pid, 3,  'RIO DE JANEIRO', true, false, false, 'Día libre. Tours opcionales recomendados: Petrópolis, city tour, favela, Jardín Botánico y Floresta de Tijuca.'),
    (pid, 4,  'RIO DE JANEIRO / FOZ DO IGUAZÚ', true, false, false, 'Traslado privado al aeropuerto (GIG). Llegada a Foz do Iguaçu (IGU) y traslado regular al hotel. Opcional Rafain Cena Show.'),
    (pid, 5,  'FOZ DO IGUAZÚ', true, false, false, 'Mañana: lado argentino de las Cataratas del Iguazú (tren ecológico, Estación Cataratas, Garganta del Diablo). Tarde: lado brasilero (Mirador de las Cataratas, caminata ~1.200 m). Regreso al hotel.'),
    (pid, 6,  'FOZ DO IGUAZÚ / MANAUS', true, false, false, 'Transfer regular al aeropuerto de Foz (IGU). Llegada a Manaus (MAO) y transfer privado al hotel. Resto del día libre.'),
    (pid, 7,  'MANAUS - LODGE DE SELVA', true, true, true, 'Pick up y transfer al Evolução Ecolodge. En el camino, encuentro de las Aguas y almuerzo en restaurante flotante. Tarde: recorrido en canoa por el Igapó. Pesca de pirañas y puesta de sol. Cena.'),
    (pid, 8,  'LODGE DE SELVA', true, true, true, 'Caminata por la selva con guía especializado; visita a la comunidad de Acajatuba (población ribereña). Almuerzo. Por la noche, cena de despedida y avistamiento nocturno de jacarés.'),
    (pid, 9,  'LODGE DE SELVA - MANAUS', true, false, false, 'Mañana libre en el lodge. 10:00 salida hacia Manaus y transfer al hotel. Resto del día libre para conocer la ciudad. Alojamiento.'),
    (pid, 10, 'MANAUS - SALVADOR DA BAHIA', true, false, false, 'Transfer privado al aeropuerto de Manaus (MAO). Llegada a Salvador (SSA) y transfer regular al hotel. Resto del día libre.'),
    (pid, 11, 'SALVADOR DA BAHIA', true, false, false, 'City tour histórico y panorámico: Farol da Barra, Ciudad Alta, El Pelourinho, iglesias, Casa de Jorge Amado y Elevador Lacerda. Regreso al hotel. Opcional: Balé Folclórico da Bahia.'),
    (pid, 12, 'SALIDA DE SALVADOR DA BAHIA', true, false, false, 'Traslado al aeropuerto de Salvador (SSA) para el vuelo de regreso. Fin de servicios.');

  -- Categoría A ──────────────────────────────────────────────────────────────
  insert into public.programa_categorias (programa_id, orden, nombre) values (pid, 0, 'Categoría A') returning id into c1;
  insert into public.programa_categoria_hoteles (categoria_id, ciudad, hotel, orden) values
    (c1, 'RIO DE JANEIRO',    'Windsor Copa',        0),
    (c1, 'FOZ DO IGUAZÚ',     'Viale Tower',         1),
    (c1, 'MANAUS',            'Saint Paul',          2),
    (c1, 'EVOLUÇÃO ECOLODGE', 'Evolução Ecolodge',   3),
    (c1, 'SALVADOR DA BAHÍA', 'Portobello Ondina',   4);
  insert into public.programa_precios (categoria_id, acomodacion, neto, bajo_solicitud) values
    (c1, 'sencilla', 2806, false),
    (c1, 'doble',    1839, false),
    (c1, 'triple',   1752, false);

  -- Categoría B ──────────────────────────────────────────────────────────────
  insert into public.programa_categorias (programa_id, orden, nombre) values (pid, 1, 'Categoría B') returning id into c2;
  insert into public.programa_categoria_hoteles (categoria_id, ciudad, hotel, orden) values
    (c2, 'RIO DE JANEIRO',    'Windsor California',      0),
    (c2, 'FOZ DO IGUAZÚ',     'Wish Foz',                1),
    (c2, 'MANAUS',            'Adrianópolis All Suites', 2),
    (c2, 'EVOLUÇÃO ECOLODGE', 'Evolução Ecolodge',       3),
    (c2, 'SALVADOR DA BAHÍA', 'Novotel Rio Vermelho',    4);
  insert into public.programa_precios (categoria_id, acomodacion, neto, bajo_solicitud) values
    (c2, 'sencilla', 3359, false),
    (c2, 'doble',    2192, false),
    (c2, 'triple',   NULL, true);

  -- Categoría C ──────────────────────────────────────────────────────────────
  insert into public.programa_categorias (programa_id, orden, nombre) values (pid, 2, 'Categoría C') returning id into c3;
  insert into public.programa_categoria_hoteles (categoria_id, ciudad, hotel, orden) values
    (c3, 'RIO DE JANEIRO',    'Miramar by Windsor',    0),
    (c3, 'FOZ DO IGUAZÚ',     'Doubletree by Hilton',  1),
    (c3, 'MANAUS',            'Tryp by Wyndham Manaus', 2),
    (c3, 'EVOLUÇÃO ECOLODGE', 'Evolução Ecolodge',     3),
    (c3, 'SALVADOR DA BAHÍA', 'Fera Palace',           4);
  insert into public.programa_precios (categoria_id, acomodacion, neto, bajo_solicitud) values
    (c3, 'sencilla', 3859, false),
    (c3, 'doble',    2486, false),
    (c3, 'triple',   NULL, true);

  -- Incluye (por ciudad) ──────────────────────────────────────────────────────
  insert into public.programa_inclusiones (programa_id, ciudad, tipo, texto, orden) values
    (pid, 'RIO DE JANEIRO', 'incluye', 'Traslado aeropuerto – hotel – aeropuerto en Río de Janeiro.', 0),
    (pid, 'RIO DE JANEIRO', 'incluye', '03 noches de alojamiento en Río de Janeiro + desayunos.', 1),
    (pid, 'RIO DE JANEIRO', 'incluye', 'City tour Río de Janeiro y Pan de Azúcar en servicio regular.', 2),
    (pid, 'RIO DE JANEIRO', 'incluye', 'Guía profesional en español e impuestos obligatorios.', 3),
    (pid, 'FOZ DO IGUAZÚ', 'incluye', 'Traslado aeropuerto – hotel – aeropuerto en Foz do Iguazú.', 4),
    (pid, 'FOZ DO IGUAZÚ', 'incluye', '02 noches de alojamiento en Foz do Iguazú + desayunos.', 5),
    (pid, 'FOZ DO IGUAZÚ', 'incluye', 'Tours a las cataratas brasileras y argentinas + entrada a los parques.', 6),
    (pid, 'FOZ DO IGUAZÚ', 'incluye', 'Guía profesional en español e impuestos obligatorios.', 7),
    (pid, 'MANAUS', 'incluye', 'Traslado aeropuerto – hotel – aeropuerto en Manaus.', 8),
    (pid, 'MANAUS', 'incluye', '02 noches de alojamiento en Manaus + desayunos e impuestos.', 9),
    (pid, 'EVOLUÇÃO ECOLODGE', 'incluye', 'Traslado hotel – puerto – hotel y 02 noches en lodge de selva.', 10),
    (pid, 'EVOLUÇÃO ECOLODGE', 'incluye', '02 desayunos, 02 almuerzos y 02 cenas.', 11),
    (pid, 'EVOLUÇÃO ECOLODGE', 'incluye', 'Encuentro de las aguas, paseo en canoa, caminata en la selva, visita a casa de nativos y avistamiento nocturno de jacarés con guía en español.', 12),
    (pid, 'SALVADOR DA BAHÍA', 'incluye', 'Traslado aeropuerto – hotel – aeropuerto en Salvador da Bahía.', 13),
    (pid, 'SALVADOR DA BAHÍA', 'incluye', '02 noches de alojamiento en Salvador + desayunos.', 14),
    (pid, 'SALVADOR DA BAHÍA', 'incluye', 'City tour histórico en servicio regular, guía en español, asistencia médica e impuestos. Fee bancario 3%.', 15),
    -- No incluye (general)
    (pid, NULL, 'no_incluye', 'Alimentación no mencionada y bebidas en las comidas.', 100),
    (pid, NULL, 'no_incluye', 'Check-in anticipado, check-out tardío y servicios no mencionados.', 101),
    (pid, NULL, 'no_incluye', 'Propinas para guías, choferes y meseros.', 102),
    (pid, NULL, 'no_incluye', 'Suplemento del 5% para pagos con TDC o link de pago.', 103),
    (pid, NULL, 'no_incluye', 'Ticket aéreo internacional.', 104),
    (pid, NULL, 'no_incluye', 'Tickets aéreos nacionales (entre ciudades).', 105);

  -- Tours opcionales ──────────────────────────────────────────────────────────
  insert into public.programa_tours (programa_id, ciudad, nombre, precio, min_pax, orden) values
    (pid, 'RIO DE JANEIRO', 'Roxy Dinner Show', 214, 2, 0),
    (pid, 'RIO DE JANEIRO', 'Tour Petrópolis', 72, 2, 1),
    (pid, 'RIO DE JANEIRO', 'Tour Fútbol Carioca', 154, 2, 2),
    (pid, 'RIO DE JANEIRO', 'Tour Favela da Rocinha', 52, 2, 3),
    (pid, 'RIO DE JANEIRO', 'Tour Carnaval Experience', 91, 2, 4),
    (pid, 'RIO DE JANEIRO', 'Paraíso Tropical y Piedra del Telégrafo', 75, 2, 5),
    (pid, 'RIO DE JANEIRO', 'Tour a Búzios con paseo de barco y almuerzo', 88, 2, 6),
    (pid, 'RIO DE JANEIRO', 'Tour a Angra dos Reis con paseo de barco y almuerzo', 80, 2, 7),
    (pid, 'FOZ DO IGUAZÚ', 'Parque de las Aves', 46, 2, 8),
    (pid, 'FOZ DO IGUAZÚ', 'Rafain Cena Show', 103, 2, 9),
    (pid, 'FOZ DO IGUAZÚ', 'Macuco Safari', 130, 2, 10),
    (pid, 'FOZ DO IGUAZÚ', 'Amanecer en las Cataratas', 127, 2, 11),
    (pid, 'FOZ DO IGUAZÚ', 'Atardecer en las Cataratas', 111, 2, 12),
    (pid, 'MANAUS', 'HD City Tour Manaus', 120, 2, 13),
    (pid, 'MANAUS', 'Nado con delfines rosas', 51, 2, 14),
    (pid, 'SALVADOR DA BAHÍA', 'Balé Folclórico da Bahia', 87, 2, 15),
    (pid, 'SALVADOR DA BAHÍA', 'Tour a las Islas (Frades + Itaparica)', 40, 2, 16);

  -- Blackouts (generales) ─────────────────────────────────────────────────────
  insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo) values
    (pid, '2025-02-28', '2025-03-09', 'Carnaval'),
    (pid, '2025-04-17', '2025-04-20', 'Viernes Santo'),
    (pid, '2025-04-20', '2025-04-22', 'Día de Tiradentes'),
    (pid, '2025-04-30', '2025-05-05', 'Día del Trabajador'),
    (pid, '2025-06-18', '2025-06-23', 'Corpus Christi'),
    (pid, '2025-09-05', '2025-09-08', 'Independencia de Brasil'),
    (pid, '2025-10-10', '2025-10-13', 'Nossa Senhora Aparecida'),
    (pid, '2025-10-31', '2025-11-03', 'Día de Finados'),
    (pid, '2025-11-14', '2025-11-17', 'Proclamación de la República'),
    (pid, '2025-11-19', '2025-11-24', 'Conciencia Negra'),
    (pid, '2025-12-23', '2025-12-26', 'Navidad'),
    (pid, '2025-12-29', '2026-01-02', 'Réveillon');
end $$;
