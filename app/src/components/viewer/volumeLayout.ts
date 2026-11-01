import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'

// Workspace preferences follow the reader between scans; patient/image state never does.
interface VolumeLayout {
  readingMode: boolean
  multiPlane: boolean
  showLocator: boolean
  showReviewPanel: boolean
  panelWidth: number
  spatialHeight: number
  toolsOpen: boolean
  threeDToolsOpen: boolean
}
const DEFAULT_LAYOUT: VolumeLayout = {
  readingMode: true, multiPlane: false, showLocator: true, showReviewPanel: true,
  panelWidth: 300, spatialHeight: 340, toolsOpen: false, threeDToolsOpen: false,
}
const useVolumeLayout = create<VolumeLayout>(() => ({...DEFAULT_LAYOUT}))
export function resetVolumeLayout() { useVolumeLayout.setState({...DEFAULT_LAYOUT}) }
export function useVolumePreference<K extends keyof VolumeLayout>(key: K): [VolumeLayout[K], Dispatch<SetStateAction<VolumeLayout[K]>>] {
  const value = useVolumeLayout((state) => state[key])
  const setValue: Dispatch<SetStateAction<VolumeLayout[K]>> = (next) => {
    useVolumeLayout.setState((state) => ({ [key]: typeof next === 'function' ? (next as (value: VolumeLayout[K]) => VolumeLayout[K])(state[key]) : next }))
  }
  return [value, setValue]
}
