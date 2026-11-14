// Genera la migración 302 y su rollback a partir de los cuerpos VIGENTES de las funciones que insertan en tarifario_resultado (256 y 260),
// cambiando SOLO lo necesario para la columna `desde_entrada`. Cada sustitución debe ocurrir exactamente una vez (si no, aborta).
// Uso (desde dspacios-travel/):  node supabase/scripts/generar_302_desde_estadia.mjs
import fs from "node:fs";

const M = "supabase/migrations/";
const leer = (f) => fs.readFileSync(M + f, "utf8").replace(/\r\n/g, "\n");
const lineas = (txt, desde, hasta) => txt.split("\n").slice(desde - 1, hasta).join("\n");
function sustituir(txt, a, b, nombre) {
  const n = txt.split(a).length - 1;
  if (n !== 1) throw new Error(`${nombre}: se esperaba 1 coincidencia, hubo ${n}`);
  return txt.replace(a, () => b);
}
const m256 = leer("20260601000256_disponibilidad_servicios_por_fecha.sql");
const m260 = leer("20260601000260_publicacion_tarifario_por_lotes.sql");

// Anclas: comprobadas por contenido, no solo por número de línea.
const iInterno = m256.split("\n").findIndex((l) => l.startsWith("create or replace function public.publicar_tarifario_resultado_interno(")) + 1;
const fInterno = m256.split("\n").findIndex((l) => l.startsWith("revoke all on function public.publicar_tarifario_resultado_interno(")) + 1;
const iLote = m260.split("\n").findIndex((l) => l.startsWith("create or replace function public.tarifario_lote_agregar_i(")) + 1;
const fLote = m260.split("\n").findIndex((l) => l.startsWith("revoke all on function public.tarifario_lote_agregar_i(")) + 1;
const iVista = m260.split("\n").findIndex((l) => l.startsWith("-- La vista (único punto de lectura comercial)")) + 1;
if (!(iInterno && fInterno > iInterno && iLote && fLote > iLote && iVista)) throw new Error("anclas no encontradas");
const fVista = m260.split("\n").findIndex((l, i) => i >= iVista && l === "end $$;") + 1;

const m226 = leer("20260601000226_tarifa_infante.sql");
const iRes = m226.split("\n").findIndex((l) => l.startsWith("create or replace view public.tarifario_resumen")) + 1;
const fRes = m226.split("\n").findIndex((l, i) => i >= iRes && l.endsWith("r.noches, r.moneda;")) + 1;
if (!(iRes && fRes > iRes)) throw new Error("ancla de tarifario_resumen no encontrada");
const resumen226 = lineas(m226, iRes, fRes);
const resumen302 = sustituir(resumen226, "    min(r.tipo_tarifa) as tipo_tarifa\n",
  "    min(r.tipo_tarifa) as tipo_tarifa,\n    -- Migración 302: entrada de la estadía que justifica el «desde» DOBLE de la combinación (porción con grupos; null = sin justificación).\n    min(r.desde_entrada) filter (where r.acomodacion = 'doble' and r.precio_pvp > 0) as desde_entrada_doble\n", "resumen: columna");
const interno256 = lineas(m256, iInterno, fInterno);
const lote260 = lineas(m260, iLote, fLote);
const vista260 = lineas(m260, iVista, fVista);

let interno302 = sustituir(interno256, "procedencia_temporadas, procedencia_mixta, fechas_disponibles\n  )", "procedencia_temporadas, procedencia_mixta, fechas_disponibles, desde_entrada\n  )", "interno: lista");
interno302 = sustituir(interno302,
  "    case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end\n  from jsonb_array_elements(p_filas)",
  "    case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,\n    -- Migración 302: entrada de la estadía que justifica el «desde» (porción de un hotel con grupos). Ausente o null = sin justificación.\n    (f.v->>'desde_entrada')::date\n  from jsonb_array_elements(p_filas)",
  "interno: valores");
let lote302 = sustituir(lote260, "procedencia_temporadas, procedencia_mixta, fechas_disponibles,\n        generacion, revision_fuente, lote)", "procedencia_temporadas, procedencia_mixta, fechas_disponibles, desde_entrada,\n        generacion, revision_fuente, lote)", "lote: lista");
lote302 = sustituir(lote302,
  "             case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,\n             p_generacion, m.revision_capturada, p_lote",
  "             case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,\n             (f.v->>'desde_entrada')::date,\n             p_generacion, m.revision_capturada, p_lote",
  "lote: valores");

const cabecera = `-- ─────────────────────────────────────────────────────────────────────────────
-- 302 · #43/#60 entrega 6 — «Desde» de porción por estadía real: justificación publicada (PROVISIONAL; sin aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Especificación §5 («Desde» de porción, U.1/U.4; diseño en AM). Exige la 260 y la 301.
--   1) \`tarifario_resultado.desde_entrada\` (date): entrada de la estadía completa más económica que produce el «desde» de una fila de PORCIÓN
--      de un hotel con grupos. Salida = desde_entrada + noches; categoría, régimen y acomodación ya están en la fila y la vigencia/grupo en su
--      procedencia. NULL = fila sin justificación (todas las anteriores y los hoteles sin grupos, que no cambian).
--   2) Se recrean la vista publicable (mismo bloque de la 260: expone la columna al final) y los dos insertores con lista EXPLÍCITA de columnas
--      (\`publicar_tarifario_resultado_interno\` de la 256 y \`tarifario_lote_agregar_i\` de la 260): cuerpo idéntico + la columna nueva
--      (GENERADO por supabase/scripts/generar_302_desde_estadia.mjs; cada cambio se comprueba como coincidencia única).
-- No cambia ninguna fila existente ni ningún precio. Orden: preflight_302 → 302 → postcheck_302 → código. Rollback: rollback_302 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.tarifario_manifiesto') is null or to_regclass('public.hotel_promocion_combinacion') is null then
    raise exception '302 ABORTADA: requiere la 260 y la 301 aplicadas';
  end if;
end $$;

alter table public.tarifario_resultado add column if not exists desde_entrada date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarifario_resultado_desde_entrada_302' and conrelid = 'public.tarifario_resultado'::regclass) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_desde_entrada_302
      check (desde_entrada is null or (modulo = 'porcion_terrestre'::public.tarifario_modulo and noches between 1 and public._e5_max_noches()));
  end if;
end $$;
comment on column public.tarifario_resultado.desde_entrada is
  '#43/#60 (302): entrada de la estadía que justifica el «desde» de una porción de un hotel con grupos (salida = entrada + noches). NULL = sin justificación.';

`;
const pie = `
commit;
`;
fs.writeFileSync(M + "20260601000302_desde_estadia_real.sql", cabecera + vista260 + "\n\n-- Resumen de la vitrina (definición de la 226 + la entrada del «desde» DOBLE, al final).\n" + resumen302 + "\n\n" + interno302 + "\n\n" + lote302 + "\n" + pie);

// Rollback: restaura los cuerpos ORIGINALES (256 y 260), recrea la vista sin la columna y la quita. Protegido: aborta con justificaciones publicadas.
const rollback = `-- ROLLBACK 302 (#43/#60 entrega 6). Separado y PROTEGIDO: aborta sin tocar nada si alguna fila tiene \`desde_entrada\` (se perdería la
-- justificación de un «desde» publicado). Para llegar a 0: revertir el código de la entrega 6 y regenerar los paquetes de porción afectados.
-- GENERADO por supabase/scripts/generar_302_desde_estadia.mjs con los cuerpos originales de la 256 y la 260.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_n bigint;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'desde_entrada') then return; end if;
  execute 'select count(*) from public.tarifario_resultado where desde_entrada is not null' into v_n;
  if v_n > 0 then raise exception 'ROLLBACK 302 ABORTADO (REVISAR): % fila(s) con desde_entrada.', v_n; end if;
end $$;

${interno256}

${lote260}

-- La vista depende de la columna y otras vistas dependen de ella (p. ej. tarifario_resumen): se guardan su definición, opciones y permisos, se
-- eliminan, se quita la columna y se recrean tal cual (la publicable con el mismo bloque de la 260).
create temp table _r302_vistas on commit drop as
  with recursive dep as (
    select distinct c.oid, 1 as nivel from pg_depend d join pg_rewrite w on w.oid = d.objid join pg_class c on c.oid = w.ev_class
     where d.refobjid = 'public.tarifario_resultado_publicable'::regclass and c.oid <> d.refobjid and c.relkind = 'v'
    union
    select c.oid, dep.nivel + 1 from dep join pg_depend d on d.refobjid = dep.oid join pg_rewrite w on w.oid = d.objid join pg_class c on c.oid = w.ev_class
     where c.oid <> d.refobjid and c.relkind = 'v'
  )
  select c.relname, max(dep.nivel) as nivel, pg_get_viewdef(c.oid) as def, c.reloptions, c.relacl
    from dep join pg_class c on c.oid = dep.oid group by c.relname, c.oid, c.reloptions, c.relacl;
create temp table _r302_acl_pub on commit drop as select relacl from pg_class where oid = 'public.tarifario_resultado_publicable'::regclass;
drop view public.tarifario_resultado_publicable cascade;
alter table public.tarifario_resultado drop constraint if exists tarifario_resultado_desde_entrada_302;
alter table public.tarifario_resultado drop column if exists desde_entrada;
${vista260}
do $$
declare v record; a record;
begin
  for a in select (aclexplode(relacl)).* from _r302_acl_pub loop
    if a.grantee <> 0 then execute format('grant %s on public.tarifario_resultado_publicable to %I', a.privilege_type, a.grantee::regrole::text); end if;
  end loop;
  for v in select * from _r302_vistas order by nivel loop
    if v.relname = 'tarifario_resumen' then
      -- La 302 le añadió desde_entrada_doble: se restaura su definición de la 226.
      execute ${"$q$"}${resumen226.replace(/;\s*$/, "")}${"$q$"};
    else
      execute format('create view public.%I %s as %s', v.relname,
        case when v.reloptions is null then '' else 'with (' || array_to_string(v.reloptions, ', ') || ')' end, v.def);
    end if;
    for a in select (aclexplode(v.relacl)).* loop
      if a.grantee <> 0 then execute format('grant %s on public.%I to %I', a.privilege_type, v.relname, a.grantee::regrole::text); end if;
    end loop;
  end loop;
end $$;

commit;
`;
fs.writeFileSync("supabase/scripts/rollback_302_desde_estadia_real.sql", rollback);
console.log("ok: 302 y rollback generados");
