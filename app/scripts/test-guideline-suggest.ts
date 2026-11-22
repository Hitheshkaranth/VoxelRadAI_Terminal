import assert from 'node:assert/strict'
import { firstMeasurementMm, suggestGuidelines, unappliedSuggestions } from '../src/lib/guidelineSuggest.ts'

const one = (text: string, context = {}) => {
  const found = suggestGuidelines(text, context)
  assert.equal(found.length, 1, `expected one suggestion for: ${text}\n got ${JSON.stringify(found)}`)
  return found[0]
}

// Measurements: dimensions in mm, in the order dictated.
assert.deepEqual(firstMeasurementMm('8 mm nodule'), [8])
assert.deepEqual(firstMeasurementMm('1.2 x 0.8 cm mass'), [12, 8])
assert.deepEqual(firstMeasurementMm('9 by 7 by 6 mm'), [9, 7, 6])
assert.equal(firstMeasurementMm('measures 8 HU'), null)

// Fleischner: incidental lung nodule, size is the mean of the first two axes.
let s = one('There is an 8 x 6 mm solid nodule in the right upper lobe.')
assert.equal(s.kind, 'fleischner')
assert.deepEqual(s.prefill, { size: 7, type: 'solid' })
assert.equal(s.label, 'Fleischner · solid nodule, 7 mm')
assert.equal(s.evidence, 'There is an 8 x 6 mm solid nodule in the right upper lobe.')
assert.equal(one('A 1.2 cm pulmonary nodule.').prefill.size, 12)
assert.equal(one('Ground-glass nodule in the left lower lobe measuring 7 mm.').prefill.type, 'ground-glass')
assert.equal(one('Part-solid nodule in the lingula, 14 mm.').prefill.type, 'part-solid')
assert.equal(one('Subsolid nodule in the left upper lobe, 9 mm.').prefill.type, undefined, 'subsolid does not say which kind')

// The largest nodule leads, and more than one nodule sentence makes it "multiple".
s = one('A 4 mm nodule in the right middle lobe. A 9 mm solid nodule in the left lower lobe.')
assert.equal(s.prefill.size, 9)
assert.equal(s.prefill.multiple, true)
assert.equal(one('Several tiny pulmonary nodules, largest 5 mm.').prefill.multiple, true)

// Not suggested: negated, benign calcified, other organs, no nodule.
assert.deepEqual(suggestGuidelines('No pulmonary nodules. Lungs are clear.'), [])
assert.deepEqual(suggestGuidelines('No suspicious lung nodule.'), [])
assert.deepEqual(suggestGuidelines('Previously seen right lower lobe nodule has resolved.'), [])
assert.deepEqual(suggestGuidelines('Calcified granuloma in the right upper lobe, 5 mm.'), [])
assert.deepEqual(suggestGuidelines('Right hilar lymph nodes are prominent.'), [])
assert.deepEqual(suggestGuidelines('Mild consolidation in the left lower lobe.'), [])

// Screening switches to Lung-RADS and keeps the screening-only inputs.
s = one('New 7 mm solid nodule in the right upper lobe.', { indication: 'Lung cancer screening, 30 pack-years' })
assert.equal(s.kind, 'lungRads')
assert.equal(s.prefill.status, 'new')
s = one('Part-solid nodule in the left upper lobe, 12 mm, solid component 5 mm.', { technique: 'Low-dose CT chest.' })
assert.deepEqual([s.prefill.size, s.prefill.solidMm, s.prefill.type], [12, 5, 'part-solid'])
assert.equal(one('Stable 6 mm perifissural nodule. No new nodules.', { indication: 'LDCT' }).prefill.status, 'stable', '"no new nodules" is not a new nodule')
assert.equal(one('Lung-RADS 3. 6 mm solid nodule in the right lower lobe.').kind, 'lungRads')
// Fleischner ignores screening-only fields.
assert.equal(one('New 7 mm nodule in the right upper lobe.').prefill.status, undefined)

// TI-RADS: only dictated features, size in cm (maximum diameter).
s = one('Solid hypoechoic nodule in the right thyroid lobe measuring 1.6 x 1.1 cm with punctate echogenic foci, taller-than-wide.')
assert.equal(s.kind, 'tirads')
assert.equal(s.prefill.size, 1.6)
assert.deepEqual(s.prefill.tirads, {
  composition: 'solid or almost completely solid', echogenicity: 'hypoechoic', shape: 'taller-than-wide', foci: ['punctate echogenic foci'],
})
assert.deepEqual(one('Spongiform thyroid nodule, 2 cm.').prefill.tirads, { composition: 'spongiform' })
assert.equal(one('Thyroid nodule 1.2 cm, very hypoechoic, no extrathyroidal extension.').prefill.tirads?.margin, undefined, 'negated ETE ignored')
assert.equal(suggestGuidelines('Thyroid nodule 1 cm. Second thyroid nodule 2 cm. Third thyroid nodule 3 cm.').length, 2, 'at most two thyroid nodules')
assert.deepEqual(suggestGuidelines('The thyroid gland is normal. No thyroid nodule.'), [])

// Adrenal: HU only when stated as unenhanced.
s = one('Left adrenal nodule measuring 2.1 cm with unenhanced attenuation of 8 HU.')
assert.deepEqual(s.prefill, { size: 2.1, hu: 8 })
assert.equal(s.label, 'Adrenal · 2.1 cm, 8 HU unenhanced')
assert.equal(one('Right adrenal nodule 1.5 cm measuring 8 HU on the portal venous phase.').prefill.hu, undefined)
assert.equal(one('Right adrenal mass 2 cm, minus 5 HU on non-contrast images.').prefill.hu, -5)
assert.equal(one('Left adrenal mass 3 cm containing macroscopic fat.').prefill.fat, true)
assert.deepEqual(suggestGuidelines('Adrenal glands are normal. No adrenal nodule.'), [])

// Bosniak and BI-RADS only when the category or a complex cystic lesion is dictated.
assert.deepEqual(one('Right renal cyst, Bosniak IIF.').prefill, { bosniakClass: 'IIF' })
assert.deepEqual(one('Complex septated cyst in the left kidney, 3 cm.').prefill, {})
assert.deepEqual(suggestGuidelines('Simple right renal cyst, 2 cm.'), [])
assert.deepEqual(one('Irregular mass in the left breast, BI-RADS 4B.').prefill, { biradsCategory: '4B' })
assert.deepEqual(one('Benign findings. BIRADS category 2.').prefill, { biradsCategory: '2' })

// Radiograph-only studies: no CT/MR guidelines (a nodule on a chest film needs CT first); stated categories still count.
const film = { radiograph: true }
assert.deepEqual(suggestGuidelines('8 mm nodule in the right upper zone of the lung.', film), [])
assert.deepEqual(suggestGuidelines('Left adrenal mass 3 cm. Right renal cyst, Bosniak IIF.', film), [])
assert.equal(suggestGuidelines('Irregular mass in the left breast, BI-RADS 4B.', film)[0]?.kind, 'birads')

// Several organs in one report.
assert.deepEqual(
  suggestGuidelines('6 mm solid nodule in the right lower lobe. Left adrenal adenoma 1.8 cm, 4 HU on unenhanced CT.').map((x) => x.kind),
  ['fleischner', 'adrenal'],
)

// Applied suggestions disappear: each inserted sentence citing a guideline covers one suggestion of that kind.
const found = suggestGuidelines('Thyroid nodule 1 cm. Second thyroid nodule 2 cm. 6 mm nodule in the right upper lobe.')
assert.equal(unappliedSuggestions(found, '').length, 3)
assert.deepEqual(unappliedSuggestions(found, 'TR3. FNA (ACR TI-RADS 2017).').map((x) => x.kind), ['fleischner', 'tirads'])
assert.deepEqual(unappliedSuggestions(found, 'x (Fleischner Society 2017). y (ACR TI-RADS 2017). z (ACR TI-RADS 2017).'), [])

console.log('guideline suggestions: ok')
