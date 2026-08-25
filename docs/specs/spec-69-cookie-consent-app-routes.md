# Spec-69: El banner de cookies tapa la barra de acciones móvil

> **Related:** [spec-62](spec-62-reception-mobile.md) (donde se detectó), [spec-61](spec-61-pickup-route-crew.md) (rutas `/app/*`)

**Status:** backlog

_Date: 2026-08-25_

---

## Goal

Que el banner de consentimiento deje de cubrir los controles primarios de las
pantallas móviles de operación, sin perder la cobertura legal que el banner
existe para dar.

## El hallazgo

`apps/frontend/src/components/Cookies.tsx` se ancla al borde inferior de la
ventana:

```
fixed bottom-0 left-0 right-0 … z-50
```

y está montado en el layout **raíz** (`apps/frontend/src/app/layout.tsx`), así
que se renderiza en **todas** las rutas — incluida la app de operación en
`/app/*`, no sólo las páginas públicas. Aparece con un `setTimeout` de 1 s
cuando no existe la cookie de consentimiento.

La barra de pestañas móvil se ancla al mismo borde, pero más abajo en la pila:

```
fixed inset-x-0 bottom-0 z-30 h-[var(--mobile-tabbar-h)]   (MobileTabBar.tsx:50)
```

`z-50` contra `z-30`: en un teléfono el banner queda **encima** de la barra de
pestañas y, en Recepción, encima de los botones de acción del pie — “Escanear
QR” y “Recibir sin QR” (spec-62 3i). Son los controles primarios de la
pantalla, y caen exactamente donde aterriza el banner.

## Por qué importa

El operario en el andén, con guantes y un teléfono con reflejo, apunta al botón
grande de abajo. Durante el primer segundo largo de su sesión ese botón está
tapado por un banner que no espera y que, en un dispositivo recién entregado o
tras limpiar los datos del sitio, vuelve a aparecer.

No hay reportes de terreno porque **los dispositivos de QA ya tienen la cookie
puesta**: el problema es invisible justo para quienes lo probarían.

## Cómo se detectó

En el E2E móvil de spec-62. El helper de `signIn` pulsa “Aceptar”, pero el
banner sale con 1 s de retraso, así que el clic corría contra el temporizador y
los clics posteriores sobre la barra de acciones impactaban en el banner.

Se resolvió con `suppressCookieBanner()` (`e2e/support/spec52-fixture.ts`), que
escribe la cookie de consentimiento antes de cargar la página. **Eso arregla el
test, no el producto**: el operario real sigue viendo el solape.

## La decisión abierta (es del usuario, no técnica)

Es una cuestión de cumplimiento antes que de estilos. Tres caminos:

1. **No renderizar el banner en `/app/*`.** La app de operación es una
   herramienta interna autenticada, no web pública; el consentimiento
   posiblemente no aplique ahí. Elimina el choque de raíz en vez de negociar
   `z-index` para siempre. Requiere confirmar la postura legal y qué cookies se
   fijan realmente en esas rutas.
2. **Mantenerlo y reordenar la pila:** subir la barra de pestañas por encima
   del banner e insetar el banner para que no cubra la barra de acciones.
   Conserva la cobertura, pero deja dos elementos disputándose el borde inferior.
3. **Mantenerlo en todas partes pero no bloqueante:** en móvil, una franja
   compacta arriba en lugar de una hoja abajo.

**Recomendación:** la opción 1, si la posición legal lo permite. Las otras dos
conservan el conflicto y lo administran.

> Sin esa decisión no se puede escribir el plan: cada camino toca archivos
> distintos (montaje del layout vs. tokens de `z-index` vs. rediseño del banner).

## Alcance

- `apps/frontend/src/components/Cookies.tsx`
- `apps/frontend/src/app/layout.tsx` (punto de montaje)
- `apps/frontend/src/components/MobileTabBar.tsx` (sólo si se elige la opción 2)
- Retirar `suppressCookieBanner()` del E2E **sólo** si la opción elegida hace que
  el banner ya no aparezca en `/app/*`; si sigue apareciendo, el helper sigue
  siendo legítimo.

## No-goals

- No es una auditoría de qué cookies fija la aplicación ni de su base legal.
- No toca el consentimiento en las páginas públicas.
- No cambia el diseño visual del banner salvo que se elija la opción 3.

## Verificación

El caso que hay que reproducir es el del **dispositivo limpio**, porque es el
único en el que el bug existe:

1. Perfil nuevo o datos del sitio borrados (la cookie de consentimiento ausente).
2. Entrar como `ops_leader` en un viewport de teléfono (390×844).
3. Ir a `/app/reception`.
4. Durante los primeros ~2 s, comprobar que “Escanear QR” es pulsable y que
   nada lo cubre.

Un test que no borre la cookie primero pasa siempre y no prueba nada.
