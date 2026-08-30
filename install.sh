#!/usr/bin/env bash
# Marge AI Widget installer for macOS and Linux.
#
# Local checkout: bash install.sh --local
# Remote release: MARGE_REPO=https://github.com/YannickLanteri/marge-ai-widget.git bash install.sh --repo
set -euo pipefail

LABEL="com.claudemarge.widget"
APP_DIR="${MARGE_DIR:-$HOME/.marge-ai-widget}"
REPO="${MARGE_REPO:-}"
MODE=""
SOURCE_DIR=""
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
[ -f "$SCRIPT_SOURCE" ] && SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
fail() { printf '\033[31m  %s\033[0m\n' "$1" >&2; exit 1; }
usage() {
  printf '%s\n' \
    'Usage: bash install.sh --local [source-directory]' \
    '       MARGE_REPO=https://github.com/YannickLanteri/marge-ai-widget.git bash install.sh --repo' \
    '' \
    'Options:' \
    '  --local [dir]  Install an atomic snapshot of a local checkout.' \
    '  --repo [url]   Clone a Git repository. MARGE_REPO is also accepted.' \
    '  --help         Show this help.'
}

case "${1:-}" in
  --local)
    MODE=local
    if [ -n "${2:-}" ] && [ "${2#--}" = "$2" ]; then SOURCE_DIR="$2"; else SOURCE_DIR="$SCRIPT_DIR"; fi
    ;;
  --repo)
    MODE=repo
    if [ -n "${2:-}" ] && [ "${2#--}" = "$2" ]; then REPO="$2"; fi
    ;;
  --help|-h) usage; exit 0 ;;
  '')
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
      MODE=local
      SOURCE_DIR="$SCRIPT_DIR"
    elif [ -n "$REPO" ]; then
      MODE=repo
    else
      usage
      fail "No repository is configured yet. Run this file from the checkout with --local."
    fi
    ;;
  *) usage; fail "Unknown option: $1" ;;
esac

case "$APP_DIR" in
  ''|/|"$HOME") fail "Unsafe installation directory: $APP_DIR" ;;
  /*) ;;
  *) fail "The installation directory must be absolute: $APP_DIR" ;;
esac
case "$APP_DIR" in
  *$'\n'*|*$'\r'*|*'<'*|*'>'*|*'&'*|*'|'*|*'\'*)
    fail "The installation directory contains unsupported characters."
    ;;
esac

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux) OS=linux ;;
  *) fail "Unsupported system: $(uname -s). macOS and Linux only." ;;
esac

bold "Marge AI Widget"
info "System: $OS"

if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || fail "Node.js 22.12 or newer is required."
NODE_VERSION="$(node -p 'process.versions.node')"
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<EOF
$NODE_VERSION
EOF
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  fail "Node.js 22.12 or newer is required (found v$NODE_VERSION)."
fi
info "Node: v$NODE_VERSION"

if [ "$MODE" = local ]; then
  [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ] || fail "Invalid local source: $SOURCE_DIR"
  SOURCE_DIR="$(cd -P "$SOURCE_DIR" && pwd)"
  info "Source: local snapshot"
else
  command -v git >/dev/null 2>&1 || fail "git is required for a repository install."
  [ -n "$REPO" ] || fail "Set MARGE_REPO or pass a repository URL after --repo."
  if [[ ! "$REPO" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]] &&
     [[ ! "$REPO" =~ ^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]; then
    fail "Only canonical GitHub repository URLs are accepted."
  fi
  info "Source: $REPO"
fi

APP_PARENT="$(dirname "$APP_DIR")"
mkdir -p "$APP_PARENT"
STAGING="$(mktemp -d "${APP_DIR}.staging.XXXXXX")"
BACKUP="${APP_DIR}.rollback.$$"
INSTALL_LOG="$(mktemp "${TMPDIR:-/tmp}/marge-ai-widget-install.XXXXXX")"
if [ "$OS" = mac ]; then
  SERVICE_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
else
  SERVICE_FILE="$HOME/.config/systemd/user/claude-marge.service"
fi
SERVICE_BACKUP="${BACKUP}.service"
[ -f "$SERVICE_FILE" ] && cp "$SERVICE_FILE" "$SERVICE_BACKUP"
SWAPPED=0
COMMITTED=0

stop_service() {
  if [ "$OS" = mac ]; then
    DOMAIN="gui/$(id -u)"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
      sleep 0.2
    done
  else
    systemctl --user stop claude-marge.service 2>/dev/null || true
  fi
}

bootstrap_macos() {
  DOMAIN="gui/$(id -u)"
  for _ in 1 2 3 4 5; do
    launchctl bootstrap "$DOMAIN" "$SERVICE_FILE" >/dev/null 2>&1 && return 0
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && return 0
    sleep 0.4
  done
  launchctl bootstrap "$DOMAIN" "$SERVICE_FILE"
}

cleanup() {
  STATUS=$?
  if [ "$STATUS" -ne 0 ] && [ "$SWAPPED" -eq 1 ]; then
    stop_service
    rm -rf -- "$APP_DIR"
    [ -d "$BACKUP" ] && mv "$BACKUP" "$APP_DIR"
    if [ -f "$SERVICE_BACKUP" ]; then
      mv -f "$SERVICE_BACKUP" "$SERVICE_FILE"
    else
      rm -f -- "$SERVICE_FILE"
    fi
    if [ -d "$APP_DIR" ]; then
      if [ "$OS" = mac ]; then
        bootstrap_macos 2>/dev/null || true
      else
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user start claude-marge.service 2>/dev/null || true
      fi
    fi
  fi
  [ -n "${STAGING:-}" ] && [ -d "$STAGING" ] && rm -rf -- "$STAGING"
  if [ "$COMMITTED" -eq 1 ]; then
    [ -d "$BACKUP" ] && rm -rf -- "$BACKUP"
    rm -f -- "$SERVICE_BACKUP"
    rm -f -- "$INSTALL_LOG"
  elif [ "$STATUS" -ne 0 ]; then
    rm -f -- "$SERVICE_BACKUP"
    printf '  Installation log: %s\n' "$INSTALL_LOG" >&2
  fi
}
trap cleanup EXIT

if [ "$MODE" = local ]; then
  tar -C "$SOURCE_DIR" \
    --exclude='./.git' --exclude='./node_modules' --exclude='./dist' \
    --exclude='./.env' --exclude='./.env.*' --exclude='./.envrc' \
    --exclude='./.claude' --exclude='./.codex' --exclude='./.cursor' --exclude='./.vscode' \
    --exclude='./auth.json' --exclude='./config.json' --exclude='./state.json' \
    --exclude='*.key' --exclude='*.pem' --exclude='*.p12' \
    --exclude='*.cer' --exclude='*.crt' --exclude='*.mobileprovision' \
    --exclude='./widget.log' --exclude='./widget.log.1' --exclude='./widget.log.2' \
    --exclude='./.DS_Store' -cf - . | tar -C "$STAGING" -xf -
else
  git clone --quiet --depth 1 "$REPO" "$STAGING"
fi

[ -f "$STAGING/install/runtime/package-lock.json" ] || fail "Runtime lockfile is missing."
APP_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$STAGING/package.json")"
ELECTRON_VERSION="$(node -e \
  'process.stdout.write(require(process.argv[1]).dependencies.electron)' \
  "$STAGING/install/runtime/package.json")"
info "Installing the locked Electron runtime"
npm ci --prefix "$STAGING/install/runtime" --foreground-scripts --no-audit --no-fund \
  >"$INSTALL_LOG" 2>&1 || {
    tail -n 8 "$INSTALL_LOG" >&2
    fail "Runtime installation failed."
  }

electron_binary() {
  if [ "$OS" = mac ]; then
    printf '%s\n' "$STAGING/install/runtime/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  else
    printf '%s\n' "$STAGING/install/runtime/node_modules/electron/dist/electron"
  fi
}

electron_works() {
  BINARY="$(electron_binary)"
  [ -x "$BINARY" ] || return 1
  ELECTRON_RUN_AS_NODE=1 "$BINARY" -e 'process.exit(0)' >/dev/null 2>&1
}

if ! electron_works; then
  info "Repairing the Electron archive"
  ( cd "$STAGING/install/runtime/node_modules/electron" && node install.js ) \
    >>"$INSTALL_LOG" 2>&1 || true
fi

if ! electron_works && [ "$OS" = mac ]; then
  ARCHIVE="$(find "$HOME/Library/Caches/electron" \
    -name "electron-v${ELECTRON_VERSION}-darwin-*.zip" -print 2>/dev/null | head -n 1)"
  if [ -n "$ARCHIVE" ]; then
    rm -rf -- "$STAGING/install/runtime/node_modules/electron/dist"
    mkdir -p "$STAGING/install/runtime/node_modules/electron/dist"
    ditto -x -k "$ARCHIVE" "$STAGING/install/runtime/node_modules/electron/dist"
    printf '%s\n' 'Electron.app' > "$STAGING/install/runtime/node_modules/electron/path.txt"
  fi
fi
electron_works || fail "Electron was downloaded but cannot start."
info "Electron: ready"

info "Running the full test suite"
( cd "$STAGING" && node test/run.js ) >>"$INSTALL_LOG" 2>&1 || {
  tail -n 12 "$INSTALL_LOG" >&2
  fail "Tests failed; the existing installation was not changed."
}

if [ -e "$APP_DIR" ]; then
  [ -f "$APP_DIR/package.json" ] || fail "$APP_DIR exists and is not a Marge AI installation."
  grep -q '"name": "marge-ai-widget"' "$APP_DIR/package.json" ||
    fail "$APP_DIR belongs to another application."
fi

stop_service
[ -e "$BACKUP" ] && fail "Rollback directory already exists: $BACKUP"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$BACKUP"
mv "$STAGING" "$APP_DIR"
STAGING=""
SWAPPED=1

ESCAPED_APP_DIR="$(printf '%s' "$APP_DIR" | sed 's/[&|]/\\&/g')"
if [ "$OS" = mac ]; then
  PLIST="$SERVICE_FILE"
  mkdir -p "$HOME/Library/LaunchAgents"
  sed "s|__APP_DIR__|$ESCAPED_APP_DIR|g" \
    "$APP_DIR/install/com.claudemarge.widget.plist.template" > "$PLIST.tmp"
  mv "$PLIST.tmp" "$PLIST"
  launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  bootstrap_macos
  info "Login item: $PLIST"
else
  UNIT="$SERVICE_FILE"
  mkdir -p "$HOME/.config/systemd/user"
  sed "s|__APP_DIR__|$ESCAPED_APP_DIR|g" \
    "$APP_DIR/install/claude-marge.service.template" > "$UNIT.tmp"
  mv "$UNIT.tmp" "$UNIT"
  systemctl --user daemon-reload
  systemctl --user enable --now claude-marge.service
  info "Login service: $UNIT"
fi

mkdir -p "$HOME/.local/bin"
ln -sfn "$APP_DIR/bin/marge" "$HOME/.local/bin/marge"

if [ "$OS" = mac ]; then
  LAUNCHER="$HOME/Applications/Marge AI.app"
  mkdir -p "$LAUNCHER/Contents/MacOS" "$LAUNCHER/Contents/Resources"
  cp "$APP_DIR/build/icon.icns" "$LAUNCHER/Contents/Resources/icon.icns"
  cat > "$LAUNCHER/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Marge AI</string>
  <key>CFBundleIdentifier</key><string>com.claudemarge.launcher</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$APP_VERSION</string>
  <key>LSBackgroundOnly</key><true/>
</dict></plist>
PLIST
  printf '#!/bin/sh\nexec "%s/bin/marge" start\n' "$APP_DIR" > "$LAUNCHER/Contents/MacOS/launch"
  chmod +x "$LAUNCHER/Contents/MacOS/launch"
  touch "$LAUNCHER"
  info "Launcher: $LAUNCHER"
else
  DESKTOP="$HOME/.local/share/applications/marge-ai-widget.desktop"
  mkdir -p "$(dirname "$DESKTOP")"
  cat > "$DESKTOP" <<DESKTOP_FILE
[Desktop Entry]
Type=Application
Name=Marge AI Widget
Comment=Show Claude, Codex and Antigravity quotas
Exec=$APP_DIR/bin/marge start
Icon=$APP_DIR/build/icon.png
Terminal=false
Categories=Utility;
DESKTOP_FILE
  info "Launcher: $DESKTOP"
fi

COMMITTED=1
sleep 4
LOG="$APP_DIR/widget.log"
STATE=""
[ -f "$LOG" ] && STATE="$(grep -o 'ok .*' "$LOG" | tail -n 1 || true)"

bold "Installed."
case "$STATE" in
  ok*) info "Providers: ${STATE#ok }" ;;
  *) info "Open Claude, Codex and Antigravity once if a source stays unavailable." ;;
esac
info "Move the pointer to the right edge of the screen."
info "Commands: marge, marge status, marge logs, marge stop"
info "Uninstall: bash $APP_DIR/uninstall.sh"
