import { useApp } from '../store'
import { filesToStudyImages } from './imageIntake'
import { toast } from '../components/shell/toastStore'

/** Add files to the active study (creating one if needed). Reports partial failures via toast. */
export async function addFilesToActiveStudy(files: File[]): Promise<void> {
  const usable = files.filter((f) => f.size > 0)
  if (!usable.length) return
  const st = useApp.getState()
  const studyId = st.activeStudyId ?? st.createStudy()
  try {
    const imgs = await filesToStudyImages(usable)
    useApp.getState().addImages(studyId, imgs)
    const skipped = usable.length - imgs.length
    toast(
      `Added ${imgs.length} image${imgs.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (unsupported)` : ''}`,
      skipped ? 'info' : 'success',
    )
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not read those files.', 'error')
  }
}
