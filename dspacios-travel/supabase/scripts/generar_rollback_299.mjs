// Arma rollback_299 con las definiciones ORIGINALES (copiadas literalmente de los archivos aplicados).
import fs from "node:fs";
const [mig, out] = process.argv.slice(2);
const leer = (f) => fs.readFileSync(`${mig}/${f}`, "utf8");
const m295 = leer("20260601000295_grupos_dias_propuesta.sql");
const m297 = leer("20260601000297_calculadora_grupos_dias.sql");
const m237 = leer("20260601000237_catalogos_globales_frontera_mayorista.sql");

function extraer(src, inicio, fin) {
  // La ÚLTIMA definición del archivo: la 295 redefine _grupos_43_config y _grupos_43_bloquear_y_comparar más abajo y es esa la que
  // queda aplicada (con la primera, el rollback restauraba un cuerpo anterior y la prueba de identidad lo detectó).
  const i = src.lastIndexOf(inicio);
  if (i < 0) throw new Error("no encontrado: " + inicio);
  const j = src.indexOf(fin, i);
  if (j < 0) throw new Error("sin fin: " + inicio);
  return src.slice(i, j + fin.length);
}
const f295 = (n) => extraer(m295, `create or replace function public.${n}(`, "end $$;");
const piezas = [
  f295("_grupos_43_config"),
  f295("_grupos_43_bloquear_y_comparar"),
  f295("grupos_dias_guardar"),
  f295("grupos_dias_borrar"),
  extraer(m297, "create or replace function public.grupos_dias_guardar_calculadora(", "end $$;"),
  extraer(m237, "CREATE OR REPLACE FUNCTION public.generar_tarifas_hotel_calculadora(", "$function$;"),
];

const sql = `-- ROLLBACK 299 (#43/#60 entrega 3c). Separado y PROTEGIDO: aborta sin tocar nada si hay grupos ACTIVOS o
-- tarifas por grupo en tarifa_hotel (deshacer dejaría vigencias sin tarifa o con tarifas que nada puede leer).
-- Para llegar a 0: «Volver a todos los días» en cada vigencia que se vende por grupos.
-- Restaura LITERALMENTE las funciones de la 295, la 297 y la 237 que la 299 redefinió (generado desde esos
-- archivos), el candado de inactividad de la 293 y la escritura directa de grupos para authenticated.
-- ANTES de correrlo: revertir el código que llama a las RPC de la 299.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_activos bigint; v_filas bigint;
begin
  select count(*) into v_activos from public.hotel_temporada_grupos where activo;
  select count(*) into v_filas from public.tarifa_hotel where grupo_id is not null;
  if v_activos > 0 or v_filas > 0 then
    raise exception 'ROLLBACK 299 ABORTADO (REVISAR): hay % grupo(s) activo(s) y % tarifa(s) por grupo. Vuelve a «todos los días» primero.', v_activos, v_filas;
  end if;
end $$;

drop trigger if exists trg_43_empates_marca on public.tarifa_hotel;
drop trigger if exists trg_43_empates_marca on public.hotel_temporadas;
drop trigger if exists trg_43_empates_marca on public.hotel_temporada_grupos;
drop trigger if exists trg_empates_43 on public.tarifa_hotel;
drop trigger if exists trg_empates_43 on public.hotel_temporadas;
drop trigger if exists trg_empates_43 on public.hotel_temporada_grupos;
drop trigger if exists trg_tarifa_hotel_grupo_rpc_43 on public.tarifa_hotel;
drop trigger if exists trg_hotel_temporada_grupos_activo_43 on public.hotel_temporada_grupos;

drop function if exists public.grupos_dias_alcance(bigint);
drop function if exists public.grupos_dias_activar(bigint, text, jsonb);
drop function if exists public.grupos_dias_descartar(bigint, text);
drop function if exists public.grupos_dias_volver_todos(bigint, text, jsonb);

-- Definiciones ORIGINALES (295, 297, 237):
${piezas.join("\n\n")}

drop function if exists public._grupos_43_bloquear(bigint, text, boolean);
drop function if exists public._grupos_43_dias_sin_grupo(bigint);
drop function if exists public._grupos_43_pendientes(bigint);
drop function if exists public._grupos_43_obsoletas(bigint);
drop function if exists public._grupos_43_edades_conflicto(bigint);
drop function if exists public._grupos_43_habilitaciones(bigint);
drop function if exists public._grupos_43_vende(text, numeric);
drop function if exists public.tg_empates_43();
drop function if exists public.tg_empates_43_marca();
drop function if exists public._grupos_43_hotel_de(text, bigint, bigint);
drop function if exists public._grupos_43_texto_empates(jsonb);
drop function if exists public._grupos_43_empates(bigint, bigint);
drop function if exists public._fecha_43(text);
drop function if exists public.tg_tarifa_hotel_grupo_rpc_43();
drop function if exists public.tg_hotel_temporada_grupos_activo_43();
drop function if exists public._grupos_43_en_rpc();

-- Permisos de las funciones restauradas (iguales a la 295 / 297; create or replace los conserva, se repiten por claridad).
revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_bloquear_y_comparar(bigint, text) from public, anon, authenticated;
grant execute on function public.grupos_dias_guardar(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_borrar(uuid, text) to authenticated;
grant execute on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) to authenticated;

grant insert, update, delete on public.hotel_temporada_grupos to authenticated;
alter table public.hotel_temporada_grupos
  add constraint hotel_temporada_grupos_inactivos_43 check (not activo);
comment on table public.hotel_temporada_grupos is
  '#43/#60: grupos de días de la semana (1=lun … 7=dom) de una vigencia. INACTIVOS hasta que el motor los soporte (check hotel_temporada_grupos_inactivos_43).';

commit;
`;
fs.writeFileSync(out, sql);
console.log("rollback_299 escrito:", sql.length, "bytes");
