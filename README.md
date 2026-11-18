# VEXsim: driver practice for VEX V5RC Override

A browser-based 3D driving simulator for the **VEX V5 Robotics Competition 2026–27 game, Override**. Open the page, plug in a gamepad (or use the keyboard), and drive.

## Features

- **The official Override field.** Octagonal Goals, three-face Toggles and corner Loaders sit at their official positions. Hex Pins and hourglass Cups have their real shapes, and the full element counts are on the field.
- **Manual-accurate scoring and timing.** Each visible Pin half scores, Cups hide halves inside their opaque half, and a Toggle only counts if no robot is touching it. The Midfield, the Autonomous Bonus, and the 0:15 + 1:45 match with its endgame all work as in the manual.
- **V5 motor physics.** Every drive motor is modeled on the 11 W V5 Smart Motor's torque-speed curve for its cartridge, geared to the wheel. Acceleration, top speed, turning and stopping come from the robot's motors, gearing, wheel size and weight, plus wheel traction, turning scrub and brake or coast mode.
- **Real robots.** Each one is built from V5 parts (C-channel, smart motors, the brain, omni and traction wheels, license plates) with a working DR4B, arm or chain-bar lift and a wrist claw. Tune the build (motor count, wheel rpm, wheel size, weight) and see the resulting speed, acceleration and turn rate.
- **A tournament venue.** A gym floor, alliance stations, a field-control table, bleachers, overhead lights and a live audience scoreboard, all lit with image-based lighting.
- **Sound.** Drive motors whine with speed and load, the lift hums, and the match buzzers play.
- **Practice modes.** Full match, driver period, 60 s driver skills, a timed placement sprint, a gate course and free practice.
- **Driver feedback.** Cycle times, personal bests, a ghost of your best run to race, a post-run path map, run history and CSV export.
- **Four cameras.** Driver station, chase cam, top-down and robot POV.

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
| Flip the next Cup (which Pin half it hides) | R | A |
| Descore the top of a Goal | G | X |
| Match Load at your Loader | B | B |
| Cycle camera | C | Y |
| Field-oriented on/off | O | R3 |
| Show/hide ghost | Y | D-pad ← |
| Pause · Restart | Esc · Backspace | Start · Back |
| Controls overlay | H | — |

Any standard USB/Bluetooth gamepad works (Xbox, PlayStation, Logitech, 8BitDo…).

### Using a real VEX V5 Controller
1. Plug the V5 Controller into your computer with a micro-USB cable.
2. Press any button except Power. If its screen lights up, press Power to turn it off; it stays connected over USB. This is the same setup VEX uses for Virtual Skills.
3. In Chrome, open **Controller setup** on the home screen and click **Map this controller**. Push each joystick and press each button when asked. The mapping is saved for that controller.

Default V5 layout: left/right joysticks drive, R1 intake, R2 outtake, L1 place, L2 precision, A flip Cup, X descore, B match load, Y camera.

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

### Drive physics

`src/robot/drivetrain.ts` models each drive motor as a V5 11 W Smart Motor: 2.1 N·m stall torque with the red (100 rpm) cartridge, scaled for green (200) and blue (600). The motor torque falls linearly to zero at free speed, then is geared to the wheel. Forces at each wheel are capped by traction (μ·m·g). The chassis integrates them with the robot's mass and rotational inertia, with rolling resistance and turning scrub. In brake mode the motors' back-EMF stops the robot quickly; in coast mode it rolls.

## How the game is modeled

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

### Sources
- Override game manual summaries ([manual page](https://www.vexrobotics.com/v5/competition/vrc-current-game), [Q&A](https://events.vex.com/faqs/51/pdf)), the [VEXcode VR Override playground](https://api.vex.com/vr/home/playgrounds/v5rc_override.html) and [Hero Bot Flex](https://api.vex.com/vr/home/robots/flex/index.html), and the open [MMGA Override sim](https://github.com/wittodetto/MMGA_Override_AutonSim), used for field coordinates and element dimensions.

## Project layout

```
src/
  main.ts              App shell: renderer, screens, session lifecycle
  session.ts           One run: fixed-step physics loop, phases, drills, ghost, recording
  config.ts            Persisted settings
  core/                input, match clock, cameras, stats, audio + motor sound, venue, physics helpers
  robot/drivetrain.ts  V5 motor + chassis physics (unit tested)
  robot/robot.ts       Robot body (Rapier character controller) and 3D model
  games/override/      Override rules (pure) + field, pieces and mechanisms
  ui/                  HUD and menu/results/stats screens
tests/                 Vitest unit tests
```

### Adding or tuning a robot

Robot presets are plain objects in the `PRESETS` array in `src/games/override/game.ts`: size, drivetrain, powertrain (motors, cartridge, wheel rpm, wheel size, weight, traction), lift reach and speed, and capacity. Add one there and it shows up in the setup screen. Drivers can also tune any preset from the UI without touching code.

## Tech

TypeScript, [Three.js](https://threejs.org) for rendering, [Rapier](https://rapier.rs) (WASM) for physics, Vite for the build, and Vitest for tests. Everything runs client-side. Settings, stats and ghosts are kept in `localStorage`.

## Disclaimer

This is an unofficial practice tool and isn't affiliated with VEX Robotics, the REC Foundation, or FIRST. Always check the official game manuals and Q&A for rulings.
