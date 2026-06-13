# FriendHub

**FriendHub** es una extensión de VS Code que conecta desarrolladores entre sí
desde un panel estilo terminal, ubicado en la zona inferior del editor (junto a
la Terminal). Hace *match* entre devs según la compatibilidad técnica de sus
proyectos —lenguaje, dominio, tests y zona horaria— y permite invitarlos a
chatear sin salir de tu editor.

Pensado para conocer gente con quien colaborar... o quizá algo más. 💜

---

## Captura

```
[screenshot aquí]
```

---

## Comandos `/fh`

Todos se escriben dentro del panel de FriendHub:

| Comando               | Descripción                                                    |
|-----------------------|----------------------------------------------------------------|
| `/fh login`           | Conecta tu cuenta de GitHub (OAuth).                           |
| `/fh status`          | Resumen de sesión, workspace detectado y conexiones.          |
| `/fh search`          | Busca un desarrollador compatible disponible.                 |
| `/fh connect`         | Envía una invitación al match actual.                         |
| `/fh accept`          | Acepta la invitación pendiente.                               |
| `/fh reject`          | Rechaza la invitación pendiente.                              |
| `/fh stack`           | Compara tu stack con el de tu match (barra de compatibilidad).|
| `/fh readme`          | Muestra el README del proyecto del match.                     |
| `/fh friends`         | Lista tus amigos con su stack.                                |
| `/fh invite @usuario` | Invita a un amigo guardado a chatear.                         |
| `/fh add <usuario>`   | Propone amistad en la conversación activa.                    |
| `/fh leave`           | Cierra la conversación actual.                                |
| `/fh timer`           | Tiempo restante para enviar el próximo mensaje (1 cada 5 min).|
| `/fh help`            | Lista todos los comandos.                                     |

---

## Instalación para desarrollo

```bash
git clone <repo>
cd friendhub
npm install
npm run compile
```

Luego pulsa **F5** en VS Code para abrir un **Extension Development Host**.
La configuración de credenciales y el flujo completo de prueba están en
[SETUP.md](SETUP.md).

Scripts útiles:

- `npm run compile` — compila TypeScript a `out/`.
- `npm run dev` / `npm run watch` — recompila al guardar.
- `npm run lint` — ESLint sobre `src/`.

---

## Stack técnico

- **TypeScript** — código de la extensión.
- **VS Code Extension API** — Webview View en el panel inferior y comandos.
- **Supabase** (`@supabase/supabase-js`):
  - Postgres para usuarios, proyectos, conversaciones, invitaciones, amigos y descartados.
  - **Realtime** (postgres_changes) para invitaciones en vivo.
  - **Realtime Broadcast** para los mensajes del chat (no se persisten).
- **GitHub OAuth** — autenticación vía servidor HTTP local temporal (puerto 7777).
- **ESLint** — calidad de código.

---

## Estructura

```
src/
  extension.ts            punto de entrada
  panel/FriendHubPanel.ts webview del panel inferior
  commands/index.ts       handlers de los comandos /fh
  auth/github.ts          flujo de GitHub OAuth
  supabase/               cliente y queries por tabla
  websocket/chat.ts       Realtime: chat e invitaciones
  compatibility/score.ts  cálculo de compatibilidad técnica
  types/index.ts          tipos del proyecto
migrations/               SQL del esquema Supabase
```
