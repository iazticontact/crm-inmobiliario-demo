# Recovery report — Wi-Fi interruption

**Fecha:** 2026-06-14
**Modo:** recuperación segura (auditoría primero, cero suposiciones)
**Branch:** `main` · sincronizada con `origin/main`

## 1. Contexto

Se cortó el Wi-Fi durante una sesión de trabajo de runtime y no se sabía con
certeza dónde había quedado. Último estado bueno conocido: RT1 completada y
pusheada en `d291a7e`, Supabase real `crm-inmobiliario-demo`
(ref `ylhdbawrllqygfvllhdo`), demo offline preservada.

## 2. Diagnóstico de Git inicial

```
## main...origin/main
 M src/app/(saas)/clients/[id]/page.tsx
```

- **HEAD:** `d291a7e feat(runtime): align core CRM UI to live Supabase (operaciones naming)`
- **Ahead/behind:** ninguno (sincronizado con `origin/main`).
- **Cambios locales:** UN solo archivo modificado → `src/app/(saas)/clients/[id]/page.tsx` (+42 / −7).
- **Tag presente:** `demo-v1`.
- **Ignorados (sin trackear, normales):** `.env.local`, `.env.local.backup_antiguo`,
  `.mcp.json`, `.claude/`, `.next/`, `memory/`, `node_modules/`, `next-env.d.ts`,
  `tsconfig.tsbuildinfo`. Nada sospechoso.

### Clasificación: **CASO 3 — cambios locales presentes**

No hay `.env*`, ni `.mcp.json`, ni `package*`, ni migraciones en los cambios.
Solo el archivo de ficha de cliente — coherente con trabajo RT2 parcial.

## 3. Auditoría del cambio local

El diff de `src/app/(saas)/clients/[id]/page.tsx` es un **polish de solo lectura
y solo-UI**:

- Añade diccionarios de etiquetas es-ES: `TASK_PRIORITY_LABEL`,
  `TASK_STATUS_LABEL`, `CASE_STATUS_LABEL`, `PROPERTY_STATUS_LABEL`.
- Añade helpers `labelOr(map, value)` y `stageLabel(vertical, stage)`.
- Sustituye los enums crudos de DB mostrados en la UI por etiquetas humanas,
  con **fallback al valor crudo** si el vocabulario no está contemplado.
- Importa `getPipelineForVertical` y `VerticalKey` desde
  `@/lib/demo/vertical-templates` (exports verificados; solo se **lee** el
  catálogo, no se modifica nada de la demo).

**No toca:** `.env*`, secrets, migraciones, `package.json`, Auth, Storage, n8n,
ni la lógica de la demo offline. No rompe el botón "Ver demo inmobiliaria".

## 4. Verificación segura de entorno (.env.local)

Sin imprimir valores:

- `.env.local` presente ✅
- Contiene ref nuevo `ylhdbawrllqygfvllhdo` ✅
- **No** contiene ref legacy `ktsgfukjgldeylfzrayr` ✅
- Claves Supabase necesarias presentes: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ✅

## 5. Validaciones

| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ verde (sin errores) |
| `npm run lint -- --max-warnings=0` | ✅ verde (0 warnings) |
| `npm run build` | ✅ verde tras corrección mínima de cache (ver §6) |

## 6. Corrección mínima aplicada

`npm run build` fallaba de forma determinista **después** de compilar:

```
✓ Compiled successfully
  Running TypeScript ...
Debug Failure. Expected <...>/.next/cache/.tsbuildinfo === <...>\.next\cache\.tsbuildinfo
```

Causa: aserción interna de TypeScript por separadores de ruta `/` vs `\` en el
`.tsbuildinfo` incremental — el corte de Wi-Fi a mitad de build dejó ese cache
corrupto/parcial. No es un error de código (`tsc --noEmit` independiente pasa).

**Acción:** se eliminó únicamente el artefacto regenerable y gitignored
`.next/cache/.tsbuildinfo` y se reconstruyó. No se tocó ningún archivo de
código, configuración, env ni trackeado. El build pasó completo (46 rutas).

## 7. Acciones realizadas

- Diagnóstico Git (solo lectura).
- Auditoría del único archivo modificado.
- Verificación segura de `.env.local` (sin imprimir valores).
- Validaciones tsc / lint / build.
- Corrección mínima: limpieza del cache incremental corrupto.
- Este informe.
- Commit del trabajo recuperado (cambio coherente, seguro y validaciones verdes).

## 8. Confirmación de lo que NO se tocó

`.env.local` · `.env.local.backup_antiguo` · secrets · API keys · service_role
en frontend · Auth · Storage · migraciones Supabase · n8n · proyectos legacy.
No se usó `git reset`, `git clean`, `git rebase`. No se borró ningún archivo de
trabajo/código (solo cache regenerable de build).

## 9. Estado final

- Branch: `main`.
- Recovered change: `src/app/(saas)/clients/[id]/page.tsx` (etiquetas es-ES).
- Validaciones: tsc ✅ / lint ✅ / build ✅.
- Smoke test en navegador: **pendiente** (a ejecutar por Oier — checklist abajo).

### Checklist de smoke test para Oier (`npm run dev -- --webpack`)

- [ ] Login real (owner) → dashboard carga.
- [ ] Clientes = 8 · Inmuebles = 7 · Operaciones = 7.
- [ ] Ficha de cliente abre y muestra etiquetas en español (tareas, casos,
      inmuebles, operaciones).
- [ ] Logout.
- [ ] Botón "Ver demo inmobiliaria" → demo offline funciona.

## 10. Veredicto

**RECOVERY COMPLETADO — LISTO PARA SMOKE TEST** (y desbloqueado para continuar
con la siguiente fase de datos reales vs demo).
