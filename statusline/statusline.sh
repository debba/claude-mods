#!/usr/bin/env bash
# Status line: model | branch | PR | ctx bar | 5h bar | weekly bar | time to 5h reset | dashboard link
input=$(cat)

model=$(jq -r '.model.display_name // "Claude"' <<<"$input")
ctx=$(jq -r '.context_window.used_percentage // 0 | floor' <<<"$input")
five=$(jq -r '.rate_limits.five_hour.used_percentage // empty | floor' <<<"$input")
five_reset=$(jq -r '.rate_limits.five_hour.resets_at // empty' <<<"$input")
week=$(jq -r '.rate_limits.seven_day.used_percentage // empty | floor' <<<"$input")
cwd=$(jq -r '.workspace.current_dir // .cwd // empty' <<<"$input")

# colors
R=$'\e[0m'; B=$'\e[1m'; DIM=$'\e[2m'
WHITE=$'\e[97m'; YEL=$'\e[33m'; GRN=$'\e[32m'; PUR=$'\e[35m'; CYAN=$'\e[36m'; UL=$'\e[4m'

bar() { # bar <pct> <color> <width>
  local pct=${1:-0} color=$2 width=${3:-8}
  (( pct > 100 )) && pct=100
  (( pct < 0 )) && pct=0
  local filled=$(( (pct * width + 50) / 100 ))
  local empty=$(( width - filled ))
  local s=""
  local i
  for (( i=0; i<filled; i++ )); do s+="█"; done
  for (( i=0; i<empty; i++ )); do s+="░"; done
  printf "[%s%s%s%s]" "$color" "$s" "$R" "$DIM"
}

# git branch + PR (PR lookup via gh, cached 5 min per repo/branch)
branch=""; pr_num=""; pr_url=""
if [[ -n "$cwd" ]] && git -C "$cwd" rev-parse --is-inside-work-tree &>/dev/null; then
  branch=$(git -C "$cwd" symbolic-ref --short -q HEAD || git -C "$cwd" rev-parse --short HEAD)
  if command -v gh &>/dev/null; then
    root=$(git -C "$cwd" rev-parse --show-toplevel)
    cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/claude-statusline"
    mkdir -p "$cache_dir"
    cache="$cache_dir/$(printf '%s' "$root/$branch" | md5sum | cut -c1-32)"
    if [[ ! -f "$cache" ]] || (( $(date +%s) - $(stat -c %Y "$cache") > 300 )); then
      (cd "$cwd" && timeout 3 gh pr view --json number,url -q '"\(.number) \(.url)"') >"$cache.tmp" 2>/dev/null \
        || : >"$cache.tmp"
      mv "$cache.tmp" "$cache"
    fi
    read -r pr_num pr_url <"$cache"
  fi
fi

out="${B}${WHITE}${model}${R} "
if [[ -n "$branch" ]]; then
  out+="${GRN}${branch}${R} "
  if [[ -n "$pr_num" ]]; then
    out+="${CYAN}"$'\e]8;;'"${pr_url}"$'\e\\'"#${pr_num}"$'\e]8;;\e\\'"${R} "
  fi
fi
out+="ctx $(bar "$ctx" "$WHITE") ${WHITE}${ctx}%${R}"

if [[ -n "$five" ]]; then
  out+="  5h $(bar "$five" "$YEL") ${YEL}${five}%${R}"
fi
if [[ -n "$week" ]]; then
  out+="  weekly $(bar "$week" "$PUR") ${PUR}${week}%${R}"
fi
if [[ -n "$five_reset" ]]; then
  now=$(date +%s)
  left=$(( five_reset - now ))
  if (( left > 0 )); then
    h=$(( left / 3600 )); m=$(( (left % 3600) / 60 ))
    out+="  ${WHITE}${h}h${m}m${R}"
  fi
fi

# OSC 8 clickable hyperlink
out+="  ${CYAN}${UL}"$'\e]8;;https://claude.ai/settings/usage\e\\'"dashboard"$'\e]8;;\e\\'"${R}"

printf "%s" "$out"
