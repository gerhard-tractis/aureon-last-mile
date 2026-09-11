# Distribución — las decisiones que sólo se pueden tomar en el mock

**Para:** quien mantiene `Distribucion.dc.html` en Claude Design (proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`).
**Fecha:** 2026-09-11.
**Contra qué se comparó:** los diez artboards `4a`–`4j` frente a QA (`qa.aureon.tractis.ai`) con `admin@musan.com`, en claro, a 1442 px y a 402 px, recorriendo el módulo entero: escritorio, modo rápido, home de la nave, pendientes, hoja de envío, consolidación, escaneo paso 1, paso 2, andén incorrecto, andenes y mover a posición.

**La dirección de este documento es la contraria a la de `mock-feedback-recogida.md`.** Allí se le contaba al diseño lo que la implementación había aprendido. Aquí el usuario fijó la regla al revés: **el mock manda y la app se corrige contra él**. Casi todo el diff ya es trabajo declarado y sale en `spec-96`.

Lo que sigue es **sólo lo que ese spec no puede tomar**: nueve puntos donde el mock contradice algo ya decidido con razón escrita, no dice nada, o dice algo que los datos desmienten. Ninguno se resuelve en código sin inventar diseño.

Cada punto dice si es (**1**) una decisión ya tomada en el código que el mock contradice, (**2**) una pantalla construida sin artboard que la gobierne, o (**3**) una ambigüedad del propio mock.

---

## 1 — La barra inferior del móvil `(1)`

El mock dibuja en `4c` una barra de cuatro pestañas **de módulo**: `Hoy · Clasificar · Andenes · Perfil`.

La app tiene una barra de cuatro pestañas **de aplicación**: `Recogida · Recepción · Distribución · Despacho` (`components/MobileTabBar.tsx`), y spec-68 Decisión 2 la declaró ganadora por escrito: «El mock dibuja la suya; la global gana, así que este componente no renderiza nada bajo la última sección».

Sólo una de las dos puede ocupar el borde inferior de un teléfono. La global es una invariante de rol — un usuario de operaciones siempre recibe exactamente esas cuatro — así que la del mock no es un añadido, es un reemplazo dentro de Distribución.

> Nota de método: en el recorrido de QA **no se vio ninguna de las dos**, porque el rol `admin` no recibe pestañas y cae al menú hamburguesa. La contraposición de arriba está leída del código, no de la pantalla.

**Qué hace falta del diseño:** decidir cuál manda dentro del módulo, y si la respuesta es «la del mock», qué pasa con la navegación entre los cuatro procesos de la nave mientras el operario está en Distribución.

---

## 2 — El turno y la nave en la cabecera `(1)`

Tres artboards lo piden, y es la misma pregunta tres veces:

| Artboard | Qué dibuja |
|---|---|
| `4a` | `6 andenes activos · 5 lotes abiertos · último cierre 11:40 · turno AM` |
| `4b` | `TURNO 08:00-16:00 · BODEGA PUDAHUEL` en la barra propia del modo rápido |
| `4c` | `Nave Quilicura · turno 14:00 · distribución` bajo el saludo |

spec-68 Decisión 9 lo quitó a propósito del móvil: «no "turno 14:00" en ninguna parte». `último cierre` sí existe y es condicional — no aparece en QA porque no ha habido cierres.

**Qué hace falta del diseño:** decidir si el turno y la nave pertenecen al cromo del módulo. Si la respuesta es sí, hace falta además de dónde sale el turno: hoy no hay ninguna noción de turno en el modelo, y `4a` («AM») y `4b` («08:00-16:00») lo escriben de dos formas distintas en el mismo mock.

---

## 3 — `URGENTES · HOY Y MAÑANA` describe mal su propia sección `(3)`

`4f` titula la primera sección `URGENTES · HOY Y MAÑANA`. La implementación la dejó en `URGENTES` a secas, y la razón está escrita en `ConsolidationMobileView.tsx`: la sección incluye **vencidos**, que llevan su propia etiqueta `AYER` en la fila. Un bulto con entrega vencida está en `URGENTES` y no es ni hoy ni mañana.

No es una simplificación: con el rótulo del mock, la sección afirma algo falso sobre una fila que está a la vista dentro de ella.

**Qué hace falta del diseño:** un rótulo que cubra los tres casos, o una cuarta sección para los vencidos. `PRÓXIMOS` no tiene calificador y funciona; probablemente `URGENTES` tampoco lo necesite.

---

## 4 — Cuatro pantallas construidas que ningún artboard gobierna `(2)`

Están en producción y no se pueden diferenciar contra el mock porque el mock no las dibuja. El spec de corrección las deja fuera por eso.

1. **Modo `ESTIBAR` / «Carga a posición»** — un segundo modo completo dentro del modo rápido, con su propio flujo de dos pasos y un `SELLAR POSICIÓN` (spec-71). Convive con `SECTORIZAR` en un par de pestañas que ni `4b` ni `4g` tienen dónde poner.
2. **`/mover-a-posicion`** — un cuarto proceso de la nave, con su propia fila en el home. `4c` dibuja tres.
3. **`/andenes`** — la pantalla que abre la fila `Andenes` de `4c`. Hoy es una lista pelada (código, nombre, conteo). `4c` promete `A3 al 94% de capacidad` y `4j` dibuja la barra de ocupación, así que el diseño de la fila existe pero el de la pantalla que abre, no.
4. **`Modo lote` (`/batch`)** — el escritorio pone este botón donde `4a` pone `Cerrar lotes del turno`. Son dos acciones distintas, no dos nombres de la misma.

**Qué hace falta del diseño:** un artboard por cada una, o la decisión explícita de retirarla. `ESTIBAR` es el más urgente: es el que obliga a meter pestañas en una pantalla que el mock diseñó sin ellas.

---

## 5 — `4j` no tiene estado equivalente en la app `(3)`

`4j` dibuja la clasificación en andén **después** de un escaneo correcto: la tarjeta de destino, la barra `Andén A3 169 / 180` con `Quedan 11 espacios · avisa al jefe de andén antes de llenarlo`, el aviso `Falta 1 paquete de esta orden`, y un pie con `Escanear siguiente` de primario.

El flujo real es de dos pasos y lo dice en su propia cabecera (`paso 1 de 2`, `paso 2 de 2`): tras confirmar el andén vuelve al paso 1 con el campo armado. No hay tercera pantalla, y `Escanear siguiente` no tiene dónde vivir — el escáner de QA es una pistola que teclea el código sin Enter, así que el campo ya está siempre enfocado y no hay gesto de «escanear» que pulsar (mismo hallazgo que `5d` en Recogida).

**Qué hace falta del diseño:** decir si `4j` es un tercer paso real, o si es `4h` después de un escaneo correcto — y en ese caso, qué reemplaza a `Escanear siguiente`.

---

## 6 — La lista de pendientes que el escritorio pone en el modo rápido `(3)`

Bajo la grilla de andenes de `4b`, la app renderiza la lista completa de pendientes por sectorizar, agrupada por andén y desplegada orden → bulto. Ocupa más pantalla que todo lo que `4b` dibuja junto.

`4b` está diseñado como una pantalla de alta densidad para escanear en andén: código grande, banner de confirmación, grilla y últimos escaneos. La lista no cabe en esa intención y tampoco está en el artboard.

**Qué hace falta del diseño:** decidir si `4b` la absorbe (y con qué jerarquía), o si se va a su propia pantalla de escritorio. Hoy no hay ninguna pantalla de escritorio para pendientes fuera del modo rápido.

---

## 7 — Las pestañas `SECTORIZAR / ESTIBAR` `(2)`

Consecuencia del punto 4, pero se anota aparte porque afecta a dos artboards a la vez: las pestañas se ven en `4b` (escritorio) y en `4g` (móvil), y en ambos casos empujan hacia abajo la tarjeta de escaneo, que es lo que el mock quiere dominante.

**Qué hace falta del diseño:** si `ESTIBAR` se queda, dónde va el conmutador sin robarle jerarquía al campo de escaneo.

---

## 8 — `ConsolidationPanel` a ancho completo en `4a` `(2)`

El escritorio pone, bajo la grilla y el rail derecho, un panel de consolidación a ancho completo con su propia lista y su acción de liberar. `4a` no lo dibuja: allí la consolidación aparece sólo como `CO` dentro de la grilla de `4b`.

Está construido y en uso, y tiene una razón escrita en `page.tsx` (cada fila lleva etiqueta, fecha y acción, que se parten en tres líneas dentro de una columna de 320 px).

**Qué hace falta del diseño:** ubicarlo en `4a`, o decidir que la consolidación de escritorio vive en otra pantalla.

---

## 9 — Dos cosas distintas se llaman casi igual `(3)`

En el escritorio, el StatTile `EXCEPCIONES DE ANDÉN` cuenta lo que devuelve `get_unmatched_comunas`: comunas cuyo texto crudo **no resuelve a ningún registro de comuna**.

En el móvil, la cabecera `SIN ANDÉN` de `4d` cuenta órdenes cuya comuna **sí resuelve, pero ningún andén la cubre**.

Son dos predicados distintos con nombres que se pisan. El día del recorrido, QA mostraba `EXCEPCIONES DE ANDÉN 0` en el escritorio y `SIN ANDÉN · 22 pendientes` en el móvil, a la vez y sin contradicción. Un jefe de nave que mire las dos pantallas concluirá que una de ellas está rota.

Además, el panel `Excepciones de andén` de `4a` tipifica tres casos — `Destino no reconocido`, `Orden incompleta`, `Zona incorrecta` — y sólo el primero se corresponde con lo que hoy cuenta el StatTile.

**Qué hace falta del diseño:** nombres que no se pisen, y la definición de los tres tipos del panel de `4a` — cuál es cada uno en términos de lo que la app puede saber. Sin eso el panel no se puede construir sin inventar la taxonomía.

---

## Lo que NO está en esta lista

Todo lo demás del diff — unas cuarenta y cinco diferencias entre `4a`–`4i` y lo que hay en QA — **no necesita decisión de diseño**: el mock dibuja algo concreto, la app no lo tiene, y la corrección es mecánica. Vive en `docs/specs/spec-96-distribucion-correccion-contra-el-mock.md`, en siete fases, y cada fase excluye explícitamente el punto de esta lista que toca su pantalla, para que las dos rondas no colisionen.

Dos aclaraciones que ahorran un falso hallazgo a quien lea el diff:

- **La capacidad de andén ya está construida** en la hoja de envío de `4e`, en el paso 2 del escaneo y en `/andenes`. No se ve en QA porque las dos zonas de QA tienen `capacity` sin configurar, y `dock-capacity.ts` prefiere no dibujar barra antes que dibujar una clavada en 0 %. Lo único sin cablear es la grilla del escritorio (`4a`) y el `169 / 180` de la tarjeta de `4b`.
- **Las comunas bajo el código de andén en `4b` también están construidas.** La lista está vacía en el fixture de QA.

## Cómo se refresca este documento

Se compara contra la copia versionada del mock (`docs/design/Distribucion.dc.html`), no contra el proyecto remoto. Si el diseño cambia, primero se vuelve a bajar el fichero (ver `docs/design/README.md`) y después se revisa éste. Un punto resuelto se borra; no se marca como hecho.
