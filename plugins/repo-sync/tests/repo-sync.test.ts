import { describe, expect, test } from 'claude-code/testing'

import { areasOf, changedPaths, commitMessage, pluginsOf } from '../hooks/register'

describe('repo-sync', () => {
  test('porcelain lines become paths, renames keep the new one', async () => {
    const porcelain = ' M plugins/gh-review/hooks/register.tsx\n?? statusline/new.sh\nR  README.md -> docs/README.md\n'
    expect(changedPaths(porcelain)).toEqual([
      'plugins/gh-review/hooks/register.tsx',
      'statusline/new.sh',
      'docs/README.md',
    ])
  })

  test('commit subject names the areas touched', async () => {
    const paths = ['plugins/gh-review/a.ts', 'plugins/repo-sync/b.ts', 'statusline/statusline.sh', 'README.md']
    expect(areasOf(paths)).toEqual(['gh-review', 'repo', 'repo-sync', 'statusline'])
    expect(pluginsOf(paths)).toEqual(['gh-review', 'repo-sync'])
    expect(commitMessage(['statusline/statusline.sh'])[0]).toBe('Update statusline')
  })
})
