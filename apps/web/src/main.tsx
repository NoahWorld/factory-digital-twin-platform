import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { initializeUiTheme } from "./theme/ui-theme";
import "./styles.css";
import "./theme/theme-palette.css";

const initialUiTheme = initializeUiTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider initialState={initialUiTheme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
