#!/usr/bin/env bash
# Installs the claude-mods plugins and status line for Claude Code.
#
#   ./install.sh                 install gh-review from the marketplace and the status line
#   ./install.sh --dev           work from this clone: load the mods from it, symlink the
#                                status line, opt the clone in to repo-sync
#   ./install.sh --no-statusline skip the status line
#   ./install.sh --no-plugins    skip the plugins
#
# Also runs without a clone:
#   curl -fsSL https://raw.githubusercontent.com/debba/claude-mods/main/install.sh | bash
set -euo pipefail

REPO="debba/claude-mods"
MARKETPLACE="debba-claude-mods"
RAW="https://raw.githubusercontent.com/$REPO/main"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
STAMP="$(date +%Y%m%d%H%M%S)"

mode="user"
with_statusline=1
with_plugins=1
for arg in "$@"; do
  case "$arg" in
    --dev) mode="dev" ;;
    --no-statusline) with_statusline=0 ;;
    --no-plugins) with_plugins=0 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\033[34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }

need jq
command -v gh >/dev/null 2>&1 || warn "gh not found: gh-review and the status line PR number need it (https://cli.github.com)"

# The clone this script lives in, when it runs from one.
clone=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "$dir/.claude-plugin/marketplace.json" ]] && clone="$dir"
fi
if [[ "$mode" == "dev" && -z "$clone" ]]; then
  echo "--dev runs from a clone: git clone https://github.com/$REPO && cd claude-mods && ./install.sh --dev" >&2
  exit 1
fi

mkdir -p "$CLAUDE_DIR"
[[ -f "$SETTINGS" ]] || echo '{}' >"$SETTINGS"
settings_backed_up=0

# Applies a jq filter to settings.json, backing it up once per run.
edit_settings() {
  if (( ! settings_backed_up )); then
    cp "$SETTINGS" "$SETTINGS.bak.$STAMP"
    settings_backed_up=1
    say "Backed up settings.json to settings.json.bak.$STAMP"
  fi
  local tmp
  tmp="$(mktemp)"
  jq "$@" "$SETTINGS" >"$tmp" && mv "$tmp" "$SETTINGS"
}

# --- plugins -----------------------------------------------------------------

if (( with_plugins )); then
  if [[ "$mode" == "dev" ]]; then
    dirs="$clone/plugins/gh-review:$clone/plugins/repo-sync"
    say "Loading the mods from $clone/plugins (CLAUDE_CODE_PLUGIN_DIRS)"
    edit_settings --arg dirs "$dirs" '.env = ((.env // {}) + {CLAUDE_CODE_PLUGIN_DIRS: $dirs})'
    git -C "$clone" config claude-mods.autosync true
    say "Opted this clone in to repo-sync (git config claude-mods.autosync true)"
  else
    need claude
    say "Adding the $REPO marketplace"
    claude plugin marketplace add "$REPO" || warn "marketplace add failed (already added?)"
    say "Installing gh-review"
    claude plugin install "gh-review@$MARKETPLACE"
  fi
fi

# --- status line ---------------------------------------------------------------

if (( with_statusline )); then
  target="$CLAUDE_DIR/statusline.sh"
  if [[ -e "$target" || -L "$target" ]]; then
    mv "$target" "$target.bak.$STAMP"
    say "Backed up the existing status line to statusline.sh.bak.$STAMP"
  fi
  if [[ "$mode" == "dev" ]]; then
    ln -s "$clone/statusline/statusline.sh" "$target"
    say "Linked $target to the clone"
  elif [[ -n "$clone" ]]; then
    install -m 755 "$clone/statusline/statusline.sh" "$target"
    say "Installed $target"
  else
    curl -fsSL "$RAW/statusline/statusline.sh" -o "$target"
    chmod 755 "$target"
    say "Downloaded $target"
  fi
  edit_settings '.statusLine = {type: "command", command: "~/.claude/statusline.sh", padding: 0}'
fi

say "Done. Restart Claude Code to load the changes."
