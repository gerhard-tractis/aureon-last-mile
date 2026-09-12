# Distribución — lo que queda abierto para el diseño

**Para:** quien mantiene `Distribucion.dc.html` en Claude Design (proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`).
**Última revisión:** 2026-09-12, con seis fases de `spec-96` implementadas y mergeadas (0, 1, 2, 3, 4, 8).

La regla del módulo la fijó el usuario y no ha cambiado: **el mock manda y la app se corrige contra él.** La corrección vive en `docs/specs/spec-96-distribucion-correccion-contra-el-mock.md`, y su criterio de aceptación es el propio `Distribucion.dc.html` — trece artboards, `4a`–`4m`.

Este fichero guarda **sólo lo que el mock todavía no puede gobernar**. La primera versión traía nueve puntos y la ronda 2 del diseño cerró ocho. Construir las seis fases contra los artboards levantó cinco nuevos, y **dos son contradicciones internas del propio mock**: cuando el benchmark se contradice no puede arbitrar, así que hubo que decidir provisionalmente y dejar la decisión escrita con su consecuencia. Un punto resuelto se borra; no se marca como hecho.

---

## 1 — La pantalla detrás de `Cerrar lotes`

`4a` pone un botón `Cerrar lotes` en la cabecera del escritorio. Ningún artboard dibuja lo que abre.

La app tiene hoy `Modo lote` en ese mismo sitio, que lleva a `/batch` — una pantalla construida y en uso (`BatchOverview`, `BatchScanner`, `BatchDetailList`, `BatchConfirmation`) con su propio flujo de escaneo por lote. `Cerrar lotes` y `Modo lote` no son dos nombres de la misma acción: uno cierra los lotes abiertos del día, el otro abre un modo de trabajo.

La fase 4 dejó el botón como estaba y lo declaró, en vez de renombrarlo sin saber a dónde lleva.

**Qué hace falta:** decir si son la misma acción; si no, dónde vive cada una en `4a` (hoy hay un solo botón); y un artboard para la pantalla de lote.

---

## 2 — `SIN ABRIR` significa dos cosas distintas en `4a` y en `4l`

Contradicción interna, no omisión.

| Artboard | Qué dibuja | Qué implica |
|---|---|---|
| `4a:243-252` (A6) | chip `SIN ABRIR`, **`0 / 120 paq.`** — capacidad **configurada** — pie `lote sin abrir`, acción `Abrir` | `SIN ABRIR` = no hay lote abierto → **actividad** |
| `4l:1230-1241` (A6) | chip `SIN ABRIR`, subtítulo `sin capacidad configurada`, `0 bultos`, `sin barra hasta configurar` | la fila no tiene señal de lote; lo único que la distingue es **capacidad sin configurar** |

Las dos lecturas son incompatibles y las dos están dibujadas.

**Decisión provisional (orquestador, 2026-09-12):** `SIN ABRIR` = sin lote abierto, la lectura de `4a`. Razón: la fase 4 ya implementó esa derivación en el escritorio, y la misma etiqueta significando condiciones distintas en móvil y escritorio es peor que una fila sin chip.

**Consecuencia declarada:** la fila sin capacidad de `4l` **no lleva chip**, aunque `4l:1236` lo dibuja. Queda escrito como desviación del benchmark en la evidencia de la fase 8, citando la línea.

**Qué hace falta:** decidir qué mide `SIN ABRIR`. Si es capacidad, el estado de actividad de `4a` necesita otro nombre; si es actividad, A6 de `4l` necesita otro chip o ninguno. Contestar al revés cuesta una línea de código.

---

## 3 — El pill `Lotes abiertos` de `4a` esconde una tile que `4a` dibuja

Segunda contradicción interna.

`4a:181` da a `Lotes abiertos` el idioma de «seleccionado» de este mismo documento — `background:var(--raised)`, `color:var(--text)`, `font:600` — y `4a:182` deja `Todas` sin fondo, `--text-2`, `font:500`. Es el idioma que usan el conmutador `Sectorizar`/`Estibar` de `4b` y el `Claro`/`Oscuro` de la cabecera.

Pero la rejilla dibujada incluye **A6** (`4a:243-252`), cuyo pie dice literalmente `lote sin abrir` — una tile que ese filtro esconde. Y probablemente **A4** (`4a:221-230`), que tampoco muestra señal de lote abierto.

**Decisión provisional:** default `Todas`. No por la razón obvia («el mock dibuja seis tiles», débil: la rejilla también es el catálogo de los cuatro chips), sino por una operativa: **la única acción `Abrir` del módulo vive exclusivamente en las tiles que `Lotes abiertos` esconde.** Arrancar en ese filtro hace invisible un andén sin abrir justo cuando hay que abrirlo, y pone fuera de alcance la acción que satisfaría el predicado del propio filtro.

**Pregunta de fondo:** el chip y el filtro miden ejes distintos. La derivación da precedencia a capacidad, así que un andén a 168/180 con su lote ya cerrado muestra `CASI LLENO` y el filtro `open` lo esconde igual — la tile más urgente desaparece sin explicación, y dos tiles con el mismo chip quedan una visible y otra no.

**Qué hace falta:** el default, y si el eje del filtro debe ser el del chip.

---

## 4 — `4d` no dibuja el modo selección, y `4f` contesta casi todo

`4d` dibuja los controles `DET`/`CMP` y `SEL` pero **ningún estado de selección**: ni dónde va el contador, ni dónde vive la confirmación, ni cómo se ve una fila marcada.

La mayor parte estaba contestada a un artboard de distancia: **`4f` es el modo selección dibujado de este mismo módulo** (`Distribucion.dc.html:804-811`) — contador `N SELECCIONADOS`, acción primaria, **y una fila secundaria**, con la casilla de 22 px **delante** de cada fila. La fase 2 acabó tomando esa forma, y al hacerlo cerró dos callejones que había abierto antes: una barra de confirmación flotante que quedaba **bajo** el footer fijo (inalcanzable en cualquier lista que scrollee), y un footer que al seleccionar desmontaba la única salida del modo — la fila secundaria de `4f` es precisamente esa salida.

Quedan tres preguntas acotadas que `4f` no responde para `4d`:

1. En modo `SEL`, ¿`Escanear` sigue en el footer junto a la confirmación, o el footer se sustituye entero? `4f` no tiene `Escanear`.
2. ¿Qué pasa con el conmutador `DET`/`CMP` mientras se selecciona? `4f` no tiene equivalente.
3. ¿La fila marcada lleva el tratamiento de casilla llena de `4f` cuando está en la paleta de aviso de `SIN ANDÉN`? `4f:761` dibuja casilla marcada sobre fondo warn; el `⋯` de `4d` en esa fila es `--warn-text`.

**Qué hace falta:** esas tres. No un artboard nuevo.

---

## 5 — `Resolver incidencias` no tiene destino, y no todos sus tipos caen donde el botón lleva

El pie del panel `Incidencias de sectorización` de `4a` es un `<span>` sin `href`. La fase 4 lo llevó a `/app/distribution/settings`, correcto para la primera fila —`Comuna no reconocida` se arregla mapeando alias y esa UI vive ahí— y **equivocado para la segunda**: `Sin andén asignado` («la comuna resuelve pero ningún andén la cubre») se resuelve editando la lista de comunas de un andén, y las órdenes afectadas se ven en `/app/distribution/pendientes` (`4d`/`4m`), que es donde iría un jefe de nave a actuar.

**Qué hace falta:** un destino para el pie, o confirmar que la acción es **por fila** en vez de una sola para las tres.

---

## Lo que ya no está en esta lista

Cerrado por la ronda 2 y ya implementado: la barra de pestañas, el turno en la cabecera, el rótulo `URGENTES`, `ESTIBAR`/«Mover a posición» (`4k`), `/andenes` (`4l`), los pendientes de escritorio (`4m`), el sitio del conmutador `SECT`/`ESTIB`, `ConsolidationPanel` en `4a`, y los nombres que se pisaban (`COMUNAS NO RECONOCIDAS` + `Incidencias de sectorización` con sus tres tipos definidos).

Ese último desatascó el trabajo más grande, y conviene saber por qué: sin los tres tipos definidos, el panel no se podía construir sin inventar la taxonomía — y **su ausencia ya había producido un bug real**. Un banner etiquetado «sin andén asignado» contaba `get_unmatched_comunas`, cuyo predicado (`comuna_id IS NULL`) es el **complemento exacto** del que el rótulo nombra (`comuna_id IS NOT NULL` y sin andén que la cubra). Solapamiento cero: no podía mostrar un solo caso de lo que decía, en ningún dataset. En QA eso eran 0 contra 22 — silencio mientras 22 bultos caían a consolidación. La distinción que hiciste en la ronda 2 es lo que lo hizo visible.

Dos artboards siguen sin implementar y sin preguntas abiertas: `4k` (fase 7) y `4m` (fase 9).

## Cómo se refresca este documento

Se compara contra la copia versionada del mock (`docs/design/Distribucion.dc.html` en el repo), no contra el proyecto remoto. Si el diseño cambia, primero se vuelve a bajar el fichero (ver `docs/design/README.md`) y después se revisa éste. Un punto resuelto se borra; no se marca como hecho. Si se vacía del todo, se borra el fichero.
