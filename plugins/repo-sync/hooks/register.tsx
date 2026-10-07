import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Pending } from '../types'

// Opt-in flag, kept in the clone's local git config so it never travels with the repo:
//   git config claude-mods.autosync true
const FLAG = 'claude-mods.autosync'
const INTERVAL_MS = 2 * 60 * 1000

const pending = atom({ plugin: 'repo-sync', key: 'pending' } as const, {
  ahead: 0,
  lastSubject: '',
  isPushing: false,
} as Pending)

/** Parses `git status --porcelain` into changed paths (renames keep the new path). */
export const changedPaths = (porcelain: string) =>
  porcelain
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.slice(3).split(' -> ').at(-1)!.replace(/^"|"$/g, ''))

/** Groups paths into the areas a commit message names: a plugin, the statusline, or the repo. */
export const areasOf = (paths: string[]) => {
  const areas = new Set<string>()
  for (const path of paths) {
    const [top, name] = path.split('/')
    if (top === 'plugins' && name) areas.add(name)
    else if (top === 'statusline') areas.add('statusline')
    else areas.add('repo')
  }

  return [...areas].sort()
}

export const pluginsOf = (paths: string[]) =>
  [...new Set(paths.filter(path => path.startsWith('plugins/')).map(path => path.split('/')[1]!))].sort()

export const commitMessage = (paths: string[]) => {
  const subject = `Update ${areasOf(paths).join(', ')}`
  const body = paths.map(path => `- ${path}`).join('\n')

  return [subject, body] as const
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

const git = ($: Engine, cwd: string, args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 60_000 })

/** The clone's root when it opted in, otherwise undefined. */
const optedInRoot = async ($: Engine) => {
  const top = await git($, $.plugin.root, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return undefined
  const root = top.stdout.trim()
  const flag = await git($, root, ['config', '--get', FLAG])

  return flag.stdout.trim() === 'true' ? root : undefined
}

const countAhead = async ($: Engine, root: string) => {
  const ahead = await git($, root, ['rev-list', '--count', '@{upstream}..HEAD'])

  return ahead.exitCode === 0 ? Number(ahead.stdout.trim()) || 0 : 0
}

// One commit pass at a time; a reload starts over, which is harmless.
let isCommitting = false

/** Validates the plugins that changed and commits everything. Never pushes. */
const commitChanges = async ($: Engine) => {
  if (isCommitting) return
  isCommitting = true
  try {
    const root = await optedInRoot($)
    if (root === undefined) return

    const status = await git($, root, ['status', '--porcelain', '--untracked-files=all'])
    const paths = changedPaths(status.stdout)
    if (paths.length > 0) {
      for (const plugin of pluginsOf(paths)) {
        const dir = `${root}/plugins/${plugin}`
        if ((await $.fs.stat(dir).catch(() => null)) === null) continue
        const checked = await $.process.run(['claude', 'plugin', 'validate', dir], { timeoutMs: 120_000 })
        if (checked.exitCode !== 0) {
          $.ui.toast(`repo-sync: ${plugin} does not validate, not committing`)
          return
        }
      }

      const [subject, body] = commitMessage(paths)
      await git($, root, ['add', '--all'])
      const commit = await git($, root, ['commit', '--quiet', '-m', subject, '-m', body])
      if (commit.exitCode !== 0) {
        $.ui.toast(`repo-sync: commit failed: ${firstLine(commit.stderr)}`)
        return
      }
      await update($, pending, value => ({ ...value, lastSubject: subject }))
    }

    const ahead = await countAhead($, root)
    await update($, pending, value => ({ ...value, ahead }))
  } finally {
    isCommitting = false
  }
}

const push = async ($: Engine) => {
  const root = await optedInRoot($)
  if (root === undefined) return
  await update($, pending, value => ({ ...value, isPushing: true }))
  try {
    const pull = await git($, root, ['pull', '--rebase', '--autostash', '--quiet'])
    const pushed = pull.exitCode === 0 ? await git($, root, ['push', '--quiet']) : pull
    $.ui.toast(pushed.exitCode === 0 ? 'repo-sync: pushed to GitHub' : `repo-sync: push failed: ${firstLine(pushed.stderr)}`)
  } finally {
    const ahead = await countAhead($, root)
    await update($, pending, value => ({ ...value, ahead, isPushing: false }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'repo-sync', description: 'Commit pending changes to claude-mods (arg: push)' })
    // The timer also catches edits made outside Claude Code (an editor, the statusline script).
    $.clock.every(INTERVAL_MS, () => void commitChanges($))
    void commitChanges($)

    return next(e)
  })

  on('command.run', { command: 'repo-sync' }, async ($, e) => {
    await commitChanges($)
    if (e.args.trim() === 'push') await push($)
    const { ahead } = await read($, pending)

    return { text: ahead > 0 ? `${ahead} commit(s) waiting to be pushed.` : 'claude-mods is up to date.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void commitChanges($)

    return result
  })

  // Adds a push row under whatever else draws above the prompt (gh-review's bar, for one).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, pending)
    if (e.props.hasSurvey || state.ahead === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="repo-sync-band" flexDirection="row" gap={2} paddingX={1}>
          <Text color="permission" bold>{`⇡ claude-mods: ${state.ahead} to push`}</Text>
          {state.lastSubject !== '' && <Text dimColor wrap="truncate-end">{state.lastSubject}</Text>}
          <Button key="repo-sync-push" variant="primary" onPress={() => void push($)}>
            {state.isPushing ? 'Pushing…' : 'Push'}
          </Button>
        </Box>
      </Box>
    )
  })
}
