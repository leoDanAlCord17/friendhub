// scripts/limpiar-seed.js
// Elimina todos los datos de prueba generados por seed-usuarios.js
// y simular-chats.js, respetando el orden de las foreign keys.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=tu-anon-key node scripts/limpiar-seed.js
//
// ADVERTENCIA: este script elimina datos de la base de datos real de forma
// irreversible. Verifica que SUPABASE_URL apunte al entorno correcto.

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY antes de ejecutar.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function obtenerIdsPrueba() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .like('github_id', 'test-%');
  if (error) throw new Error(`No se pudieron obtener usuarios de prueba: ${error.message}`);
  return data.map(u => u.id);
}

async function eliminar(tabla, descripcion, filtroFn) {
  process.stdout.write(`  ${descripcion}... `);
  try {
    const query = filtroFn(supabase.from(tabla).delete());
    const { data, error } = await query.select('id');
    if (error) throw error;
    const n = data?.length ?? 0;
    console.log(`${n} eliminados`);
    return n;
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log('\nTermPals — Limpieza de datos de prueba');
  console.log('━'.repeat(50));

  process.stdout.write('  obteniendo IDs de usuarios de prueba... ');
  let ids;
  try {
    ids = await obtenerIdsPrueba();
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    process.exit(1);
  }
  console.log(`${ids.length} usuarios encontrados`);

  if (ids.length === 0) {
    console.log('  nada que limpiar.\n');
    return;
  }

  const listaIds = ids.join(',');
  let total = 0;

  // ── 1. descartados ────────────────────────────────────────────────────────
  total += await eliminar(
    'descartados',
    'descartados',
    q => q.or(`usuario_id.in.(${listaIds}),descartado_id.in.(${listaIds})`),
  );

  // ── 2. amigos ─────────────────────────────────────────────────────────────
  total += await eliminar(
    'amigos',
    'amigos',
    q => q.or(`usuario_id.in.(${listaIds}),amigo_id.in.(${listaIds})`),
  );

  // ── 3. invitaciones ───────────────────────────────────────────────────────
  total += await eliminar(
    'invitaciones',
    'invitaciones',
    q => q.or(`de_usuario.in.(${listaIds}),para_usuario.in.(${listaIds})`),
  );

  // ── 4. conversaciones ─────────────────────────────────────────────────────
  total += await eliminar(
    'conversaciones',
    'conversaciones',
    q => q.or(`usuario_a.in.(${listaIds}),usuario_b.in.(${listaIds})`),
  );

  // ── 5. proyectos ──────────────────────────────────────────────────────────
  total += await eliminar(
    'proyectos',
    'proyectos',
    q => q.in('usuario_id', ids),
  );

  // ── 6. feedback ───────────────────────────────────────────────────────────
  total += await eliminar(
    'feedback',
    'feedback',
    q => q.in('usuario_id', ids),
  );

  // ── 7. usuarios ───────────────────────────────────────────────────────────
  total += await eliminar(
    'usuarios',
    'usuarios',
    q => q.like('github_id', 'test-%'),
  );

  console.log('\n' + '━'.repeat(50));
  console.log(`  total registros eliminados: ${total}\n`);
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
