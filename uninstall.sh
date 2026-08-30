#!/usr/bin/env bash
# Remove Marge AI Widget without touching provider credentials.
set -euo pipefail

APP_DIR="${MARGE_DIR:-$HOME/.marge-ai-widget}"
LABEL="com.claudemarge.widget"
PURGE=0

case "${1:-}" in
  '') ;;
  --purge) PURGE=1 ;;
  --help|-h)
    printf '%s\n' 'Usage: bash uninstall.sh [--purge]' \
      '  --purge also removes widget settings, state and Chromium caches.'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
esac

case "$APP_DIR" in
  ''|/|"$HOME") printf 'Unsafe installation directory: %s\n' "$APP_DIR" >&2; exit 1 ;;
  /*) ;;
  *) printf 'Installation directory must be absolute: %s\n' "$APP_DIR" >&2; exit 1 ;;
esac
case "$APP_DIR" in
  *$'\n'*|*$'\r'*|*'<'*|*'>'*|*'&'*|*'|'*|*'\'*)
    printf 'Installation directory contains unsupported characters.\n' >&2
    exit 1
    ;;
esac

if [ "$(uname -s)" = Darwin ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
else
  systemctl --user disable --now claude-marge.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/claude-marge.service"
  systemctl --user daemon-reload 2>/dev/null || true
fi

rm -f "$HOME/.local/bin/marge"
rm -rf "$HOME/Applications/Marge AI.app" "$HOME/Applications/Claude Marge.app"
rm -f "$HOME/.local/share/applications/marge-ai-widget.desktop"
rm -f "$HOME/.local/share/applications/claude-marge.desktop"
rm -rf -- "$APP_DIR"

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$HOME/.config/marge-ai-widget" "$HOME/.config/claude-marge"
  if [ "$(uname -s)" = Darwin ]; then
    rm -rf "$HOME/Library/Application Support/marge-ai-widget"
    rm -rf "$HOME/Library/Application Support/claude-marge-widget"
    rm -rf "$HOME/Library/Caches/marge-ai-widget"
    rm -rf "$HOME/Library/Caches/claude-marge-widget"
  fi
fi

printf 'Marge AI Widget removed. Provider credentials were not touched.\n'
[ "$PURGE" -eq 0 ] && printf 'Settings were kept. Use --purge to remove them too.\n'
