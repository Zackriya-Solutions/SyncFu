import { useState } from "react";
import { HistoryView } from "./HistoryView";
import { IslandSettingsPanel } from "./IslandSettingsPanel";

// Main window shell. Layout-slot decision (T7b): the island settings surface is a
// second sidebar section beside History - a tray menu cannot host 13 controls.
// History stays the default view, so this is additive and does not regress it.
type MainView = "history" | "island";

export function MainApp() {
  const [view, setView] = useState<MainView>("history");

  return (
    <div data-testid="main-app-root" className="main-app">
      <aside className="sidebar">
        <nav>
          <button
            className={`nav-item${view === "history" ? " active" : ""}`}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => setView("history")}
          >
            History
          </button>
          <button
            className={`nav-item${view === "island" ? " active" : ""}`}
            aria-current={view === "island" ? "page" : undefined}
            onClick={() => setView("island")}
          >
            Island
          </button>
        </nav>
      </aside>
      <main className="content">
        {view === "history" ? <HistoryView /> : <IslandSettingsPanel />}
      </main>
    </div>
  );
}
