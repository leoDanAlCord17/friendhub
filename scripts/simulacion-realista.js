'use strict';

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

const CONCURRENCIA  = 20;
const MAX_BUSQUEDAS = 4;

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

// ── Semáforo simple para limitar concurrencia ─────────────────────────────────
class Semaforo {
  constructor(max) {
    this._max   = max;
    this._activos = 0;
    this._cola  = [];
  }
  adquirir() {
    return new Promise(resolve => {
      if (this._activos < this._max) {
        this._activos++;
        resolve();
      } else {
        this._cola.push(resolve);
      }
    });
  }
  liberar() {
    this._activos--;
    if (this._cola.length > 0) {
      this._activos++;
      this._cola.shift()();
    }
  }
}

// ── Query de match: replica buscarMatch() de src/supabase/usuarios.ts ─────────
async function buscarMatchDisponible(usuario, descartadosLocales) {
  let query = supabase
    .from('usuarios')
    .select('id, busca')
    .eq('estatus', true)
    .eq('busca', usuario.busca ?? 'colaborar')
    .is('conversacion_activa_id', null)
    .neq('id', usuario.id)
    .like('github_id', 'test-%');  // solo usuarios de prueba

  const excluidos = [...descartadosLocales];
  if (excluidos.length > 0) {
    query = query.not('id', 'in', `(${excluidos.join(',')})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const candidatos = data ?? [];
  if (candidatos.length === 0) return null;
  return candidatos[Math.floor(Math.random() * candidatos.length)];
}

// ── Flujo completo de un usuario ──────────────────────────────────────────────
async function simularUsuario(usuario, stats) {
  const descartadosLocales = new Set();
  let conectado = false;

  for (let intento = 0; intento < MAX_BUSQUEDAS && !conectado; intento++) {
    // ── 1. Llamar a la RPC consumir_busqueda (atómica, misma que usa verificarYConsumirBusqueda) ──
    const t0 = Date.now();
    let permitido, restantes;

    try {
      const { data, error } = await supabase.rpc('consumir_busqueda', {
        p_usuario_id: usuario.id,
      });

      const ms = Date.now() - t0;
      stats.intentosTotal++;
      stats.tiemposIntento.push(ms);

      if (error) {
        stats.errores.push(`@${usuario.github_login} intento ${intento + 1}: consumir_busqueda: ${error.message}`);
        break;
      }

      permitido  = data[0].permitido;
      restantes  = data[0].restantes;
    } catch (err) {
      stats.intentosTotal++;
      stats.tiemposIntento.push(Date.now() - t0);
      stats.errores.push(`@${usuario.github_login} intento ${intento + 1}: ${err.message}`);
      break;
    }

    if (!permitido) {
      // La RPC dice que ya agotó las búsquedas (no debería pasar con reset en 0 y ≤4 iter)
      stats.busquedasBloqueadas++;
      break;
    }

    stats.busquedasPermitidas++;

    // ── 2. Buscar match disponible ────────────────────────────────────────────
    let match;
    try {
      match = await buscarMatchDisponible(usuario, descartadosLocales);
    } catch (err) {
      stats.errores.push(`@${usuario.github_login} buscar match: ${err.message}`);
      continue;
    }

    if (!match) {
      stats.intentosFallidosSinCandidatos++;
      continue;
    }

    // ── 3. Conectar via RPC conectar_usuarios (una sola transacción) ──────────
    const tConexion = Date.now();
    try {
      const { error: convError } = await supabase.rpc('conectar_usuarios', {
        p_de_usuario:  usuario.id,
        p_para_usuario: match.id,
        p_readme:      null,
        p_puntaje:     0,
      });

      if (convError) {
        // Race condition: alguien ya conectó con este match; excluirlo y reintentar
        descartadosLocales.add(match.id);
        stats.racesConexion++;
        continue;
      }

      stats.tiemposConexion.push(Date.now() - tConexion);
      stats.usuariosConectados++;
      conectado = true;

    } catch (err) {
      descartadosLocales.add(match.id);
      stats.errores.push(`@${usuario.github_login} conectar_usuarios: ${err.message}`);
    }
  }

  // ── 4. Si agotó sin conectar → encuesta Pro ──────────────────────────────────
  if (!conectado) {
    stats.usuariosSinConectar++;
    const interesado = Math.random() < 0.6;

    try {
      const { error } = await supabase
        .from('interes_pro')
        .upsert(
          { usuario_id: usuario.id, interesado, actualizado_por: 'simulacion' },
          { onConflict: 'usuario_id' },
        );

      if (error) {
        stats.errores.push(`@${usuario.github_login} encuesta Pro: ${error.message}`);
      } else {
        stats.encuestasRespondidas++;
        if (interesado) stats.interesados++;
        else stats.noInteresados++;
      }
    } catch (err) {
      stats.errores.push(`@${usuario.github_login} encuesta Pro: ${err.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const tiempoInicio = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  TermPals — Simulación realista: 100 usuarios concur  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── Resetear solo searches_hoy y ultima_busqueda_en ──────────────────────────
  process.stdout.write('  reseteando searches_hoy=0 y ultima_busqueda_en=null... ');
  const { error: errReset1 } = await supabase
    .from('usuarios')
    .update({ searches_hoy: 0, ultima_busqueda_en: null, conversacion_activa_id: null })
    .like('github_id', 'test-%');
  if (errReset1) { console.log(`ERROR: ${errReset1.message}`); process.exit(1); }
  console.log('OK');

  // ── Cargar los 100 usuarios de prueba ─────────────────────────────────────
  process.stdout.write('  cargando usuarios de prueba... ');
  const { data: usuarios, error: errU } = await supabase
    .from('usuarios')
    .select('id, github_login, busca')
    .like('github_id', 'test-%')
    .order('github_login');
  if (errU) { console.log(`ERROR: ${errU.message}`); process.exit(1); }
  console.log(`OK (${usuarios.length} usuarios)\n`);

  // ── Estadísticas compartidas (JS es single-threaded: sin race en el objeto) ─
  const stats = {
    intentosTotal:                 0,
    busquedasPermitidas:           0,
    busquedasBloqueadas:           0,
    intentosFallidosSinCandidatos: 0,
    racesConexion:                 0,
    tiemposIntento:                [],
    usuariosConectados:            0,
    usuariosSinConectar:           0,
    tiemposConexion:               [],
    encuestasRespondidas:          0,
    interesados:                   0,
    noInteresados:                 0,
    errores:                       [],
  };

  // ── Procesar con semáforo de concurrencia 20 ─────────────────────────────────
  console.log(`  lanzando ${usuarios.length} usuarios en paralelo (concurrencia máx: ${CONCURRENCIA})...\n`);
  const sem = new Semaforo(CONCURRENCIA);

  await Promise.all(usuarios.map(async (usuario) => {
    await sem.adquirir();
    try {
      await simularUsuario(usuario, stats);
    } finally {
      sem.liberar();
    }
  }));

  // ── Reporte final ──────────────────────────────────────────────────────────
  const duracion = ((Date.now() - tiempoInicio) / 1000).toFixed(1);

  console.log('═'.repeat(54));
  console.log('=== SIMULACIÓN REALISTA: 100 USUARIOS CONCURRENTES ===');
  console.log('═'.repeat(54));

  console.log('\nBÚSQUEDAS:');
  console.log(`  Total de intentos de búsqueda:        ${stats.intentosTotal}`);
  console.log(`  Búsquedas permitidas:                 ${stats.busquedasPermitidas}`);
  console.log(`  Búsquedas bloqueadas (límite diario): ${stats.busquedasBloqueadas}`);
  console.log(`  Intentos sin candidatos disponibles:  ${stats.intentosFallidosSinCandidatos}`);
  if (stats.racesConexion > 0) {
    console.log(`  Colisiones de conexión (resueltas):   ${stats.racesConexion}`);
  }
  console.log(`  Tiempo promedio por intento RPC:      ${avg(stats.tiemposIntento)}ms`);
  console.log(`  Tiempo máximo por intento RPC:        ${Math.max(0, ...stats.tiemposIntento)}ms`);

  console.log('\nCONEXIONES:');
  console.log(`  Usuarios que conectaron exitosamente: ${stats.usuariosConectados}/100`);
  console.log(`  Usuarios que agotaron sin conectar:   ${stats.usuariosSinConectar}/100`);
  console.log(`  Tiempo promedio de conexión exitosa:  ${avg(stats.tiemposConexion)}ms`);

  console.log('\nVALIDACIÓN PRO:');
  console.log(`  Encuestas respondidas:                ${stats.encuestasRespondidas}`);
  const total = stats.encuestasRespondidas || 1;
  const pctSi = Math.round((stats.interesados  / total) * 100);
  const pctNo = Math.round((stats.noInteresados / total) * 100);
  console.log(`  Interesados (sí):                     ${stats.interesados} (${pctSi}%)`);
  console.log(`  No interesados:                       ${stats.noInteresados} (${pctNo}%)`);

  console.log('\nERRORES:');
  if (stats.errores.length === 0) {
    console.log('  ninguno');
  } else {
    stats.errores.forEach(e => console.log(`  - ${e}`));
  }

  console.log(`\nDURACIÓN TOTAL: ${duracion}s`);
  console.log('═'.repeat(54) + '\n');
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
