// Create, edit, delete and choose the default report template (letterhead, footer, section titles).
import { useEffect, useState } from 'react'
import { Plus, Star, Trash2, Upload } from 'lucide-react'
import { Sheet } from '../shell/Sheet'
import { ShellButton } from '../shell/ShellButton'
import { toast } from '../shell/toastStore'
import {
  DEFAULT_SECTION_TITLES,
  blankTemplate,
  logoDataUrl,
  useTemplates,
  type ReportTemplate,
  type TemplateInput,
} from '../../lib/reportTemplates'
import { REPORT_FIELD_KEYS } from '../../types'
import { TemplateHeader } from './TemplateHeader'

const toInput = (t: ReportTemplate): TemplateInput => ({ name: t.name, header: { ...t.header, lines: [...t.header.lines] }, footer: { ...t.footer }, sectionTitles: { ...t.sectionTitles } })

export function TemplatesSheet({ open, onClose, institution }: { open: boolean; onClose: () => void; institution: string }) {
  const { templates, load, save, remove, setDefault, error } = useTemplates()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TemplateInput | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) void load() }, [open, load])

  const edit = (template: ReportTemplate | null) => {
    setEditingId(template?.id ?? null)
    setDraft(template ? toInput(template) : blankTemplate(institution))
  }
  const close = () => { setDraft(null); setEditingId(null); onClose() }
  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try { await work(); if (done) toast(done, 'success') }
    catch (reason) { toast(reason instanceof Error ? reason.message : 'Template action failed.', 'error') }
    finally { setBusy(false) }
  }
  const patch = (update: (d: TemplateInput) => TemplateInput) => setDraft((d) => (d ? update(d) : d))

  const footer = draft ? (
    <>
      <ShellButton type="button" className="btn" onClick={() => setDraft(null)}>Back to list</ShellButton>
      <ShellButton type="button" className="btn btn-primary" disabled={busy || !draft.name.trim()}
        onClick={() => act(async () => { const id = await save(draft, editingId ?? undefined); setEditingId(id); setDraft(null) }, 'Template saved')}>
        Save template
      </ShellButton>
    </>
  ) : <ShellButton type="button" className="btn" onClick={close}>Done</ShellButton>

  return (
    <Sheet open={open} onClose={close} title="Report templates" subtitle="Letterhead, footer and section titles for printed and PDF reports. Saved to your account." footer={footer}>
      {error ? <p role="alert" className="tpl-error">{error}</p> : null}
      {!draft ? (
        <div className="tpl-list">
          {templates.length === 0 ? <p className="tpl-empty">No templates yet. Reports use the standard header until you create one.</p> : null}
          {templates.map((t) => (
            <div key={t.id} className="tpl-row">
              <div className="tpl-row-main">
                <strong>{t.name}</strong>
                <span>{t.header.institution || 'No institution'}{t.isDefault ? ' · Default' : ''}</span>
              </div>
              <ShellButton type="button" className={`icon-btn${t.isDefault ? ' tpl-star-on' : ''}`} disabled={busy}
                aria-label={t.isDefault ? `${t.name} is the default; clear default` : `Make ${t.name} the default`} aria-pressed={t.isDefault}
                onClick={() => act(() => setDefault(t.isDefault ? null : t.id))}>
                <Star size={15} />
              </ShellButton>
              <ShellButton type="button" className="btn btn-sm" onClick={() => edit(t)}>Edit</ShellButton>
              <ShellButton type="button" className="icon-btn" aria-label={`Delete ${t.name}`} disabled={busy}
                onClick={() => { if (window.confirm(`Delete template “${t.name}”? Reports using it switch to your default template.`)) void act(() => remove(t.id), 'Template deleted') }}>
                <Trash2 size={15} />
              </ShellButton>
            </div>
          ))}
          <ShellButton type="button" className="btn btn-primary" onClick={() => edit(null)}><Plus size={14} /> New template</ShellButton>
        </div>
      ) : (
        <form className="tpl-form" onSubmit={(e) => e.preventDefault()}>
          <label>Template name<input className="input" maxLength={80} value={draft.name} onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))} /></label>
          <fieldset>
            <legend>Header</legend>
            <div className="tpl-logo-row">
              {draft.header.logoDataUrl ? <img src={draft.header.logoDataUrl} alt="Logo preview" className="tpl-logo" /> : <span className="tpl-logo tpl-logo-empty">No logo</span>}
              <label className="btn btn-sm tpl-upload">
                <Upload size={14} /> {draft.header.logoDataUrl ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                  const file = e.target.files?.[0]; e.target.value = ''
                  if (!file) return
                  try { const url = await logoDataUrl(file); patch((d) => ({ ...d, header: { ...d.header, logoDataUrl: url } })) }
                  catch (reason) { toast(reason instanceof Error ? reason.message : 'Logo could not be read.', 'error') }
                }} />
              </label>
              {draft.header.logoDataUrl ? <ShellButton type="button" className="btn btn-sm btn-plain" onClick={() => patch((d) => ({ ...d, header: { ...d.header, logoDataUrl: undefined } }))}>Remove</ShellButton> : null}
            </div>
            <label>Institution<input className="input" maxLength={120} value={draft.header.institution} onChange={(e) => patch((d) => ({ ...d, header: { ...d.header, institution: e.target.value } }))} /></label>
            <label>Department / subtitle<input className="input" maxLength={120} value={draft.header.department} onChange={(e) => patch((d) => ({ ...d, header: { ...d.header, department: e.target.value } }))} /></label>
            <label>Address and contact lines (one per line, up to 6)
              <textarea className="input" rows={3} value={draft.header.lines.join('\n')}
                onChange={(e) => patch((d) => ({ ...d, header: { ...d.header, lines: e.target.value.split('\n').slice(0, 6).map((l) => l.slice(0, 160)) } }))} />
            </label>
            <label>Alignment
              <select className="input" value={draft.header.align} onChange={(e) => patch((d) => ({ ...d, header: { ...d.header, align: e.target.value as 'left' | 'center' } }))}>
                <option value="left">Logo left</option><option value="center">Centered</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>Footer (repeats on every printed page)</legend>
            <label>Footer text<textarea className="input" rows={2} maxLength={600} value={draft.footer.text} placeholder="e.g. Reported by consultant radiologist · For queries call …"
              onChange={(e) => patch((d) => ({ ...d, footer: { ...d.footer, text: e.target.value } }))} /></label>
            <label className="tpl-check"><input type="checkbox" checked={draft.footer.showPageNumbers} onChange={(e) => patch((d) => ({ ...d, footer: { ...d.footer, showPageNumbers: e.target.checked } }))} /> Page numbers (“Page 1 of 2”)</label>
            <label className="tpl-check"><input type="checkbox" checked={draft.footer.showDisclaimer} onChange={(e) => patch((d) => ({ ...d, footer: { ...d.footer, showDisclaimer: e.target.checked } }))} /> AI decision-support disclaimer on signed reports (always shown on drafts)</label>
          </fieldset>
          <fieldset>
            <legend>Section titles</legend>
            <div className="tpl-titles">
              {REPORT_FIELD_KEYS.map((key) => (
                <label key={key}>{DEFAULT_SECTION_TITLES[key]}
                  <input className="input" maxLength={60} placeholder={DEFAULT_SECTION_TITLES[key]} value={draft.sectionTitles[key] ?? ''}
                    onChange={(e) => patch((d) => ({ ...d, sectionTitles: { ...d.sectionTitles, [key]: e.target.value || undefined } }))} />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="tpl-preview" aria-label="Header preview"><TemplateHeader template={{ ...draft, id: '', isDefault: false }} fallbackInstitution={institution} subtitle="Radiology Report" meta="Report date · Accession" /></div>
        </form>
      )}
    </Sheet>
  )
}
