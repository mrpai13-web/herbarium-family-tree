import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
  where: string;
  copied: boolean;
}

/**
 * Last line of defence: a rendering error shows this note instead of a blank page.
 * The tree is safe either way (every edit is already saved in IndexedDB), so
 * "Reload" brings everything back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, where: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Herbarium crashed while drawing the page:', error, info.componentStack);
    this.setState({ where: info.componentStack ?? '' });
  }

  private details() {
    const { error, where } = this.state;
    return [
      `Herbarium error: ${error?.message}`,
      `When: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      '',
      (error?.stack ?? '').split('\n').slice(0, 8).join('\n'),
      '',
      'Components:',
      where.split('\n').filter(Boolean).slice(0, 8).join('\n'),
    ].join('\n');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="canvas-bg grid h-full place-items-center p-6">
        <div className="w-full max-w-md rounded-leaf border border-rule bg-card p-6 shadow-lift">
          <h1 className="font-display text-[22px]">Something went wrong drawing the tree</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            Your family tree is safe: every change was already saved in this browser. Reloading the page brings it back.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-leaf-sm bg-mist p-2 font-label text-[11px] text-ink-soft">
            {error.message}
          </pre>
          <p className="mt-2 text-[12px] text-ink-muted">If this keeps happening, press “Copy error details” and paste them to Claude, with what you did just before.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-solid" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              Try to continue
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(this.details());
                  this.setState({ copied: true });
                } catch {
                  /* clipboard blocked: the message is on screen anyway */
                }
              }}
            >
              {this.state.copied ? 'Copied' : 'Copy error details'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
