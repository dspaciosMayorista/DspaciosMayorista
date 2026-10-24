-- ───────────────────────────────────────────────────────────────────────────
-- 230 · FIXTURE de la oferta #63 ABIERTA del paquete 70 (réplica de la medición de Producción: p63_oferta id 1, paquete 70, estado
-- 'abierta', cotización interna de prueba). Se corre DESPUÉS de test_230_correccion_fixture.sql y ANTES de la corrección, SOLO en una
-- base desechable local. Inserta directo (no por crear_cotizacion_oferta_63) porque el paquete 70 de la réplica está inactivo.
-- ───────────────────────────────────────────────────────────────────────────
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000230001', 'c230-oferta@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000230001', 'c230-oferta@x.test', 'C230 oferta', 'superadmin', true, 'mayorista')
on conflict (id) do update set activo = true;

insert into public.cotizaciones (cliente, tipo, modo, tenant, paquete_armado_id, estado, moneda)
values ('PRUEBA INTERNA 230', 'tarifario', 'simple', 'mayorista', 70, 'abierta', 'COP');

insert into public.p63_oferta (id, cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos,
                               huella, huella_financiera, snapshot, estado)
overriding system value
select 1, c.id, 'mayorista', 70, (select min(id) from public.salidas_dinamicas where paquete_id = 70), 3200,
       p.tarifario_revision_fuente, 5, 5, p.p63_rev_costos,
       'h-230', 'hf-230', '{"prueba": true}'::jsonb, 'abierta'
  from public.cotizaciones c, public.armado_paquetes p
 where c.cliente = 'PRUEBA INTERNA 230' and p.id = 70;

commit;
