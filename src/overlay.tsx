import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import "./overlay.css";

// Overlay window initialized

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);