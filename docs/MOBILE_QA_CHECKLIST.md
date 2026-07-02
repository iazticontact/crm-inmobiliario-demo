# Checklist de QA móvil

> Probar en **iPhone Safari (~390px)** y **Android Chrome (~360px)**. Marca cada punto. Ante cualquier
> problema: captura de pantalla + dispositivo/navegador + qué hacías.

## Reglas generales (aplican a todas las pantallas)
- [ ] Los campos de texto **no hacen zoom** al tocarlos (inputs ≥ 16px).
- [ ] No hay **scroll horizontal** accidental en ninguna pantalla.
- [ ] Los botones de acción son accesibles (no quedan tapados por el teclado).
- [ ] El menú lateral (**drawer**) se abre y cierra con normalidad y bloquea el scroll del fondo.

## Login
- [ ] Formulario centrado, sin corte; botón «Entrar» visible sin hacer zoom.

## Dashboard
- [ ] KPIs en cuadrícula, sin solaparse; drawer accesible desde el icono de menú.

## Clientes / ficha de cliente
- [ ] Listado y buscador usables con una mano.
- [ ] Pestañas de la ficha **scrollables** en horizontal (no se cortan).
- [ ] Pestaña **Documentos**: subir, listar, **descargar** y borrar funcionan.

## Cartera / inmueble
- [ ] Inmuebles como **tarjetas** (no tabla apretada); precios y medidas legibles.
- [ ] Subir un documento del inmueble funciona.

## Calendario
- [ ] Agenda / próximas citas legibles.
- [ ] Al crear/editar una cita, el **teclado no tapa** el botón de guardar.

## Asistente
- [ ] Campo de entrada 16px (sin zoom); el teclado no oculta el chat.
- [ ] «busco un piso entre 200 y 250 mil» → devuelve resultados coherentes.
- [ ] Generar informe PDF → el enlace **abre/descarga** el PDF.

## Facturación
- [ ] **Crear con texto**: el textarea y el botón «Generar» son usables.
- [ ] **Dictado (audio)**: si el navegador lo soporta, funciona; si no, aparece el aviso de fallback.
- [ ] **Editor** en móvil: alterna **Editar / Vista previa** (no muestra dos paneles a la vez).
- [ ] **Inputs numéricos** (cantidad, precio, Dto., IVA, IRPF): se puede **borrar el 0** y escribir libremente;
      teclado numérico/decimal; al salir del campo vacío vuelve a 0.
- [ ] **Selector de moneda**: se abre y se busca (EUR por defecto); si eliges USD aparece el tipo de cambio.
- [ ] **Checklist pre-emisión** y **modales** (papelera / eliminar definitivamente) caben en pantalla y son usables.
- [ ] **Descargar PDF** desde móvil funciona (se abre/descarga).
- [ ] **Resumen financiero**: KPIs y gráficos sin overflow; el selector de periodo funciona.

## Configuración
- [ ] Formularios de empresa/datos fiscales usables; subir **logo** funciona.

---

### Notas de implementación (para referencia técnica)
- Las alturas de paneles/modales usan `clamp()`/`calc(100vh - …)` acotado (no `h-screen`), por lo que no
  rompen en móvil.
- El editor de factura usa un input decimal propio (`DecimalInput`, `type="text"` + `inputMode="decimal"`)
  para permitir borrar/escribir con libertad y usar coma o punto, sin auto-zoom.
- Pestañas y filtros usan `overflow-x-auto` para desplazarse en pantallas estrechas.
