export type Item = {
  kind: 'pr' | 'issue'
  number: number
  title: string
  url: string
  author: string
  note: string
  updatedAt: number
}

export type Snapshot = {
  cwd: string
  repo: string
  me: string
  reviewRequested: Item[]
  toReview: Item[]
  mine: Item[]
  assigned: Item[]
  awaitingReply: Item[]
  error: string
  isLoading: boolean
  fetchedAt: number
}

export type Tab = 'pr' | 'issue' | 'mine'

declare module 'claude-code' {
  interface PluginState {
    'gh-review': { snapshot: Snapshot; tab: Tab }
  }
}
