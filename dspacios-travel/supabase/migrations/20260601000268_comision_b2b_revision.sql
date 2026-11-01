-- ─────────────────────────────────────────────────────────────────────────────
-- 268 · Retención de diez filas de comisión B2B hasta que contabilidad concilie (#65)   ⚠️ SIN CORRER
--
-- ENTREGA SEPARADA del código del portal (#415): solo esquema. No cambia importes, abonos ni fichas, y NO incluye ninguna forma de cerrar la retención.
-- NUMERACIÓN: 268 = siguiente número libre tras la 267 de main. Confirmar con `ls supabase/migrations | sort | tail` antes de correr.
--
-- QUÉ HACE. El dueño aplazó la conciliación de diez filas históricas de `aliados_b2b` (#1, #80, #81, #82, #83, #85, #89, #107, #135, #137): su atribución
-- a una persona y el destinatario real de sus abonos no están conciliados. Una fila presente en `comision_b2b_revision` está RETENIDA: el portal B2B no
-- la atribuye a nadie (ni participación, ni importe, ni «Pagada», ni cuenta de cobro). El registro queda intacto; la marca vive en una tabla aparte.
--   1. `comision_b2b_revision`: una fila por registro retenido, con la ficha CONFIRMADA por el dueño (informativa: nada la aplica). Se siembra aquí (idempotente).
--   2. Auditoría genérica (087/108) sobre la tabla.
-- QUÉ NO HACE. No hay función ni instrucción de cierre: levantar una retención es una tarea posterior (comprobante, destinatario, corrección financiera cuando
-- corresponda y prueba de permisos). Hasta entonces la tabla es de solo lectura para la aplicación (solo service-role/administrador de base de datos la escribe).
-- Sin la tabla, el portal FALLA CERRADO (no muestra comisión): por eso esta migración va ANTES del código de #415.
-- Orden: preflight = conciliacion_asesor_comision_65_solo_lectura.sql → 268 → postcheck = auditoria_revision_comision_65_solo_lectura.sql (debe dar VERIFICACION_OK).
-- Rollback: supabase/scripts/rollback_268_comision_b2b_revision.sql (borra la marca, no los datos).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.comision_b2b_revision (
  aliado_b2b_id    bigint primary key references public.aliados_b2b(id) on delete cascade,
  tenant           text not null,
  ficha_confirmada bigint references public.aliados(id),
  motivo           text not null,
  abierta_en       timestamptz not null default now()
);
comment on table public.comision_b2b_revision is
  '#65: filas de aliados_b2b retenidas del portal hasta que contabilidad concilie. Toda fila presente está retenida. La ficha confirmada es informativa.';

alter table public.comision_b2b_revision enable row level security;
revoke all on table public.comision_b2b_revision from anon;
revoke insert, update, delete, truncate on table public.comision_b2b_revision from authenticated;
drop policy if exists "comision_b2b_revision: lectura contable" on public.comision_b2b_revision;
create policy "comision_b2b_revision: lectura contable" on public.comision_b2b_revision for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion') and public.puede_ver_tenant(tenant));

drop trigger if exists trg_auditoria on public.comision_b2b_revision;
create trigger trg_auditoria after insert or update or delete on public.comision_b2b_revision
  for each row execute function public.fn_auditoria();

-- Lista inicial: asignación CONFIRMADA por el dueño (ficha destino) de cada fila. Idempotente; solo marca filas que existen.
insert into public.comision_b2b_revision (aliado_b2b_id, tenant, ficha_confirmada, motivo)
select v.id, b.tenant, a.id, v.motivo
  from (values
    (1::bigint,   8::bigint,  '0498 línea 1 sin ficha → 8 (Javier); abonos registrados superan el total'),
    (80::bigint,  3::bigint,  '0462 línea 2 a nombre de Javier → 3 (Tatiana, línea 1)'),
    (81::bigint,  33::bigint, '0422 línea 2 a nombre de Javier → 33 (línea 1)'),
    (82::bigint,  1::bigint,  '0432 línea 2 a nombre de Javier → 1 (línea 1)'),
    (83::bigint,  1::bigint,  '0433 línea 2 a nombre de Javier → 1 (línea 1)'),
    (85::bigint,  24::bigint, '0439 línea 2 a nombre de Javier → 24 (línea 1)'),
    (89::bigint,  28::bigint, '0463 línea 2 a nombre de Javier → 28 (línea 1)'),
    (107::bigint, 7::bigint,  '0484 línea 2 a nombre de Javier → 7 (línea 1)'),
    (135::bigint, 37::bigint, '0519 línea 1 sin ficha → 37 (Yaqueline)'),
    (137::bigint, 37::bigint, '0519 línea 2 a nombre de Javier → 37 (Yaqueline)')
  ) as v(id, ficha, motivo)
  join public.aliados_b2b b on b.id = v.id
  left join public.aliados a on a.id = v.ficha
on conflict (aliado_b2b_id) do nothing;
