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
  { id: 'cxd_69598', modality: 'X-ray', title: 'Chest PA', series: 'cxd_69598 · ChestX-Det test', source: 'cxr-69598', overlay: 'cxr-69598-skanda', overlayKind: 'recorded', finding: 'Consolidation', region: 'Left & right mid zone', evidence: 'Skanda outlines, recorded in-app', model: 'Skanda', window: 'W 100 · L 100', layers: ['Source film', 'Skanda outline · L mid zone', 'Skanda outline · R mid zone', 'Pleural effusion · R'] },
  { id: 'cxd_45707', modality: 'X-ray', title: 'Chest PA', series: 'cxd_45707 · ChestX-Det test', overlay: 'cxr-45707-heat', overlayKind: 'recorded', finding: 'Opacity · effusion', region: 'Left lower zone', evidence: 'Classifier evidence map, recorded', model: 'MedGemma + classifier', window: 'W 100 · L 100', layers: ['Source film', 'Evidence heatmap', 'Finding boxes 1–4'] },
  { id: 'skull', modality: 'X-ray', title: 'Skull lateral', series: 'Radiograph reconstructed from CT', source: 'xr-skull-lateral', overlay: 'xr-skull-lateral-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Frontoparietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'DRR · bone', layers: ['Reconstructed radiograph', 'Attention map', 'Region bracket'] },
  { id: 'ct', modality: 'CT', title: 'CT head', series: 'Slicer CTBrain · axial 46', source: 'ct-axial-brain', overlay: 'ct-axial-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Left parietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'W 90 · L 40', layers: ['Axial slice 46', 'Attention map', 'Region bracket'] },
  { id: 'soop-47', modality: 'MRI', title: 'Brain MRI DWI', series: 'SOOP sub-47 · axial 16', source: 'soop-47-16', overlay: 'soop-47-16-skanda', overlayKind: 'recorded', finding: 'Acute ischaemic infarct', region: 'Left cerebral hemisphere', evidence: 'Skanda V1 candidate box, recorded in-app', model: 'Skanda', window: 'DWI b1000 · W 1100 · L 550', layers: ['Axial 16 / 26', 'Skanda candidate box'] },
  { id: 'mr', modality: 'MRI', title: 'MR head', series: 'Slicer MRHead · sagittal', source: 'mr-sagittal', overlay: 'mr-sagittal-heat', overlayKind: 'illustrative', finding: 'Attention map', region: 'Parietal', evidence: 'Illustrative overlay, no labelled finding', model: 'Illustration', window: 'T1 · auto', layers: ['Sagittal midline', 'Attention map', 'Region bracket'] },
]

export const wall = [
  'cxr-69598', 'ct-axial-brain', 'soop-47-16-skanda', 'xr-skull-lateral', 'mr-axial', 'cxr-45707-heat', 'ct-sagittal', 'mr-coronal',
  'ct-axial-bone', 'soop-47-16', 'mr-sagittal', 'xr-skull-ap', 'ct-axial-heat', 'cxr-69598-skanda', 'mr-axial-high', 'ct-coronal',
  'soop-47-16-reference', 'xr-skull-lateral-heat', 'ct-axial-low', 'mr-axial-low', 'mr-sagittal-heat', 'ct-axial-high',
]

export const reads = [
  { image: 'cxr-41481-skanda', title: 'Cardiomegaly', meta: 'Chest X-ray · Skanda outline, live' },
  { image: 'mrtumor1-76-skanda', title: 'Extra-axial tumour', meta: 'Brain MRI · Skanda outline, live' },
  { image: 'cxr-69598-skanda', title: 'Bilateral consolidation', meta: 'Chest X-ray · Skanda outlines' },
  { image: 'soop-47-16-skanda', title: 'Acute ischaemic infarct', meta: 'Brain MRI DWI · Skanda box' },
  { image: 'cxr-45707-heat', title: 'Evidence heatmap', meta: 'Chest X-ray · classifier map' },
  { image: 'ct-axial-heat', title: 'Axial attention', meta: 'CT head · illustrative' },
  { image: 'soop-47-16', title: 'Diffusion-weighted slice', meta: 'Brain MRI · SOOP source' },
  { image: 'xr-skull-lateral-heat', title: 'Skull lateral', meta: 'Radiograph from CT · illustrative' },
  { image: 'mr-sagittal-heat', title: 'Sagittal attention', meta: 'MR head · illustrative' },
  { image: 'soop-47-16-reference', title: 'Radiologist reference', meta: 'Brain MRI · SOOP lesion mask' },
  { image: 'ct-coronal', title: 'Coronal reformat', meta: 'CT head · source' },
  { image: 'xr-skull-ap', title: 'Skull AP', meta: 'Radiograph from CT · source' },
  { image: 'mr-axial', title: 'Axial T1', meta: 'MR head · source' },
  { image: 'ct-axial-bone', title: 'Bone window', meta: 'CT head · source' },
]

export type Faq = [question: string, answer: string, link?: { label: string; href: string }]
export const faqs: Faq[] = [
  ['What is Skanda V1?', 'Skanda V1 is the model the hosted RadGenis workspace serves: the run 4b checkpoint of the Skanda reader (Qwen3-VL-30B-A3B with SAM 2.1 outlines). It reads chest X-rays and CT and MRI slices, writes a structured report and outlines each finding. On held-out cases it names the right finding type 39% of the time on chest X-ray, 68% on CT and 84% on MRI, and clears 76%, 91% and 94% of normal cases. Its weights are private; the earlier run 3 is open source as Skanda-0.', { label: 'See the benchmarks', href: '/benchmarks' }],
  ['How were MedGemma and MAIRA-2 compared?', 'All three models read the same 111 held-out ChestX-Det films, labelled and boxed by three radiologists, and were scored by the same script (benchmark/score.py). Skanda read every film twice, so its figures are the mean of both reads. Intervals are Wilson 95%.'],
  ['Are the scans and heatmaps on this page real?', 'The chest films, the brain-tumour MRI and the SOOP stroke MRI overlays are crops of real model output recorded in the app (the cardiomegaly film and the tumour MRI were read live on radgenis.com in November 2026); the MRI reference is the dataset\'s own lesion mask. The CT and MR head teaching volumes carry no labelled finding, so their heatmaps are marked as illustrative. Skull radiographs are reconstructed from the public CT volume.'],
  ['Where does Skanda fall short?', 'On the pre-registered confirmatory set Skanda V1 outlined 23.5% of chest X-ray findings and 36% overall. In the earlier X-ray comparison, runs 2–3 found 2 of 10 pneumothoraces and few small nodules, where MedGemma found all 10; Skanda V1 has no separate pneumothorax figure yet. In the labelled CT/MRI fault report, five of six positive-slice boxes missed their reference region entirely. Every model finding stays a draft until a clinician reviews it.', { label: 'Read the fault report', href: 'https://github.com/Hitheshkaranth/VoxelRadAI_Terminal/blob/main/docs/validation/2026-11-02-labeled-case-failure-report.md' }],
  ['Is RadGenis a diagnostic device?', 'No. It is a research and evaluation workspace. It has not been clinically validated, and any clinical use needs independent validation and review by a qualified professional.'],
  ['How do I get access?', 'The hosted workspace is invite-only: request access with the form below and we will reply by email, or sign in if your organization already has an account. To run a Skanda model yourself, download the open-source Skanda-0 weights (bf16, int8 or int4) from Hugging Face and follow the Skanda reader guide. Skanda V1, the model served in the hosted workspace, is not part of the open release. For anything else, open an issue on GitHub.', { label: 'Request access', href: '#access' }],
]

export const models = benchmarks
export type ModelKey = (typeof benchmarks)[number]['key']
export const modelColor: Record<ModelKey, string> = { skanda: 'var(--sk-blue)', medgemma: '#8f8f8f', maira: 'var(--sk-amber)' }
