-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA del bloque 4.b de `diagnostico_contratos_b2b.sql`
--
-- Crea tres contratos de mentira con formas distintas y comprueba que el
-- veredicto los separa bien. **Termina en ROLLBACK**: no deja nada.
--
-- POR QUÉ EXISTE
--   El bloque 4.b decide si un contrato "tiene la forma" de haber salido del
--   importador de minorista. Una versión anterior afirmaba que miraba seis
--   señales y el `case` solo comprobaba cuatro: un contrato manual escueto
--   —sin destino, sin tipo de paquete, 1 pax y ya confirmado— salía marcado
--   como importado sin serlo, y eso llevaría a "arreglar" un dato que estaba
--   bien. El caso PARCIAL de aquí abajo es exactamente esa fila.
--
-- ⚠️ La expresión está DUPLICADA de `diagnostico_contratos_b2b.sql` a
--   propósito: ese archivo tiene que poder pegarse en el editor SQL de
--   Supabase sin depender de nada. Si se cambia el veredicto allí, hay que
--   cambiarlo aquí — y esta prueba es la que lo delata, porque los tres casos
--   dejarían de clasificar como se espera.
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into public.ventas
  (numero_contrato, tenant, cliente, asesor, freelance_nombre, tipo_asesor, canal,
   estado, pax, precio_venta, destino, tipo_paquete, fecha_regreso, aliado_id, b2b_usuario_id)
values
  -- 1. IMPORTADO: cumple las ocho señales.
  ('PRUEBA-IMP', 'minorista', 'Cliente', 'ANA GOMEZ', 'ANA GOMEZ', 'freelance', 'B2B',
   'confirmado', 1, 1000, null, null, null, null, null),

  -- 2. PARCIAL: contrato manual escueto. Sin destino, sin tipo de paquete,
  --    1 pax y confirmado —las cuatro que se comprobaban antes— pero SÍ tiene
  --    fecha de regreso y el asesor NO es el freelance. No es importado.
  ('PRUEBA-PAR', 'minorista', 'Cliente', 'PEDRO INTERNO', 'ANA GOMEZ', 'freelance', 'B2B',
   'confirmado', 1, 1000, null, null, '2026-09-10', null, null),

  -- 3. MANUAL: no se parece en nada.
  ('PRUEBA-MAN', 'minorista', 'Cliente', 'PEDRO INTERNO', null, 'interno', 'B2C',
   'activo', 2, 2000, 'SAN ANDRES', 'empaquetado', '2026-09-10', null, null);

create temp table _esperado(numero text, veredicto text) on commit drop;
insert into _esperado values
  ('PRUEBA-IMP', 'COMPATIBLE con el importador de minorista — cumple las 8'),
  ('PRUEBA-PAR', 'PARCIAL — se parece pero NO cumple todas; revisar a mano'),
  ('PRUEBA-MAN', 'NO encaja con el importador — revisar cómo se creó');

with calculado as (
  select
    v.numero_contrato,
    ( (v.destino is null)::int
    + (v.tipo_paquete is null)::int
    + (v.fecha_regreso is null)::int
    + (v.pax = 1)::int
    + (v.estado = 'confirmado')::int
    + (v.asesor is not null and v.freelance_nombre is not null
         and lower(btrim(v.asesor)) = lower(btrim(v.freelance_nombre)))::int
    + (v.aliado_id is null)::int
    + (v.b2b_usuario_id is null)::int
    ) as senales,
    case
      when v.destino is null
       and v.tipo_paquete is null
       and v.fecha_regreso is null
       and v.pax = 1
       and v.estado = 'confirmado'
       and v.asesor is not null and v.freelance_nombre is not null
       and lower(btrim(v.asesor)) = lower(btrim(v.freelance_nombre))
       and v.aliado_id is null
       and v.b2b_usuario_id is null
        then 'COMPATIBLE con el importador de minorista — cumple las 8'
      when v.destino is null and v.tipo_paquete is null and v.pax = 1
        then 'PARCIAL — se parece pero NO cumple todas; revisar a mano'
      else 'NO encaja con el importador — revisar cómo se creó'
    end as veredicto
  from public.ventas v
  where v.numero_contrato in ('PRUEBA-IMP','PRUEBA-PAR','PRUEBA-MAN')
)
select
  c.numero_contrato,
  c.senales as "señales que cumple (de 8)",
  c.veredicto,
  e.veredicto as "se esperaba",
  case when c.veredicto = e.veredicto then 'OK' else 'FALLA' end as resultado
from calculado c
join _esperado e on e.numero = c.numero_contrato
order by c.numero_contrato;

rollback;
