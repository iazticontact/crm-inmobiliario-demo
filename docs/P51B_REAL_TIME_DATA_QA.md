# P51B — QA de datos en tiempo real

## Estado: ⛔ NO EJECUTADO (BLOCKED) — requiere UI/staging interactiva

## Garantías de código (verificadas)
- `/api/agent/tool` es `export const dynamic = 'force-dynamic'` → **sin caché**; cada lectura consulta
  Supabase en vivo.
- El motor local-first consulta con la sesión **RLS del usuario** en el momento (datos frescos).
- Follow-up de confirmación usa `lastResults` (anti-contradicción) SOLO cuando el turno es de confirmación;
  una lectura nueva siempre re-consulta.

## Procedimiento para el operador (staging)
1. En la UI, crea o edita un registro permitido (p. ej. una **tarea** o un **cliente**).
2. Guarda.
3. Pregunta al Asistente por ese dato (`muéstrame mis tareas` / `busca el cliente X`).
4. Confirma que aparece el cambio.
5. Edita de nuevo y repite la pregunta → debe reflejar el nuevo valor (no cache viejo).

Entidades sugeridas: tarea o cliente (rápidas y reversibles). Si no quieres tocar datos demo, usa un
registro de prueba y revíértelo después. **No inventar resultados**: anotar el transcript real.

## Resultado
⛔ Pendiente de ejecución en staging por el operador (sin acceso interactivo en esta sesión).
