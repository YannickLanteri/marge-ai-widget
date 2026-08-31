# Contributing

## Requirements

- Node.js 22.12 or newer.
- macOS 13+ or Linux for the complete runtime path.

## Development checks

```sh
npm ci
npm run electron:ensure
npm run check
npm run demo
npm run docs:capture
```

Before submitting a UI change, capture the real Electron output:

```sh
MARGE_DEMO=1 MARGE_CAPTURE=/tmp/marge-widget.png MARGE_CAPTURE_EXPANDED=1 npm run demo
MARGE_DEMO=1 MARGE_CAPTURE=/tmp/marge-settings.png MARGE_CAPTURE_SETTINGS=1 npm run demo
```

`npm run docs:capture` regenerates the neutral repository showcase images from those real demo captures. Documentation images must never contain real accounts, files, notifications or quota values.

Add tests for provider normalization, scheduling, persistence, installation or configuration changes. The test runner discovers every `test/*.test.js` file automatically.

Never commit credentials, raw provider responses containing account data, runtime state, logs, build outputs or `node_modules`.
