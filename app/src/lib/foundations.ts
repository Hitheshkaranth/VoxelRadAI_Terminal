// Foundation models behind Skanda and the app, and Skanda-0's training data.
// Sources: Skanda-0 README (architecture, training, licences) and data card (benchmarks/charts/data-card.svg on
// huggingface.co/hitheshkaranth/Skanda-0); app/server/txrv_server.py; app/server/maira_server.py.

export interface Foundation { name: string; by: string; role: string; facts: string[]; trained: string; licence: string; href: string }

export const FOUNDATIONS: Foundation[] = [
  {
    name: 'Qwen3-VL-30B-A3B-Instruct', by: 'Qwen team, Alibaba', role: 'Reads the image and writes the report',
    facts: ['Mixture of experts: 31B parameters, about 3B active per token', '48 layers, 128 experts, 8 active', 'Vision encoder: 27-block ViT'],
    trained: 'LoRA (rank 64) on attention and on the last 11 vision blocks, plus a new [SEG] token for each finding',
    licence: 'Apache-2.0', href: 'https://huggingface.co/Qwen/Qwen3-VL-30B-A3B-Instruct',
  },
  {
    name: 'SAM 2.1 Hiera-L', by: 'Meta AI, via ByteDance Sa2VA', role: 'Draws the outline for each finding',
    facts: ['About 224M parameters', 'Meta pre-trained SAM on SA-1B: 11M images, 1.1B masks', 'SAM 2 adds SA-V: 50.9K videos, 642.6K masklets'],
    trained: 'Mask decoder and object score fine-tuned on radiologist outlines; image encoder frozen',
    licence: 'Apache-2.0', href: 'https://huggingface.co/ByteDance/Sa2VA-Qwen3-VL-4B',
  },
  {
    name: 'Skanda heads', by: 'Built for Skanda', role: 'Connects the two and scores each case',
    facts: ['[SEG] projector: MLP 2048 → 2048 → 256 into SAM 2', 'Score head: p(abnormal) + 13 chest X-ray classes', 'Calibrated gate and hint thresholds'],
    trained: 'Trained from scratch alongside the LoRA',
    licence: 'Skanda-0: CC BY-NC 4.0', href: '/skanda-0',
  },
]

export const APP_MODELS = [
  { name: 'MAIRA-2', by: 'Microsoft', role: 'Optional second reader for chest X-ray: adds findings only when the classifier supports them' },
  { name: 'TorchXRayVision', by: 'Cohen et al.', role: 'Classifier cross-check and evidence heatmaps: three DenseNet-121 models trained on CheXpert, MIMIC-CXR and PadChest, plus a ChestX-Det anatomy model' },
  { name: 'MedGemma 27B', by: 'Google', role: 'Baseline in every benchmark; never used as training text' },
]

export interface DataSet { name: string; what: string; records: number }
export interface DataGroup { modality: string; sets: DataSet[] }

/** Records per dataset (one image, slice or volume each), split by patient; held-out test cases never trained on. */
export const TRAINING_DATA: DataGroup[] = [
  { modality: 'Chest X-ray', sets: [
    { name: 'NIH ChestX-ray14', what: 'normal films and rare-class labels', records: 6597 },
    { name: 'ChestX-Det', what: 'radiologist outlines, 13 classes', records: 2486 },
  ] },
  { modality: 'CT', sets: [
    { name: 'DeepLesion', what: 'lesions across the body, slices', records: 10608 },
    { name: 'MSD', what: 'liver, lung, pancreas, vessels, colon, slices', records: 3620 },
    { name: 'autoPET', what: 'whole-body PET/CT lesions, slices', records: 1949 },
    { name: 'MSD volumes', what: 'same tasks in 3D', records: 1732 },
    { name: 'autoPET volumes', what: '3D', records: 977 },
  ] },
  { modality: 'MRI', sets: [
    { name: 'MSD brain tumour', what: 'glioma: oedema and tumour core, slices', records: 2420 },
    { name: 'ISLES 2022', what: 'acute stroke, DWI + ADC, slices', records: 1102 },
    { name: 'MSD brain volumes', what: '3D', records: 967 },
    { name: 'ISLES volumes', what: '3D', records: 404 },
  ] },
]

export const groupTotal = (g: DataGroup) => g.sets.reduce((n, s) => n + s.records, 0)
export const TRAINING_TOTAL = TRAINING_DATA.reduce((n, g) => n + groupTotal(g), 0)
/** ChestX-Det, NIH ChestX-ray14, DeepLesion, MSD, autoPET, ISLES 2022 (CheXmask lung and heart outlines also feed the connector stage). */
export const DATASET_COUNT = 6
