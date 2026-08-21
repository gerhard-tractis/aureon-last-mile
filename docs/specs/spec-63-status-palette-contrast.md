# Spec-63: Contraste no textual de la paleta de estado

> **Related:** [spec-54](spec-54-ui-rebrand.md) (define la paleta y la regla de dos canales), [spec-62](spec-62-reception-mobile.md) (donde se detectó)

**Status:** backlog

_Date: 2026-08-21_

---

## Goal

Llevar los chips de estado —los cuadros de color que llevan un glifo blanco— por
encima del 3:1 que exige WCAG 1.4.11 para elementos no textuales, sin romper la
identidad de la paleta ni la regla de dos canales.

## El hallazgo

Detectado revisando el tono `warn` del bloque de resultado de escaneo en spec-62
(fase 1, task 2). Las mediciones, glifo blanco sobre el color sólido del chip:

| Token | Valor | Contraste con blanco | WCAG 1.4.11 (3:1) |
|---|---|---|---|
| `--color-status-warning` | `#f59e0b` | ~2.15:1 | ❌ |
| `--color-status-success` | `#10b981` | ~2.56:1 | ❌ |
| `--color-status-error` | `#ef4444` | ~3.9:1 | ✅ |

Ninguno lo introdujo spec-62: success y error ya estaban desplegados. El tono
`warn` es nuevo, y quedó como el peor de los tres.

## Por qué importa más que un número de auditoría

La regla de diseño de spec-54 dice que **cada estado se codifica por dos canales,
color y forma**, para que sobreviva a la visión daltónica y a una foto en escala
de grises. El glifo *es* el segundo canal. Un glifo que no contrasta con su
propio fondo degrada el canal del que depende toda la regla: en un andén, con
luz de galpón y una pantalla con reflejo, el operario se queda solo con el color
— exactamente lo que la regla existía para evitar.

## Alcance

- Los tres pares de `--color-status-*` en `globals.css` (claro y oscuro).
- Todo consumidor del chip sólido con glifo blanco: `ScanResult`, `StatusBadge`,
  las tarjetas de andén, los badges de la torre, y los que aparezcan al auditar.

Dos caminos posibles, a decidir al abrir el spec:

1. **Oscurecer los tokens sólidos** hasta pasar 3:1 con blanco. Cambia el color
   de marca de los estados en todas las pantallas.
2. **Cambiar el glifo** a la variante `-text` sobre el fondo `-bg` claro, en vez
   de blanco sobre el sólido. Menos invasivo en la paleta, pero cambia la forma
   del chip.

La opción 2 probablemente sea la correcta, porque conserva los colores que el
equipo ya reconoce; hay que verificarla contra los mocks antes de decidir.

## No-goals

- No es un rediseño de la paleta ni una revisión de los colores de marca.
- No toca el contraste de **texto** (1.4.3), que es una auditoría distinta.

## Por qué no se arregló en spec-62

Es un cambio transversal: torre, distribución, despacho, recogida y recepción
consumen los mismos tokens. Metido en un PR de recepción móvil habría hecho
irrevisable tanto el cambio de diseño como la pantalla, y habría mezclado dos
motivos de reversión en un solo commit.
