import { ShellButton } from './ShellButton'
import { Component, type ReactNode } from 'react'

/** Contains a render crash to one pane instead of blanking the whole app. */
interface Props {
  children: ReactNode
  label: string
  resetKey?: unknown
}
interface State {
  error: Error | null
  resetKey?: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  /** A new resetKey (e.g. another image selected) clears the error without a setState in an update hook. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
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
        <ShellButton className="btn" onClick={() => this.setState({ error: null })}>Try again</ShellButton>
      </div>
    )
  }
}
