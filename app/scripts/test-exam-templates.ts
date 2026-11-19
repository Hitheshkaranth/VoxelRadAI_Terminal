import assert from 'node:assert/strict'
import {
  BUILTIN_EXAM_TEMPLATES,
  fillField,
  listFields,
  mergeTemplateSections,
  nextField,
  normalizeModality,
  studyExamHints,
  suggestTemplates,
  unresolvedFields,
} from '../src/lib/examTemplates.ts'
import { BUILTIN_MACROS, expandMacro, findMacro, macroShortcut, type ReportMacro } from '../src/lib/macros.ts'
import type { Study } from '../src/types.ts'

// Field parsing
const text = 'The [right/left] kidney measures [___] cm. [Normal] cortex.'
const fields = listFields(text)
assert.deepEqual(fields.map((f) => f.kind), ['choice', 'blank', 'label'])
assert.deepEqual(fields[0].options, ['right', 'left'])
assert.equal(text.slice(fields[1].start, fields[1].end), '[___]')
assert.equal(fields[2].label, 'Normal')
assert.deepEqual(listFields('No brackets here. [unclosed and\n] split'), [])

// Navigation wraps around in both directions
assert.equal(nextField(text, 0)?.start, fields[0].start)
assert.equal(nextField(text, fields[0].end)?.start, fields[1].start)
assert.equal(nextField(text, text.length)?.start, fields[0].start)
assert.equal(nextField(text, fields[1].start, -1)?.start, fields[0].start)
assert.equal(nextField(text, 0, -1)?.start, fields[2].start)
assert.equal(nextField('plain', 0), null)

// Filling
const filled = fillField(text, fields[0], 'left')
assert.equal(filled, 'The left kidney measures [___] cm. [Normal] cortex.')
assert.equal(listFields(filled).length, 2)

// Unresolved fields across sections, in report order
const unresolved = unresolvedFields({ impression: 'Grade [I/II]', findings: 'Size [___] mm', technique: 'Done.' })
assert.deepEqual(unresolved.map((u) => u.section), ['findings', 'impression'])
assert.deepEqual(unresolvedFields({ findings: 'All filled.' }), [])

// Modality normalisation
assert.equal(normalizeModality('DX'), 'XR')
assert.equal(normalizeModality('Radiograph (X-ray)'), 'XR')
assert.equal(normalizeModality('CT'), 'CT')
assert.equal(normalizeModality('MRI'), 'MR')
assert.equal(normalizeModality('USG abdomen'), 'US')
assert.equal(normalizeModality(''), undefined)

// Suggestions from DICOM tags, model output and titles
const ids = (hints: Parameters<typeof suggestTemplates>[0]) => suggestTemplates(hints, BUILTIN_EXAM_TEMPLATES).map((t) => t.id)
assert.equal(ids({ modality: 'CR', bodyPart: 'CHEST', view: 'PA' })[0], 'builtin:cxr-pa')
assert.equal(ids({ modality: 'DX', bodyPart: 'Chest', view: 'AP' })[0], 'builtin:cxr-ap-portable')
assert.equal(ids({ modality: 'CT', bodyPart: 'HEAD' })[0], 'builtin:ct-brain-nc')
assert.equal(ids({ modality: 'CT', text: 'CT KUB for renal colic' })[0], 'builtin:ct-kub')
assert.equal(ids({ modality: 'MR', bodyPart: 'KNEE' })[0], 'builtin:mri-knee')
assert.equal(ids({ modality: 'MR', bodyPart: 'LSPINE', text: 'MRI lumbar spine' })[0], 'builtin:mri-ls-spine')
assert.equal(ids({ text: 'USG whole abdomen' })[0], 'builtin:usg-abdomen')
assert.ok(!ids({ modality: 'CT', bodyPart: 'CHEST' }).includes('builtin:cxr-pa'))
assert.deepEqual(ids({}), [])

const study = {
  title: 'Chest study',
  patient: { indication: 'cough' },
  images: [{ sourceModality: 'DX', sourceBodyPart: 'CHEST', analysis: { view: 'PA' } }],
} as unknown as Study
assert.deepEqual(studyExamHints(study), { modality: 'DX', bodyPart: 'CHEST', view: 'PA', text: 'Chest study cough' })

// Every built-in covers findings and impression; the brief's twelve exams ship.
assert.ok(BUILTIN_EXAM_TEMPLATES.length >= 12)
for (const t of BUILTIN_EXAM_TEMPLATES) assert.ok(t.sections.findings && t.sections.impression, t.id)

// Applying a template
const merged = mergeTemplateSections({ findings: 'Existing.', impression: '' }, { sections: { findings: 'New.', impression: 'Normal.' } }, 'insert')
assert.deepEqual(merged, { findings: 'Existing.\nNew.', impression: 'Normal.' })
assert.deepEqual(mergeTemplateSections({ findings: 'Existing.' }, { sections: { findings: 'New.' } }, 'replace'), { findings: 'New.' })

// Macros
assert.deepEqual(macroShortcut('Lungs: .normalchest'), { name: 'normalchest', length: 12 })
assert.deepEqual(macroShortcut('.noacute'), { name: 'noacute', length: 8 })
assert.equal(macroShortcut('e.g'), null)
assert.equal(macroShortcut('measures 1.5'), null)
assert.ok(expandMacro('normal chest')?.startsWith('Lungs are clear'))
assert.ok(expandMacro('Normal-Chest')?.startsWith('Lungs are clear'))
assert.ok(expandMacro('no acute intracranial')?.includes('haemorrhage'))
assert.ok(listFields(expandMacro('degenerative spine') ?? '').length >= 2)
assert.equal(expandMacro('unknown'), null)
const personal: ReportMacro = { id: 'p1', name: 'normalchest', trigger: '', text: 'My chest.', scope: 'personal' }
assert.equal(findMacro('normalchest', [personal, ...BUILTIN_MACROS])?.text, 'My chest.')

console.log('Exam templates and macros: 50 checks passed')
