#!/bin/sh
# Controles NEGATIVOS del bloque 3 (#11/#13/#36 + B3-1/B3-2): cada mutante rompe UNA regla en el código o la migración y las pruebas (reales sobre la base o unitarias) DEBEN fallar; el original debe pasar.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_bloque3_mutantes.sh <contenedor_pg> <plantilla>        Solo bases desechables. Restaura SIEMPRE los archivos al terminar (trap), incluso si se interrumpe.
# NO editar los archivos mutados mientras corre (tarda ~25 min); lanzarlo en primer plano o con run_in_background y esperar su aviso.
set -u
CT="${1:?contenedor}"; PL="${2:?plantilla}"
T="$(mktemp -d)"
ARCHIVOS="supabase/migrations/20260601000343_presencia_y_avisos_compra.sql lib/paquetes/vencimientoCompra.ts lib/paquetes/vencimientoCompraDatos.ts lib/paquetes/estadoPublicacion.ts lib/presencia/ping.ts lib/avisos/actions.ts lib/avisos/compraAviso.ts lib/avisos/generarCompra.ts"
mkdir -p "$T/p"; for f in $ARCHIVOS; do mkdir -p "$T/p/$(dirname "$f")"; cp "$f" "$T/p/$f"; done
restaurar() { for f in $ARCHIVOS; do cp "$T/p/$f" "$f"; done; }
trap 'restaurar; rm -rf "$T"' EXIT INT TERM
UNIT="pruebas/vencimientoCompra13.test.ts pruebas/estadoPublicacion36.test.ts pruebas/actividadReciente11.test.ts pruebas/avisoCompra13.test.ts pruebas/presenciaIdentidad11.test.ts pruebas/generarCompra13.test.ts"
corre() {
  echo "  [real/BD]"; sh supabase/scripts/test_bloque3_11_13_36.sh "$CT" "$PL" 2>&1 | grep -E "^ℹ (pass|fail)|^  ✖|SQL falló" | head -${1:-4} | cut -c1-200
  echo "  [unitarias]"; node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs $UNIT 2>&1 | grep -E "^ℹ (pass|fail)|^  ✖" | head -${1:-4} | cut -c1-200
}
mutar() { # nombre, archivo, patrón sed (separador #)
  cp "$2" "$T/orig"; sed -i "$3" "$2"
  if cmp -s "$T/orig" "$2"; then echo "[$1] el mutante NO cambió nada: revisar el patrón"; cp "$T/orig" "$2"; return; fi
  echo "== MUTANTE $1"; corre; cp "$T/orig" "$2"
}
echo "== ORIGINAL"; corre 2
M=supabase/migrations/20260601000343_presencia_y_avisos_compra.sql
mutar "N1 la RPC del informe no exige superadmin" "$M" "s#if public.mi_rol() is distinct from 'superadmin' then#if false then#"
mutar "N2 la ventana de contexto no se limita a 30 días" "$M" "s#least(greatest(coalesce(p_dias, 7), 1), 30)#greatest(coalesce(p_dias, 7), 1)#"
mutar "N3 el informe incluye a usuarios inactivos" "$M" "s#where u.activo is true and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance')#where u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance')#"
mutar "N4 la presencia se escribe en CADA llamada (sin límite de 4 min en la base)" "$M" "s#where p.visto_en < now() - interval '4 minutes';#where true;#"
mutar "N5 cliente_final también deja presencia" "$M" "s#if v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance') then#if v_rol is null then#"
mutar "N6 el informe omite a los aliados B2B" "$M" "s#'control_vuelo', 'agencia', 'freelance')\$#'control_vuelo')#"
mutar "N7 el generador duplica avisos (sin unicidad por evento)" "$M" "s#where tipo = 'compra_por_vencer' and archivado_en is null;#where tipo = 'compra_por_vencer' and false;#"
mutar "N8 el generador no archiva lo que ya no aplica" "$M" "s#where a.id in (select o.id from obsoletos o order by o.id limit v_lote)#where false#"
mutar "N9 el generador avisa también a venta (rol que no escribe paquetes)" "$M" "s#r.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones') and#r.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') and#"
mutar "N10 el generador ignora la agencia (tenant) del destinatario" "$M" "s# and (r.rol::text = 'superadmin' or r.tenant = e.tenant)##"
mutar "N11 el disparador no archiva al cambiar la fecha o la activación" "$M" "s#     and ((ventana_tipo = tg_argv\[0\]#     and false and ((ventana_tipo = tg_argv[0]#"
mutar "N12 (B3-3) el archivo vuelve a depender de que no queden pendientes (lote incompleto = nada se archiva)" "$M" "s#where a.id in (select o.id from obsoletos o order by o.id limit v_lote)#where (select count(*) from faltan) = 0 and a.id in (select o.id from obsoletos o order by o.id limit v_lote)#"
mutar "N13 el aviso vigente permite repetirse tras leído (índice sin archivado)" "$M" "s#where tipo = 'compra_por_vencer' and archivado_en is null;#where tipo = 'compra_por_vencer' and leido_en is null and archivado_en is null;#"
V=lib/paquetes/vencimientoCompra.ts
mutar "N14 lo ya vencido entra a los avisos" "$V" "s#return d !== null \&\& d >= 0 \&\& d <= normalizarDias(dias) ? d : null;#return d !== null \&\& d <= normalizarDias(dias) ? d : null;#"
mutar "N15 un paquete inactivo también avisa" "$V" "0,/if (!f.activo) continue;/s###"
mutar "N16 el empaquetado se avisa aunque no tenga paquete activo" "$V" "s#if (!activos.length) continue;#if (false) continue;#"
mutar "N17 un paquete total sin publicar también avisa" "$V" "s#if (!f.activo || !f.publicado) continue;#if (!f.activo) continue;#"
D=lib/paquetes/vencimientoCompraDatos.ts
mutar "N18 (B3-2) el tope se aplica ANTES de excluir salidas de paquetes inactivos" "$D" "s#\.eq(\"armado_paquetes\.activo\", true)##"
mutar "N19 (B3-2) el tope se aplica ANTES de excluir empaquetados sin paquete activo" "$D" "s#\.eq(\"armado_empaquetados\.armado_paquetes\.activo\", true)##"
mutar "N20 (B3-2) un recorte no se reporta" "$D" "s#const truncado = \[filasPq, filasSal, filasEmp, filasTot\]\.some((f) => f\.length > LIMITE_AVISOS_COMPRA);#const truncado = false;#"
E=lib/paquetes/estadoPublicacion.ts
mutar "N21 la cotización por unidad no se reconoce (queda «sin oferta»)" "$E" "s#if (unidad) return { clave: \"cotizacion_unidad\"#if (false) return { clave: \"cotizacion_unidad\"#"
mutar "N22 un paquete inactivo con generación exitosa se rotula sin oferta" "$E" "s#if (!e.activo || e.snapshotPublicable === false) {#if (false) {#"
mutar "N23 pendiente con conteo 0 se rotula publicado" "$E" "s#if (estado === \"listo\") {#if (estado === \"listo\" || estado === \"pendiente\") {#"
mutar "N24 (B3-1) una verificación fallida se rotula «sin oferta vendible»" "$E" "s#if (sinUnidad || sinSolicitud) {#if (false) {#"
mutar "N25 (B3-1) la evidencia desconocida no se anota como secundaria" "$E" "s#if (sinUnidad \&\& !unidad) s.push(\"Unidad sin verificar\");##"
P=lib/presencia/ping.ts
mutar "N26 la presencia se envía también con la pestaña OCULTA" "$P" "s#if (!visible || estado.detenido) return false;#if (estado.detenido) return false;#"
mutar "N27 sin intervalo mínimo entre envíos del navegador" "$P" "s#return !(Number.isFinite(estado.ultimo) \&\& ahora - estado.ultimo < INTERVALO_PING_MS \&\& ahora >= estado.ultimo);#return true;#"
A=lib/avisos/actions.ts
mutar "N28 quien no escribe paquetes ve (y cuenta) los avisos de compra" "$A" "s#(yo.verCompra ? q : q.neq(\"tipo\", \"compra_por_vencer\"))#q#"
C=lib/avisos/compraAviso.ts
mutar "N29 venta también puede ver avisos de compra" "$C" "s#\"operaciones\"\] as const;#\"operaciones\", \"venta\"] as const;#"
mutar "N30 el enlace del aviso ignora la ventana (siempre al listado)" "$C" "s#return esFuenteCompra(f.ventana_tipo) \&\& Number.isInteger(f.ventana_ref) ? rutaVentana(f.ventana_tipo, f.ventana_ref as number) : \"/dashboard/paquetes\";#return \"/dashboard/paquetes\";#"
mutar "N31 (B3-3) la selección repite lo ya hecho (sin antiunión): las mismas 500 filas en cada llamada" "$M" "s#and a.ventana_id = e.ventana_id and a.compra_fin = e.compra_fin)#and a.ventana_id = e.ventana_id and a.compra_fin = e.compra_fin and false)#"
mutar "N32 (B3-3) sin tope de trabajo por llamada" "$M" "s#order by compra_fin, ventana_tipo, ventana_id, usuario_id limit v_lote) f#order by compra_fin, ventana_tipo, ventana_id, usuario_id) f#"
mutar "N33 (B3-3) el archivo no tiene tope (500 por llamada)" "$M" "s#order by o.id limit v_lote)#order by o.id)#"
mutar "N34 (B3-3) el cron no repite la pasada aunque queden pendientes" "lib/avisos/generarCompra.ts" "s#if (!(p.pendientes > 0) || p.creados + p.archivados === 0) break;#break;#"
mutar "N35 (B3-3) el cron repite aunque la pasada no avance (bucle)" "lib/avisos/generarCompra.ts" "s#if (!(p.pendientes > 0) || p.creados + p.archivados === 0) break;#if (!(p.pendientes > 0)) break;#"
P=lib/presencia/ping.ts
mutar "N36 (B3-4) límite de envío compartido por todo el navegador (una sola clave)" "$P" "s#^export const claveDe = .*#export const claveDe = (_id: string) => PREFIJO_CLAVE;#"
mutar "N37 (B3-4) el envío no verifica la sesión real antes de atribuirse" "$P" "s#const real = await d.sesion();.*#const real = id;#"
mutar "N38 (B3-4) un resultado tardío de la cuenta anterior reescribe el límite" "$P" "s#if (identidad !== id) return true;.*##"
mutar "N39 (B3-4) el envío en vuelo de A bloquea a B (un solo indicador)" "$P" "s#const puede = (id: string) => !enCurso.has(id)#const puede = (_id: string) => enCurso.size === 0#"
mutar "N40 (B3-4) sin respaldo en memoria (almacenamiento roto = una llamada por gesto)" "$P" "s#return Math.max(v, memoria.get(id) ?? 0);#return v;#"
mutar "N41 (B3-4) el cierre de sesión no borra las claves guardadas" "$P" "s#if (salvo === null || viejo(Number(d.almacen.leer(k)))) d.almacen.borrar(k);#if (viejo(Number(d.almacen.leer(k)))) d.almacen.borrar(k);#"
mutar "N42 (B3-4) una cuenta rechazada detiene también a la siguiente persona" "$P" "s#if (nueva) detenidos.delete(nueva);#detenidos.add(nueva as string);#"
