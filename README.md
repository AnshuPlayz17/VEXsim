# VEXsim: driver practice for VEX Override & FRC REBUILT

A browser-based 3D driving simulator for practicing match play in

- **VEX V5 Robotics Competition 2026–27: _Override_**: 12′×12′ field, Pins and Cups stacked on nine Goals, four wall Toggles, Midfield parking.
- **FIRST Robotics Competition 2026: _REBUILT_**: FUEL shooting into alternating-active HUBs, BUMPS, TRENCHES and a three-rung TOWER climb.

No install is needed to play: open the page, plug in a gamepad (or use the keyboard), and drive.

## Features

- **Real field geometry and timing.** Both fields are modeled to published dimensions, with the official match clocks: Override 0:15 auto + 1:45 driver with a 10 s endgame; REBUILT 0:20 AUTO + 2:20 TELEOP split into the TRANSITION SHIFT, SHIFTS 1–4 and the 0:30 END GAME.
- **Live scoring to the manual's point values.** Includes Override's Toggle ownership of yellow Pins and REBUILT's HUB active/inactive shifts, decided by the AUTO winner.
- **Drivetrain physics.** Tank, arcade, split arcade, swerve and X-drive/mecanum, with acceleration and braking limits, traction (differential drives can't slide sideways) and a shared wheel-speed budget for holonomic drives. Field-oriented control is relative to *your* driver station.
- **Robot height matters.** Low robots fit under the 22.25″ TRENCH; tall ones don't. BUMPS are real ramps.
- **Real game-piece physics.** Pins and Cups tip and get shoved around. All 504 FUEL are rigid bodies.
- **Shooter assists for REBUILT.** Full auto-aim with shoot-on-the-move, speed-only (you aim the robot), or fully manual. A live trajectory preview turns green when the shot will go in.
- **Practice modes.** Full match, driver/TELEOP period, Override driver skills (60 s), a timed placement/scoring sprint, a gate course for pure driving accuracy, and free practice.
- **Driver feedback.** Cycle-time tracking, personal bests, a **ghost of your best run** to race against, a post-run path map, run history with a trend chart, and CSV export.
- **Driver-feel tuning.** Deadzone, expo curves, a precision-mode speed, and per-robot top speed, acceleration, turn rate, capacity and drivetrain type.
- **Four cameras.** Driver station (what you see at competition), chase cam, top-down (oriented to your station), and robot POV.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests (drivetrain, match clock, scoring rules)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

## Publish it with GitHub Pages

The repository includes `.github/workflows/deploy.yml`. It runs the tests, builds, and deploys to Pages on every push to `main`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site then appears at `https://<user>.github.io/<repo>/`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Drive | W A S D | Left stick |
| Rotate / turn | ← → (or Q E) | Right stick |
| Tank drive | arcade-style on keys | Left Y = left side, Right Y = right side |
| Intake (hold) | Space | RT |
| Outtake (hold) | V | LT |
| Score / shoot (hold) | F | RB |
| Precision mode (hold) | Shift | LB |
| VEX: flip which Pin color faces up · FRC: climb (hold) | R · T | A |
| VEX: descore top of goal · FRC: climb down | G | X |
| VEX: match-load Cup · FRC: human-player OUTPOST feed | B | B |
| FRC manual shooter speed | [ ] | D-pad ↑ ↓ |
| Cycle camera | C | Y |
| Field-oriented on/off | O | R3 |
| Show/hide ghost | Y | D-pad ← |
| Pause · Restart | Esc · Backspace | Start · Back |
| Controls overlay | H | — |

Any standard USB/Bluetooth controller works (Xbox, PlayStation, Logitech, 8BitDo…). A VEX V5 controller can't connect to a browser, so use a gamepad with the same stick layout.

## How each game is modeled

### Override (VEX V5RC 2026–27)

| Item | Value used |
| --- | --- |
| Field | 12′ × 12′, four quadrants (triangles between the diagonals) + Midfield |
| Goals | 9: one Tall (8.7″, center), four neutral Short (5.8″), four Alliance (3.25″; 2 red, 2 blue), one Alliance + one Short per quadrant |
| Pieces | 63 Pins (20 red/yellow, 20 blue/yellow, 19 yellow/yellow, 4 red/blue) and 56 Cups (incl. 10 match-load Cups per alliance), 1 Pin preload |
| Stacking | Pin, Cup, Pin, Cup… A Pin is Placed in a Goal or in a Cup on a Placed Pin |
| Points | Autonomous Bonus 12 · alliance-color Pin 5 · yellow Pin 10 for the owner of that quadrant's Toggle · Robot in Midfield 8 |
| Midfield | Diamond \|x\| + \|y\| ≤ 24″, judged by robot center |
| Timing | 0:15 auto + 1:45 driver (last 0:10 = endgame); Driver Skills 0:60 |

**Assumptions** (the material available while building this didn't say): the starting layout of Pins/Cups, the exact Goal positions, which half of a Pin scores (we score the half facing up, and you choose it with R / A), goal stack limits, how a Toggle flips (touching it sets it to your color), and how yellow Pins on the Tall Goal are owned (by the alliance holding 3+ Toggles). The Autonomous Win Point isn't modeled. Every value lives in `src/games/override/rules.ts` and `src/games/override/game.ts`, so you can match them to the official manual.

### REBUILT (FRC 2026)

| Item | Value used |
| --- | --- |
| Field | 651.2″ × 317.7″; alliance zones 158.6″ deep |
| HUB | 47″ × 47″, opening 72″ high, one per alliance, between two 6.5″ BUMPS |
| TRENCH | 22.25″ clearance under the arm, between each BUMP and the guardrail |
| TOWER | Rungs at 27″ / 45″ / 63″ |
| FUEL | 504 balls, 5.91″: 360 neutral zone, 24 per DEPOT, 24 per OUTPOST, up to 8 preload |
| Points | FUEL 1 (active HUB only) · TOWER L1 15 in AUTO, L1/L2/L3 10/20/30 at the end |
| Shifts | The AUTO winner's HUB is inactive in SHIFTS 1 & 3 and active in 2 & 4. Both are active in AUTO, TRANSITION and END GAME. The HUB lights blink before switching off |
| Ranking points | ENERGIZED 100 FUEL · SUPERCHARGED 360 FUEL · TRAVERSAL 50 TOWER pts (shown solo) |

**Approximations:** the TOWER/DEPOT/OUTPOST positions along the alliance wall, the BUMP ramp length, the HUB funnel shape, and how scored FUEL exits the HUB. Air drag is ignored. All dimensions are constants at the top of `src/games/rebuilt/game.ts`.

For solo practice, the AUTO winner comes from the setup screen. It either compares your AUTO FUEL with a configurable opponent count or lets you force a win or loss so you can drill both shift patterns.

## Project layout

```
src/
  main.ts              App shell: renderer, screens, session lifecycle
  session.ts           One run: fixed-step physics loop, phases, drills, ghost, recording
  config.ts            Persisted settings
  core/                input (keyboard + gamepad), match clock, camera rig, stats, audio, physics helpers
  robot/drivetrain.ts  Pure drivetrain kinematics (unit tested)
  robot/robot.ts       Robot body (Rapier character controller) and 3D model
  games/override/      Override rules (pure) + field, pieces and mechanisms
  games/rebuilt/       REBUILT rules (pure) + field, FUEL, shooter, climb
  ui/                  HUD and menu/results/stats screens
tests/                 Vitest unit tests
```

### Adding or tuning a robot

Robot presets are plain objects in each game's `PRESETS` array: size, drivetrain type, speed/acceleration limits, capacity, intake width, shooter rate and angle, and climb ability. Add one there and it shows up in the setup screen. Drivers can also tune any preset from the UI without touching code.

## Tech

TypeScript, [Three.js](https://threejs.org) for rendering, [Rapier](https://rapier.rs) (WASM) for physics, Vite for the build, and Vitest for tests. Everything runs client-side. Settings, stats and ghosts are kept in `localStorage`.

## Disclaimer

This is an unofficial practice tool and isn't affiliated with VEX Robotics, the REC Foundation, or FIRST. Always check the official game manuals and Q&A for rulings.
