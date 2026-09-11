# Distribución — lo que queda abierto para el diseño

**Para:** quien mantiene `Distribucion.dc.html` en Claude Design (proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`).
**Última revisión:** 2026-09-11, tras la ronda 2 del diseño.

La regla de este módulo la fijó el usuario y no ha cambiado: **el mock manda y la app se corrige contra él.** La corrección vive en `docs/specs/spec-96-distribucion-correccion-contra-el-mock.md`, y su criterio de aceptación es el propio `docs/design/Distribucion.dc.html` — trece artboards, `4a`–`4m`.

Este fichero sólo guarda **lo que el mock todavía no puede gobernar**. La primera versión traía nueve puntos; la ronda 2 los cerró todos menos uno. Los cerrados se borraron, que es la regla de esta casa: un punto resuelto no se marca como hecho, desaparece. Lo que el diseño contestó queda registrado en la tabla de spec-96, no aquí.

---

## 1 — La pantalla detrás de `Cerrar lotes`

`4a` pone un botón `Cerrar lotes` en la cabecera del escritorio. Ningún artboard dibuja lo que abre.

La app tiene hoy `Modo lote` en ese mismo lugar, que lleva a `/batch` — una pantalla construida y en uso (`BatchOverview`, `BatchScanner`, `BatchDetailList`, `BatchConfirmation`) con su propio flujo de escaneo por lote. `Cerrar lotes` y `Modo lote` no son dos nombres de la misma acción: uno cierra los lotes abiertos del día, el otro abre un modo de trabajo.

Mientras no haya artboard, `spec-96` deja `/batch` fuera de todas sus fases: no se puede diferenciar contra un dibujo que no existe, y renombrar el botón sin saber a dónde lleva empeoraría la pantalla en vez de arreglarla.

**Qué hace falta del diseño, en este orden:**

1. Decir si `Cerrar lotes` y `Modo lote` son la misma acción. Si lo son, cuál de las dos intenciones gana.
2. Si son distintas, dónde vive cada una en `4a` — hoy hay un solo botón para las dos.
3. Un artboard para la pantalla de lote, sea cual sea el nombre que quede.

---

## Cómo se refresca este documento

Se compara contra la copia versionada del mock (`docs/design/Distribucion.dc.html`), no contra el proyecto remoto. Si el diseño cambia, primero se vuelve a bajar el fichero (ver `docs/design/README.md`) y después se revisa éste. Un punto resuelto se borra; no se marca como hecho. Si se vacía del todo, se borra el fichero.
