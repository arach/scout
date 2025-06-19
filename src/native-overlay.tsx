import React from "react";
import ReactDOM from "react-dom/client";
import { NativeOverlayDemo } from "./components/NativeOverlayDemo";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div style={{ 
      minHeight: '100vh', 
      background: '#1e1e1e', 
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <NativeOverlayDemo />
    </div>
  </React.StrictMode>
);