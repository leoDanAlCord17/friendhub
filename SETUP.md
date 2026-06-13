# Guía de configuración y prueba local — FriendHub

Esta guía te lleva desde cero hasta ver FriendHub corriendo en un
**Extension Development Host** de VS Code.

> ⚠️ **Importante:** FriendHub lee su configuración desde los **Settings de
> VS Code** (`friendhub.*`), no desde un archivo `.env`. El archivo
> `.env.example` solo documenta qué valores necesitas reunir. Cópialos a los
> Settings como se indica en el paso 3.

---

## 1. Crear una GitHub OAuth App

1. Ve a <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Completa:
   - **Application name:** `FriendHub (local)`
   - **Homepage URL:** `http://localhost:7777`
   - **Authorization callback URL:** `http://localhost:7777/callback`
     - ☝️ Debe ser **exactamente** esta URL (puerto `7777`, ruta `/callback`).
3. Crea la app y copia el **Client ID**.
4. Pulsa **Generate a new client secret** y copia el **Client Secret**
   (solo se muestra una vez).

---

## 2. Obtener las keys de Supabase

1. Entra a tu proyecto en <https://supabase.com/dashboard>.
2. Ve a **Project Settings → API**.
3. Copia:
   - **Project URL** → será tu `friendhub.supabaseUrl`
     (formato `https://xxxxxxxx.supabase.co`).
   - **Project API keys → `anon` `public`** → será tu `friendhub.supabaseAnonKey`.
4. Asegúrate de haber aplicado las migraciones de la carpeta `migrations/`
   (incluida `002_sync_tipos.sql`) y de tener **Realtime** habilitado para la
   tabla `invitaciones` (Database → Replication → `supabase_realtime`).

---

## 3. Configurar los Settings en VS Code

Abre **Settings (JSON)** con `Ctrl+Shift+P` → *Preferences: Open User Settings (JSON)*
y agrega:

```jsonc
{
  "friendhub.supabaseUrl": "https://tu-proyecto.supabase.co",
  "friendhub.supabaseAnonKey": "tu-anon-key",
  "friendhub.githubClientId": "tu-github-client-id",
  "friendhub.githubClientSecret": "tu-github-client-secret"
}
```

(También puedes configurarlos por UI buscando `friendhub` en Settings.)

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

## 5. Ver el panel de FriendHub

En la ventana del Extension Development Host:

- El panel se ubica en la **zona inferior**, junto a la Terminal.
- Si no aparece, abre la paleta (`Ctrl+Shift+P`) y ejecuta
  **FriendHub: Abrir panel** (`fh.open`).
- Al abrirse por primera vez sin sesión, FriendHub lanza el login de GitHub
  automáticamente.

---

## 6. Qué comandos probar primero

Escribe estos comandos dentro del panel (estilo terminal):

| Orden | Comando        | Qué hace                                            |
|------:|----------------|-----------------------------------------------------|
| 1     | `/fh login`    | Conecta tu cuenta de GitHub (abre el navegador).     |
| 2     | `/fh status`   | Muestra tu sesión y el stack detectado del workspace.|
| 3     | `/fh search`   | Busca un desarrollador compatible disponible.        |
| 4     | `/fh connect`  | Envía una invitación al match encontrado.            |
| 5     | `/fh help`     | Lista todos los comandos disponibles.                |

Para el flujo entre dos personas: una hace `/fh connect` y la otra recibe la
tarjeta de invitación para responder con `/fh accept` o `/fh reject`.
