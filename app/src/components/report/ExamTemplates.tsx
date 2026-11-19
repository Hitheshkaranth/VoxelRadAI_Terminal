// Exam template picker (suggested for the study first) and the manager for personal exam templates and macros.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Sheet } from '../shell/Sheet'
import { ShellButton } from '../shell/ShellButton'
import { toast } from '../shell/toastStore'
import {
  hasReportText,
  studyExamHints,
  suggestTemplates,
  type ExamModality,
  type ExamTemplate,
  type ExamTemplateInput,
} from '../../lib/examTemplates'
import { allExamTemplates, allMacros, useExamLibrary } from '../../lib/examLibrary'
import type { MacroInput, ReportMacro } from '../../lib/macros'
import { REPORT_FIELD_KEYS, type ReportFieldKey, type Study } from '../../types'
import { DEFAULT_SECTION_TITLES } from '../../lib/reportTemplates'

const MODALITY_LABEL: Record<ExamModality, string> = { XR: 'X-ray', CT: 'CT', MR: 'MRI', US: 'Ultrasound', OT: 'Other' }
const FIELD_HINT = 'Fields: [label] to replace, [left/right] to pick one, [___] for a blank. Tab, Shift+Tab or F2 moves between fields; unfilled fields are flagged at sign-off.'

const matches = (t: ExamTemplate, query: string) => {
  const q = query.trim().toLowerCase()
  return !q || [t.name, t.bodyPart, t.modality, MODALITY_LABEL[t.modality], ...t.keywords].some((s) => s.toLowerCase().includes(q))
}

function TemplateRow({ template, onPick }: { template: ExamTemplate; onPick: (t: ExamTemplate) => void }) {
  return (
    <button type="button" className="tpl-row exam-row" onClick={() => onPick(template)}>
      <span className="tpl-row-main">
        <strong>{template.name}</strong>
        <span>{MODALITY_LABEL[template.modality]} · {template.bodyPart || 'Any'}{template.builtin ? '' : ' · Personal'}</span>
      </span>
    </button>
  )
}

export function ExamTemplatePicker({ open, onClose, study, current, onApply, onManage }: {
  open: boolean
  onClose: () => void
  study: Study
  current: Partial<Record<ReportFieldKey, string>>
  onApply: (template: ExamTemplate, mode: 'replace' | 'insert') => void
  onManage: () => void
}) {
  const personal = useExamLibrary((s) => s.templates)
  const load = useExamLibrary((s) => s.load)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<ExamTemplate | null>(null)
  useEffect(() => { if (open) void load() }, [open, load])

  const all = useMemo(() => allExamTemplates({ templates: personal }), [personal])
  const suggested = useMemo(() => suggestTemplates(studyExamHints(study), all).slice(0, 4), [study, all])
  const rest = all.filter((t) => matches(t, query) && (query.trim() || !suggested.includes(t)))

  const close = () => { setPending(null); setQuery(''); onClose() }
  const pick = (template: ExamTemplate) => {
    if (hasReportText(current)) setPending(template)
    else { onApply(template, 'replace'); close() }
  }
  const apply = (mode: 'replace' | 'insert') => { if (pending) onApply(pending, mode); close() }

  const footer = pending ? (
    <>
      <ShellButton type="button" className="btn" onClick={() => setPending(null)}>Back</ShellButton>
      <ShellButton type="button" className="btn" onClick={() => apply('insert')}>Insert below existing text</ShellButton>
      <ShellButton type="button" className="btn btn-destructive" onClick={() => apply('replace')}>Replace sections</ShellButton>
    </>
  ) : (
    <>
      <ShellButton type="button" className="btn" onClick={() => { close(); onManage() }}>Manage templates &amp; macros</ShellButton>
      <ShellButton type="button" className="btn" onClick={close}>Cancel</ShellButton>
    </>
  )

  return (
    <Sheet open={open} onClose={close} title="Apply exam template" subtitle="Normal-report text with fields to complete. Edit everything to match the images before signing." footer={footer}>
      {pending ? (
        <p className="exam-confirm">
          This report already has text. <strong>Replace</strong> overwrites the sections “{pending.name}” fills
          ({Object.keys(pending.sections).map((k) => DEFAULT_SECTION_TITLES[k as ReportFieldKey]).join(', ')}); <strong>Insert</strong> adds its text after what is there.
        </p>
      ) : (
        <div className="tpl-list">
          <input className="input" type="search" placeholder="Search exam templates (e.g. knee, CT, USG)" aria-label="Search exam templates"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {!query.trim() && suggested.length ? <h3 className="exam-group">Suggested for this study</h3> : null}
          {!query.trim() ? suggested.map((t) => <TemplateRow key={t.id} template={t} onPick={pick} />) : null}
          {!query.trim() && suggested.length ? <h3 className="exam-group">All templates</h3> : null}
          {rest.map((t) => <TemplateRow key={t.id} template={t} onPick={pick} />)}
          {!rest.length && query.trim() ? <p className="tpl-empty">No exam template matches “{query}”.</p> : null}
          <p className="exam-hint">{FIELD_HINT}</p>
        </div>
      )}
    </Sheet>
  )
}

type TemplateDraft = Omit<ExamTemplateInput, 'keywords'> & { keywords: string }
const toDraft = (t?: ExamTemplate): TemplateDraft => ({
  name: t ? (t.builtin ? `${t.name} (my version)` : t.name) : 'New exam template',
  modality: t?.modality ?? 'XR',
  bodyPart: t?.bodyPart ?? '',
  keywords: (t?.keywords ?? []).join(', '),
  views: t?.views,
  sections: { ...t?.sections },
})
const fromDraft = (d: TemplateDraft): ExamTemplateInput => ({
  name: d.name.trim(),
  modality: d.modality,
  bodyPart: d.bodyPart.trim(),
  keywords: d.keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 30),
  ...(d.views?.length ? { views: d.views } : {}),
  sections: Object.fromEntries(Object.entries(d.sections).filter(([, v]) => v?.trim())),
})

export function ExamLibrarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { templates, macros, load, saveTemplate, removeTemplate, saveMacro, removeMacro, error } = useExamLibrary()
  const [tab, setTab] = useState<'templates' | 'macros'>('templates')
  const [editing, setEditing] = useState<{ id?: string; template?: TemplateDraft; macro?: MacroInput } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) void load() }, [open, load])

  const close = () => { setEditing(null); onClose() }
  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try { await work(); if (done) toast(done, 'success'); return true }
    catch (reason) { toast(reason instanceof Error ? reason.message : 'Action failed.', 'error'); return false }
    finally { setBusy(false) }
  }
  const editMacro = (m?: ReportMacro) => setEditing({
    id: m?.scope === 'personal' ? m.id : undefined,
    macro: { name: m ? (m.scope === 'builtin' ? `my${m.name}` : m.name) : '', trigger: m?.trigger ?? '', text: m?.text ?? '' },
  })
  const patchTemplate = (update: Partial<TemplateDraft>) => setEditing((e) => (e?.template ? { ...e, template: { ...e.template, ...update } } : e))
  const patchMacro = (update: Partial<MacroInput>) => setEditing((e) => (e?.macro ? { ...e, macro: { ...e.macro, ...update } } : e))

  const valid = editing?.template
    ? !!editing.template.name.trim() && Object.values(editing.template.sections).some((v) => v?.trim())
    : !!editing?.macro && /[a-z0-9]/i.test(editing.macro.name) && !!editing.macro.text.trim()
  const save = () => act(async () => {
    if (editing?.template) await saveTemplate(fromDraft(editing.template), editing.id)
    else if (editing?.macro) await saveMacro({ name: editing.macro.name.trim(), trigger: editing.macro.trigger.trim(), text: editing.macro.text }, editing.id)
    setEditing(null)
  }, 'Saved')

  const footer = editing ? (
    <>
      <ShellButton type="button" className="btn" onClick={() => setEditing(null)}>Back to list</ShellButton>
      <ShellButton type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => void save()}>Save</ShellButton>
    </>
  ) : <ShellButton type="button" className="btn" onClick={close}>Done</ShellButton>

  return (
    <Sheet open={open} onClose={close} wide title="Exam templates & macros" subtitle="Personal templates and macros are saved to your account (this browser without an account). Built-ins can be duplicated and edited." footer={footer}>
      {error ? <p role="alert" className="tpl-error">{error}</p> : null}
      {editing?.template ? (
        <form className="tpl-form" onSubmit={(e) => e.preventDefault()}>
          <label>Name<input className="input" maxLength={80} value={editing.template.name} onChange={(e) => patchTemplate({ name: e.target.value })} /></label>
          <div className="tpl-titles">
            <label>Modality
              <select className="input" value={editing.template.modality} onChange={(e) => patchTemplate({ modality: e.target.value as ExamModality })}>
                {(Object.keys(MODALITY_LABEL) as ExamModality[]).map((m) => <option key={m} value={m}>{MODALITY_LABEL[m]}</option>)}
              </select>
            </label>
            <label>Body part<input className="input" maxLength={60} value={editing.template.bodyPart} onChange={(e) => patchTemplate({ bodyPart: e.target.value })} /></label>
          </div>
          <label>Keywords for suggestions (comma-separated)<input className="input" value={editing.template.keywords} placeholder="e.g. chest, thorax, lung" onChange={(e) => patchTemplate({ keywords: e.target.value })} /></label>
          <p className="exam-hint">{FIELD_HINT}</p>
          {REPORT_FIELD_KEYS.map((key) => (
            <label key={key}>{DEFAULT_SECTION_TITLES[key]}
              <textarea className="input" rows={key === 'findings' ? 8 : 2} maxLength={8000} value={editing.template!.sections[key] ?? ''}
                onChange={(e) => patchTemplate({ sections: { ...editing.template!.sections, [key]: e.target.value } })} />
            </label>
          ))}
        </form>
      ) : editing?.macro ? (
        <form className="tpl-form" onSubmit={(e) => e.preventDefault()}>
          <label>Shortcut name (type “.{editing.macro.name || 'name'}” then Space or Tab)
            <input className="input" maxLength={40} value={editing.macro.name} placeholder="e.g. normalchest" onChange={(e) => patchMacro({ name: e.target.value })} />
          </label>
          <label>Spoken phrase (dictation: “insert macro …”)
            <input className="input" maxLength={80} value={editing.macro.trigger} placeholder="e.g. normal chest" onChange={(e) => patchMacro({ trigger: e.target.value })} />
          </label>
          <label>Text<textarea className="input" rows={6} maxLength={4000} value={editing.macro.text} onChange={(e) => patchMacro({ text: e.target.value })} /></label>
          <p className="exam-hint">{FIELD_HINT}</p>
        </form>
      ) : (
        <>
          <div className="segmented exam-tabs" role="tablist" aria-label="Library">
            <ShellButton type="button" role="tab" aria-selected={tab === 'templates'} onClick={() => setTab('templates')}>Exam templates</ShellButton>
            <ShellButton type="button" role="tab" aria-selected={tab === 'macros'} onClick={() => setTab('macros')}>Macros</ShellButton>
          </div>
          {tab === 'templates' ? (
            <div className="tpl-list" role="tabpanel">
              {allExamTemplates({ templates }).map((t) => (
                <div key={t.id} className="tpl-row">
                  <div className="tpl-row-main">
                    <strong>{t.name}</strong>
                    <span>{MODALITY_LABEL[t.modality]} · {t.bodyPart || 'Any'} · {t.builtin ? 'Built-in' : 'Personal'}</span>
                  </div>
                  {t.builtin ? (
                    <ShellButton type="button" className="btn btn-sm" onClick={() => setEditing({ template: toDraft(t) })}><Copy size={13} /> Duplicate</ShellButton>
                  ) : (
                    <>
                      <ShellButton type="button" className="btn btn-sm" onClick={() => setEditing({ id: t.id, template: toDraft(t) })}>Edit</ShellButton>
                      <ShellButton type="button" className="icon-btn" aria-label={`Delete ${t.name}`} disabled={busy}
                        onClick={() => { if (window.confirm(`Delete exam template “${t.name}”?`)) void act(() => removeTemplate(t.id), 'Exam template deleted') }}>
                        <Trash2 size={15} />
                      </ShellButton>
                    </>
                  )}
                </div>
              ))}
              <ShellButton type="button" className="btn btn-primary" onClick={() => setEditing({ template: toDraft() })}><Plus size={14} /> New exam template</ShellButton>
            </div>
          ) : (
            <div className="tpl-list" role="tabpanel">
              {allMacros({ macros }).map((m) => (
                <div key={m.id} className="tpl-row">
                  <div className="tpl-row-main">
                    <strong>.{m.name}{m.trigger ? ` · “${m.trigger}”` : ''}</strong>
                    <span className="tpl-row-text">{m.scope === 'builtin' ? 'Built-in · ' : ''}{m.text}</span>
                  </div>
                  {m.scope === 'builtin' ? (
                    <ShellButton type="button" className="btn btn-sm" onClick={() => editMacro(m)}><Copy size={13} /> Duplicate</ShellButton>
                  ) : (
                    <>
                      <ShellButton type="button" className="btn btn-sm" onClick={() => editMacro(m)}>Edit</ShellButton>
                      <ShellButton type="button" className="icon-btn" aria-label={`Delete macro ${m.name}`} disabled={busy}
                        onClick={() => { if (window.confirm(`Delete macro “${m.name}”?`)) void act(() => removeMacro(m.id), 'Macro deleted') }}>
                        <Trash2 size={15} />
                      </ShellButton>
                    </>
                  )}
                </div>
              ))}
              <ShellButton type="button" className="btn btn-primary" onClick={() => editMacro()}><Plus size={14} /> New macro</ShellButton>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
