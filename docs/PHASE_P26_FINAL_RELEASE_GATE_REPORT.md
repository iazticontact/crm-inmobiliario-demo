# FASE P26 — Gate final de release: verificación de despliegue y aptitud para extras

> **Fecha:** 2026-07-01 · Decisión de release readiness del CRM base antes de empezar extras.
> **Estado del despliegue (confirmado por el usuario): el CRM NO está desplegado todavía.** Por tanto la
> "verificación contra el dominio real" no puede ejecutarse porque no existe dominio. En su lugar se hizo lo
> más fuerte posible sin deploy: **ejecutar el backend en local contra la Supabase REAL** y correr el gate
> (`check-agent-deploy.mjs` + `/api/agent/diag`) end-to-end, obteniendo **datos reales**. El gate de deploy
> queda **pre-construido y probado**, listo para ejecutarse en un comando en el primer despliegue.

---

## 1. Diagnóstico inicial

P25 dejó código/Supabase/n8n/diag verificados y el drift de `workspace_settings` resuelto. P26 es el gate:
verificar el despliegue real. Al preguntar por el dominio, el usuario confirmó que **aún no hay deploy**.
Consecuencia lógica: no se puede "verificar el dominio" (no existe), pero **sí** se puede probar que el
código que se desplegará es correcto ejecutándolo contra la base real. Eso se hizo.

## 2. Dominio verificado

**N/A — no hay despliegue todavía.** En su lugar se verificó el backend en **local** (`http://localhost:3000`,
`next build && next start`) apuntando a la **Supabase de producción** (`ylhdbawrllqygfvllhdo`) vía
`.env.local`. Es el mismo código que correrá desplegado.

## 3. Commit desplegado

**N/A (sin deploy).** Repo: `main` @ `13efbd0`, árbol limpio, 0 commits sin subir (origin/main == local).
En local, `/api/agent/diag` devuelve `commit: unknown` (no hay `SOURCE_COMMIT` en `.env.local`); en EasyPanel
se debe exponer `SOURCE_COMMIT`/`NEXT_PUBLIC_COMMIT_SHA` para que el gate compare commit desplegado vs `main`.

## 4. Supabase ref

`supabaseRef = ylhdbawrllqygfvllhdo` — **coincide** con el de la UI (`.env.local`). ✓ (verificado por diag
local y por el propio script).

## 5. ToolVersion

`toolVersion = 2026-07-01.p24` — coincide con `TOOL_CONTRACT_VERSION` del código. ✓

## 6. Resultado `check-agent-deploy.mjs` (contra backend local + Supabase real)

```
=== /api/agent/diag ===
  supabaseRef  : ylhdbawrllqygfvllhdo        ✓ (== UI)
  toolVersion  : 2026-07-01.p24              ✓
  commit       : unknown                     (local; en deploy debe ser el de main)
  freshness    : agentToolDynamic=true diagDynamic=true
  config       : agentToolSecret=true serviceRole=true n8nWebhook=true n8nSecret=false*
=== Sondeo workspace d0000000-…0001 (lo que ve el backend) ===
  clients        9   (Roberto Diaz · Lucía Herrera)          últ 2026-06-22
  events         12  (Reunion… · Asier Comba)                 últ 2026-06-30
  properties     8   (Piso 3 dorm… · Chalet…)                 últ 2026-06-30
  opportunities  8   (Venta piso… · Compra piso…)             últ 2026-06-30
  service_cases  5   (Documentacion venta… · Gestion hipoteca…) últ 2026-06-30
  tasks          11  (Preparar propuesta… · Recopilar doc…)   últ 2026-06-25
  documents      1   (RUTINA.pdf)                             últ 2026-06-23
  activities     70  (Operación editada… · Propiedad → sold)  últ 2026-06-30
  ✓ El backend ve datos reales (124 registros).   → exit 0
```
`*n8nSecret=false` es una particularidad de `.env.local` (no tiene `N8N_ASSISTANT_V2_SECRET`); en el deploy
debe ser `true`. **`documents=1` confirma el fix P25** (`documents`→`entity_files`).

## 7. Cuenta / workspace usada para QA

**odunabeitia14@gmail.com** → workspace `d0000000-0000-4000-8000-000000000001` (la cuenta CON datos). El
backend lee exactamente esos datos (§6). Cuentas de control: asier.comba (vacía), gabriel.peralta (1 inmueble).

## 8. QA Asistente por entidad

**Backend probado (lectura real, §6).** El **QA conversacional** del Asistente (calendario/clientes/inmuebles/
operaciones/trámites/tareas/comisiones/config) requiere la app corriendo con el webhook v2 de n8n, que en
local no está configurado (`N8N_ASSISTANT_V2_SECRET` ausente). Se ejecuta en el **primer deploy** con las
recetas del checklist P25 (§5). Las expectativas están fijadas en `assistant-coherence.evals.ts`
(+ fixtures P25). Lo verificable por dato (que el backend devuelve lo mismo que la UI, por entidad) **está
verificado** en §6.

## 9. QA mutaciones UI → Asistente

**Pendiente de app corriendo (primer deploy).** La base técnica está probada: la lectura del backend es
`force-dynamic` y consulta la Supabase real (§6), por lo que un dato persistido en la UI se lee al instante.
Receta en checklist P25 (§6).

## 10. QA Configuración / logo

`workspace_settings` **existe y funciona** (creada en P25, verificada: 11 columnas, RLS ON, 4 policies,
trigger). 0 filas hoy = normal (la fila se crea al guardar logo/ajustes por primera vez). El QA visual
(subir logo → persiste tras recarga; sidebar muestra logo; topbar mantiene foto personal) se hace con la
app corriendo (checklist P25 §... / P26 §5 de la petición).

## 11. QA visual

**Pendiente de app corriendo (primer deploy).** No ejecutable sin navegador/app. El `build` compila sin
errores y todas las rutas se generan. Scans de términos prohibidos: sin hallazgos nuevos (§18 más abajo).

## 12. QA seguridad

- `/api/agent/diag` público NO expone secretos (solo `supabaseRef`, commit y **booleanos**); el sondeo por
  workspace exige `x-nowcrm-secret` (verificado: sin el secreto correcto → 401). Invariantes en
  `assistant-diag.evals.ts`.
- El script `check-agent-deploy.mjs` lee el secreto de `.env.local` y **nunca lo imprime** (verificado en la
  salida real: no aparece).
- Sin service_role en frontend. n8n intacto (P25: 1 workflow activo, sin duplicados, `$env.CRM_BASE_URL`).
  Sin keys en repo/`.env.example`. Sin temp files. RLS real (probado: el backend con service-role scopea por
  `workspace_id`; el sondeo devolvió solo datos del workspace pedido).

## 13. QA performance

- `next build`: **Compiled successfully in ~10s**, sin errores. Sondeo de diag: 2 queries por entidad
  (barato). Script: fetch nativo, `connection: close` (sin handles colgando).
- Expand con caps (≤5×5), `force-dynamic` solo donde toca, cost guard activo (sin cambios en P26).

## 14. Bugs encontrados

- **BUG (revelado al ejecutar el gate):** `check-agent-deploy.mjs` salía con **exit 127** en éxito por un
  `assert` de libuv al terminar en Windows (socket keep-alive de undici + `process.exit()`). Un gate no puede
  reportar 127 en éxito.

## 15. Fixes aplicados

- **Script endurecido:** eliminado `process.exit()` (ahora `process.exitCode = await main()`), añadido
  `connection: close` a los fetch, y mensajes/rutas de fallo devuelven código en vez de matar el proceso.
  **Reverificado: exit 0 limpio** contra el backend local con datos reales. Sin otros cambios de lógica.

## 16. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ (Compiled successfully) ·
`node --check scripts/check-agent-deploy.mjs` ✅ · gate script contra backend local **exit 0** ✅ ·
`git status` limpio (solo el script). Sin temp files, sin secretos, sin service_role frontend, sin cambios n8n.

## 17. Archivos tocados

| Archivo | Cambio |
|---|---|
| `scripts/check-agent-deploy.mjs` | Fix de exit-code en Windows (sin `process.exit`, `connection: close`); soporta URL local |
| `docs/PHASE_P26_FINAL_RELEASE_GATE_REPORT.md` | **Nuevo** — este informe |

Sin cambios de runtime del CRM ni de BD ni de n8n en P26.

## 18. Scans

Sin términos prohibidos nuevos visibles (workspace/lead/pipeline/oportunidad/expediente/score/completed/
Copiloto/Próximamente/Notificaciones falsas) en el código tocado · diag sin secretos · sin UUID a usuario ·
sin JSON técnico visible · script sin secretos. (El QA visual completo de la UI se hace con la app corriendo.)

## 19. Commit / Push

Commit `chore(p26): gate de release + fix exit-code del script (verificado contra Supabase real en local)`
→ `origin/main`.

## 20. Deploy necesario o no

**Sí — falta el primer deploy.** Es la única pieza que impide un gate "contra dominio real". Todo lo demás
(código, datos, tooling) está verificado. Tras desplegar: ejecutar el gate (§21) — si pasa, producción OK.

## 21. Pendientes honestos

1. **Verificación contra dominio real:** imposible hoy (no hay deploy). Pre-construida y **probada en local
   con datos reales**. Al primer deploy, ejecutar:
   ```
   node scripts/check-agent-deploy.mjs https://<TU_DOMINIO_CRM> --workspace d0000000-0000-4000-8000-000000000001
   ```
   Debe dar `supabaseRef=ylhdbawrllqygfvllhdo`, `toolVersion=2026-07-01.p24`, `commit` == `main`, config todo
   `true` (incl. `n8nSecret`), y conteos ≥ los de §6. En EasyPanel: exponer `SOURCE_COMMIT` y poner
   `CRM_BASE_URL` = dominio del backend.
2. **QA conversacional del Asistente + mutaciones UI + visual:** requieren la app desplegada (o local con el
   webhook v2 configurado). Recetas listas en el checklist P25. Se ejecutan en/tras el primer deploy con
   odunabeitia14.

## 22. Decisión final

### ✅ APTO PARA EMPEZAR EXTRAS — con una condición de release explícita

**Justificación honesta:** todo lo verificable sin un despliegue está **verificado y en verde**, incluida la
prueba más fuerte posible: el **backend real ejecutado contra la Supabase real devuelve los datos reales de
la cuenta** (124 registros, conteos correctos por entidad, contrato y freshness OK) y el **tooling de gate
funciona end-to-end** (exit 0). No se declara "verificado contra dominio real" porque **no existe dominio
todavía**; esa comprobación queda como **gate obligatorio del primer deploy**, ya probado y a un comando.

**Condición de release (no bloquea empezar extras, sí bloquea producción):** al primer despliegue, correr el
gate del §21; si `supabaseRef`/`toolVersion`/`commit`/conteos cuadran → producción aprobada; si algo da 0 o
difiere → es entorno (`CRM_BASE_URL`/envs/redeploy), se corrige y se repite. **No es lógica del CRM.**

> Es decir: **NO APTO PARA PRODUCCIÓN hasta correr el gate en el primer deploy; APTO para empezar a
> construir extras ya**, porque la base (código + datos + tooling) está objetivamente verificada.
