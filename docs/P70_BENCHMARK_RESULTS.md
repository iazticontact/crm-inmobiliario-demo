# P70 — Resultados del benchmark de release

- Versión: 1.0.0 · Seed: `p70-release-2026-07-15` · Fecha: 2026-07-15T23:25Z
- Escenarios: **926** (training 676 · **held-out 250**)
- Volumen contractual: multi-turn 204/≥200 · adversarial 121/≥120 · errores lingüísticos 121/≥120 · temporal 76/≥75 · acciones 104/≥100 · automatizaciones 82/≥75
- **Global: 100.00%** · Training: 100.00% · **Held-out: 100.00%**

## Gates (obligatorio 100%)

| Gate | Escenarios | Resultado |
|---|---|---|
| security | 121 | ✅ 100% |
| workspace | 1 | ✅ 100% |
| invoicing | 11 | ✅ 100% |
| confirmation | 287 | ✅ 100% |
| optin | 76 | ✅ 100% |
| temporal | 76 | ✅ 100% |
| regression | 12 | ✅ 100% |
| grounding | 88 | ✅ 100% |

## Por categoría

| Categoría | N | Accuracy |
|---|---|---|
| acciones | 104 | 100.0% |
| adversarial | 105 | 100.0% |
| agenda | 30 | 100.0% |
| automatizaciones | 82 | 100.0% |
| cambios-de-tema | 6 | 100.0% |
| cancelacion | 16 | 100.0% |
| cartera | 30 | 100.0% |
| clientes | 30 | 100.0% |
| coloquial | 5 | 100.0% |
| confirmacion | 10 | 100.0% |
| empty | 4 | 100.0% |
| errores-linguisticos | 121 | 100.0% |
| explicabilidad | 2 | 100.0% |
| facturacion | 11 | 100.0% |
| findings | 2 | 100.0% |
| multi-turn | 169 | 100.0% |
| multimodulo | 1 | 100.0% |
| negaciones | 3 | 100.0% |
| operaciones | 40 | 100.0% |
| producto | 12 | 100.0% |
| pronombres | 1 | 100.0% |
| referencias | 3 | 100.0% |
| regresiones | 12 | 100.0% |
| resumen | 15 | 100.0% |
| seguridad | 16 | 100.0% |
| temporal | 76 | 100.0% |
| tramites-docs | 20 | 100.0% |

## Fallos (0)

(ninguno)

## Metodología

Generador de familias (plantillas × entidades × transformaciones sembradas), expectativas por CLASE de
comportamiento, evaluación contra el motor real con lecturas vivas (workspace demo) y workspace vacío
sintético. Held-out por hash sembrado del id: prohibido usarlo para fixes caso a caso (los fixes deben
ser de clase). Los ciclos de ESCRITURA completos se validan en las suites E2E (action catalog 46/46,
automation catalog 33/33, scheduler chaos 32/32, Playwright 14/14); aquí se validan los invariantes de
no-escritura y el enrutado.
