import assert from 'node:assert/strict'
import { applyVocabulary, suggestReplacement, upsertVocabulary, vocabularyKeyterms } from '../src/lib/dictationVocabulary.ts'
import { normaliseMeasurements } from '../src/lib/dictationNumbers.ts'

// Built-in radiology mis-hearings
assert.equal(applyVocabulary('Small plural effusion on the left.'), 'Small pleural effusion on the left.')
assert.equal(applyVocabulary('Plural effusion noted'), 'Pleural effusion noted')
assert.equal(applyVocabulary('no new mo thorax'), 'no pneumothorax')
assert.equal(applyVocabulary('basal a telectasis'), 'basal atelectasis')
assert.equal(applyVocabulary('hyper dense and hyper-dense foci'), 'hyperdense and hyperdense foci')
assert.equal(applyVocabulary('acute sub dural haematoma'), 'acute subdural haematoma')
assert.equal(applyVocabulary('patchy ground glass capacity'), 'patchy ground-glass opacity')
assert.equal(applyVocabulary('h r c t chest'), 'HRCT chest')
// Word boundaries: no replacement inside other words
assert.equal(applyVocabulary('infraction'), 'infarction')
assert.equal(applyVocabulary('acute infract'), 'acute infarct')
assert.equal(applyVocabulary('fact sheet'), 'fact sheet')
// Custom entries win and are case-preserving
const custom = [{ from: 'boss knee ak', to: 'Bosniak' }, { from: 'plural effusion', to: 'pleural fluid' }, { from: '', to: 'T2 FLAIR' }]
assert.equal(applyVocabulary('boss knee ak 2 cyst', custom), 'Bosniak 2 cyst')
assert.equal(applyVocabulary('plural effusion', custom), 'pleural fluid')
assert.deepEqual(vocabularyKeyterms(custom), ['Bosniak', 'pleural fluid', 'T2 FLAIR'])
// Upsert replaces an entry for the same heard phrase
assert.deepEqual(upsertVocabulary(custom, { from: ' Boss knee ak ', to: 'Bosniak II' })[0], { from: 'Boss knee ak', to: 'Bosniak II' })
assert.equal(upsertVocabulary(custom, { from: 'x', to: '  ' }), custom)
assert.equal(upsertVocabulary(custom, { from: 'boss knee ak', to: 'Bosniak II' }).length, 3)
// Learning from an undo followed by a re-dictation
assert.deepEqual(suggestReplacement('small sinus effusion on the left', 'small pleural effusion on the left'), { from: 'sinus', to: 'pleural' })
assert.deepEqual(suggestReplacement('Plural.', 'Pleural.'), { from: 'plural', to: 'pleural' })
assert.equal(suggestReplacement('the liver is normal', 'heart size is enlarged with effusion'), null)
assert.equal(suggestReplacement('same text', 'same text'), null)
assert.equal(suggestReplacement('cat', 'pneumothorax'), null)

// Measurement normalisation
assert.equal(normaliseMeasurements('one point two by zero point eight centimetres'), '1.2 x 0.8 cm')
assert.equal(normaliseMeasurements('a five millimetre nodule'), 'a 5 mm nodule')
assert.equal(normaliseMeasurements('measuring 1.2 by 0.8 centimeters.'), 'measuring 1.2 x 0.8 cm.')
assert.equal(normaliseMeasurements('twenty three millimetres'), '23 mm')
assert.equal(normaliseMeasurements('three by four by five cm'), '3 x 4 x 5 cm')
assert.equal(normaliseMeasurements('two point five into one point five cms'), '2.5 x 1.5 cm')
assert.equal(normaliseMeasurements('density of forty five hounsfield units'), 'density of 45 HU')
assert.equal(normaliseMeasurements('one hundred and twenty ml'), '120 mL')
assert.equal(normaliseMeasurements('ten percent'), '10%')
assert.equal(normaliseMeasurements('zero point eight'), '0.8')
// Not measurements: left alone
assert.equal(normaliseMeasurements('one of the nodules'), 'one of the nodules')
assert.equal(normaliseMeasurements('divided into two parts'), 'divided into two parts')
assert.equal(normaliseMeasurements('two into three'), 'two into three')
assert.equal(normaliseMeasurements('oh no'), 'oh no')
assert.equal(normaliseMeasurements('3 lesions'), '3 lesions')
assert.equal(normaliseMeasurements('series 4 image 120'), 'series 4 image 120')
// Punctuation inside stops the measurement chain
assert.equal(normaliseMeasurements('five, by six mm'), 'five, by 6 mm')
// Regression: number-word runs are read whole or not at all; a value never changes magnitude
assert.equal(normaliseMeasurements('point five cm'), '0.5 cm')
assert.equal(normaliseMeasurements('a point five centimetre focus'), 'a 0.5 cm focus')
assert.equal(normaliseMeasurements('twenty five hundred cc'), '2500 cc')
assert.equal(normaliseMeasurements('one thousand two hundred ml'), '1200 mL')
assert.equal(normaliseMeasurements('one thousand and five ml'), '1005 mL')
assert.equal(normaliseMeasurements('fifteen hundred ml'), '1500 mL')
assert.equal(normaliseMeasurements('nine nine mm'), 'nine nine mm')
assert.equal(normaliseMeasurements('C five six by four'), 'C five six by four')
assert.equal(normaliseMeasurements('two 3 cm'), 'two 3 cm')
assert.equal(normaliseMeasurements('one point two point three cm'), 'one point two point three cm')
assert.equal(normaliseMeasurements('hundred five mm'), 'hundred five mm')
assert.equal(normaliseMeasurements('one thousand twenty five hundred ml'), 'one thousand twenty five hundred ml')
assert.equal(normaliseMeasurements('at this point two nodules'), 'at this point two nodules')
assert.equal(normaliseMeasurements('point five by point four cm'), '0.5 x 0.4 cm')
assert.equal(normaliseMeasurements('1.2 by five six cm'), '1.2 by five six cm')
console.log('Dictation vocabulary and numbers: 55 checks passed')
