import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Item, Snapshot, Tab } from '../types'

const PANE = 'gh-review'
const TITLE = 'GitHub'
const REFRESH_MS = 5 * 60 * 1000

const EMPTY: Snapshot = {
  cwd: '',
  repo: '',
  me: '',
  reviewRequested: [],
  toReview: [],
  mine: [],
  assigned: [],
  awaitingReply: [],
  error: '',
  isLoading: false,
  fetchedAt: 0,
}

const snapshot = atom({ plugin: 'gh-review', key: 'snapshot' } as const, EMPTY)
const activeTab = atom({ plugin: 'gh-review', key: 'tab' } as const, 'pr' as Tab)

type Login = { login?: string; name?: string } | null

type RawCommon = { number: number; title: string; url: string; author: Login; updatedAt?: string }

export type RawPr = RawCommon & {
  isDraft: boolean
  reviewDecision: string
  reviewRequests: Login[]
}

export type RawIssue = RawCommon & {
  assignees: Login[]
  comments: { author: Login }[]
  labels: { name: string }[]
}

const loginOf = (who: Login) => who?.login ?? who?.name ?? '?'

const DECISIONS: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'review required',
}

const toItem = (kind: Item['kind'], raw: RawCommon, note: string): Item => ({
  kind,
  number: raw.number,
  title: raw.title,
  url: raw.url,
  author: loginOf(raw.author),
  note,
  updatedAt: raw.updatedAt ? Date.parse(raw.updatedAt) : 0,
})

export const classifyPrs = (prs: RawPr[], me: string) => {
  const reviewRequested: Item[] = []
  const toReview: Item[] = []
  const mine: Item[] = []
  for (const pr of prs) {
    const decision = DECISIONS[pr.reviewDecision] ?? 'no review'
    if (loginOf(pr.author) === me) {
      mine.push(toItem('pr', pr, pr.isDraft ? 'draft' : decision))
    } else if (pr.reviewRequests.some(who => loginOf(who) === me)) {
      reviewRequested.push(toItem('pr', pr, decision))
    } else if (!pr.isDraft && pr.reviewDecision !== 'APPROVED') {
      toReview.push(toItem('pr', pr, decision))
    }
  }

  return { reviewRequested, toReview, mine }
}

export const classifyIssues = (issues: RawIssue[], me: string) => {
  const assigned: Item[] = []
  const awaitingReply: Item[] = []
  for (const issue of issues) {
    const labels = issue.labels.map(label => label.name).join(', ')
    const count = issue.comments.length
    const note = [`${count} comment${count === 1 ? '' : 's'}`, labels].filter(Boolean).join(' · ')
    const last = issue.comments.at(-1)
    const lastAuthor = last ? loginOf(last.author) : loginOf(issue.author)
    if (issue.assignees.some(who => loginOf(who) === me)) {
      assigned.push(toItem('issue', issue, note))
    } else if (lastAuthor !== me) {
      awaitingReply.push(toItem('issue', issue, note))
    }
  }

  return { assigned, awaitingReply }
}

export const ageOf = (updatedAt: number, now: number) => {
  if (!updatedAt || !now) return ''
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)

  return days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`
}

const fit = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

const gh = async ($: Engine, cwd: string, args: string[]) => {
  const ran = await $.process.run(['gh', ...args], { cwd, timeoutMs: 60_000 })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `gh ${args[0]} exit ${ran.exitCode}`)

  return ran.stdout
}

const refresh = async ($: Engine) => {
  const cwd = await $.session.cwd()
  await update($, snapshot, value => ({ ...(value ?? EMPTY), isLoading: true }))
  try {
    const repo = JSON.parse(await gh($, cwd, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner as string
    const me = (await gh($, cwd, ['api', 'user', '--jq', '.login'])).trim()
    const [prJson, issueJson] = await Promise.all([
      gh($, cwd, [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title,url,author,updatedAt,isDraft,reviewDecision,reviewRequests',
      ]),
      gh($, cwd, [
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title,url,author,updatedAt,assignees,comments,labels',
      ]),
    ])
    const prs = classifyPrs(JSON.parse(prJson) as RawPr[], me)
    const issues = classifyIssues(JSON.parse(issueJson) as RawIssue[], me)
    const fetchedAt = await $.clock.now()
    await update($, snapshot, () => ({ ...EMPTY, ...prs, ...issues, cwd, repo, me, fetchedAt }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, snapshot, () => ({ ...EMPTY, cwd, error: message }))
  }
}

const openInBrowser = async ($: Engine, item: Item) => {
  const cwd = await $.session.cwd()
  const ran = await $.process.run(['gh', item.kind, 'view', String(item.number), '--web'], { cwd })
  $.ui.toast(ran.exitCode === 0 ? `Opening #${item.number} in the browser` : `Could not open #${item.number}`)
}

export const claudePrompt = (item: Item) =>
  item.kind === 'pr'
    ? `Handle PR #${item.number} "${item.title}" (${item.url}). ` +
      `Read it with \`gh pr view ${item.number} --comments\` and \`gh pr diff ${item.number}\`, ` +
      'summarize what changes, flag problems or risks and suggest next steps. ' +
      'Do not comment, approve or merge without asking me first.'
    : `Handle issue #${item.number} "${item.title}" (${item.url}). ` +
      `Read it with \`gh issue view ${item.number} --comments\`, understand the problem, ` +
      'find the code involved and propose a fix or a draft reply. ' +
      'Do not post comments without asking me first.'

const handInClaude = async ($: Engine, item: Item) => {
  const filled = await $.prompt.fill({ text: claudePrompt(item) })
  $.ui.toast(
    filled.isFilled
      ? `Prompt for #${item.number} ready: review it and press Enter`
      : `Cannot write to the prompt right now`,
  )
}

const isPaneOpen = async ($: Engine) => (await $.ui.panes()).some(pane => pane.id === PANE)

const togglePane = async ($: Engine) => {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })

    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  void refresh($)

  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gh-review',
      description: 'Toggle the pane with the GitHub issues and PRs to check (arg: refresh)',
    })
    // The old version pinned a status line; the band above the prompt replaces it.
    $.ui.status(undefined)
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'gh-review' }, async ($, e) => {
    if (e.args.trim() === 'refresh') {
      await refresh($)

      return { text: 'Issues and PRs refreshed.' }
    }
    const isOpen = await togglePane($)

    return { text: isOpen ? 'GitHub pane opened.' : 'GitHub pane closed.' }
  })

  // Repo changes when the session moves to another directory: refetch after the turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const current = await read($, snapshot)
    if (!current.isLoading && current.cwd !== (await $.session.cwd())) void refresh($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const data = await read($, snapshot)
    const tab = await read($, activeTab)
    const width = Math.max(30, e.props.bodyColumns ?? e.viewport?.columns ?? 80)

    const row = (item: Item, accent: string) => (
      <Box
        key={`row-${item.kind}-${item.number}`}
        flexDirection="column"
        paddingX={1}
        hover={{ backgroundColor: 'promptBorder' }}
      >
        <Box flexDirection="row" gap={1}>
          <Text color={accent} bold>
            {`#${item.number}`.padEnd(6)}
          </Text>
          <Button
            plain
            key={`open-${item.kind}-${item.number}`}
            label={fit(item.title, width - 22)}
            hover={{ color: 'permission', underline: true }}
            onPress={() => void openInBrowser($, item)}
          />
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor wrap="truncate-end">
            {`       @${item.author} · ${item.note}${item.updatedAt ? ` · ${ageOf(item.updatedAt, data.fetchedAt)} ago` : ''}`}
          </Text>
          <Button
            plain
            dimColor
            key={`claude-${item.kind}-${item.number}`}
            label="✦ Claude"
            hover={{ color: 'claude' }}
            onPress={() => void handInClaude($, item)}
          />
          <Button
            plain
            dimColor
            key={`web-${item.kind}-${item.number}`}
            label="↗ web"
            hover={{ color: 'permission' }}
            onPress={() => void openInBrowser($, item)}
          />
        </Box>
      </Box>
    )

    const section = (title: string, items: Item[], accent: string) => (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={accent} bold>
            {title}
          </Text>
          <Text dimColor>{`${items.length}`}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(Math.min(width, 60))}</Text>
        {items.length === 0 && <Text dimColor>{'  ✓ nothing to do'}</Text>}
        {items.map(item => row(item, accent))}
      </Box>
    )

    const prCount = data.reviewRequested.length + data.toReview.length
    const issueCount = data.assigned.length + data.awaitingReply.length
    const tabButton = (id: Tab, label: string, hotkey: string) => (
      <Button
        key={`tab-${id}`}
        hotkey={hotkey}
        variant={tab === id ? 'primary' : 'secondary'}
        dimColor={tab !== id}
        onPress={() => void update($, activeTab, () => id)}
      >
        {label}
      </Button>
    )

    const updatedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString().slice(0, 5) : '…'

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
          <Text bold wrap="truncate-end">
            {data.repo !== '' ? `⎇  ${data.repo}` : '⎇  GitHub'}
          </Text>
          <Text dimColor wrap="truncate-end">
            {data.isLoading
              ? '⟳ refreshing…'
              : data.repo !== ''
                ? `@${data.me} · updated at ${updatedAt}`
                : 'no repository'}
          </Text>
          {data.repo !== '' && (
            <Box flexDirection="row" gap={2}>
              <Text color="permission">{`● ${data.reviewRequested.length + data.assigned.length} for you`}</Text>
              <Text>{`◆ ${prCount} PR`}</Text>
              <Text>{`◇ ${issueCount} issue`}</Text>
            </Box>
          )}
        </Box>

        {data.error !== '' && (
          <Box borderStyle="round" borderColor="error" paddingX={1} marginTop={1}>
            <Text color="error" wrap="wrap">
              {`No GitHub repository in ${data.cwd}\n${data.error}`}
            </Text>
          </Box>
        )}

        {data.repo !== '' && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            {tabButton('pr', `PR ${prCount}`, '1')}
            {tabButton('issue', `Issue ${issueCount}`, '2')}
            {tabButton('mine', `Mine ${data.mine.length}`, '3')}
          </Box>
        )}

        {data.repo !== '' && tab === 'pr' && (
          <Box flexDirection="column">
            {section('◉ Review requested from you', data.reviewRequested, 'permission')}
            {section('◆ To review', data.toReview, 'text')}
          </Box>
        )}
        {data.repo !== '' && tab === 'issue' && (
          <Box flexDirection="column">
            {section('◉ Assigned to you', data.assigned, 'permission')}
            {section('◇ Awaiting your reply', data.awaitingReply, 'text')}
          </Box>
        )}
        {data.repo !== '' && tab === 'mine' && section('◆ Your PRs', data.mine, 'success')}

        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="refresh" hotkey="r" variant="primary" onPress={() => void refresh($)}>
            {data.isLoading ? 'Refreshing…' : '⟳ Refresh'}
          </Button>
          <Button key="close" hotkey="x" role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>
            ✕ Close
          </Button>
        </Box>
        <Text dimColor>{'title / ↗ web: browser · ✦ Claude: draft a prompt · 1/2/3 tabs · r refresh · x close'}</Text>
      </Box>
    )
  })

  // Compact bar above the prompt in place of the engine's status line; other plugins' rows stay below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, snapshot)
    if (e.props.hasSurvey || data.repo === '') return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const forMe = data.reviewRequested.length + data.assigned.length
    const prCount = data.reviewRequested.length + data.toReview.length
    const issueCount = data.assigned.length + data.awaitingReply.length
    const openOn = (tab: Tab) => async () => {
      await update($, activeTab, () => tab)
      if (!(await isPaneOpen($))) await togglePane($)
    }

    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box key="gh-band" flexDirection="row" gap={2} paddingX={1}>
          <Text color="permission" bold>{`⎇ ${data.repo}`}</Text>
          {forMe > 0 && <Text color="permission">{`● ${forMe} for you`}</Text>}
          <Button
            plain
            key="band-pr"
            label={`◆ ${prCount} PR`}
            hover={{ color: 'permission' }}
            onPress={() => void openOn('pr')()}
          />
          <Button
            plain
            key="band-issue"
            label={`◇ ${issueCount} issue`}
            hover={{ color: 'permission' }}
            onPress={() => void openOn('issue')()}
          />
          <Button
            plain
            dimColor
            key="band-toggle"
            label="▤ pane"
            hover={{ color: 'permission' }}
            onPress={() => void togglePane($)}
          />
          {data.isLoading && <Text dimColor>⟳</Text>}
        </Box>
        {below}
      </Box>
    )
  })
}
