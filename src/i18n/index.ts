import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type Traducciones = Record<string, string>;

let _traducciones: Traducciones = {};
let _idioma = 'es';

export function inicializarI18n(extensionPath: string): void {
  const idiomVscode = vscode.env.language;
  _idioma = idiomVscode.startsWith('es') ? 'es' : 'en';

  const archivo = path.join(extensionPath, 'i18n', `${_idioma}.json`);
  const fallback = path.join(extensionPath, 'i18n', 'es.json');

  try {
    const ruta = fs.existsSync(archivo) ? archivo : fallback;
    const contenido = fs.readFileSync(ruta, 'utf-8');
    _traducciones = JSON.parse(contenido) as Traducciones;
  } catch {
    _traducciones = {};
  }
}

export function t(clave: string, ...args: (string | number)[]): string {
  let texto = _traducciones[clave] ?? clave;
  args.forEach((arg, i) => {
    texto = texto.replace(`{${i}}`, String(arg));
  });
  return texto;
}

export function idioma(): string {
  return _idioma;
}
