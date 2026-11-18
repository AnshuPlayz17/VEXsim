# Override reference sources

**Links only, no copies.** The Override field design and game manual are © VEX Robotics / Innovation First (all rights reserved), and photos belong to the teams and photographers who took them. Open them at the source. To keep official CAD or photos on your own computer for reference, put them in `reference/local/`, which is git-ignored and never pushed.

What VEXsim takes from these is written up as facts in [`field-spec.md`](field-spec.md) / [`field-spec.json`](field-spec.json), drawn as original diagrams in [`diagrams/`](diagrams/), and coded in `src/games/override/`.

Tags: **[rules]** · **[layout]** starting positions · **[perimeter]** · **[goals]** · **[pins]** · **[cups]** · **[toggles]** · **[loaders]** · **[robots]**

## Official (VEX Robotics / RECF)

| Link | What it shows | Tags |
| --- | --- | --- |
| [V5RC Override game page and manual](https://www.vexrobotics.com/v5/competition/vrc-current-game) | The game manual: field, elements, scoring (SC rules), Skills | rules, layout, perimeter, goals, pins, cups, toggles, loaders |
| Game manual, Appendix A (field drawings: element locations, scoring object locations, perimeter, toggles, loaders, tape) | Every field position and dimension in the sim; shared by the user from the manual. Measurements only, no copies | layout, perimeter, goals, pins, cups, toggles, loaders |
| [Override Q&A](https://events.vex.com/faqs/51/pdf) | Official rulings, e.g. scoring of Pin halves and Cups | rules, pins, cups, toggles |
| [VEXcode VR: V5 26-27 Override playground](https://api.vex.com/vr/home/playgrounds/v5rc_override.html) | Official virtual field and its starting layout | layout, goals, pins, cups, toggles, loaders |
| [Using the V5 26-27 Override Playground](https://kb.vex.com/hc/en-us/articles/51426592122004-Using-the-VEX-V5-26-27-Override-Playground-Window) | Start locations, preloads, Match Load buttons | layout, loaders |
| [Hero Bot “Flex”](https://api.vex.com/vr/home/robots/flex/index.html) | VEX’s Override Hero Bot (arm + claw) | robots |
| [Field Build Instructions for VEX V5 Override](https://library.globalrobotics.org/hc/en-us/articles/51135682959380-Field-Build-Instructions-for-VEX-V5-Override) | Build instructions for the field elements | perimeter, goals, toggles, loaders |
| [Override Full Game & Field Element Kit (276-9250)](https://www.vexrobotics.com/276-9250.html) | Product photos of the field element kit | goals, toggles, loaders |
| [Override Scoring Element Kit (276-9255)](https://www.vexrobotics.com/276-9255.html) | Product photos of Pins and Cups | pins, cups |
| [Connecting a V5 Controller to Virtual Driving Skills](https://kb.vex.com/hc/en-us/articles/32140206930708-Connecting-a-VEX-V5-Controller-to-Virtual-Driving-Skills) | How a V5 Controller connects to a computer over USB (used for VEXsim’s controller support) | robots |
| [Game reveal (VEX Robotics on X)](https://x.com/VEXRobotics/status/2047858177778106792) | Reveal video of the game | layout, goals, toggles |

## Community

| Link | What it shows | Tags |
| --- | --- | --- |
| [Override dimensions (VEX Forum)](https://www.vexforum.com/t/override-dimensions/145928) | Measured element and field dimensions | goals, pins, cups, toggles |
| [OnShape Field Simplified (VEX Forum)](https://www.vexforum.com/t/onshape-field-simplified/146994) | Community CAD of the field | layout, perimeter, goals |
| [Override Cup Placement Confusion (VEX Forum)](https://www.vexforum.com/t/override-cup-placement-confusion/147127) | How Cups nest and which half hides a Pin | cups, pins |
| [Toggle (VEX Forum)](https://www.vexforum.com/t/toggle/147825) | Discussion of how Toggles are set | toggles |
| [Override v1.1 Manual Summary (Spartan Design)](https://spartandesignrobotics.org/override-manual-summary) | Plain-language rule summary | rules |
| [Override Scoring and Robot Design Guide](https://www.atlantahobby.com/blogs/robotics/vex-v5-override-game-breakdown-scoring) | Scoring walkthrough, SG6 holding limit | rules, robots |
| [MMGA Override AutonSim (GitHub)](https://github.com/wittodetto/MMGA_Override_AutonSim) | Open-source Gazebo sim with element meshes and field coordinates (source of VEXsim’s goal coordinates) | layout, goals, pins, cups, toggles, loaders |
| [8059 Blank. early-season reveals](https://www.vexforum.com/t/8059-blank-s-beginnings-2026-override-early-season-reveals/146887) | Standoff-linkage DR4B robots | robots |
| [Override robot with a cascade lift](https://www.vexforum.com/t/override-robot-with-a-cascade-lift/148629) | Cascade lift power budgeting | robots |
| [What bot designs do you see used for the new game?](https://www.vexforum.com/t/what-bot-designs-do-you-see-used-for-the-new-game/145750) | Early design predictions | robots |
| [VEX Robot Showcase (VEX Forum)](https://www.vexforum.com/c/v5-general-discussion/vex-robot-showcase/41) | Team robot reveals and photo threads | robots, layout |
| [ACE Cascade + Horizontal Intake breakdown (YouTube)](https://www.youtube.com/watch?v=KeTu6UaoPWA) | Cascade robot design | robots |
| [Goodebot Override programming hub](https://goodebot.net/override/) | Reference robot designs and element handling | robots, pins, cups |

## Adding to this list
Add a row with the link, one line on what it shows, and its tags. Don't commit downloaded images or CAD from these sources; keep those in `reference/local/`.
