# VEXsim: driver practice for VEX Override & FRC REBUILT

A browser-based 3D driving simulator for practicing match play in

- **VEX V5 Robotics Competition 2026–27: _Override_**: 12′×12′ field, Pins and Cups stacked on nine Goals, four wall Toggles, Midfield parking.
- **FIRST Robotics Competition 2026: _REBUILT_**: FUEL shooting into alternating-active HUBs, BUMPS, TRENCHES and a three-rung TOWER climb.

No install is needed to play: open the page, plug in a gamepad (or use the keyboard), and drive.

## Features

- **Real robots.** VEX robots built from V5 parts with working lifts and claws; FRC robots modeled on 2910, 4414, 1678, 971, 1690 and 4946.
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
| VEX: flip the next Cup (which Pin half it hides) · FRC: climb (hold) | R · T | A |
| VEX: descore top of goal · FRC: climb down | G | X |
| VEX: match-load Cup · FRC: human-player OUTPOST feed | B | B |
| FRC manual shooter speed | [ ] | D-pad ↑ ↓ |
| Cycle camera | C | Y |
| Field-oriented on/off | O | R3 |
| Show/hide ghost | Y | D-pad ← |
| Pause · Restart | Esc · Backspace | Start · Back |
| Controls overlay | H | — |

Any standard USB/Bluetooth controller works (Xbox, PlayStation, Logitech, 8BitDo…). A VEX V5 controller can't connect to a browser, so use a gamepad with the same stick layout.

## Robots

### VEX (Override)
Built from real V5 parts: aluminum C-channel, 11 W smart motors with their gear cartridges, the V5 brain and battery, omni and traction wheels, and alliance-colored license plates. Each one has a working lift and claw.

| Robot | Based on | Drive | Lift / reach |
| --- | --- | --- | --- |
| DR4B claw stacker | Early-season Override reveals (standoff-linkage DR4B claw bots) | 6-motor 450 RPM tank | Double-reverse four-bar to ~42″ |
| Clawbot “Flex” | VEX’s official Override Hero Bot (arm + claw) | 4-motor 200 RPM | Single arm to ~26″ |
| Chain-bar + roller intake | Forklift / chain-bar stacker concepts from the Override design threads | 6-motor 600 RPM | Chain-bar to ~32″ |
| X-drive arm bot | Holonomic “S-bot” designs | 4-motor X-drive | Arm to ~30″ |

Placing takes real time: the lift travels to the top of the stack, and the wrist flips the Pin tip-down. Stacks taller than your lift can reach are rejected.

### FRC (REBUILT)
Modeled on teams’ published 2026 specs and CAD: frame size, height, top speed, hopper size, shot rate, turret vs. chassis-aimed shooter, and climber.

| Robot | Archetype | Notes |
| --- | --- | --- |
| 2910 Jack in the Bot · Re•Blitz | Dumper | 58 FUEL, 4-wide drum fixed to the chassis firing **backward** at 32/s |
| 4414 HighTide · RIPCURRENT | Dye Rotor + turret | ~88 FUEL under a net, 18/s turret with shoot-on-the-move |
| 1678 Citrus Circuits · Limestone | Drum + lift | Rear drum 26/s, Level 1 climb |
| 971 Spartan Robotics · Mixtape | Twin turrets | Two turrets ≈ 20/s, Level 1 climb |
| 1690 Orbit · Kepler | Compact turret | 12/s turret, intake runs while shooting |
| 4946 The Alpha Dogs · Moto Moto | Round Dye Rotor | 29.5″ tall, so it can’t fit under the TRENCH and takes the BUMPS |
| Practice bot: L3 climber | Generic | Not a real team’s robot. Use it to practice all three TOWER levels |

Hopper sizes for 1678, 971, 1690 and 4946 weren’t published and are estimates. With full aim assist, chassis-aimed robots like 2910 and 1678 turn themselves to face the HUB, the way a real auto-align button works.

## How each game is modeled

### Override (VEX V5RC 2026–27)

| Item | Value used |
| --- | --- |
| Field | 12′ × 12′ foam tiles; corner-to-corner tape makes four Quadrants; 48″ Midfield diamond |
| Goals | 9 **octagonal** tapered Goals: Tall 8.77″ (center), four neutral Short 5.77″ at (±24″, ±47″)/(±47″, ±24″), four Alliance 3.25″ (2 red on the red side, 2 blue) |
| Toggles | 656 mm three-face (yellow/red/blue) prisms at the center of each wall. They count only when **no robot is touching them** |
| Loaders | 4, in the corners beside the Alliance Stations. Match Loads: 10 Cups + 10 alliance Pins + 1 yellow Pin per alliance |
| Pins | 63 two-color hex Pins (20 red/yellow, 20 blue/yellow, 19 yellow/yellow, 4 red/blue), tapered end nests down. 1 alliance Pin preload per robot |
| Cups | 56 hourglass Cups, **clear lower half and opaque upper half**. Flip them (R / A) to choose which Pin half they hide |
| Scoring | **Each visible Pin half**: 5 for a red/blue half, 10 for a yellow half owned via the quadrant Toggle. A half inside a Cup’s opaque half doesn’t count. Robot in Midfield 8 · Autonomous Bonus 12 (6 each on a tie), decided on Pin points |
| Timing | 0:15 auto + 1:45 driver (last 0:10 endgame). Driver Skills 0:60 |

**Assumptions:** the starting spots of the field elements beyond the 20 in the official VEXcode VR layout (they're filled in on the same 1-foot grid with the field's red/blue symmetry), one yellow Pin starting on the Tall Goal, the order Match Loads come out, and the Tall Goal's yellow halves going to the alliance with more robots in the Midfield. The Autonomous Win Point isn't modeled.

### REBUILT (FRC 2026)

| Item | Value used |
| --- | --- |
| Field | 651.2″ × 317.7″; alliance zones 158.6″ deep; 20″ guardrails; alliance wall 36.8″ base + 42″ glass |
| HUB | 47″ × 47″ with a sloped opening (72″ front rim, 80″ back rim). FUEL drops in and rolls out of an opening in the neutral-zone face at 30″. A NET behind it catches over-shots |
| BUMP / TRENCH | BUMPS 73″ × 44.4″ × 6.5″ ramps; TRENCHES 65.65″ wide with 22.25″ clearance under a 3″ arm |
| TOWER | From the field CAD: just right of center on the alliance wall, 39″ × 45″ base, uprights 32.25″ apart, rungs at 27″ / 45″ / 63″ |
| DEPOT / OUTPOST | DEPOT 42″ × 27″ with low barriers, 1.93 m left of center. OUTPOST in the right corner with a CHUTE at 28″ and a corral |
| FUEL | 504 foam balls, 5.91″, 0.215 kg, restitution 0.45, **air drag** in flight and carpet rolling resistance |
| Points | FUEL 1 (active HUB, plus a 3 s grace after it turns off) · TOWER L1 15 in AUTO, L1/L2/L3 10/20/30 at the end |
| Shifts | The AUTO winner's HUB is off in SHIFTS 1 & 3 and on in 2 & 4. Both are on in AUTO, TRANSITION and END GAME. The HUB lights blink before switching off |

The aim assist solves the shot *with* air drag, so the trajectory preview and the real flight agree.

**Approximations:** the FUEL staging in the neutral zone and the inside of the HUB.

### Sources
- Override game manual summaries ([manual page](https://www.vexrobotics.com/v5/competition/vrc-current-game), [Q&A](https://events.vex.com/faqs/51/pdf)), the [VEXcode VR Override playground](https://api.vex.com/vr/home/playgrounds/v5rc_override.html) and [Hero Bot Flex](https://api.vex.com/vr/home/robots/flex/index.html), and the open [MMGA Override sim](https://github.com/wittodetto/MMGA_Override_AutonSim), used for field coordinates and element dimensions.
- The [2026 FRC Game Manual](https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf), and the open [rebuilt-sim-2026](https://github.com/TylerHandel/rebuilt-sim-2026), used for its compilation of field-CAD positions and teams' published robot specs.

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
