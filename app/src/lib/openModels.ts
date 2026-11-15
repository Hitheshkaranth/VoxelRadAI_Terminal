// Published Skanda-0 weights and the benchmark numbers from the Hugging Face model card
// (https://huggingface.co/hitheshkaranth/Skanda-0, read 15 Nov 2026). Update this file when the card changes.

const HF = 'https://huggingface.co'

export interface ModelBuild {
  repo: string
  precision: 'bf16' | 'int8' | 'int4'
  size: string
  note: string
  recommended?: boolean
}

export const SKANDA_0 = {
  name: 'Skanda-0',
  repo: 'hitheshkaranth/Skanda-0',
  summary:
    'Radiology vision-language model. Reads chest X-ray, CT and MRI, writes a JSON report, and outlines each finding it reports.',
  architecture: [
    ['Language model', 'Qwen3-VL-30B-A3B-Instruct, LoRA-tuned (31B total, ~3B active MoE)'],
    ['Outline model', 'SAM 2.1 Hiera-L (~224M), weights from Sa2VA-Qwen3-VL-4B'],
    ['Heads', '[SEG] projector + score head (p(abnormal), 13 X-ray classes)'],
    ['Memory', '~68 GB steady, ~93 GB peak (bf16, DGX Spark GB10)'],
  ] as const,
  license: 'CC BY-NC 4.0',
  licenseNote: 'Weights are non-commercial; ask in the repo Discussions for commercial use. Code is Apache-2.0.',
  github: 'https://github.com/Hitheshkaranth/Skanda-0',
}

export const BUILDS: ModelBuild[] = [
  { repo: 'hitheshkaranth/Skanda-0', precision: 'bf16', size: '62.6 GB', note: 'Reference weights' },
  { repo: 'hitheshkaranth/Skanda-0-int8', precision: 'int8', size: '32.8 GB', note: 'Per-row int8. Effectively lossless', recommended: true },
  { repo: 'hitheshkaranth/Skanda-0-int4', precision: 'int4', size: '18.2 GB', note: 'Group-128 int4. Measurable quality loss' },
]

export const QUANT_NOTE = 'Only the language model is quantized. The SAM 2.1 decoder, [SEG] projector and score head stay bf16.'

export const hfUrl = (repo: string) => `${HF}/${repo}`
export const hfFilesUrl = (repo: string) => `${HF}/${repo}/tree/main`
export const downloadCommand = (repo: string) => `hf download ${repo} --local-dir ${repo.split('/')[1]}`

/** A benchmark row: one value per column, null where the model was not run. */
export interface BenchRow { metric: string; values: (number | null)[] }
export interface BenchGroup { label: string; cases: string; rows: BenchRow[] }
export interface BenchTable { id: string; title: string; caption: string; columns: string[]; highlight: number; groups: BenchGroup[]; footnote?: string }

const r = (metric: string, ...values: (number | null)[]): BenchRow => ({ metric, values })

export const BENCHMARKS: BenchTable[] = [
  {
    id: 'baselines',
    title: 'vs baselines',
    caption: 'Held-out test cases, 1 Nov 2026 read. Percent, higher is better.',
    columns: ['MedGemma 27B', 'MedGemma + MAIRA-2', 'Skanda-0'],
    highlight: 2,
    groups: [
      {
        label: 'Chest X-ray', cases: '111 films · ChestX-Det test',
        rows: [
          r('Abnormal flagged', 90, 91, 84),
          r('Normals called normal', 72, 72, 69),
          r('Right finding type', 41, 47, 40.5),
          r('Box precision', 6, null, 25.5),
          r('Box recall', 4, null, 10),
        ],
      },
      {
        label: 'CT', cases: '340 cases',
        rows: [
          r('Abnormal flagged', 97, null, 82),
          r('Normals called normal', 6, null, 91),
          r('Right finding type', 49, null, 72),
          r('Box precision', 1, null, 22),
          r('Box recall', 3, null, 16),
        ],
      },
      {
        label: 'MRI', cases: '240 cases',
        rows: [
          r('Abnormal flagged', 99, null, 89),
          r('Normals called normal', 2, null, 94),
          r('Right finding type', 42, null, 89),
          r('Box precision', 6, null, 70),
          r('Box recall', 8, null, 65),
        ],
      },
    ],
    footnote: 'MAIRA-2 reads chest X-ray only. — means not run.',
  },
  {
    id: 'quants',
    title: 'Quantized builds',
    caption: 'Same test sets, 8 Nov 2026 re-read. Percent, higher is better.',
    columns: ['bf16', 'int8', 'int4'],
    highlight: 1,
    groups: [
      {
        label: 'Chest X-ray', cases: '111 films',
        rows: [r('Right finding type', 39, 40.5, 36), r('Box precision', 24.5, 24, 17.5), r('Box recall', 9.5, 8.5, 8.5)],
      },
      {
        label: 'CT', cases: '340 cases',
        rows: [r('Normals called normal', 91, 85, 78), r('Right finding type', 72, 72, 74), r('Box precision', 22, 21, 19)],
      },
      {
        label: 'MRI', cases: '240 cases',
        rows: [r('Right finding type', 89, 87, 80), r('Box recall', 65, 67, 49)],
      },
    ],
    footnote: 'Loss per token on the bf16 replies: bf16 0.0823 · int8 0.0824 · int4 0.1181. The bf16 X-ray numbers come from a re-read and differ slightly from the baseline table.',
  },
]

export const MODEL_DISCLAIMER =
  'Research use only. Not a medical device and not cleared by any regulator. There has been no external test set, reader study or radiologist review of its reports.'
