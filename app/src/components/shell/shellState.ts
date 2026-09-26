// OWNER: Agent 5. Shared shell-layout state (collapsible sidebar / inspector) so
// App, Toolbar and Inspector can drive the same animation without store coupling.
import { create } from 'zustand'

interface ShellState {
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  toggleSidebar: () => void
  toggleInspector: () => void
  setSidebarCollapsed: (v: boolean) => void
  setInspectorCollapsed: (v: boolean) => void
}

export const useShell = create<ShellState>()((set) => ({
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setInspectorCollapsed: (v) => set({ inspectorCollapsed: v }),
}))