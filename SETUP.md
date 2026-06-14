# Guía de configuración y prueba local — MeetHub

Esta guía te lleva desde cero hasta ver MeetHub corriendo en un
**Extension Development Host** de VS Code.

> ⚠️ **Importante:** MeetHub lee su configuración desde los **Settings de
> VS Code** (`meethub.*`), no desde un archivo `.env`. El archivo
> `.env.example` solo documenta qué valores necesitas reunir. Cópialos a los
> Settings como se indica en el paso 3.

---

## 1. Crear una GitHub OAuth App

1. Ve a <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Completa:
   - **Application name:** `MeetHub (local)`
   - **Homepage URL:** `https://github.com/leodanielalvarez/meethub`
   - **Authorization callback URL:** `vscode://leodanielalvarez.meethub/callback`
     - ☝️ Debe ser **exactamente** esta URL. MeetHub ya **no** usa un servidor
       local en el puerto 7777: ahora VS Code recibe el callback de forma nativa
       mediante su propio esquema de URI (`registerUriHandler`), lo que elimina
       el error `ECONNRESET` en Windows.
     - Si usas **VS Code Insiders**, el esquema cambia a
       `vscode-insiders://leodanielalvarez.meethub/callback`. En general es
       `<uriScheme>://leodanielalvarez.meethub/callback`, donde `<uriScheme>` es
       el valor de `vscode.env.uriScheme` de tu editor.

> 🔄 **¿Vienes de una versión anterior?** Si tu OAuth App tenía
> `http://localhost:7777/callback`, edítala y reemplázala por
> `vscode://leodanielalvarez.meethub/callback`. GitHub solo permite **una**
> Authorization callback URL por app.

3. Crea la app y copia el **Client ID**.
4. Pulsa **Generate a new client secret** y copia el **Client Secret**
   (solo se muestra una vez).

---

## 2. Obtener las keys de Supabase

1. Entra a tu proyecto en <https://supabase.com/dashboard>.
2. Ve a **Project Settings → API**.
3. Copia:
   - **Project URL** → será tu `meethub.supabaseUrl`
     (formato `https://xxxxxxxx.supabase.co`).
   - **Project API keys → `anon` `public`** → será tu `meethub.supabaseAnonKey`.
4. Asegúrate de haber aplicado las migraciones de la carpeta `migrations/`
   (incluida `002_sync_tipos.sql`) y de tener **Realtime** habilitado para la
   tabla `invitaciones` (Database → Replication → `supabase_realtime`).

---

## 3. Configurar los Settings en VS Code

Abre **Settings (JSON)** con `Ctrl+Shift+P` → *Preferences: Open User Settings (JSON)*
y agrega:

```jsonc
{
  "meethub.supabaseUrl": "https://tu-proyecto.supabase.co",
  "meethub.supabaseAnonKey": "tu-anon-key",
  "meethub.githubClientId": "tu-github-client-id",
  "meethub.githubClientSecret": "tu-github-client-secret"
}
```

(También puedes configurarlos por UI buscando `meethub` en Settings.)

---

## 4. Abrir la extensión en modo desarrollo (F5)

1. Instala dependencias y compila:
   ```bash
   npm install
   npm run compile
   ```
2. Abre la carpeta del proyecto en VS Code.
3. Pulsa **F5** (o *Run → Start Debugging*).
   - Esto ejecuta la tarea de build `watch` y abre una segunda ventana:
     el **Extension Development Host**.

> Tip: deja `npm run dev` (o la tarea `watch`) corriendo para recompilar al
> guardar.

---

## 5. Ver el panel de MeetHub

En la ventana del Extension Development Host:

- El panel se ubica en la **zona inferior**, junto a la Terminal.
- Si no aparece, abre la paleta (`Ctrl+Shift+P`) y ejecuta
  **MeetHub: Abrir panel** (`mh.open`).
- Al abrirse por primera vez sin sesión, MeetHub lanza el login de GitHub
  automáticamente.

---

## 6. Qué comandos probar primero

Escribe estos comandos dentro del panel (estilo terminal):

| Orden | Comando        | Qué hace                                            |
|------:|----------------|-----------------------------------------------------|
| 1     | `/mh login`    | Conecta tu cuenta de GitHub (abre el navegador).     |
| 2     | `/mh status`   | Muestra tu sesión y el stack detectado del workspace.|
| 3     | `/mh search`   | Busca un desarrollador compatible disponible.        |
| 4     | `/mh connect`  | Envía una invitación al match encontrado.            |
| 5     | `/mh help`     | Lista todos los comandos disponibles.                |

Para el flujo entre dos personas: una hace `/mh connect` y la otra recibe la
tarjeta de invitación para responder con `/mh accept` o `/mh reject`.
