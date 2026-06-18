import { Component, type ReactNode } from "react";
import { strings } from "../i18n/en";

/**
 * State for the ErrorBoundary class component. When `error` is non-null
 * the boundary renders the recovery screen; otherwise it renders its
 * children transparently.
 */
interface State {
  error: Error | null;
}

/**
 * ErrorBoundary — the last line of defense against an uncaught React
 * render error blanking out the page.
 *
 * What it does:
 * - Intercepts any error thrown synchronously inside a descendant's
 * render function or lifecycle (this is React's contract for error
 * boundaries — they do NOT catch async errors, event-handler errors,
 * or errors thrown in effects after the first render).
 * - On catch, swaps the subtree for a styled recovery card containing
 * the error message, a "Dismiss" button (reset to render children
 * again), and a "Reload" button (full page reload).
 * - Logs the error + React component stack to the console so a
 * developer can locate the failing component in DevTools.
 *
 * Why a class component? React's hooks API still has no equivalent for
 * `componentDidCatch` / `getDerivedStateFromError`. Until that ships,
 * boundaries must be class components — this is an intentional choice,
 * not a refactor TODO.
 *
 * Mounted near the very top of the React tree (just inside the providers
 * but outside the router) so it can catch crashes from any routed page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(
    error: Error,
    info: { componentStack?: string | null },
  ): void {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="min-h-screen grid place-items-center p-6 bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100"
        >
          <div className="card card-pad max-w-md text-center">
            <h1 className="text-xl font-semibold mb-2">
              {strings.errors.boundaryTitle}
            </h1>
            <p className="text-sm text-ink-600 dark:text-ink-400 mb-4">
              {strings.errors.boundaryBody}
            </p>
            <pre className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 p-3 rounded mb-4 whitespace-pre-wrap text-left">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                className="btn-secondary"
                onClick={this.reset}
              >
                {strings.errors.dismiss}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => window.location.reload()}
              >
                {strings.errors.reload}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
