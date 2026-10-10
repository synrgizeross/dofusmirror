# MirrorDeck — UX Specification

**MirrorDeck is an Android game client, not a screen mirror.**

The phone is the compute. Your PC is the console. The moment you let the phone's
own UI be visible and primary, you're playing a remote-desktop app, and remote
desktop apps always feel bad for games: mouse precision is nothing like thumb
ergonomics, nothing is fullscreen, and the desktop chrome is in your face while
you're trying to aim.

---

## 1. Three surfaces

### Library (default surface)
The home screen is **games, not devices**. A grid of installed apps pulled from
the device, each tile carrying:

- cover art (real screenshot captured from the device, not a placeholder)
- last-played, install size
- a profile badge — whether a control mapping exists for it

A slim device rail on the left switches *which* phone you're playing on. The
device is infrastructure; it should not be the hero of the screen.

### Game Mode (the surface that matters)
Launching a game enters a **zero-chrome fullscreen surface**:

- video fills the window edge to edge
- no toolbar, no sidebar, no status bar, nothing
- input comes from gamepad first, keyboard second
- HUD appears only on demand (hold `Tab` / press `Start`) and fades after 2s

This is the single most important screen in the product. Everything else is a
way to reach it.

### Desktop Mode
The existing feature set — mouse/keyboard control, clipboard, recording,
multi-device tiles — kept intact for non-game apps and for people who *do* want
a mirror. It becomes a mode, not the product.

---

## 2. Input is the product

Video quality is table stakes. Input is what makes it feel like a PC game.

### Gamepad-first
An Xbox/PS controller is polled via the Gamepad API each frame. This is not a
nice-to-have; it is the core input device.

**Two mapping modes:**

| Mode | How it works | Fits |
|---|---|---|
| **Virtual Pad** (default) | left stick + D-pad → one virtual dpad zone; face buttons → action zones | games with on-screen controls |
| **Direct Map** | every controller button → an absolute screen coordinate | games with no on-screen controls, or unusual layouts |

**Calibration:** press *Calibrate*, drag zones onto the game's real controls,
save against the package name. The profile auto-applies whenever that game
launches — you never configure the same game twice.

**Feel parameters** that matter and must be user-visible:
- **Deadzone** — analog stick threshold, per-axis
- **Turbo** — repeat rate when a direction is held, configurable (off / 5 / 10 / 20 Hz)
- **Response curve** — linear vs. exponential

### Keyboard mapping
Keys map to the same zones. This is how you play with no controller at all, and
it's how competitive players set up WASD-style bindings.

---

## 3. Feel and performance

Decorative motion in an input path is a bug. In Game Mode there is no entrance
animation, no fade-in of the video, no transition between states.

**Latency Mode** vs **Quality Mode**, one toggle:
- *Latency* — lower resolution, lower bitrate, aggressive keyframe interval
- *Quality* — higher resolution, more bitrate, smoother

**HUD** (opt-in, `Tab`): real numbers, monospace, no chrome:
- input → frame latency (ms)
- decode time (ms)
- frames dropped, since launch
- network jitter / bitrate
- controller battery, if reported

---

## 4. Visual language

Built on shadcn/ui primitives with a restyled token layer.

- **Base** — near-black neutrals, one accent. No glass, no glow, no gradients
  as decoration.
- **Accent** — amber/gold. Deliberately *not* the default AI blue/violet.
  Semantic colours: red = recording / danger, green = connected / success.
- **Radius** — one documented scale: 8px controls, 12px surfaces, pill for
  badges only.
- **Type** — tight, small, confident. Uppercase micro-labels for metadata.
  Monospace for every number, always.
- **Sleek = restraint.** The shell earns its negative space; the game surface
  earns its nothing-at-all.

---

## 5. What is explicitly not in scope

- Phone launcher / app drawer mirroring as the primary experience
- Any account system or cloud sync
- Decorative animation in Game Mode
- Editing control profiles on the phone