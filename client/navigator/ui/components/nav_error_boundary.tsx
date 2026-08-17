import { Component } from "preact";
import type { ComponentChildren } from "preact";

type Props = { slot: string; children: ComponentChildren };
type State = { error?: string };

export class NavErrorBoundary extends Component<Props, State> {
  state: State = {};

  componentDidCatch(error: unknown) {
    console.error("navigator: render error", error);
    this.setState({
      error: error instanceof Error ? error.message : String(error),
    });
  }

  render() {
    if (this.state.error === undefined) return this.props.children;
    const { slot } = this.props;
    return (
      <div className={`sb-nav-root sb-nav-root-${slot}`}>
        <div className="sb-nav-body">
          <div className="sb-nav-error">{this.state.error}</div>
        </div>
      </div>
    );
  }
}
