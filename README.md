# Battle Room

A seated, **tabletop** wireframe space battle for **Meta Quest 3 / 3S**, inspired by the
command-school simulator in *Ender's Game*. The whole battle plays out as a miniature
inside a small wireframe box (about 0.9 m wide) floating in front of you, so you never
have to turn or move. Your cyan ship fights waves of red ships inside the box.

It is a WebXR web page built with three.js. It runs in the Quest's built-in browser, so you
don't need to install an app or turn on developer mode. It also runs in a normal desktop
browser with mouse and keyboard.

![diorama](screenshots/09-diorama.png)

## How to play

- Destroy every red ship to clear a wave. Each new wave has more enemies, and they are
  faster and shoot more often. From wave 3 on, armoured **cruisers** join the fighters.
- Your hull has 5 points. Clearing a wave repairs 1.
- **Wrap-around:** fly out through one face of the box and you come back in through the
  opposite face, with a small flash. Nothing ever forces your ship to turn. Enemies wrap too.
- Your view never moves and the game never turns you. Just look at the box.

## Controls

### Quest (VR, seated)

The right hand flies and shoots. The left hand moves the box, opens settings, and has extra shoot/boost buttons.

| Hand | Input | Action |
|---|---|---|
| Right | **Turn the controller** (Mirror steering, default) | The ship turns the way your controller turns, in any direction: straight up, straight down, over the top in a loop, or upside down, with no limit and no flipping. Turns are multiplied by the **Mirror gain** (default 2x), so turning your wrist 45° turns the ship 90°, and 90° turns it all the way around. Turns past 180° stop at 180°. Wrist roll is ignored (a small cosmetic bank is added). Smoothing is about 65 ms. The ship always flies forward |
| Right | **Trigger** | Shoot (gentle aim assist). Also starts and restarts the game |
| Right | **Hold the grip** | Boost |
| Right | **A** | Brake |
| Right | **Click the thumbstick** | Re-center: the controller's current orientation becomes "straight into the box". This happens automatically when a game starts, so hold the controller comfortably then |
| Left | **Trigger** | Also shoots |
| Left | **Hold the grip** | Also boosts |
| Left | **Stick forward / back** | Boost / brake |
| Left | **Hold Y (alone) and move your hand** | Drag the box. While holding Y, stick up/down grows or shrinks it |
| Left | **Click the thumbstick** | Put the box back in its default spot |
| Left | **X + Y together** | Settings (point with the right controller and pull the right trigger to change; the game pauses) |
| Left | **Look at your wrist** | Score, wave, hull and a top-down radar of the box |

The trigger, grip and A work the same in every steering mode.

Other steering modes (in Settings):
- **Relative (hand stick):** tilt the controller away from a captured neutral to turn the ship relative to its own heading. Click the right stick to re-center. A small gimbal on the controller shows your tilt.
- **Point:** the ship flies the way you point, with a short laser and ring.
- **Thumbstick:** the right stick flies the ship. B inverts up/down.

### Settings (saved on the device, as are the box position and size)

| Setting | Options | Default |
|---|---|---|
| Steering | Mirror / Relative / Point / Thumbstick | Mirror |
| Mirror gain (how much the ship turns per degree of wrist turn) | 1x / 1.5x / 2x / 2.5x / 3x / 3.5x | 2x |
| Ship turn speed (Relative, Point and Thumbstick modes) | Normal / Fast / Very fast | Fast |
| Box size | Small 0.6 m / Medium 0.9 m / Large 1.2 m | Medium |

### Desktop (testing without a headset)

| Input | Action |
|---|---|
| Mouse | Mirror steering: the ship points where the mouse points |
| M | Cycle steering: mirror / relative (cursor offset from the centre) / point / thumbstick (I/K + J/L, V inverts) |
| Left click / Space | Shoot |
| Shift / F | Boost / brake |
| + / - | Box size |
| C | Reset the box |
| Right-drag or arrow keys | Look around |
| Tab or the gear button | Settings |
| Enter / R | Start / restart |

URL options: `?wave=5` starts at wave 5, and `?demo` turns on an autopilot (attract mode).
`?test` sends errors and status lines to a local test server.

## Getting it onto the Quest

**Live copy:** https://willcoding11.github.io/vr-battle-room/ (GitHub Pages). Open it in the
Quest Browser and press **ENTER VR**.

WebXR only works over **HTTPS** (or `localhost`), so the files must be served from an HTTPS
address. The folder is plain static files (`index.html`, `js/`, `vendor/`), so there is no
build step.

1. **Simplest: a static host.** Put the folder on any HTTPS static host, such as GitHub
   Pages, Netlify Drop or Cloudflare Pages. Open the URL in the Quest Browser and press
   **ENTER VR**. Tip: bookmark it in the Quest browser.
2. **Local, over USB, no hosting.** On a PC with `adb` and the Quest in developer mode, run
   `adb reverse tcp:8000 tcp:8000`. Then run `python -m http.server 8000` in this folder
   and open `http://localhost:8000` on the Quest. `localhost` counts as secure.
3. **Local Wi-Fi.** Serve the folder over HTTPS with a self-signed certificate, for example
   `npx http-server -S` or `caddy`, and accept the warning in the Quest browser.

When you are in the Quest browser, sit down, then press **ENTER VR**. If the battle sits too
high or too low, hold the Meta button to recentre, or use the left-hand Y/X buttons.

## Files

- `index.html` - page, desktop HUD and title screen
- `js/main.js` - game: scene, input (VR + desktop), player, enemies, waves, HUD, effects
- `js/models.js` - wireframe ship models (points joined by lines)
- `js/audio.js` - synthesized 3D sound effects (WebAudio, no audio files)
- `vendor/` - three.js r187 (`three.module.js`, `three.core.js`, `VRButton.js`), MIT licence
- `screenshots/` - desktop-mode screenshots

## Not done yet / ideas

- Squadron mode (point and give orders to groups of ships)
- Proper enemy formations and enemy types beyond fighter and cruiser
- A louder warning when an enemy attacks from behind (positional sound only, so far)
- A settings menu (comfort options, seated height, volume)
- So far it has only been tested in an emulator (IWER) and in desktop Firefox, not yet on a real Quest
