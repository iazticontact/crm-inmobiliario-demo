# Runbook — Reutilizar el staging existente para el General Planner (REVERSIBLE)

> Autorizado: reutilizar TEMPORALMENTE `crm-inmobiliario-crm-staging` (límite de 3 servicios en EasyPanel).
> **Producción NO se toca. `main` NO se toca. n8n/Supabase/secrets/dominios NO se tocan.** 2026-07-19.
> Yo NO tengo acceso a EasyPanel; las acciones de UI las haces tú. Yo verifico por HTTP tras cada deploy.

## 1. Snapshot ANTES (estado actual del staging — referencia de restauración)
Verificado por mí vía `GET /api/agent/diag` (2026-07-19T15:22Z):
```
service=agent-tool-backend · supabaseRef=ylhdbawrllqygfvllhdo · commit=unknown
toolVersion=2026-07-17.p71-rc · config: agentToolSecret=true, serviceRole=true, n8nWebhook=true, n8nSecret=true
generalSemanticPlanner = (AUSENTE)   ← V1/P71 NO tiene este campo
```
Dominio: `crm-inmobiliario-crm-staging.hvdnby.easypanel.host`.

**Tú DEBES anotar en EasyPanel ANTES de tocar nada (para poder restaurar):**
- [ ] Repo/Source del servicio (debe ser `iazticontact/crm-inmobiliario-demo`).
- [ ] **Branch ACTUAL** que sigue el servicio (¡apúntalo! p. ej. `main` o `staging`). ← clave para el rollback.
- [ ] Build command / Start command (por defecto Next: `next build` / `next start`).
- [ ] Env var **NAMES** presentes (NO valores). En especial si ya existe `GENERAL_SEMANTIC_PLANNER`.
- [ ] Healthcheck path (si hay).
Haz una captura de la pestaña Source y de la pestaña Environment. Pásamelas y las archivo como backup.

## 2. Cambios EXACTOS en EasyPanel (mínimos, campo por campo)
En el servicio `crm-inmobiliario-crm-staging` (NO en producción):
1. **Pestaña Source/Git** → campo **Branch**: cambia el valor actual por **`general-semantic-planner`**.
   (No cambies el repo. No cambies build/start.)
2. **Pestaña Environment** → **añade** una variable:
   - Nombre: `GENERAL_SEMANTIC_PLANNER`
   - Valor: `SHADOW`
   (No modifiques ninguna otra variable: Supabase, n8n, secrets, dominios se quedan igual.)
3. Guarda y pulsa **Deploy** (rebuild desde la nueva branch).
4. Cuando termine, avísame. Yo verifico por HTTP.

## 3. Verificación que hago yo tras el deploy (SHADOW)
- `GET /api/agent/diag` → debe traer **`generalSemanticPlanner: "shadow"`** (marcador inequívoco de que corre
  la RAMA, no V1/P71). Si el campo NO aparece → el deploy no cogió la branch; paramos y revisamos.
- Health: la app responde 200 en la raíz y en `/api/agent/diag`.
- Confirmo que **producción** (servicio distinto) sigue intacta (su diag/estado sin cambios).
- Ejecuto **SHADOW real**: conversaciones nuevas; P71 responde al usuario, el planner observa (logs
  `source=shadow_planner:arch=GENERAL_PLANNER:...`), writes del planner = 0.

## 4. Gate para ON (solo si SHADOW pasa)
Si la comparación shadow muestra al planner claramente superior sin peor seguridad crítica, te pido:
- Cambiar la env var `GENERAL_SEMANTIC_PLANNER` de `SHADOW` a **`ON`** y **Deploy**.
- Yo verifico `generalSemanticPlanner: "on"` en diag y que las respuestas llevan `assistantArchitecture=
  GENERAL_PLANNER`, y corro el black-box + generality challenge.

## 5. ROLLBACK exacto (volver a V1/P71 en minutos)
Si algo falla, en CUALQUIER momento:
- **Opción rápida (sin rebuild de branch)**: env var `GENERAL_SEMANTIC_PLANNER` → `OFF` (o bórrala) → Deploy.
  Con OFF, aunque corra la rama, el comportamiento es idéntico a P71 (el planner ni se invoca).
- **Restauración completa**: en Source/Git, **Branch** → el valor ORIGINAL que anotaste en §1 → Deploy.
- Verifico: `GET /api/agent/diag` → `toolVersion=2026-07-17.p71-rc` y **sin** `generalSemanticPlanner`
  (o con OFF), confirmando P71 restaurado.

## 6. Invariantes de seguridad (se respetan en todo el proceso)
- No merge de `general-semantic-planner` a `main`. No deploy en producción.
- No se tocan: producción, main, n8n productivo, Supabase secrets, dominios de producción, credenciales.
- El planner es READ + dry-run; escrituras solo por el action plane P65. Rollback instantáneo con el flag.
- Supabase QA: mismo proyecto `ylhdbawrllqygfvllhdo`, workspace QA aislado por RLS; el planner en SHADOW no
  escribe. (Si en ON quieres probar acciones reales, van por el action plane con confirmación.)

## 7. Qué necesito de ti ahora
1. Capturas de Source y Environment del staging (backup del estado actual + branch original).
2. Haz los cambios de §2 y pulsa Deploy.
3. Avísame; yo verifico diag/health/shadow y sigo.
