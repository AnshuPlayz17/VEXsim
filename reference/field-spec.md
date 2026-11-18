# Override field spec (VEXsim)

> Generated from the simulator's field data by `npm run reference`. Don't edit by hand. Each value names its source; **assumption** marks values VEXsim had to choose. The official game manual always wins.

![Starting layout](diagrams/starting-layout.svg)

## Coordinates
Origin at the field center. **+x** points toward the blue Alliance Station (East wall); red stands on the West wall. **+z** points toward the South wall. Diagrams put North at the top. Values are in inches, with meters in `field-spec.json`.

## Field
- 12 ft × 12 ft, made of 36 foam tiles (6 × 6, 24″ each)
- Tape: two corner-to-corner diagonals make the four Quadrants (N, E, S, W); the Midfield is a 48″ diamond with a center cross
- Counts: 63 Pins (20 red/yellow, 20 blue/yellow, 19 yellow/yellow, 4 red/blue), 56 Cups, 9 Goals, 4 Toggles, 4 Loaders *(game manual)*

## Goals
| Goal | Kind | Quadrant | x″ | z″ | Height″ |
| --- | --- | --- | --- | --- | --- |
| center | tall | Midfield | 0 | 0 | 8.77 |
| N-short | short | N | -23.62 | -47.24 | 5.77 |
| N-blue | alliance (blue) | N | 23.62 | -47.24 | 3.25 |
| E-blue | alliance (blue) | E | 47.24 | -23.62 | 3.25 |
| E-short | short | E | 47.24 | 23.62 | 5.77 |
| S-short | short | S | 23.62 | 47.24 | 5.77 |
| S-red | alliance (red) | S | -23.62 | 47.24 | 3.25 |
| W-red | alliance (red) | W | -47.24 | 23.62 | 3.25 |
| W-short | short | W | -47.24 | -23.62 | 5.77 |

Chamfered-square footprint, 5.61″ across the flats, tapering to 3.49″ at the top.

## Toggles
| Quadrant | x″ | z″ | Length″ |
| --- | --- | --- | --- |
| N | 0 | -70.08 | 25.83 |
| E | 70.08 | 0 | 25.83 |
| S | 0 | 70.08 | 25.83 |
| W | -70.08 | 0 | 25.83 |

Three faces (yellow neutral, red, blue). A Toggle counts only when set to a color and not touched by any Robot. ![Toggle](diagrams/toggle.svg)

## Loaders
| Alliance | x″ | z″ |
| --- | --- | --- |
| red | -68.5 | -58.66 |
| red | -68.5 | 58.66 |
| blue | 68.5 | -58.66 |
| blue | 68.5 | 58.66 |

## Game elements
![Elements](diagrams/elements.svg)

- **Pin:** 6.5″ long, hexagonal and symmetric (3.16″ across the collar's corners, 3.02″ across the flats). Each end is a 2.35″ tip, so either end nests into a Goal or Cup. Each half scores separately.
- **Cup:** 6.48″ tall, 3.16″ across the top, 2.32″ at the waist; clear lower half, opaque upper half. A Pin half inside the opaque half doesn't score.
- **Goals:** chamfered square, 5.61 in across the flats, 3.22 in center to corner; every Goal is topped by the same 3.25 in tapered module: 0.39 in flange, tapering to 3.49 in across, 2.37 in hole, code marker 1.49 in up. neutral Goals black with yellow line art; Alliance Goals red or blue.
- **Stacking:** the Pin’s 0.64 in tip drops into the Goal hole; a Cup’s clear lower half slides over the Pin and rests on its center collar; the next Pin’s tip sits at the Cup’s waist, inside its opaque upper half (that half is hidden, SC3).

## Match Loads and Preloads
- **Match:** 10 Cups + 10 alliance-color Pins + 1 yellow/yellow Pin per alliance *(game manual summary; order of release is an assumption)*
- **Skills:** 3 red/yellow Pins, 4 blue/yellow Pins and 7 Cups begin off the field as Match Loads *(game manual (Skills), as quoted)*
- **Preload:** 1 alliance-color Pin per robot

## Starting layout
20 elements come from the official VEXcode VR layout. The rest (36 Pins and 36 Cups on the field in total, plus 1 yellow Pin on the Tall Goal) are **filled in symmetrically by VEXsim (assumption)**. Replace them in `startingLayout()` in `src/games/override/game.ts` once checked against the manual, then run `npm run reference`.

| Element | Colors (tapered / flat) | x″ | z″ | Source |
| --- | --- | --- | --- | --- |
| Pin | red / yellow | -23.62 | -68.7 | official |
| Pin | blue / yellow | 23.62 | 68.7 | official |
| Pin | red / yellow | -68.7 | -23.62 | official |
| Pin | blue / yellow | 68.7 | 23.62 | official |
| Pin | blue / yellow | 23.62 | -68.7 | official |
| Pin | red / yellow | -23.62 | 68.7 | official |
| Pin | blue / yellow | 68.7 | -23.62 | official |
| Pin | red / yellow | -68.7 | 23.62 | official |
| Pin | yellow / yellow | 0 | -23.62 | official |
| Pin | yellow / yellow | 0 | 23.62 | official |
| Pin | red / blue | -23.62 | 0 | official |
| Pin | blue / red | 23.62 | 0 | official |
| Pin | red / yellow | -35.43 | -35.43 | filled |
| Pin | blue / yellow | 35.43 | 35.43 | filled |
| Pin | red / yellow | -23.62 | -11.81 | filled |
| Pin | blue / yellow | 23.62 | 11.81 | filled |
| Pin | blue / yellow | -35.43 | -47.24 | filled |
| Pin | red / yellow | 35.43 | 47.24 | filled |
| Pin | blue / yellow | -11.81 | 23.62 | filled |
| Pin | red / yellow | 11.81 | -23.62 | filled |
| Pin | yellow / yellow | -35.43 | -23.62 | filled |
| Pin | yellow / yellow | 35.43 | 23.62 | filled |
| Pin | yellow / yellow | -11.81 | -47.24 | filled |
| Pin | yellow / yellow | 11.81 | 47.24 | filled |
| Pin | yellow / yellow | -23.62 | 35.43 | filled |
| Pin | yellow / yellow | 23.62 | -35.43 | filled |
| Pin | yellow / yellow | -47.24 | -59.06 | filled |
| Pin | yellow / yellow | 47.24 | 59.06 | filled |
| Pin | yellow / yellow | -47.24 | 59.06 | filled |
| Pin | yellow / yellow | 47.24 | -59.06 | filled |
| Pin | yellow / yellow | -11.81 | -23.62 | filled |
| Pin | yellow / yellow | 11.81 | 23.62 | filled |
| Pin | yellow / yellow | -11.81 | -11.81 | filled |
| Pin | yellow / yellow | 11.81 | 11.81 | filled |
| Pin | red / blue | 0 | -35.43 | filled |
| Pin | blue / red | 0 | 35.43 | filled |
| Cup | — | -47.24 | -47.24 | official |
| Cup | — | 47.24 | 47.24 | official |
| Cup | — | 47.24 | -47.24 | official |
| Cup | — | -47.24 | 47.24 | official |
| Cup | — | -23.62 | -23.62 | official |
| Cup | — | 23.62 | 23.62 | official |
| Cup | — | 23.62 | -23.62 | official |
| Cup | — | -23.62 | 23.62 | official |
| Cup | — | -47.24 | 11.81 | filled |
| Cup | — | 47.24 | -11.81 | filled |
| Cup | — | -35.43 | 11.81 | filled |
| Cup | — | 35.43 | -11.81 | filled |
| Cup | — | -59.06 | -23.62 | filled |
| Cup | — | 59.06 | 23.62 | filled |
| Cup | — | -23.62 | 59.06 | filled |
| Cup | — | 23.62 | -59.06 | filled |
| Cup | — | -35.43 | 59.06 | filled |
| Cup | — | 35.43 | -59.06 | filled |
| Cup | — | -11.81 | 47.24 | filled |
| Cup | — | 11.81 | -47.24 | filled |
| Cup | — | -35.43 | 0 | filled |
| Cup | — | 35.43 | 0 | filled |
| Cup | — | -47.24 | -11.81 | filled |
| Cup | — | 47.24 | 11.81 | filled |
| Cup | — | -11.81 | -35.43 | filled |
| Cup | — | 11.81 | 35.43 | filled |
| Cup | — | -47.24 | 0 | filled |
| Cup | — | 47.24 | 0 | filled |
| Cup | — | -35.43 | 35.43 | filled |
| Cup | — | 35.43 | -35.43 | filled |
| Cup | — | -35.43 | 23.62 | filled |
| Cup | — | 35.43 | -23.62 | filled |
| Cup | — | -11.81 | 0 | filled |
| Cup | — | 11.81 | 0 | filled |
| Cup | — | 0 | -47.24 | filled |
| Cup | — | 0 | 47.24 | filled |
