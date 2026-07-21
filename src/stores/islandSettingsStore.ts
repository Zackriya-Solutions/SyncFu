import { create } from "zustand";
import {
  DEFAULT_ISLAND_SETTINGS,
  type IslandSettings,
} from "@/types/islandSettings";

interface IslandSettingsState {
  readonly settings: IslandSettings;
  // Replace the whole settings object - fed by the backend `island:settings` event and by reads.
  setSettings: (settings: IslandSettings) => void;
  reset: () => void;
}

export const useIslandSettingsStore = create<IslandSettingsState>((set) => ({
  settings: DEFAULT_ISLAND_SETTINGS,

  setSettings: (settings) => set({ settings }),

  reset: () => set({ settings: DEFAULT_ISLAND_SETTINGS }),
}));
