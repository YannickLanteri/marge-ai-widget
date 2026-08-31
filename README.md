<p align="center">
  <img src="build/icon.png" width="96" height="96" alt="Marge AI Widget icon">
</p>

<h1 align="center">Marge AI Widget</h1>

<p align="center">Claude, Codex and Antigravity quotas at the right edge of your screen.</p>

<p align="center">
  <a href="https://github.com/YannickLanteri/marge-ai-widget/actions/workflows/test.yml"><img src="https://github.com/YannickLanteri/marge-ai-widget/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  · <a href="LICENSE">MIT License</a>
  · Electron 44.0.0
  · <a href="README.fr.md">Français</a>
</p>

![Marge AI Widget on a fictional neutral desktop](docs/hero.png)

Move the pointer to the outer right edge and the widget slides in without taking focus. Move away and it disappears. Hover for the selected provider breakdown; click for exact reset dates.

The desktop above is entirely fictional. Every quota comes from the built-in demo mode: no real account, application, file or notification appears in the repository images.

## Install

Requirements: macOS 13+ or Linux X11, Node.js 22.12 or newer, and the provider applications you want to monitor.

```sh
git clone https://github.com/YannickLanteri/marge-ai-widget.git marge-ai-widget
cd marge-ai-widget
bash install.sh --local
```

The installer creates an atomic snapshot in `~/.marge-ai-widget`, installs only the locked Electron runtime, runs the complete test suite, registers autostart and launches the widget. If anything fails, the previous installation stays untouched.

The first launch confirms that Marge AI is running and explains the right-edge gesture; clicking the notification reveals the widget. It is shown only once. The menu bar icon remains the permanent status indicator and exposes refresh, settings, updates and quit controls.

```sh
marge            # start or restart
marge status     # process state and last aggregate reading
marge logs       # follow bounded logs
marge stop       # stop until the next start or login
marge update     # update a Git-based installation
```

Update a local snapshot by pulling the repository and running `bash install.sh --local` again.

Uninstall without touching provider sessions:

```sh
bash ~/.marge-ai-widget/uninstall.sh
```

Settings are preserved by default. Add `--purge` to remove the widget configuration, state and logs. Claude, Codex and Antigravity sessions are never removed.

## Read the widget

- **Outer ring:** short window, normally five hours; a longer exhausted limit that applies to the same model makes this ring empty.
- **Inner ring:** weekly window.
- **Number:** remaining percentage of the provider’s strictest reported limit.
- **Dotted ring:** the provider did not report this window; missing data is never invented as zero.
- **Hover:** selected provider summary and every reported sub-limit.
- **Click:** exact reset dates and times; click again to collapse.
- **Colour:** available headroom, from comfortable to close to the limit.

The three providers keep stable positions even when one temporarily stops reporting. Claude may expose model-specific weekly limits. Codex and Antigravity may expose different model families. A depleted global weekly limit blocks every short window, while a model-specific weekly limit only affects the same model. The headline always takes the strictest real value and the panel names its source.

## Provider sources

### Claude

The widget reads the Claude Code session from the macOS Keychain or `~/.claude/.credentials.json`, then calls only:

```text
GET https://api.anthropic.com/api/oauth/usage
```

It never refreshes or persists the token. On macOS, an authentication failure exposes a **Connect Claude** button that opens Terminal with the fixed command `claude auth login`. Claude Code remains responsible for authentication and renewal.

### Codex

The widget starts the official local Codex App Server while refreshing and reads:

```text
account/rateLimits/read
```

Codex owns authentication and token renewal. The widget never reads `auth.json`. API-key-only accounts do not expose ChatGPT subscription quotas. If Codex omits a window, the corresponding ring stays dotted.

### Antigravity

The widget discovers the local Antigravity process and requests its service on `127.0.0.1`. Its local CSRF token stays in memory and is never written or logged. Antigravity must be running for its quota to be available.

## Refresh, stale values and resource use

The normal refresh interval is five minutes. **Refresh now** in the menu bar asks immediately. The scheduler pauses around sleep and lock states, slows down while the machine is idle, obeys server throttling and backs off after failures.

A failed request never replaces a real value with zero. The last successful reading may remain visible for up to 24 hours, clearly marked stale. Only successful normalized readings enter the cache; raw provider error bodies are not persisted. State is written atomically with user-only permissions.

Configuration lives at `~/.config/marge-ai-widget/config.json`. Existing settings from `~/.config/claude-marge` are copied once for backwards compatibility.

## Settings

![Marge AI Widget settings on a fictional neutral desktop](docs/settings-showcase.png)

Everything applies immediately:

- fourteen neutral, light and period-specific themes;
- automatic, 24-hour or AM/PM time;
- vertical placement and multi-display behaviour;
- refresh interval from 30 seconds to one hour;
- configurable quota alerts;
- start at login and language selection;
- a global keep-visible shortcut;
- daily update checks, always manual to install.

The included themes are `midnight`, `graphite`, `nordic`, `ember`, `matcha`, `lilac`, `daylight`, `sand`, `glass`, `win95`, `winxp`, `aqua`, `win11` and `ubuntu`.

## Menu bar

- **Refresh now:** read all three providers immediately.
- **Show briefly:** reveal the widget without reaching for the edge.
- **Start at login:** toggle the supervised login service.
- **Keep visible:** pin the pill; the details panel still follows the pointer.
- **Settings:** open the full settings window.
- **Check for updates:** compare the installation with `main`.
- **Reveal configuration:** open the local JSON configuration.
- **Restart / Quit:** restart through the supervisor or deliberately stop.

The default global shortcut is `Cmd/Ctrl+Shift+M`.

## Privacy

- No analytics, telemetry or advertising.
- No copied or stored credentials.
- No hard-coded account, email or organization identifiers.
- Claude traffic goes only to `api.anthropic.com`.
- Codex traffic is owned by its official local App Server.
- Antigravity traffic stays on localhost.
- Logs contain percentages and state transitions, never credentials or raw responses.
- Demo values and documentation captures are never persisted as user state.

## Security model

Provider credentials stay in the main process and never enter the renderer. Context isolation, renderer sandboxing, restrictive CSPs, blocked navigation and denied browser permissions reduce the UI attack surface. Packaged builds enforce ASAR integrity and disable RunAsNode, Node environment injection and CLI inspection.

Installations use locked dependencies. Local snapshots exclude common environment files, private keys, provider configuration and authentication files. GitHub Actions are pinned to immutable commit SHAs and Dependabot monitors npm and workflow dependencies.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Please use GitHub private vulnerability reporting instead of a public issue when it is enabled.

## Compatibility

| System | Status | Notes |
| --- | --- | --- |
| macOS 13+, Apple Silicon | Supported and tested | LaunchAgent, menu bar application, Electron 44 |
| macOS 13+, Intel | Supported | Same code path; public binaries must include the architecture |
| Linux X11 | Supported and CI-tested | systemd user service; a compositor improves transparency |
| Linux Wayland | Partial | Global edge placement is not guaranteed by Electron |
| Windows | Not supported | Placement and autostart are not implemented |

Claude Pro/Max, ChatGPT subscription accounts exposed by Codex, and local Antigravity installations are normalized from the limits each application actually reports. No plan-specific quota is fabricated.

## Development and verification

```sh
npm ci
npm run electron:ensure
npm run check
npm run demo
npm run usage
npm run docs:capture
npm run dist:mac
```

`npm run check` runs 135 unit and integration checks across 17 files. Coverage includes provider normalization, missing windows, cache privacy, backoff, rate limits, atomic state, bounded logs, installer rollback, autostart, updates, alerts, localization, themes and multi-display geometry.

GitHub Actions runs Node 22.12 and Node 24 on macOS and Ubuntu, ShellCheck, two dependency audits and real Electron capture smoke tests on macOS and Linux X11.

Documentation scenes are reproducible with `npm run docs:capture`. They combine the real demo-mode Electron captures with a local HTML/CSS desktop template; no generated approximation of the application UI is used.

Local packages are unsigned. A public macOS binary must be signed and notarized before distribution. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## License and attribution

[MIT](LICENSE). This is an unofficial project and is not affiliated with, endorsed by or supported by Anthropic, OpenAI or Google.

The original Claude Marge work remains attributed through the Git history and license. AG Usage-derived work is credited in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
