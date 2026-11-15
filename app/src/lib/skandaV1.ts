// Skanda V1 (run 4b, runs4/polish_s2/final): the model the hosted workspace serves. Weights are private.
// Numbers from the Skanda V1 model card (huggingface.co/hitheshkaranth/Skanda-V1, private), bf16, read 15 Nov 2026.
// Baselines are the re-read published on that same card, so every column comes from one runner and one scorer.

export const V1_SOURCE = 'Skanda V1 model card, bf16 (weights private)'

export interface V1Table { label: string; cases: string; columns: string[]; rows: { metric: string; values: (number | null)[] }[] }

export const V1_BENCH: V1Table[] = [
  {
    label: 'Chest X-ray', cases: '111 ChestX-Det test films · mean of two passes',
    columns: ['MedGemma 27B', 'MAIRA-2', 'MedGemma + MAIRA-2', 'Skanda V1'],
    rows: [
      { metric: 'Abnormal flagged', values: [86, 89, 87.5, 82.5] },
      { metric: 'Normals called normal', values: [72, 72, 72, 76] },
      { metric: 'Right finding type', values: [36, 34, 42, 39] },
      { metric: 'Box precision', values: [8.5, 30, 10.5, 27] },
      { metric: 'Box recall', values: [5.5, 13, 7, 13.5] },
    ],
  },
  {
    label: 'CT', cases: '340 held-out cases',
    columns: ['MedGemma 27B', 'Skanda V1'],
    rows: [
      { metric: 'Abnormal flagged', values: [97, 81] },
      { metric: 'Normals called normal', values: [6, 91] },
      { metric: 'Right finding type', values: [49, 68] },
      { metric: 'Box precision', values: [1, 18] },
      { metric: 'Box recall', values: [3, 13] },
    ],
  },
  {
    label: 'MRI', cases: '240 held-out cases',
    columns: ['MedGemma 27B', 'Skanda V1'],
    rows: [
      { metric: 'Abnormal flagged', values: [99, 86] },
      { metric: 'Normals called normal', values: [2, 94] },
      { metric: 'Right finding type', values: [42, 84] },
      { metric: 'Box precision', values: [6, 73] },
      { metric: 'Box recall', values: [8, 65] },
    ],
  },
]

/** Pre-registered confirmatory set: analysis plan committed (6 Nov 2026, 06:11 UTC) before Skanda V1 read it. Descriptive pass. */
export const V1_CONFIRMATORY = {
  columns: ['Chest X-ray · 707', 'CT · 1,093', 'MRI · 784', 'All · 2,584'],
  rows: [
    { metric: 'Abnormal flagged', values: [79.5, 71.6, 79.6, 76.2] },
    { metric: 'Normals cleared (no finding drawn)', values: [79.5, 72.4, 93.5, 80.4] },
    { metric: 'Outline recall (mask IoU ≥ 0.3)', values: [23.5, 28.0, 61.4, 36.2] },
    { metric: 'Outline precision', values: [32.5, 28.4, 67.8, 42.8] },
    { metric: 'Mean Dice of found outlines', values: [70.9, 72.1, 74.8, 73.2] },
    { metric: 'Finding type agrees (found outlines)', values: [44.5, 68.5, 95.7, 75.7] },
    { metric: 'Side agrees (found outlines)', values: [83.2, 94.0, 95.7, 91.8] },
  ],
  secondsPerRead: [7.0, 5.5, 7.3, 6.4],
  note: 'Chest X-ray = 307 confirmatory films + 400 fresh normal films; CT and MRI = MSD and autoPET test cases. Every read parsed (2,584 / 2,584). Outlines are matched one-to-one on mask IoU ≥ 0.3, stricter than the box-centre rule above, so the two are not comparable. Descriptive numbers only: the pre-registered hypothesis tests with confidence intervals, and the int8/int4 passes, are still running.',
}
