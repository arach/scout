/**
 * The desktop companion's own runtime.
 *
 * The Mac app's companion panel loads `/companion.html`, not the app shell:
 * React, the companion screen, its host bridge and the broker stream — no
 * router, no `ScoutProvider`, no app stylesheet. `/embed/companion` stays as
 * the browser preview inside the full app.
 */

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { scoutThemeAugmentVars } from "../lib/theme-vars.ts";
import {
  applyScoutThemeToDocument,
  resolveScoutNativeThemeVars,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
} from "../lib/theme.ts";
import { CompanionScreen } from "../screens/companion/CompanionScreen.tsx";
import "./runtime.css";

const theme = resolveScoutStartupTheme();
const template = resolveScoutStartupTemplate();
const appearance = resolveScoutStartupAppearanceDetails();
applyScoutThemeToDocument(theme, template, appearance);

/** The two theme scopes ScoutProvider draws, and nothing else it does. */
function CompanionRuntime() {
  const params = new URLSearchParams(window.location.search);
  const style = useMemo(
    () => ({ ...scoutThemeAugmentVars(theme), ...(resolveScoutNativeThemeVars() ?? {}) }),
    [],
  );
  return (
    <div
      data-scout-theme-mode={theme}
      data-scout-palette={appearance.palette}
      data-scout-contrast={appearance.contrast}
      data-scout-accent={appearance.accent}
      data-scout-shell={appearance.shell}
      data-scout-avatar-style={appearance.avatarStyle}
      data-hudson-theme={theme}
      data-hudson-template={template}
      style={style}
    >
      <div data-scout-theme={theme} style={{ display: "contents" }}>
        {/* The same root classes the embed host stamps; companion.css keys off both. */}
        <div className="s-discovered-embed s-companion-embed" data-scout-surface="companion">
          <CompanionScreen
            embedded
            navigate={() => {}}
            workIds={params.get("workIds")?.trim() || undefined}
            mode={params.get("mode")?.trim() || undefined}
          />
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <CompanionRuntime />
  </StrictMode>,
);
