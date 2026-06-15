# Phase 2E-2 H6 — Login workspace link + premium login redesign

> **Fecha:** 2026-06-15 · **Base:** `4e84a43` · Fix de datos en Supabase (vínculo
> de workspace, vía MCP server-side) + UI de login. **No se tocó `.env.local`,
> schema, migraciones, contraseñas, ni service_role en frontend.**

## 1. Problema inicial
Tras resolver el "Invalid API key" (H3), el login real mostraba:
**"Tu usuario no está vinculado a un workspace"**. La autenticación funcionaba,
pero faltaba el vínculo en datos.

## 2. Diagnóstico Auth (read-only, Supabase MCP, sin imprimir secretos)
- **`auth.users` tiene exactamente 1 usuario:** `odunabeitia14@gmail.com`
  (confirmado, con `last_sign_in_at` reciente → **Auth OK**).
- `oier.dunabeitia@opendeusto.es` **no existe** en Auth.
- Ese usuario tenía **`has_profile=false`** y **sin `workspace_members`** → causa
  exacta del error.
- **`public.profiles` y `public.workspace_members` estaban VACÍAS (0 filas).** Las
  filas del seed habían desaparecido: los FK `profiles.id`/`workspace_members.user_id`
  → `auth.users(id)` son **ON DELETE CASCADE**; al borrarse un usuario Auth de
  prueba anterior, su profile + membership se eliminaron en cascada.
- Workspace existente: **"Demo Inmobiliaria"** (`d0000000-…-0001`).

## 3. Usuario encontrado / vinculado
- **Único usuario real:** `odunabeitia14@gmail.com` → es el correcto (no hay
  ambigüedad; es el único en Auth y el que usa Oier). No se inventó nada.

## 4. Qué vínculo faltaba
- Faltaba **`profiles`** (id = auth user) y **`workspace_members`** (owner) para
  ese usuario en el workspace Demo Inmobiliaria.

## 5. Fix aplicado (idempotente, server-side vía MCP, respetando constraints)
Constraints verificadas antes de escribir:
- `profiles.role` ∈ {nowlabs_admin, **client_admin**, member}.
- `workspace_members.role` ∈ {**owner**, admin, comercial, solo_lectura}.
- `workspace_members` UNIQUE(workspace_id, user_id) → idempotencia.

Operación:
- `INSERT … profiles (id, workspace_id, email, full_name, role='client_admin')
  ON CONFLICT (id) DO UPDATE …`
- `INSERT … workspace_members (workspace_id, user_id, role='owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE …`

**Verificado tras el fix:** `odunabeitia14@gmail.com` → profile `client_admin`,
`profile_ws_ok=true`, member `owner`, workspace **Demo Inmobiliaria**.

## 6. Qué NO se tocó
`.env.local`, schema/migraciones, contraseñas (sin cambios; password ≥8 sigue),
Auth users (no se borró ni creó usuario), Storage, n8n, service_role en frontend.
El fix es **datos** (2 filas), no código de backend.

## 7. Cambios visuales en login (`src/app/login/page.tsx`, solo UI)
- **Portada (panel izquierdo) rediseñada, premium y honesta:**
  - H1: "Gestiona clientes, operaciones y citas desde un solo lugar."
  - Subtítulo, **3 beneficios** (Clientes/operaciones, Tareas/citas/expedientes,
    Asistente IA), mini-cards "Clientes · Operaciones · Calendario · Asistente IA",
    bloque de confianza "Acceso privado · Datos protegidos · Workspace seguro".
  - **Sin promesas falsas:** se eliminó "documentación"; no se menciona WhatsApp,
    facturación, Storage ni Google.
- **Microcopy de error sin-workspace** más claro: "Tu cuenta existe, pero no está
  asignada a ningún workspace. Contacta con el equipo técnico…".
- **Botón demo** con copy honesto: "Entrarás en un entorno de ejemplo. No se
  guardan cambios reales."
- Form, validación (password ≥8), mapeo de errores (H3) y guard demo → intactos.

## 8. Demo / real verificado
Login real limpia `DEMO_MODE_KEY`; demo solo por botón; logout limpia; sin mocks
en real. El usuario vinculado ahora entra al workspace Demo Inmobiliaria por RLS
(membership owner).

## 9. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 10. Riesgos
- El vínculo se aplicó a la BD de Supabase (no vive en el repo). Si se recrea/
  resetea el proyecto o se borra el usuario Auth, habrá que repetir el INSERT.
- Login depende de reiniciar el dev (NEXT_PUBLIC inlinado) — ya cubierto en H3.

## 11. Próximo paso (Oier)
1. Reiniciar `next dev` + hard refresh (Ctrl+Shift+R).
2. Login real con **odunabeitia14@gmail.com** (contraseña ≥8).
3. Debe entrar al workspace **Demo Inmobiliaria** → **smoke navegador completo**
   (ficha/mutaciones → asistente → demo) y pasar resultados.
