import { create } from "zustand";
import type { HistoryEntry, Priority } from "@/types/notification";

export type DateRange = "today" | "7d" | "30d" | "all";

interface HistoryState {
  readonly entries: readonly HistoryEntry[];
  readonly selectedId: string | null;
  readonly search: string;
  readonly senderFilter: string | null;
  readonly priorityFilter: Priority | null;
  readonly dateRange: DateRange;
  readonly loading: boolean;
  readonly senders: readonly string[];
  setEntries: (entries: readonly HistoryEntry[]) => void;
  prependEntry: (entry: HistoryEntry) => void;
  selectEntry: (id: string | null) => void;
  setSearch: (search: string) => void;
  setSenderFilter: (sender: string | null) => void;
  setPriorityFilter: (priority: Priority | null) => void;
  setDateRange: (range: DateRange) => void;
  setLoading: (loading: boolean) => void;
  setSenders: (senders: readonly string[]) => void;
  clearFilters: () => void;
  reset: () => void;
}

const initialState = {
  entries: [] as readonly HistoryEntry[],
  selectedId: null as string | null,
  search: "",
  senderFilter: null as string | null,
  priorityFilter: null as Priority | null,
  dateRange: "all" as DateRange,
  loading: false,
  senders: [] as readonly string[],
};

export const useHistoryStore = create<HistoryState>((set) => ({
  ...initialState,

  setEntries: (entries) => set({ entries }),

  // Idempotent by id: a notification is recorded at most once. This is the
  // double-ingest guard for history wiring - the backend broadcasts one
  // `history:add` per notification and only the main window ingests it, but a
  // redelivered event or a StrictMode double-listener must never duplicate a row.
  prependEntry: (entry) =>
    set((state) =>
      state.entries.some((e) => e.id === entry.id)
        ? state
        : { entries: [entry, ...state.entries] }
    ),

  selectEntry: (id) => set({ selectedId: id }),

  setSearch: (search) => set({ search }),

  setSenderFilter: (sender) => set({ senderFilter: sender }),

  setPriorityFilter: (priority) => set({ priorityFilter: priority }),

  setDateRange: (range) => set({ dateRange: range }),

  setLoading: (loading) => set({ loading }),

  setSenders: (senders) => set({ senders }),

  clearFilters: () =>
    set({
      search: "",
      senderFilter: null,
      priorityFilter: null,
      dateRange: "all",
    }),

  reset: () => set(initialState),
}));
