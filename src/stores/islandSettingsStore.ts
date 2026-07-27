import { create } from "zustand";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandCaptureStatus,
  type IslandSettings,
} from "@/types/islandSettings";

interface IslandSettingsState {
  readonly settings: IslandSettings;
  // Honest OS-derived capture status (T9), fed by the `get_island_capture_status` command. Null
  // until first queried; T7b renders it. Never inferred client-side (G2).
  readonly captureStatus: IslandCaptureStatus | null;
  // Replace the whole settings object - fed by the backend `island:settings` event and by reads.
  setSettings: (settings: IslandSettings) => void;
  setCaptureStatus: (captureStatus: IslandCaptureStatus) => void;
  reset: () => void;
}

export const useIslandSettingsStore = create<IslandSettingsState>((set) => ({
  settings: DEFAULT_ISLAND_SETTINGS,
  captureStatus: null,

  setSettings: (settings) => set({ settings }),

  setCaptureStatus: (captureStatus) => set({ captureStatus }),

  reset: () => set({ settings: DEFAULT_ISLAND_SETTINGS, captureStatus: null }),
}));
