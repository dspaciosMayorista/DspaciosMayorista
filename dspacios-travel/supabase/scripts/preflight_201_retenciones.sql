-- SOLO LECTURA. No corrige ningún dato. Correr ANTES de la migración 201 (y
-- repetir después): cuenta las sillas con datos de pasajero que la regla de
-- retención en plazo va a tratar distinto. Autocontenido (no usa funciones de
-- 194/198), para poder correrlo en cualquier base con la tabla `sillas`.
--
-- Qué cambia para cada categoría con la 201 (la migración NO las modifica):
--   A. sin contrato, vendible, con pasajero SIN plazo: ya no cuentan como cupo;
--      editarlas o cargarles datos exigirá fecha de plazo.
--   B. sin contrato, vendible, con pasajero y plazo: ya no cuentan como cupo
--      (son retenciones de hecho, aunque sigan en `disponible`).
--   C. sin contrato, vendible, con datos pero SIN pasajero (solo hotel, asesor,
--      documento…): ya no cuentan como cupo; para editarlas hará falta
--      pasajero y plazo, o vaciarlas.
--   D. en_plazo sin contrato con plazo ya vencido: aparecerán en el aviso de
--      Vuelos para liberarlas a mano.
--   E. en_plazo sin contrato vigente.
--   F. en_plazo sin contrato y sin pasajero o sin plazo: estado inconsistente.
--   G. con contrato MANUAL y pasajero SIN plazo: DECISIÓN CERRADA del dueño
--      (152 en producción): SIN backfill. El plazo se pide en la misma acción
--      al quitar el contrato manual (quitar_contrato_manual con p_plazo); la
--      firma vieja sin plazo las rechaza. Ningún script les pone plazo.
with params as (select (now() at time zone 'America/Bogota')::date as hoy),
s as (
  select s.id, b.record, s.numero_silla, s.estado::text as estado, s.plazo,
         s.numero_contrato, s.contrato_manual,
         coalesce(btrim(s.pasajero_nombres), '') <> '' or coalesce(btrim(s.pasajero_apellidos), '') <> '' as tiene_pasajero,
         (coalesce(btrim(s.pasajero_nombres), '') <> '' or coalesce(btrim(s.pasajero_apellidos), '') <> ''
          or coalesce(btrim(s.tipo_doc), '') <> '' or coalesce(btrim(s.numero_doc), '') <> '' or s.nacimiento is not null
          or coalesce(btrim(s.inf_nombres), '') <> '' or coalesce(btrim(s.inf_apellidos), '') <> ''
          or coalesce(btrim(s.inf_tipo_doc), '') <> '' or coalesce(btrim(s.inf_numero), '') <> '' or s.inf_nacimiento is not null
          or coalesce(btrim(s.responsable_menor), '') <> '' or coalesce(btrim(s.agencia), '') <> ''
          or coalesce(btrim(s.asesor), '') <> '' or coalesce(btrim(s.hotel), '') <> ''
          or coalesce(btrim(s.acomodacion), '') <> '' or s.plazo is not null) as tiene_datos
    from public.sillas s
    join public.bloqueos_vuelo b on b.id = s.bloqueo_id
), clasif as (
  select s.*,
         case
           when numero_contrato is null and contrato_manual is null and estado in ('disponible', 'cambio_entrante') then
             case when tiene_pasajero and plazo is null then 'A'
                  when tiene_pasajero then 'B'
                  when tiene_datos then 'C' end
           when numero_contrato is null and contrato_manual is null and estado = 'en_plazo' then
             case when not tiene_pasajero or plazo is null then 'F'
                  when plazo < (select hoy from params) then 'D'
                  else 'E' end
           when numero_contrato is null and contrato_manual is not null and tiene_pasajero and plazo is null
                and estado not in ('devuelta', 'no_vendida', 'retirada', 'cambio') then 'G'
         end as cat
    from s
), categorias(cat, descripcion) as (values
  ('A', 'sin contrato, vendible, con pasajero SIN plazo'),
  ('B', 'sin contrato, vendible, con pasajero y plazo'),
  ('C', 'sin contrato, vendible, con datos sin pasajero'),
  ('D', 'en_plazo sin contrato, plazo VENCIDO (aviso: liberar a mano)'),
  ('E', 'en_plazo sin contrato, vigente'),
  ('F', 'en_plazo sin contrato sin pasajero o sin plazo (inconsistente)'),
  ('G', 'contrato MANUAL con pasajero SIN plazo (quitar contrato exigirá plazo)')
)
select c.cat, c.descripcion, count(x.id) as sillas,
       count(distinct x.record) as records,
       coalesce(string_agg(x.record || ' #' || x.numero_silla, ', ' order by x.record, x.numero_silla)
                  filter (where x.id is not null), '') as ejemplos
  from categorias c
  left join clasif x on x.cat = c.cat
 group by c.cat, c.descripcion
 order by c.cat;
