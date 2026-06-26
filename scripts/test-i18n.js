// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ES = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'es.json'), 'utf-8'));
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'en.json'), 'utf-8'));

const esKeys = Object.keys(ES);
const enKeys = Object.keys(EN);

let errores = 0;

function fail(msg) {
  console.error('  FAIL:', msg);
  errores++;
}

// ── 1. Mismo número de claves ─────────────────────────────────────────────
console.log('\n[1] Conteo de claves');
if (esKeys.length !== enKeys.length) {
  fail(`ES tiene ${esKeys.length} claves, EN tiene ${enKeys.length}`);
} else {
  console.log(`  OK  ES=${esKeys.length}  EN=${enKeys.length}`);
}

// ── 2. Mismas claves en ambos archivos ────────────────────────────────────
console.log('\n[2] Claves simétricas');
const soloEnEs = esKeys.filter(k => !(k in EN));
const soloEnEn = enKeys.filter(k => !(k in ES));
if (soloEnEs.length) { fail(`Solo en ES: ${soloEnEs.join(', ')}`); }
if (soloEnEn.length) { fail(`Solo en EN: ${soloEnEn.join(', ')}`); }
if (!soloEnEs.length && !soloEnEn.length) { console.log('  OK  todas las claves están en ambos archivos'); }

// ── 3. Ningún valor vacío ─────────────────────────────────────────────────
console.log('\n[3] Valores no vacíos');
const vacios = [];
for (const k of esKeys) {
  if (!ES[k] || !ES[k].trim()) { vacios.push(`ES["${k}"]`); }
}
for (const k of enKeys) {
  if (!EN[k] || !EN[k].trim()) { vacios.push(`EN["${k}"]`); }
}
if (vacios.length) { fail(`Vacíos: ${vacios.join(', ')}`); }
else { console.log('  OK  ningún valor vacío'); }

// ── 4. Placeholders {N} coinciden entre idiomas ───────────────────────────
console.log('\n[4] Placeholders {N} consistentes');
const PLACEHOLDER = /\{(\d+)\}/g;
const discrepancias = [];
for (const k of esKeys) {
  if (!(k in EN)) { continue; }
  const esPlaces = [...ES[k].matchAll(PLACEHOLDER)].map(m => m[1]).sort();
  const enPlaces = [...EN[k].matchAll(PLACEHOLDER)].map(m => m[1]).sort();
  const esStr = JSON.stringify(esPlaces);
  const enStr = JSON.stringify(enPlaces);
  if (esStr !== enStr) {
    discrepancias.push(`"${k}":  ES=${esStr}  EN=${enStr}`);
  }
}
if (discrepancias.length) {
  discrepancias.forEach(d => fail(d));
} else {
  console.log('  OK  todos los placeholders coinciden');
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(46));
if (errores === 0) {
  console.log('PASS  i18n/es.json e i18n/en.json son válidos.');
} else {
  console.log(`FAIL  ${errores} error(es) encontrado(s).`);
  process.exit(1);
}
