-- Migración 012 (seed): Bloqueos reales JETSMART · Cartagena (MDE-CTG-MDE)
-- Datos tomados del INVENTARIO APPWEB. Idempotente por `record`.

insert into public.bloqueos_vuelo
  (record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida,
   vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg,
   cupos_total, tarifa_para_empaquetar, fecha_devolucion, fecha_emision)
values
  ('ABC001','JETSMART','MDE - CTG - MDE','5410','2026-04-10','08:47','09:57','5414','2026-04-13','17:26','18:39',10, 81900,'2026-03-31','2026-04-07'),
  ('L93FYZ','JETSMART','MDE - CTG - MDE','5410','2026-06-19','08:47','09:59','5414','2026-06-22','17:21','18:40', 0,212034,'2026-06-09','2026-06-16'),
  ('FEYPMH','JETSMART','MDE - CTG - MDE','5410','2026-06-26','08:47','09:59','5414','2026-06-29','17:21','18:40', 7,426948,'2026-06-16','2026-06-23'),
  ('D3KMMY','JETSMART','MDE - CTG - MDE','5410','2026-08-21','08:47','09:59','5414','2026-08-24','17:21','18:40',10,242022,'2026-08-11','2026-08-18'),
  ('E7IB3Z','JETSMART','MDE - CTG - MDE','5410','2026-08-28','08:47','09:59','5414','2026-08-31','17:21','18:40',10,242022,'2026-08-18','2026-08-25'),
  ('OEFQNX','JETSMART','MDE - CTG - MDE','5410','2026-09-04','08:47','09:59','5414','2026-09-07','17:21','18:40',10,242022,'2026-08-25','2026-09-01'),
  ('KBBH2A','JETSMART','MDE - CTG - MDE','5410','2026-09-11','08:47','09:59','5414','2026-09-14','17:21','18:40',10,242022,'2026-09-01','2026-09-08'),
  ('PG2LNE','JETSMART','MDE - CTG - MDE','5410','2026-09-18','08:47','09:59','5414','2026-09-21','17:21','18:40',10,242022,'2026-09-08','2026-09-15'),
  ('V985YM','JETSMART','MDE - CTG - MDE','5410','2026-09-25','08:47','09:59','5414','2026-09-28','17:21','18:40',10,242022,'2026-09-15','2026-09-22'),
  ('B9S2WG','JETSMART','MDE - CTG - MDE','5410','2026-10-16','08:47','09:59','5414','2026-10-19','17:21','18:40',10,242022,'2026-10-06','2026-10-13'),
  ('L9WYMW','JETSMART','MDE - CTG - MDE','5410','2026-10-23','08:47','09:59','5414','2026-10-26','17:21','18:40',10,242022,'2026-10-13','2026-10-20'),
  ('UF8G9U','JETSMART','MDE - CTG - MDE','5410','2026-11-06','08:51','10:02','5414','2026-11-09','17:26','18:41',10,242022,'2026-10-27','2026-11-03'),
  ('QC2DKQ','JETSMART','MDE - CTG - MDE','5410','2026-11-20','08:51','10:02','5414','2026-11-23','17:26','18:41',10,242022,'2026-11-10','2026-11-17'),
  ('Q38P4L','JETSMART','MDE - CTG - MDE','5410','2026-11-27','08:51','10:02','5414','2026-11-30','17:26','18:41',10,242022,'2026-11-17','2026-11-24'),
  ('NC1U2N','JETSMART','MDE - CTG - MDE','5426','2026-12-30','09:50','11:01','5425','2027-01-02','16:41','17:56', 6,371970,'2026-12-20','2026-12-27')
on conflict (record) do nothing;

-- Generar las sillas (1..cupos) en estado disponible para los records sembrados
insert into public.sillas (bloqueo_id, numero_silla, estado)
select b.id, g, 'disponible'
from public.bloqueos_vuelo b
cross join generate_series(1, b.cupos_total) g
where not exists (select 1 from public.sillas s where s.bloqueo_id = b.id);
