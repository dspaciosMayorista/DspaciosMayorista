-- ACTIVAR la ventana de mantenimiento (migración 294). Como postgres, en el editor SQL. NO activa la excepción (eso es habilitar_excepcion_mantenimiento.sql).
-- Reemplazar OPERADOR_1/OPERADOR_2 por los id (uuid) de los operadores autorizados: usuarios ACTIVOS superadmin/administracion.
-- Atómico: si algo falla, no queda nada cambiado. Guarda el filtro previo (nivel rol/base) y los jobs que pausa, para restaurarlos EXACTOS al desactivar.
-- DESPUÉS, en una ejecución APARTE (para que la activación ya esté confirmada): select mant_priv.cortar_en_curso();  y luego verificar_mantenimiento.sql
select mant_priv.activar(array['OPERADOR_1', 'OPERADOR_2']::uuid[], 'authenticator');
