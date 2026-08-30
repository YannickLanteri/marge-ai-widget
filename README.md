# Marge AI Widget

Claude, Codex and Antigravity quotas at the right edge of the screen.

Move the pointer to the edge and the widget slides in without taking focus. Move away and it disappears. The three services keep stable positions even when one of them temporarily stops reporting a limit.

[Français](README.fr.md)

![Marge AI Widget showing Claude, Codex and Antigravity quotas](docs/widget.png)

## At a glance

- Inner ring: short window, normally five hours.
- Outer ring: weekly window.
- Number on the right: remaining percentage of the service’s strictest limit.
- Dotted ring: the service did not report that window; it is never faked as zero.
- Hover: selected provider breakdown.
- Click: exact reset dates and times; click again to collapse.

Claude may expose model-specific weekly limits. Antigravity separates Gemini from Claude/GPT. The headline always uses the actual strictest value and the panel names its source.

## Install from a checkout

Requirements: macOS 13+ or Linux X11, and Node.js 22.12 or newer.

```sh
git clone https://github.com/YannickLanteri/marge-ai-widget.git marge-ai-widget
cd marge-ai-widget
bash install.sh --local
```

The installer builds an atomic local snapshot in `~/.marge-ai-widget`, installs only the locked Electron runtime, runs the full test suite, registers autostart and then launches the widget. A failed installation leaves the previous version untouched.

```sh
marge
marge status
marge logs
marge stop
```

A local snapshot is updated by running `bash install.sh --local` again. Git-based remote installs also expose `marge update`.

Uninstall without touching provider sessions:

```sh
bash ~/.marge-ai-widget/uninstall.sh
```

Settings are kept by default. Add `--purge` to remove widget settings and caches as well. Provider sessions are never removed.

## Where the numbers come from

### Claude

The widget reads the Claude Code session from the macOS Keychain or `~/.claude/.credentials.json`, then calls only:

```text
GET https://api.anthropic.com/api/oauth/usage
```

It never refreshes or stores the token. On macOS, an authentication error exposes a
**Connect Claude** button that opens Terminal with the fixed command `claude auth login`.
Claude Code remains responsible for saving and renewing its own session.

### Codex

The widget starts the official local Codex App Server when refreshing and reads:

```text
account/rateLimits/read
```

Codex owns authentication and token renewal. The widget never reads `auth.json`. API-key-only accounts do not expose ChatGPT subscription quotas.

If the official response omits a five-hour or weekly window, its ring stays dotted rather than showing invented data.

### Antigravity

The widget discovers the local Antigravity process and asks its service on `127.0.0.1`. Its local CSRF token stays in memory and is never written or logged. Antigravity must be running for its quota to be available.

## Privacy

- No analytics or telemetry.
- No copied or stored credentials.
- Claude traffic goes only to `api.anthropic.com`.
- Codex traffic is owned by its official App Server.
- Antigravity traffic stays on localhost.
- Logs contain percentages and states, never secrets.

## Refreshing and stale data

The default refresh interval is five minutes. It slows down while the machine is idle and respects server throttling. After an error, the last real value may remain visible for up to 24 hours and is clearly marked stale. Demo values are never persisted.

Configuration lives at `~/.config/marge-ai-widget/config.json`. Existing `~/.config/claude-marge` settings are copied once for backwards compatibility. Fourteen themes, multiple displays, configurable alerts and a global pin shortcut are included.

![Marge AI Widget settings](docs/settings.png)

## Development

```sh
npm ci
npm run electron:ensure
npm test
npm run check
npm run demo
MARGE_DEMO=1 MARGE_CAPTURE=/tmp/marge-ai.png npm run demo
npm run usage
npm run dist:mac
```

Tests cover configuration boundaries, the installer, bounded logs, multi-display geometry, all three providers, missing windows, persistence, backoff, alerts, languages, themes and updates. CI also captures the real Electron widget and settings window.

Local packages are unsigned. Public macOS binaries must be signed and notarized before distribution.

## Security

Renderer sandboxing, context isolation, restrictive CSPs, denied navigation and denied browser permissions keep provider sessions outside the UI. Packaged builds also enforce ASAR integrity and disable RunAsNode, Node environment injection and CLI inspection. State files are written atomically with user-only permissions. See [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## Compatibility

- macOS 13+, Intel and Apple Silicon: supported.
- Linux X11: supported.
- Linux Wayland: partial; global Electron positioning is not guaranteed.
- Windows: widget placement is not implemented.

## License

[MIT](LICENSE). Unofficial project, not affiliated with Anthropic, OpenAI or Google. Original Claude Marge work remains attributed through the Git history and license; AG Usage-derived work is credited in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
