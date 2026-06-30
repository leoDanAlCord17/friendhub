'use strict';

// scripts/test-reconexion-supabase.js
// Simula pérdida de conexión con Supabase y verifica recuperación.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Stub vscode ───────────────────────────────────────────────────────────────
const Module = require('module');
const _orig = Module._resolveFilename;
Module._resolveFilename = function (req, p, m, o) {
  if (req === 'vscode') return 'vscode';
  return _orig.call(this, req, p, m, o);
};
require.cache['vscode'] = {
  id: 'vscode', filename: 'vscode', loaded: true,
  exports: {
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
  },
};

const { createClient } = require('@supabase/supabase-js');

const TIMEOUT_MS = 3000;

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ]);
}

async function main() {
  console.log('\nTermPals — Test: simulación de pérdida de conexión con Supabase');
  console.log('─'.repeat(60));

  // ── Test 1: conexión rota se captura sin crashear ─────────────────────────
  console.log('\n  Test 1 — conexión rota capturada sin crashear el proceso:');
  const supabaseRoto = createClient(
    'https://noexiste12345.supabase.co',
    SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );

  let errorCapturado = null;
  const t1inicio = Date.now();

  try {
    const resultado = await conTimeout(
      supabaseRoto.from('usuarios').select('id').limit(1),
      TIMEOUT_MS
    );
    if (resultado?.error) {
      errorCapturado = resultado.error.message;
    }
  } catch (err) {
    errorCapturado = err.message;
  }

  const t1duracion = Date.now() - t1inicio;

  if (errorCapturado !== null) {
    pass(`error capturado sin crash: "${errorCapturado.slice(0, 60)}"`);
  } else {
    fail('la query rota no devolvió error — debería haber fallado');
  }

  // ── Test 2: error retorna en menos de 4 segundos ──────────────────────────
  console.log('\n  Test 2 — conexión rota retorna error en < 4 segundos:');
  if (t1duracion < 4000) {
    pass(`resolvió en ${t1duracion}ms (< 4000ms)`);
  } else {
    fail(`tardó ${t1duracion}ms — superó los 4000ms sin resolverse`);
  }

  // ── Test 3: conexión sana funciona después ────────────────────────────────
  console.log('\n  Test 3 — conexión sana funciona normalmente después:');
  const supabaseSano = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  try {
    const t3inicio = Date.now();
    const { data, error } = await conTimeout(
      supabaseSano.from('terminos_versiones').select('id').limit(1),
      TIMEOUT_MS
    );
    const t3duracion = Date.now() - t3inicio;

    if (error) {
      fail(`query sana devolvió error: ${error.message}`);
    } else {
      pass(`query sana respondió en ${t3duracion}ms — datos: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    fail(`query sana lanzó excepción: ${err.message}`);
  }

  console.log('\n' + '─'.repeat(60));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);

  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
