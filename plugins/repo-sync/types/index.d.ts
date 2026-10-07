export type Pending = {
  /** Local commits not yet on the upstream branch. */
  ahead: number
  /** Subject of the last commit repo-sync made, if any. */
  lastSubject: string
  isPushing: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'repo-sync': { pending: Pending }
  }
}
