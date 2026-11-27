import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class ShadowErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#991b1b", background: "#fef2f2", height: "100%" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Erreur BOB</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

window.mountBobShadowWidget = function mountBobShadowWidget(shadowRoot) {
  let mountNode = shadowRoot.getElementById("bob-shadow-react-root");
  if (!mountNode) {
    mountNode = document.createElement("div");
    mountNode.id = "bob-shadow-react-root";
    mountNode.style.cssText = "width:100%;height:100%;display:flex;flex-direction:column;";
    shadowRoot.appendChild(mountNode);
  }
  if (!mountNode.__bobReactRoot) {
    mountNode.__bobReactRoot = ReactDOM.createRoot(mountNode);
  }
  mountNode.__bobReactRoot.render(
    <React.StrictMode>
      <ShadowErrorBoundary>
        <App />
      </ShadowErrorBoundary>
    </React.StrictMode>
  );
  return mountNode.__bobReactRoot;
};
