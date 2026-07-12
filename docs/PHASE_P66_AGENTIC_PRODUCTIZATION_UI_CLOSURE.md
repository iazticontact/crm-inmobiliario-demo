# P66 — AGENTIC PRODUCTIZATION: CHAT WIRING DEL PLANO DE ACCIONES

**Estado:** ✅ CHAT→ACCIONES OPERATIVO Y DEMOSTRADO CON DATOS REALES / límites declarados
**Fecha:** 2026-07-12

> Cierra EL hueco declarado por P65: una frase natural en el chat ahora recorre todo el ciclo
> interpretación → prepare → preview → confirmación → execute → verify, reutilizando `/api/agent/action`
> (cero duplicación: ni segundo registro, ni segunda tabla, ni segundo sistema de tokens).

## Preflights — ✅
Repo limpio (HEAD `30471f1`) · n8n P65 intacto e idempotente · staging p65 · P65 E2E verde.

## Núcleo entregado
1. **`assistant-action-intent.ts`** (puro): frases naturales → acciones REGISTRADAS por composición
   (verbo de mutación + campo + valor + entidad), con parsers españoles (precios «280.000 €/280 mil»,
   teléfonos «600 555 555», fechas «mañana/el viernes» en Europe/Madrid). Confirmación ESTRICTA
   («sí explícame»/«sí pero…» NO confirman); prioridad cancel > modify > status > confirm > prepare.
   Cero falsos positivos sobre lecturas (eval).
2. **Wiring en `local-answers`** (`handleChatAction`): resolución de entidad con los readers RLS reales
   (inmueble/cliente/tarea; ambigüedad → UNA aclaración con opciones), `prepare` contra el endpoint P65
   desplegado, **preview visible** («Precio: 375.000 € → 280.000 €… Todavía no se ha aplicado»),
   **pending action persistente en BD** (assistant_actions; sobrevive a refresh y no depende del texto del
   hilo), confirmación re-firmando el token server-side desde la fila, cancelación, modificación
   (cancel + prepare nuevo), status. Nunca en turnos meta/corrección/queja ni Facturación; un «sí» sin
   pending action JAMÁS ejecuta (cae al flujo normal de ofertas).
3. **n8n P66 funcional** (PUT 200, verificado): tools **`crm_action_cancel`** y **`crm_action_status`**
   conectadas al agente (4/4 tools de acción) + bloque **[P66 CHAT ACTION INTEGRATION]** (modificación =
   cancel+prepare nuevo, nunca editar la acción anterior; EXPIRED/CANCELLED/CONFLICT → informar sin
   reintentar). Backup previo en temp.

## E2E CONVERSACIONAL con datos reales — **11/11 TODO PASS** (`scripts/p66-chat-action-e2e.mts`)
Contra el motor real del chat + Supabase real + endpoint desplegado:
«Cambia el precio de Avenida San Pedro 66 a 280.000 €» → preview (375.000 → 280.000), **BD intacta** ·
«sí, confirma» → **BD real = 280.000 verificado** · restauración por el mismo ciclo → **375.000 de vuelta** ·
crear tarea → preview → «mejor no, cancela» → **la tarea no existe en BD** · «sí» sin pending → no ejecuta.

## Validación
Nueva eval `assistant-action-intent` → **38 suites TODO VERDE** · incidentes P61/P62/P63 **PASS** ·
harness/runner **PASS** · tsc/lint/build/gate ✅ · **strict 7/7 en vivo** ✅ · marcador `2026-07-12.p66` ·
0 secretos · 0 migraciones nuevas (reutiliza assistant_actions de P65).

## Límites declarados
- **UI visual** (tarjetas con botones Confirmar/Cancelar): la respuesta es texto limpio con instrucciones;
  el contrato UI estructurado queda para una fase de frontend.
- **Automatizaciones opt-in** (brief diario, watches): no implementadas — requieren scheduler + tablas de
  reglas/findings. No se simulan.
- **Playwright**: BLOCKED — TEST_SESSION_MISSING.
- Acciones nuevas más allá de las 4 de P65: pendientes de ampliar el registro (mismo patrón).

## Operador (2 min, tras ~5 min de deploy)
En el chat: «Cambia el precio de Avenida San Pedro 66 a 280.000 €» → preview sin aplicar · «sí, confirma»
→ aplicado y verificado · «mejor no, cancela» en un preview → descartado. `node scripts/p66-chat-action-e2e.mts`
reproduce todo el ciclo y restaura los datos.

---
**P66 — 0 fallos conocidos dentro de la matriz validada: el chat prepara, previsualiza, confirma, ejecuta y
VERIFICA escrituras reales reutilizando íntegro el plano P65, con pending action persistente, confirmación
estricta y n8n 4/4 tools bajo contrato. Límites declarados: UI visual, automatizaciones y Playwright.**
