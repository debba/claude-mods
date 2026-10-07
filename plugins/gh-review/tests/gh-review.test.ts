import { describe, expect, test } from 'claude-code/testing'

import { ageOf, claudePrompt, classifyIssues, classifyPrs } from '../hooks/register'
import type { RawIssue, RawPr } from '../hooks/register'

const pr = (over: Partial<RawPr>): RawPr => ({
  number: 1, title: 't', url: 'u', author: { login: 'other' },
  isDraft: false, reviewDecision: 'REVIEW_REQUIRED', reviewRequests: [], ...over,
})

const issue = (over: Partial<RawIssue>): RawIssue => ({
  number: 1, title: 't', url: 'u', author: { login: 'other' },
  assignees: [], comments: [], labels: [], ...over,
})

describe('gh-review', () => {
  test('PRs split into requested, to review and mine', async () => {
    const out = classifyPrs([
      pr({ number: 1, reviewRequests: [{ login: 'me' }] }),
      pr({ number: 2 }),
      pr({ number: 3, isDraft: true }),
      pr({ number: 4, reviewDecision: 'APPROVED' }),
      pr({ number: 5, author: { login: 'me' }, reviewDecision: 'CHANGES_REQUESTED' }),
    ], 'me')
    expect(out.reviewRequested.map(i => i.number)).toEqual([1])
    expect(out.toReview.map(i => i.number)).toEqual([2])
    expect(out.mine.map(i => i.number)).toEqual([5])
    expect(out.mine[0]?.note).toBe('changes requested')
  })

  test('issues the maintainer already answered last are left out', async () => {
    const out = classifyIssues([
      issue({ number: 1, assignees: [{ login: 'me' }] }),
      issue({ number: 2 }),
      issue({ number: 3, comments: [{ author: { login: 'me' } }] }),
      issue({ number: 4, comments: [{ author: { login: 'me' } }, { author: { login: 'x' } }], labels: [{ name: 'bug' }] }),
      issue({ number: 5, author: { login: 'me' } }),
    ], 'me')
    expect(out.assigned.map(i => i.number)).toEqual([1])
    expect(out.awaitingReply.map(i => i.number)).toEqual([2, 4])
    expect(out.awaitingReply[1]?.note).toBe('2 comments · bug')
  })
})

describe('ageOf', () => {
  test('formats minutes, hours and days', async () => {
    expect(ageOf(0, 1)).toBe('')
    expect(ageOf(1_000_000, 1_000_000 + 5 * 60_000)).toBe('5m')
    expect(ageOf(1_000_000, 1_000_000 + 3 * 3_600_000)).toBe('3h')
    expect(ageOf(1_000_000, 1_000_000 + 4 * 86_400_000)).toBe('4d')
  })
})

describe('claudePrompt', () => {
  test('PR and issue prompts name the right gh commands and stay hands-off', async () => {
    const base = { number: 7, title: 'x', url: 'u', author: 'a', note: '', updatedAt: 0 }
    const prText = claudePrompt({ ...base, kind: 'pr' })
    expect(prText).toContain('gh pr diff 7')
    expect(prText).toContain('without asking me first')
    expect(claudePrompt({ ...base, kind: 'issue' })).toContain('gh issue view 7 --comments')
  })
})
