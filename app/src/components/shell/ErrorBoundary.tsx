import { Component, type ReactNode } from 'react'

/** Contains a render crash to one pane instead of blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 600 }}>{this.props.label} hit an error</div>
        <div style={{ color: 'var(--label-2)', fontSize: 'var(--text-footnote)' }}>{this.state.error.message}</div>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
