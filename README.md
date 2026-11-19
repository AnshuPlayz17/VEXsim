# VEXsim: driver practice for VEX V5RC Override

A browser-based 3D driving simulator for the **VEX V5 Robotics Competition 2026–27 game, Override**. Open the page, plug in a gamepad (or use the keyboard), and drive.

## Features

- **The official Override field.** Octagonal Goals, three-face Toggles and corner Loaders sit at their official positions. Hex Pins and hourglass Cups have their real shapes, and the full element counts are on the field.
- **Manual-accurate scoring and timing.** Each visible Pin half scores, Cups hide halves inside their opaque half, and a Toggle only counts if no robot is touching it. The Midfield, the Autonomous Bonus, and the 0:15 + 1:45 match with its endgame all work as in the manual.
- **V5 motor physics.** Battery sag, motor heating and the firmware's thermal current limits are modeled too. Every drive motor is modeled on the 11 W V5 Smart Motor's torque-speed curve for its cartridge, geared to the wheel. Acceleration, top speed, turning and stopping come from the robot's motors, gearing, wheel size and weight, plus wheel traction, turning scrub and brake or coast mode.
- **Real robots.** Each one is built from V5 parts (C-channel, smart motors, the brain, omni and traction wheels, license plates) with a working DR4B, arm or chain-bar lift and a wrist claw. Tune the build (motor count, wheel rpm, wheel size, weight) and see the resulting speed, acceleration and turn rate.
- **A tournament venue.** A gym floor, alliance stations, a field-control table, bleachers, overhead lights and a live audience scoreboard, all lit with image-based lighting.
- **Sound.** Drive motors whine with speed and load, the lift hums, and the match buzzers play.
- **Practice modes.** Full match, driver period, 60 s driver skills, a timed placement sprint, a gate course and free practice.
- **Driver feedback.** Cycle times, personal bests, a ghost of your best run to race, a post-run path map, run history and CSV export.
- **Four cameras, switchable any time.** Driver station, follow robot (drag to orbit, scroll to zoom), top-down and robot POV, from on-screen buttons or `C`.
- **Controls always in view.** A legend along the bottom of the screen shows the key controls for whatever you're using (keyboard, gamepad or V5 Controller). `H` shows them all.

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
| Lift up · down (hold) | ↑ · ↓ (or I · K) | RB · LB |
| Intake / close the claw (hold). Lift down to grab off the floor; at the top of a stack it descores | Space | RT |
| Release / open the claw. Over a Goal, seated on the stack, it scores; anywhere else it drops | V | LT |
| Flip the wrist (which Pin half or Cup side goes down) | R | A |
| Precision driving (hold) | Shift | X |
| Match Load at your Loader | B | B |
| Cycle camera | C | Y |
| Field-oriented on/off | O | R3 |
| Show/hide ghost | Y | D-pad ← |
| Pause · Restart | Esc · Backspace | Start · Back |
| Controls overlay | H | — |

**Driving it like a real robot.** There's no auto-score button. You raise and lower the lift yourself, line the claw up over a Goal and open it. A ring on the Goal under the claw turns green when you're lined up (within 2″ of center; the Goal's tapered top and a Cup's flare guide a Pin in) and low enough (2.5″ or less above the stack), and the HUD shows the claw height and how far to lower. Over a Goal but not lined up, the robot keeps hold and tells you what's off; away from any Goal, opening the claw drops the piece. Beginners can turn on **Placement assist** in the setup screen's Advanced section to get the old one-button lift-and-place (F) back.

Any standard USB/Bluetooth gamepad works (Xbox, PlayStation, Logitech, 8BitDo…).

### Using a real VEX V5 Controller
1. Plug the V5 Controller into your computer with a micro-USB cable.
2. Press any button except Power. If its screen lights up, press Power to turn it off; it stays connected over USB. This is the same setup VEX uses for Virtual Skills.
3. In Chrome, open **Controller setup** on the home screen and click **Map this controller**. Push each joystick and press each button when asked. The mapping is saved for that controller.

Default V5 layout: joysticks drive, L1/L2 lift up/down, R1 intake (close claw), R2 release (open claw), A flip wrist, X precision, B match load, Y camera. Controllers mapped with an older version are converted (L1/L2 become the lift).

### Performance
The field, venue and robots merge every non-moving part into one mesh per material, and each Pin is a single mesh, so a frame is a few hundred draw calls. **Graphics** in the setup screen's Advanced section: *Fast* (no shadows, 1× pixels), *High* (shadows, up to 1.5× pixels, the default) and *Ultra* (adds ambient occlusion and full HiDPI resolution; needs a strong GPU).

## Robots

### VEX (Override)
**19109M** is modeled from the team's regionals code: the drive (4 blue motors geared 36:48 to 450 rpm, 3.25″ omnis, 12.75″ track, 10.5″ wheelbase, 15.5″ × 17.8″ frame, split arcade, coast), its claw on the back (stick forward drives away from the claw, like the real robot), grabbing a Cup with its Pin as one stack (from the field or a Loader), and its driver macros: R1 grabs and lifts to mid height (R1 again: to the top), and holding R2 lowers onto the Goal, then letting go opens the claw and lifts back up. Its claw sits on a red-cartridge arm that swings over the top of the robot: at a Loader, Match Load (B) runs its L1 loading macro (cascade down, arm swings in, the Cup + Pin drops into the claw after 0.8 s), and R1 then lifts and swings the arm back out once the cascade is about 30% up, like its `B_ARM_OUT_HEIGHT`. Its frame is a U open at the claw end, so it backs over a Goal or a field stack and the claw works inside the frame, 5″ behind center (the autos' tuned `SCORE_PIN_BEHIND`). Its weight (15 lb) and cascade height (~33″) are estimates.

Built from real V5 parts: aluminum C-channel, 11 W smart motors with their gear cartridges, the V5 brain and battery, omni and traction wheels, and alliance-colored license plates. Each one has a working lift and claw.

| Robot | Based on | Drive | Lift / reach |
| --- | --- | --- | --- |
| **19109M (regionals)** | Team 19109M’s own robot code | 4-motor 450 RPM omni, split arcade, coast | 3-motor cascade to ~33″; pneumatic claw that scores off the back |
| DR4B claw stacker | Early-season Override reveals (standoff-linkage DR4B claw bots) | 6-motor 450 RPM tank | Double-reverse four-bar to ~42″ |
| Clawbot “Flex” | VEX’s official Override Hero Bot (arm + claw) | 4-motor 200 RPM | Single arm to ~26″ |
| Chain-bar + roller intake | Forklift / chain-bar stacker concepts from the Override design threads | 6-motor 600 RPM | Chain-bar to ~32″ |
| X-drive arm bot | Holonomic “S-bot” designs | 4-motor X-drive | Arm to ~30″ |
| Cascade + horizontal intake | This season's cascade reveals (ACE-style cascade, Formula 5) | 6-motor 450 RPM tank | 3-stage cascade to ~44″ |

Placing takes real time: the lift travels to the top of the stack, and the wrist flips the Pin tip-down. Stacks taller than your lift can reach are rejected.

### Drive physics

`src/robot/drivetrain.ts` models each drive motor as a V5 11 W Smart Motor: 2.1 N·m stall torque with the red (100 rpm) cartridge, scaled for green (200) and blue (600). The motor torque falls linearly to zero at free speed, then is geared to the wheel. Forces at each wheel are capped by traction (μ·m·g). The chassis integrates them with the robot's mass and rotational inertia, with rolling resistance and turning scrub. In brake mode the motors' back-EMF stops the robot quickly; in coast mode it rolls.

`src/robot/power.ts` adds the V5 battery and motor heat. The 12.8 V battery sags with the current drawn (shoving another robot or a wall can pull it near 11 V, so the motors lose speed and torque) and slowly as it drains. Each motor's current is capped at 2.5 A, and its temperature climbs with current squared. Like the real firmware, the current limit halves at 55 °C, drops to a quarter at 60 °C and stops the motor at 65 °C, so a match spent pushing at stall overheats the drive. The HUD shows battery voltage, charge and motor temperature, and the lift and intake draw current too.

The chassis also squats back under acceleration, dips forward when braking and leans out in turns. Intake rollers pull nearby Pins and Cups into the mouth before the claw grabs them.

## How the game is modeled

### Override (VEX V5RC 2026–27)

| Item | Value used |
| --- | --- |
| Field | 140.41″ square inside an 11.54″ tall, 2″ thick white perimeter with a checker band (manual Appendix A); 6 × 6 foam tiles. Tape: Midfield diamond (corners 23.55″ out), the Autonomous Line corner to corner (doubled NW–SE) and an alliance-colored Load Zone L in each corner |
| Goals | 9 Goals on a chamfered-square footprint (5.61″ across the flats), all topped by the same 3.25″ tapered module with a 2.37″ hole and code markers. Neutral Goals are black with yellow line art on a base: Tall 8.77″ (center), four Short 5.77″; every Goal on the 23.55″ / 47.10″ grid from Appendix A. Four Alliance Goals are the bare 3.25″ module in red or blue |
| Toggles | 25.8″ three-face (yellow/red/blue) prisms **on top of the perimeter** at the middle of each wall, axis 13.20″ up. They start yellow up and into the field, with that side's alliance color facing out. They count only when **no robot is touching them** |
| Loaders | 4 clear chutes hanging on the alliance walls, 58.77″ either side of center. Match Loads per alliance: 10 Cups + 10 alliance/yellow Pins + 1 yellow/yellow Pin. Skills: 7 Cups, 3 red/yellow and 4 blue/yellow Pins, with the neutral Goals starting empty |
| Pins | 63 two-color Pins (20 red/yellow, 20 blue/yellow, 19 yellow/yellow, 4 red/blue): 6.5″ long, hexagonal and **symmetric**, with flat six-sided faces, a chamfered 2.35″ tip at each end, a taper out to the 3.16″ collar, and a seam where the two molded halves meet, so either end nests. R / A flips which color half goes down. 1 alliance Pin preload per robot |
| Cups | 56 Cups, 6.48″ tall, 3.16″ across the top with a 2.32″ waist, **clear lower half and gray opaque upper half**, hollow with rolled rims. A Cup rests on a Pin's collar, and the next Pin's tip drops into its waist with its collar on the Cup's top rim. R / A flips a Cup to choose which Pin half it hides |
| Scoring | **Each visible Pin half**: 5 for a red/blue half, 10 for a yellow half owned via the quadrant Toggle. A half inside a Cup’s opaque half doesn’t count. Robot in Midfield 8 · Autonomous Bonus 12 (6 each on a tie), decided on Pin points |
| Timing | 0:15 auto + 1:45 driver (last 0:10 endgame). Driver Skills 0:60 |

| Starting layout | From the manual's Scoring Object Locations sheet: a yellow/yellow Pin on each neutral Goal, four "stars" (a Cup with four Pins lying around it) on the NW–SE Autonomous Line, Cups holding yellow/yellow Pins on the other diagonal, red/blue Pins in Cups on the Midfield corners, and Cup / Cup + Pin / Cup groups against every wall. 37 Pins and 36 Cups, matching the manual's counts |

**Assumptions:** which 12 Cups start clear side up (the sheets don't make it legible), the robots' starting spots, the order Match Loads come out, and the Tall Goal's yellow halves going to the alliance with more robots in the Midfield. The Autonomous Win Point isn't modeled.

### Sources
- Override game manual summaries ([manual page](https://www.vexrobotics.com/v5/competition/vrc-current-game), [Q&A](https://events.vex.com/faqs/51/pdf)), the [VEXcode VR Override playground](https://api.vex.com/vr/home/playgrounds/v5rc_override.html) and [Hero Bot Flex](https://api.vex.com/vr/home/robots/flex/index.html), and the open [MMGA Override sim](https://github.com/wittodetto/MMGA_Override_AutonSim), used for field coordinates and element dimensions.

## Field reference

[`reference/`](reference/) holds what the field model is built from:
- [`field-spec.md`](reference/field-spec.md) / [`field-spec.json`](reference/field-spec.json): every dimension, position and count, with where each comes from and which values are assumptions.
- [`diagrams/`](reference/diagrams/): original top-down and element drawings (starting layout, Pin / Cup / Goals, Toggle).
- [`SOURCES.md`](reference/SOURCES.md): links to the official manual, VEX's playground, CAD and community photo threads, labelled by what they show.

These files are generated from the simulator's own field data with `npm run reference`, and `npm test` fails if they get out of date. Private copies of official CAD or photos go in `reference/local/` (git-ignored).

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
