# TermPals — Scripts de prueba de carga

> **ADVERTENCIA:** estos scripts escriben y eliminan datos en la base de datos
> real de producción. Asegurate de saber a qué proyecto Supabase apunta
> `SUPABASE_URL` antes de ejecutar cualquiera de estos scripts.

---

## Scripts disponibles

### `seed-usuarios.js`
Genera 100 usuarios sintéticos (`github_id` con prefijo `test-`) y un proyecto
asociado por cada uno. Usa upsert con `onConflict: 'github_id'`, por lo que
puede ejecutarse más de una vez sin duplicar datos.

### `simular-chats.js`
Empareja los 100 usuarios de prueba en 50 pares consecutivos, crea una
conversación en la BD por cada par y abre canales Supabase Realtime Broadcast
(formato idéntico al usado por `src/websocket/chat.ts`). Envía 5 mensajes por
canal midiendo tiempo de conexión y errores. Al final imprime un resumen de
canales conectados, mensajes enviados y tiempos (promedio / min / max).

### `limpiar-seed.js`
Elimina todos los registros de prueba en el orden correcto de foreign keys:
descartados → amigos → invitaciones → conversaciones → proyectos → usuarios.
Solo afecta filas cuyo `github_id` empieza con `test-`.

---

## Configuración

Antes de ejecutar cualquier script, exporta las variables de entorno:

```bash
export SUPABASE_URL=https://tu-proyecto.supabase.co
export SUPABASE_ANON_KEY=tu-anon-key
```

O bien pásalas inline:

```bash
SUPABASE_URL=https://... SUPABASE_ANON_KEY=... node scripts/seed-usuarios.js
```

No se necesita instalar nada adicional: `@supabase/supabase-js` ya está en
`package.json` como dependencia del proyecto.

---

## Orden de ejecución

```bash
# 1. Poblar la BD con usuarios y proyectos de prueba
node scripts/seed-usuarios.js

# 2. Simular conversaciones y mensajes en tiempo real
node scripts/simular-chats.js

# 3. Limpiar todos los datos de prueba cuando termines
node scripts/limpiar-seed.js
```

---

## Identificación de datos de prueba

Todos los usuarios de prueba tienen `github_id` con el formato `test-{N}` y
`github_login` con el formato `testuser{N}`. Los scripts de limpieza usan este
prefijo para identificarlos sin afectar usuarios reales.
