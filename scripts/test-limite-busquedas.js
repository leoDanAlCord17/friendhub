'use strict';

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
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null, findFiles: async () => [], fs: { readFile: async () => Buffer.alloc(0) } },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => {} },
    ViewColumn: { One: 1 },
  },
};

const { createClient }                    = require('@supabase/supabase-js');
const { setSupabase }                     = require('../out/supabase/client');
const { verificarYConsumirBusqueda }      = require('../out/supabase/usuarios');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

async function main() {
  console.log('\nTermPals — Test: límite de 4 búsquedas diarias');
  console.log('─'.repeat(52));

  // 1. Tomar un usuario de prueba existente
  const { data: usuarios, error: errU } = await supabase
    .from('usuarios')
    .select('id, github_login, searches_hoy, ultima_busqueda_en')
    .like('github_id', 'test-%')
    .limit(1)
    .single();

  if (errU || !usuarios) {
    console.error('ERROR: no se encontró ningún usuario de prueba. Ejecuta seed-usuarios.js primero.');
    process.exit(1);
  }

  const { id, github_login } = usuarios;
  console.log(`  usuario de prueba: @${github_login} (${id})`);

  // 2. Resetear searches_hoy a 0 y ultima_busqueda_en a null
  process.stdout.write('  reseteando searches_hoy=0, ultima_busqueda_en=null... ');
  const { error: errReset } = await supabase
    .from('usuarios')
    .update({ searches_hoy: 0, ultima_busqueda_en: null })
    .eq('id', id);
  if (errReset) {
    console.log(`ERROR: ${errReset.message}`);
    process.exit(1);
  }
  console.log('OK\n');

  // 3. Llamar verificarYConsumirBusqueda() 5 veces
  const esperados = [
    { permitido: true,  restantes: 3 },
    { permitido: true,  restantes: 2 },
    { permitido: true,  restantes: 1 },
    { permitido: true,  restantes: 0 },
    { permitido: false, restantes: 0 },
  ];

  let todosOk = true;

  for (let i = 0; i < 5; i++) {
    const llamada = i + 1;
    const resultado = await verificarYConsumirBusqueda(id);
    const esperado  = esperados[i];

    const okPermitido  = resultado.permitido  === esperado.permitido;
    const okRestantes  = resultado.restantes  === esperado.restantes;
    const ok = okPermitido && okRestantes;

    if (!ok) todosOk = false;

    const estado = ok ? 'PASS' : 'FAIL';
    console.log(
      `  llamada ${llamada}: permitido=${String(resultado.permitido).padEnd(5)} restantes=${resultado.restantes}` +
      `  (esperado: permitido=${String(esperado.permitido).padEnd(5)} restantes=${esperado.restantes})` +
      `  → ${estado}`,
    );
  }

  console.log('\n' + '─'.repeat(52));
  console.log(`  resultado final: ${todosOk ? '✓ PASS — todos los casos correctos' : '✗ FAIL — hay casos incorrectos'}\n`);

  process.exit(todosOk ? 0 : 1);
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
