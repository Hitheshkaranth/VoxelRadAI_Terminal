// Letterhead for printed reports. Without a template it shows the institution name from Settings.
import type { ReportTemplate } from '../../lib/reportTemplates'

export function TemplateHeader({ template, fallbackInstitution, subtitle, meta }: {
  template: ReportTemplate | null
  fallbackInstitution: string
  subtitle: string
  meta: string
}) {
  if (!template) {
    return (
      <header className="rp-lh">
        <div className="rp-lh-name">{fallbackInstitution || 'Diagnostic Radiology'}</div>
        <div className="rp-lh-sub">{subtitle}</div>
        <div className="rp-lh-meta">{meta}</div>
      </header>
    )
  }
  const { header } = template
  return (
    <header className={`rp-lh rp-lh-tpl rp-lh-${header.align}`}>
      {header.logoDataUrl ? <img className="rp-lh-logo" src={header.logoDataUrl} alt="" /> : null}
      <div className="rp-lh-text">
        <div className="rp-lh-name">{header.institution || fallbackInstitution || 'Diagnostic Radiology'}</div>
        {header.department ? <div className="rp-lh-dept">{header.department}</div> : null}
        {header.lines.filter((l) => l.trim()).map((line, i) => <div key={i} className="rp-lh-line">{line}</div>)}
      </div>
      <div className="rp-lh-right">
        <div className="rp-lh-sub">{subtitle}</div>
        <div className="rp-lh-meta">{meta}</div>
      </div>
    </header>
  )
}
