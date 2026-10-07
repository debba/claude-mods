# claude-mods

My mods for [Claude Code](https://claude.com/claude-code) and my status line.

## Mods

### gh-review

Shows the GitHub issues and pull requests to check for the repository in the current working directory, using the `gh` CLI.

- A bar above the prompt: repository, items waiting on you, open PRs and issues. Click a count to open the pane on that tab.
- A closable pane with three tabs (PRs, issues, your PRs). Each row shows author, review state or labels, and age.
- Click a title (or `↗ web`) to open it in the browser.
- `✦ Claude` drafts a prompt in the input box to handle that PR or issue inside Claude Code. Nothing is sent until you press Enter, and the prompt asks Claude not to comment, approve or merge without asking.
- `/gh-review` toggles the pane, `/gh-review refresh` refreshes. Data refreshes every 5 minutes and when the session changes directory.

Requires `gh` installed and authenticated (`gh auth login`).

### repo-sync

Keeps a clone of this repository committed, and leaves the push to you. After each Claude Code turn, and every two minutes, it validates the plugins that changed and commits everything with a message naming what changed (`Update gh-review, statusline`). When local commits are waiting, a row above the prompt shows `⇡ claude-mods: N to push` with a **Push** button. `/repo-sync` commits now, `/repo-sync push` commits and pushes.

It does nothing unless the clone opts in:

```sh
git config claude-mods.autosync true
```

The flag lives in the clone's local git config, so forks and installed copies never commit on their own.

## Install

At the Claude Code prompt:

```
/plugin install gh-review --marketplace debba/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

## Status line

`statusline/statusline.sh` shows the model, git branch and PR, context usage, 5-hour and weekly limits, time to the 5-hour reset and a link to the usage dashboard. It needs `jq`, and `gh` for the PR number.

```sh
cp statusline/statusline.sh ~/.claude/statusline.sh
# or, to edit it in the clone:
ln -s "$PWD/statusline/statusline.sh" ~/.claude/statusline.sh
```

Then in `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 0 }
```

## Developing

Load the mods straight from the clone, so edits hot-reload in every session. In `~/.claude/settings.json`:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/claude-mods/plugins/gh-review:~/Projects/claude-mods/plugins/repo-sync"
}
```

Check a mod with `claude plugin validate plugins/<name>` and `claude plugin test plugins/<name>`.

## License

MIT
