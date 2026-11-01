import type { AnalysisResult, Finding } from '../types.ts'
import { renderSlice, type Volume, type VolumePlane } from './volume.ts'

/** Conservative consistency checks, not a detector or a clinical validation score. */
export function findingIssues(finding: Finding, pixels: Uint8ClampedArray, width: number, height: number): string[] {
  const issues: string[] = []
  const background=displayBackground(pixels,width,height)
  const visibleFraction=1-background.reduce((sum,value)=>sum+value,0)/Math.max(1,width*height)
  if(finding.severity !== 'normal' && visibleFraction < .10) issues.push('Limited visible context: less than 10% of this image is outside border-connected background. Verify this peripheral slice manually.')
  const text = `${finding.title} ${finding.description} ${finding.location}`
  if (/\b\d+(?:\.\d+)?\s*(?:mm|cm|millimet(?:er|re)s?|centimet(?:er|re)s?)\b/i.test(text)) issues.push('Unsupported physical measurement: the model received no calibrated measurement tool.')
  if (/\b(?:\d+|multiple|several|adjacent|consecutive)\s+(?:axial\s+|coronal\s+|sagittal\s+)?slices?\b/i.test(text)) issues.push('Unsupported multi-slice claim: only one image was supplied to this request.')
  if (/\bT[12][ -]?(?:weighted|WI)\b|\bFLAIR\b|\b(?:post[ -]?contrast|contrast[ -]?enhanc\w*)\b/i.test(text)) issues.push('MRI sequence or contrast was inferred without acquisition metadata.')
  if (finding.severity !== 'normal' && /^normal\b/i.test(finding.title)) issues.push('Contradiction: the title describes normal anatomy but the severity marks an abnormality.')
  const b = finding.bbox
  if (b) {
    if (![b.x,b.y,b.w,b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0 || b.x < 0 || b.y < 0 || b.x+b.w > 1.001 || b.y+b.h > 1.001) issues.push('Invalid localization coordinates.')
    else {
      let black=0,total=0
      for(let y=Math.floor(b.y*height);y<Math.min(height,Math.ceil((b.y+b.h)*height));y++) for(let x=Math.floor(b.x*width);x<Math.min(width,Math.ceil((b.x+b.w)*width));x++) {
        total++;if(background[y*width+x])black++
      }
      if(total && black/total>=.95)issues.push('Localization is almost entirely in display background at the analysis window; verify on source images.')
    }
  }
  return issues
}
export function validateVolumeAnalysis(volume: Volume, plane: VolumePlane, index: number, window: {center:number;width:number}, analysis: AnalysisResult): AnalysisResult {
  const slice=renderSlice(volume,plane,index,window)
  return {...analysis,findings:analysis.findings.map(finding=>({...finding,validationIssues:findingIssues(finding,slice.pixels,slice.width,slice.height)}))}
}

/** Only near-black pixels connected to the image border; enclosed dark anatomy is retained. */
export function displayBackground(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask=new Uint8Array(width*height), queue=new Int32Array(width*height)
  let head=0,tail=0
  const add=(i:number)=>{if(mask[i]||Math.max(pixels[i*4],pixels[i*4+1],pixels[i*4+2])>12)return;mask[i]=1;queue[tail++]=i}
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x)}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1)}
  while(head<tail){const i=queue[head++],x=i%width;if(x>0)add(i-1);if(x+1<width)add(i+1);if(i>=width)add(i-width);if(i+width<width*height)add(i+width)}
  return mask
}
