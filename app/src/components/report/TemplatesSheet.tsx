// Create, edit, delete and choose the default report template (letterhead, footer, section titles).
import { useEffect, useState } from 'react'
import { Plus, Star, Trash2, Upload } from 'lucide-react'
import { Sheet } from '../shell/Sheet'
import { ShellButton } from '../shell/ShellButton'
import { toast } from '../shell/toastStore'
import {
  DEFAULT_SECTION_TITLES,
  blankTemplate,
  layoutOf,
  letterheadFromFile,
  logoDataUrl,
  systematicTemplate,
  useTemplates,
  type ReportTemplate,
  type TemplateInput,
} from '../../lib/reportTemplates'
import { REPORT_FIELD_KEYS } from '../../types'
import { TemplateHeader } from './TemplateHeader'
import { SystematicLetterhead } from './SystematicReport'

const toInput = (t: ReportTemplate): TemplateInput => ({ name: t.name, header: { ...t.header, lines: [...t.header.lines] }, footer: { ...t.footer }, sectionTitles: { ...t.sectionTitles },
  ...(t.layout ? { layout: t.layout } : {}), ...(t.signatory ? { signatory: { ...t.signatory, ...(t.signatory.lines ? { lines: [...t.signatory.lines] } : {}) } } : {}), ...(t.signatureLines ? { signatureLines: [...t.signatureLines] } : {}), ...(t.greeting !== undefined ? { greeting: t.greeting } : {}), ...(t.letterhead ? { letterhead: { ...t.letterhead } } : {}) })
const NO_SIGNATORY = { name: '', qualifications: '', registration: '' }

export function TemplatesSheet({ open, onClose, institution }: { open: boolean; onClose: () => void; institution: string }) {
  const { templates, load, save, remove, setDefault, error } = useTemplates()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TemplateInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [letterheadBusy, setLetterheadBusy] = useState(false)

  useEffect(() => { if (open) void load() }, [open, load])

  const edit = (template: ReportTemplate | null, preset?: TemplateInput) => {
    setEditingId(template?.id ?? null)
    setDraft(template ? toInput(template) : preset ?? blankTemplate(institution))
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
                <span>{t.header.institution || 'No institution'}{layoutOf(t) === 'systematic' ? ' · Systematic layout' : ''}{t.isDefault ? ' · Default' : ''}</span>
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
          <ShellButton type="button" className="btn" onClick={() => edit(null, systematicTemplate(institution))}><Plus size={14} /> New systematic template (diagnostic-centre style)</ShellButton>
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
            <legend>Blank report page (your printed letterhead)</legend>
            <p className="tpl-empty">Upload a blank page of the report you print today (PDF or a scan/photo). It prints behind every page, and the report fills the space between its header and footer.</p>
            <div className="tpl-lh">
              {draft.letterhead ? (
                <div className="tpl-lh-page" aria-label="Blank page preview with the writing area marked">
                  <img src={draft.letterhead.pageDataUrl} alt="" />
                  <span className="tpl-lh-area" style={{ top: `${(draft.letterhead.topMm / 297) * 100}%`, bottom: `${(draft.letterhead.bottomMm / 297) * 100}%` }}>Report text</span>
                </div>
              ) : <span className="tpl-lh-page tpl-lh-empty">No page</span>}
              <div className="tpl-lh-side">
                <label className="btn btn-sm tpl-upload">
                  <Upload size={14} /> {letterheadBusy ? 'Reading…' : draft.letterhead ? 'Replace page' : 'Upload blank page'}
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden disabled={letterheadBusy} onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = ''
                    if (!file) return
                    setLetterheadBusy(true)
                    try { const letterhead = await letterheadFromFile(file); patch((d) => ({ ...d, letterhead })); toast('Page read. Check the marked writing area.', 'success') }
                    catch (reason) { toast(reason instanceof Error ? reason.message : 'That page could not be read.', 'error') }
                    finally { setLetterheadBusy(false) }
                  }} />
                </label>
                {draft.letterhead ? <>
                  <label>Space for header (mm from top)<input className="input" type="number" min={0} max={150} value={draft.letterhead.topMm}
                    onChange={(e) => { const v = Math.min(150, Math.max(0, Number(e.target.value) || 0)); patch((d) => (d.letterhead ? { ...d, letterhead: { ...d.letterhead, topMm: v } } : d)) }} /></label>
                  <label>Space for footer (mm from bottom)<input className="input" type="number" min={0} max={120} value={draft.letterhead.bottomMm}
                    onChange={(e) => { const v = Math.min(120, Math.max(0, Number(e.target.value) || 0)); patch((d) => (d.letterhead ? { ...d, letterhead: { ...d.letterhead, bottomMm: v } } : d)) }} /></label>
                  <p className="tpl-empty">With a blank page, its own header replaces the logo and lines above, and page numbers are left off so they don't print over your footer.</p>
                  <ShellButton type="button" className="btn btn-sm btn-plain" onClick={() => patch((d) => { const { letterhead: _drop, ...rest } = d; return rest })}>Remove page</ShellButton>
                </> : null}
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>Layout</legend>
            <label>Report layout
              <select className="input" value={layoutOf(draft)} onChange={(e) => patch((d) => ({ ...d, layout: e.target.value as 'standard' | 'systematic' }))}>
                <option value="standard">Standard (technique, comparison, findings, impression)</option>
                <option value="systematic">Systematic (patient block, one row per anatomical section)</option>
              </select>
            </label>
            {layoutOf(draft) === 'systematic' ? (
              <>
                <label>Greeting line<input className="input" maxLength={80} value={draft.greeting ?? ''} placeholder="THANKS FOR REFERRING" onChange={(e) => patch((d) => ({ ...d, greeting: e.target.value }))} /></label>
                <label>Reporting radiologist<input className="input" maxLength={120} value={draft.signatory?.name ?? ''} placeholder="Dr. A. Radiologist" onChange={(e) => patch((d) => ({ ...d, signatory: { ...NO_SIGNATORY, ...d.signatory, name: e.target.value } }))} /></label>
                <label>Qualifications<input className="input" maxLength={160} value={draft.signatory?.qualifications ?? ''} placeholder="MBBS, MD (Radiodiagnosis)" onChange={(e) => patch((d) => ({ ...d, signatory: { ...NO_SIGNATORY, ...d.signatory, qualifications: e.target.value } }))} /></label>
                <label>Registration line<input className="input" maxLength={120} value={draft.signatory?.registration ?? ''} placeholder="Medical council registration number" onChange={(e) => patch((d) => ({ ...d, signatory: { ...NO_SIGNATORY, ...d.signatory, registration: e.target.value } }))} /></label>
                <label>More radiologist lines (one per line, up to 4)
                  <textarea className="input" rows={2} value={(draft.signatory?.lines ?? []).join('\n')} placeholder="e.g. Life membership number"
                    onChange={(e) => patch((d) => ({ ...d, signatory: { ...NO_SIGNATORY, ...d.signatory, lines: e.target.value.split('\n').slice(0, 4).map((l) => l.slice(0, 160)) } }))} />
                </label>
                <label>Signature block (one per line, up to 6; text only)
                  <textarea className="input" rows={3} value={(draft.signatureLines ?? []).join('\n')} placeholder="Defaults to the radiologist's name, qualifications and registration"
                    onChange={(e) => patch((d) => ({ ...d, signatureLines: e.target.value.split('\n').slice(0, 6).map((l) => l.slice(0, 160)) }))} />
                </label>
                <p className="tpl-empty">Every section heading prints; one the read said nothing about prints with an empty line for you. Normals appear only where the read stated them.</p>
              </>
            ) : null}
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
          <div className="tpl-preview" aria-label="Header preview">{layoutOf(draft) === 'systematic'
            ? <SystematicLetterhead template={{ ...draft, id: '', isDefault: false }} fallbackInstitution={institution} />
            : <TemplateHeader template={{ ...draft, id: '', isDefault: false }} fallbackInstitution={institution} subtitle="Radiology Report" meta="Report date · Accession" />}</div>
        </form>
      )}
    </Sheet>
  )
}
