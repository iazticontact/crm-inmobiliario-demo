# P56B — Reconciliación UI ≠ DB ≠ Assistant: veredicto por hipótesis (con evidencia)

Ejecutado 2026-07-09 contra la BD real y el endpoint DESPLEGADO de staging.

| # | Hipótesis | Veredicto | Evidencia |
|---|---|---|---|
| 1 | La UI no usa el handler P56 | ✅ **Resuelto y demostrable** | Marcador `meta.toolVersion`: staging sirve `2026-07-09.p56` (probado en vivo; el deploy tarda ~5 min tras el push). `node scripts/reconcile-portfolio.mjs` lo imprime siempre. |
| 2 | n8n/LLM pisa la respuesta local | ❌ No aplica a estados | Las preguntas de estado (publicados/vendidos…) las responde el handler LOCAL (`handled:true` → n8n ni se llama; eval). Cuando n8n actúa, sus tools llaman al MISMO endpoint/reader (probado en vivo). |
| 3 | El bot lee otro workspace | ✅ **CAUSA RAÍZ del descuadre** | Hay DOS workspaces con inmuebles: **Oier → demo `d0000000…`** (8: 6 vendidos, 1 publicado, 1 alquilado) y **gabriel.peralta → `ffc49d1b…`** (2 publicados: «Avenida San Pedro 66» Madrid y «San Pío X 7 n8» Bilba). Chat con una cuenta + Cartera de la otra = descuadre aparente. Cada cuenta ve SU workspace, consistente UI=Asistente. |
| 4 | Reader ≠ página Cartera | ✅ **1 gap real, corregido** | `crm_read_query(properties)` no filtraba `deleted_at` (la UI sí) → `soft:true` añadido. Reconciliación en vivo: el reader devuelve exactamente los inmuebles/estados de la BD por workspace. |
| 5 | «vendido» no existe en el endpoint | ❌ Refutada | El endpoint devuelve `sold` en vivo (6 en demo). |
| 6 | Los vendidos viven en Operaciones | ❌ Refutada | SQL: las 5 operaciones `won` tienen su inmueble con `properties.status='sold'` (100% coherente). |
| 7 | Caché/lastResults contaminando | ✅ Mitigado | Preguntas de estado SIEMPRE leen en vivo; «mira otra vez/acabo de editar» fuerza lectura fresca (P56). Prueba: un cambio hecho durante la sesión (5→6 vendidos) apareció al instante en el reader. |
| 8 | P56 solo probado con fixtures | ✅ Cerrado | `scripts/reconcile-portfolio.mjs` prueba contra el endpoint REAL desplegado con datos REALES. |
| 9 | No hay reconciliación | ✅ Cerrado | Mecanismo permanente: marcador de versión + script de reconciliación por workspace. |

## Cómo reconciliar en 1 minuto (operador)
```powershell
# ¿Qué versión ejecuta staging y qué ve el Asistente en cada workspace?
node scripts/reconcile-portfolio.mjs                                   # demo (Oier)
$env:WORKSPACE_ID="ffc49d1b-12ba-465f-8f5a-d43f5e473fe7"; node scripts/reconcile-portfolio.mjs  # gabriel
```
Comparar con la página Cartera **de esa misma cuenta**: totales y estados deben coincidir.

## Reglas operativas
1. **Probar el chat y la Cartera con LA MISMA cuenta** (el descuadre reportado venía de mezclar cuentas).
2. Tras un push, esperar ~5 min de auto-deploy; confirmar con `toolVersion` antes de dar QA por mala.
3. Dato del workspace real: la ciudad «Bilba» (San Pío X 7 n8) parece un typo del usuario — corregir en la UI si procede (no lo toco: es dato real de esa cuenta).
