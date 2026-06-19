// scripts/seed-usuarios.js
// Genera 100 usuarios sintéticos con sus proyectos para pruebas de carga.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=tu-anon-key node scripts/seed-usuarios.js
//
// ADVERTENCIA: este script escribe directamente en la base de datos real.
// Ejecutalo solo en un entorno de pruebas o cuando quieras datos de carga.

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY antes de ejecutar.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TOTAL      = 100;
const BATCH_SIZE = 20;
const DELAY_MS   = 200;

const BUSCA     = ['colaborar', 'networking', 'ambas'];
const LOCATIONS = ['Madrid', 'Buenos Aires', 'México', null];
const LENGUAJES = ['TypeScript', 'Python', 'JavaScript', 'Go', 'Rust', 'Dart', 'Java'];
const DOMINIOS  = ['web', 'mobile', 'backend', 'data', 'otro'];
const STACKS    = ['react', 'express', 'nextjs', 'fastify', 'prisma', 'tailwindcss', 'vite', 'supabase'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pickN(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function generarUsuarios() {
  return Array.from({ length: TOTAL }, (_, i) => {
    const idx = i + 1;
    return {
      github_id:      `test-${idx}`,
      github_login:   `testuser${idx}`,
      nombre_usuario: `testuser${idx}`,
      nombre:         `Test User ${idx}`,
      avatar_url:     null,
      email:          `testuser${idx}@termpals.test`,
      bio:            `Usuario de prueba #${idx} para testing de carga`,
      location:       LOCATIONS[i % LOCATIONS.length],
      zona_horaria:   null,
      disponible:     true,
      busca:          BUSCA[i % BUSCA.length],
      estatus:        true,
      creado_por:     'seed-script',
      actualizado_por:'seed-script',
    };
  });
}

function generarProyecto(usuario_id, idx) {
  const nLenguajes = Math.floor(Math.random() * 3) + 1;
  return {
    usuario_id,
    nombre:          `proyecto-test-${idx}`,
    descripcion:     `Proyecto sintético ${idx} para pruebas de carga`,
    lenguajes:       pickN(LENGUAJES, nLenguajes),
    dominio:         DOMINIOS[idx % DOMINIOS.length],
    tiene_tests:     Math.random() > 0.5,
    zona_horaria:    null,
    repo_url:        null,
    stack:           pickN(STACKS, 2),
    readme:          '# Proyecto de prueba\n\nEste es un README sintético para testing.',
    comparte_readme: true,
    estatus:         true,
    creado_por:      'seed-script',
    actualizado_por: 'seed-script',
  };
}

async function main() {
  console.log(`\nTermPals — Seed de ${TOTAL} usuarios de prueba`);
  console.log('━'.repeat(50));

  const usuarios = generarUsuarios();
  const errores = [];
  let usuariosCreados = 0;
  let proyectosCreados = 0;

  for (let i = 0; i < usuarios.length; i += BATCH_SIZE) {
    const batch = usuarios.slice(i, i + BATCH_SIZE);
    const desde = i + 1;
    const hasta = Math.min(i + BATCH_SIZE, TOTAL);

    process.stdout.write(`  usuarios ${String(desde).padStart(3)}–${String(hasta).padStart(3)}... `);

    const { data: usersData, error: usersError } = await supabase
      .from('usuarios')
      .upsert(batch, { onConflict: 'github_id' })
      .select('id, github_id');

    if (usersError) {
      console.log('ERROR');
      errores.push({ paso: `usuarios ${desde}-${hasta}`, error: usersError.message });
    } else {
      usuariosCreados += usersData.length;
      console.log(`OK (${usersData.length})`);

      process.stdout.write(`  proyectos ${String(desde).padStart(3)}–${String(hasta).padStart(3)}... `);

      const proyectos = usersData.map((u, j) => generarProyecto(u.id, i + j + 1));

      const { data: proyData, error: proyError } = await supabase
        .from('proyectos')
        .upsert(proyectos, { onConflict: 'usuario_id' })
        .select('id');

      if (proyError) {
        console.log('ERROR');
        errores.push({ paso: `proyectos ${desde}-${hasta}`, error: proyError.message });
      } else {
        proyectosCreados += proyData.length;
        console.log(`OK (${proyData.length})`);
      }
    }

    if (i + BATCH_SIZE < TOTAL) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n' + '━'.repeat(50));
  console.log(`  usuarios creados:  ${usuariosCreados} / ${TOTAL}`);
  console.log(`  proyectos creados: ${proyectosCreados} / ${TOTAL}`);

  if (errores.length > 0) {
    console.log(`\n  ERRORES (${errores.length}):`);
    errores.forEach(e => console.log(`  [${e.paso}] ${e.error}`));
    process.exit(1);
  } else {
    console.log('  sin errores.\n');
  }
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
