import { benchmarks } from './benchmarks.generated'

export const img = (name: string) => `/landing/${name}.webp`

export type Modality = 'X-ray' | 'CT' | 'MRI'
export type Study = {
  id: string
  modality: Modality
  title: string
  series: string
  source?: string
  overlay: string
  overlayKind: 'recorded' | 'illustrative' | 'reference'
  finding: string
  region: string
  evidence: string
  model: string
  window: string
  layers: string[]
}

/** Every image here is built by app/scripts/build-landing-imagery.py; see public/landing/provenance.json. */
export const studies: Study[] = [
  { id: 'cxd_69598', modality: 'X-ray', title: 'Chest PA', series: 'cxd_69598 · ChestX-Det test', source: 'cxr-69598', overlay: 'cxr-69598-skanda', overlayKind: 'recorded', finding: 'Consolidation', region: 'Left & right mid zone', evidence: 'Skanda outlines, recorded in-app', model: 'Skanda V1', window: 'W 100 · L 100', layers: ['Source film', 'Skanda outline · L mid zone', 'Skanda outline · R mid zone', 'Pleural effusion · R'] },
  { id: 'cxd_45707', modality: 'X-ray', title: 'Chest PA', series: 'cxd_45707 · ChestX-Det test', overlay: 'cxr-45707-heat', overlayKind: 'recorded', finding: 'Opacity · effusion', region: 'Left lower zone', evidence: 'Classifier evidence map, recorded', model: 'MedGemma + classifier', window: 'W 100 · L 100', layers: ['Source film', 'Evidence heatmap', 'Finding boxes 1–4'] },
  { id: 'skull', modality: 'X-ray', title: 'Skull lateral', series: 'Radiograph reconstructed from CT', source: 'xr-skull-lateral', overlay: 'xr-skull-lateral-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Frontoparietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'DRR · bone', layers: ['Reconstructed radiograph', 'Attention map', 'Region bracket'] },
  { id: 'ct', modality: 'CT', title: 'CT head', series: 'Slicer CTBrain · axial 46', source: 'ct-axial-brain', overlay: 'ct-axial-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Left parietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'W 90 · L 40', layers: ['Axial slice 46', 'Attention map', 'Region bracket'] },
  { id: 'brats', modality: 'MRI', title: 'Brain MRI T1c', series: 'BraTS glioma · axial 75', source: 'mri-brats-75', overlay: 'mri-brats-75-skanda', overlayKind: 'recorded', finding: 'Enhancing tumour', region: 'Left cerebral hemisphere', evidence: 'Skanda outline + box, recorded', model: 'Skanda V1', window: 'T1 post-contrast', layers: ['Axial 75 / 155', 'Skanda outline', 'Candidate box'] },
  { id: 'mr', modality: 'MRI', title: 'MR head', series: 'Slicer MRHead · sagittal', source: 'mr-sagittal', overlay: 'mr-sagittal-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Parietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'T1 · auto', layers: ['Sagittal midline', 'Attention map', 'Region bracket'] },
]

export const wall = [
  'cxr-69598', 'ct-axial-brain', 'mri-brats-75-skanda', 'xr-skull-lateral', 'mr-axial', 'cxr-45707-heat', 'ct-sagittal', 'mr-coronal',
  'ct-axial-bone', 'mri-brats-skanda-boxes', 'mr-sagittal', 'xr-skull-ap', 'ct-axial-heat', 'cxr-69598-skanda', 'mr-axial-high', 'ct-coronal',
  'mri-brats-75-reference', 'xr-skull-lateral-heat', 'ct-axial-low', 'mr-axial-low', 'mr-sagittal-heat', 'ct-axial-high', 'mri-brats-75',
]

export const reads = [
  { image: 'cxr-69598-skanda', title: 'Bilateral consolidation', meta: 'Chest X-ray · Skanda outlines' },
  { image: 'mri-brats-75-skanda', title: 'Enhancing tumour', meta: 'Brain MRI · Skanda outline' },
  { image: 'cxr-45707-heat', title: 'Evidence heatmap', meta: 'Chest X-ray · classifier map' },
  { image: 'ct-axial-heat', title: 'Axial attention', meta: 'CT head · illustrative' },
  { image: 'mri-brats-skanda-boxes', title: 'Three candidate regions', meta: 'Brain MRI · Skanda boxes' },
  { image: 'xr-skull-lateral-heat', title: 'Skull lateral', meta: 'Radiograph from CT · illustrative' },
  { image: 'mr-sagittal-heat', title: 'Sagittal attention', meta: 'MR head · illustrative' },
  { image: 'mri-brats-75-reference', title: 'Radiologist reference', meta: 'Brain MRI · BraTS label' },
  { image: 'ct-coronal', title: 'Coronal reformat', meta: 'CT head · source' },
  { image: 'xr-skull-ap', title: 'Skull AP', meta: 'Radiograph from CT · source' },
  { image: 'mr-axial', title: 'Axial T1', meta: 'MR head · source' },
  { image: 'ct-axial-bone', title: 'Bone window', meta: 'CT head · source' },
]

export const faqs: [string, string][] = [
  ['What is Skanda V1?', 'Skanda is the base model behind VoxelRad AI. It reads chest X-rays and axial CT and MRI slices, writes a structured report, and points to where each finding is with a box and an outline. On the held-out chest X-ray split it gets the right finding type 40.5% of the time (run-3 checkpoint); the page’s other Skanda figures come from the run-2 results committed in benchmark/.'],
  ['How were MedGemma and MAIRA-2 compared?', 'All three models read the same 111 held-out ChestX-Det films, labelled and boxed by three radiologists, and were scored by the same script (benchmark/score.py). Skanda read every film twice, so its figures are the mean of both reads. Intervals are Wilson 95%.'],
  ['Are the scans and heatmaps on this page real?', 'The chest films and BraTS MRI overlays are crops of real model output recorded in the app. The CT and MR head teaching volumes carry no labelled finding, so their heatmaps are marked as illustrative. Skull radiographs are reconstructed from the public CT volume.'],
  ['Where does Skanda fall short?', 'On the held-out split it found 2 of 10 pneumothoraces and few small nodules, and its CT tumour outlines remain poor. MedGemma found all 10 pneumothoraces. Every model finding stays a draft until a clinician reviews it.'],
  ['Is VoxelRad AI a diagnostic device?', 'No. It is a research and evaluation workspace. It has not been clinically validated, and any clinical use needs independent validation and review by a qualified professional.'],
  ['How do I get access?', 'Sign in with an account your workspace administrator has created. Skanda runs on your own GPU server. The weights and serving scripts are documented in the Skanda reader guide.'],
]

export const models = benchmarks
export type ModelKey = (typeof benchmarks)[number]['key']
export const modelColor: Record<ModelKey, string> = { skanda: 'var(--sk-blue)', medgemma: '#8f8f8f', maira: 'var(--sk-amber)' }
