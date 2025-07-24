import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./themes/ThemeProvider";
import { RecordingProvider } from "./contexts/RecordingContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <RecordingProvider>
        <App />
      </RecordingProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
