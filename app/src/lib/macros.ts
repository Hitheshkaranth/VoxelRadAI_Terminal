// Report macros: named snippets expanded by typing ".name" then Space or Tab, or by voice ("insert macro <name>").
// Macro text may hold template fields ([label], [a/b], [___]). Pure helpers; persistence lives in examLibrary.ts.

export interface ReportMacro {
  id: string
  /** Short name; typed as ".name" (spaces and punctuation are ignored when matching). */
  name: string
  /** Spoken phrase for dictation, e.g. "normal chest". Optional; the name also matches. */
  trigger: string
  text: string
  scope: 'personal' | 'builtin'
  updatedAt?: string
}

export type MacroInput = Pick<ReportMacro, 'name' | 'trigger' | 'text'>

/** Matching key: lower case letters and digits only, so ".normalchest", ".normal-chest" and "normal chest" agree. */
export const macroKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Personal macros come first in the list, so they win over a built-in of the same name. */
export function findMacro(name: string, macros: ReportMacro[]): ReportMacro | null {
  const key = macroKey(name)
  if (!key) return null
  return macros.find((m) => macroKey(m.name) === key) ?? macros.find((m) => m.trigger && macroKey(m.trigger) === key) ?? null
}

export function expandMacro(name: string, macros: ReportMacro[] = BUILTIN_MACROS): string | null {
  return findMacro(name, macros)?.text ?? null
}

/** A ".name" shortcut ending the text before the caret. Needs a space or line start before the dot,
 * so abbreviations ("e.g") and decimals ("1.5") are left alone. */
export function macroShortcut(textBeforeCaret: string): { name: string; length: number } | null {
  const match = textBeforeCaret.match(/(?:^|[\s(])\.([a-z][a-z0-9_-]{0,39})$/i)
  return match ? { name: match[1], length: match[1].length + 1 } : null
}

const m = (name: string, trigger: string, text: string): ReportMacro => ({ id: `builtin:${macroKey(name)}`, name, trigger, text, scope: 'builtin' })

export const BUILTIN_MACROS: ReportMacro[] = [
  m('normalchest', 'normal chest', 'Lungs are clear. No focal consolidation, pleural effusion or pneumothorax. Cardiomediastinal silhouette is within normal limits. No acute osseous abnormality.'),
  m('noacute', 'no acute intracranial', 'No acute intracranial haemorrhage, territorial infarct, mass effect or midline shift. Ventricles and sulci are appropriate for age. Basal cisterns are patent.'),
  m('degenspine', 'degenerative spine', 'Multilevel degenerative changes with disc desiccation and [mild/moderate/severe] loss of disc height, most marked at [___]. Facet arthropathy. No high-grade spinal canal stenosis.'),
  m('nopneumo', 'no pneumothorax', 'No pneumothorax.'),
  m('fattyliver', 'fatty liver', 'Liver shows diffusely increased echogenicity, in keeping with grade [I/II/III] fatty infiltration.'),
  m('renalcalc', 'renal calculus', 'A [___] mm calculus is seen in the [upper/mid/lower] pole of the [right/left] kidney, without hydronephrosis.'),
  m('nodule', 'lung nodule', 'A [solid/part-solid/ground-glass] nodule measuring [___] mm is seen in the [___] lobe.'),
  m('correlate', 'clinical correlation', 'Clinical correlation is suggested.'),
  m('followup', 'follow up', 'Follow-up [CT/MRI/ultrasound/radiograph] in [___] is suggested, as clinically appropriate.'),
]
