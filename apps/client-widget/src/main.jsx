import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class WidgetErrorBoundary extends React.Component {
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
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#991b1b", background: "#fef2f2", minHeight: "100vh" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Erreur d affichage BOB</div>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}</pre>
      <button type="button" onClick={() => this.setState({ error: null })} style={{ marginTop: 10, padding: "4px 10px", cursor: "pointer" }}>Réessayer</button>
    </div>
  );
}
return this.props.children;
}
}

ReactDOM.createRoot(document.getElementById("root")).render(
<React.StrictMode>
<WidgetErrorBoundary>
  <App />
</WidgetErrorBoundary>
</React.StrictMode>
);
