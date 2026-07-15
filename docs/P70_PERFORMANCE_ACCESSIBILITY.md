# P70 — Performance y accesibilidad (Wave H)

## Performance (`scripts/p70-performance.mts`, contra motor real + staging)

| Camino | p50 | p95 | Presupuesto p95 | |
|---|---|---|---|---|
| parse acción (puro) | 0 ms | 0 ms | 5 ms | ✅ |
| lectura clientes | 86 ms | 567 ms | 2500 ms | ✅ |
| lectura cartera | 70 ms | 553 ms | 2500 ms | ✅ |
| lectura agenda (citas+tareas) | 129 ms | 154 ms | 2500 ms | ✅ |
| resumen ejecutivo (multi-fuente, 5 lectores en paralelo) | 229 ms | 235 ms | 4000 ms | ✅ |
| automation preview (opt-in) | 0 ms | 1 ms | 2500 ms | ✅ |
| action prepare (plano desplegado) | 293 ms | 545 ms | 3000 ms | ✅ |

**7/7 dentro de presupuesto.** El parser y el preview de automatización son instantáneos (lógica pura);
las lecturas locales resuelven en <600 ms p95 con la sesión RLS; el resumen ejecutivo paraleliza sus 5
fuentes (235 ms). El prepare de acción incluye ida/vuelta al plano en staging (545 ms). Performance es
informativo (no bloquea salvo p95 > 3× presupuesto).

## Accesibilidad (verificada en código y por Playwright 14/14)

### Roles y etiquetas ARIA
- Cada card estructurada es un `role="group"` con `aria-label` descriptivo: «Acción: …»,
  «Automatización: …», «Incidencias detectadas». Los tests Playwright las localizan por
  `getByRole('group', { name: … })` — es decir, la semántica ARIA está ejercida en vivo.
- Los filtros del centro de incidencias son botones con `aria-pressed` (estado seleccionado
  anunciado); los grupos de filtro llevan `role="group"` + `aria-label` («Filtrar por estado/severidad»).
- Los botones de confirmación muestran `aria-busy` mientras la petición está en curso.
- Botones e inputs con `aria-label` donde el texto visible no basta (enviar, editar título, etc.).

### Teclado y foco
- Composer: `Enter` envía, `Shift+Enter` nueva línea.
- «Modificar» en una card lleva el foco al composer (`composerRef.current?.focus()`) para escribir el
  nuevo valor, sin reconstruir prompts.
- Navegación por Tab a través de cards y botones (elementos nativos `<button>`, no divs clicables).

### Responsive y móvil
- Cards con `max-w-full` y `flex-wrap`; el chat no desborda horizontalmente (verificado en
  `assistant-mobile.spec.ts`: `scrollWidth - clientWidth <= 1` en Pixel 7).
- Botones de card apilan con `flex-wrap` en pantallas estrechas; el centro de incidencias usa grid
  responsive (2 col → 4 col).

### Estados de carga y error
- Skeletons durante la carga (mensajes, centro de incidencias); estados vacíos explícitos («No hay
  incidencias abiertas»); errores humanos sin stack ni JSON.
- Fallback textual garantizado: si el bloque `ui` es inválido, la card no se pinta y queda el texto.

### Higiene visible (accesible y limpio)
Sin UUIDs, tokens, secretos, stacks, JSON crudo ni markdown `**` ni marcadores internos `[AUTO…]` en la
UI (saneado en `displayAssistantText` y validado por el contrato + red-team UI tampering).

## Tema pendiente conocido (no bloqueante)
Auditoría a11y automatizada con axe-core no incluida (requeriría dependencia adicional); la cobertura
actual es ARIA-roles ejercidos por Playwright + revisión de código. Registrado en blockers como P2.
