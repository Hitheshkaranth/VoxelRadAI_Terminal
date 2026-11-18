/** Identify a provider quota refusal without confusing ordinary model failures with it. */
export function gpuQuota(error: string): { message: string; resetWait?: string } | null {
  let detail = error
  const start = error.indexOf('{')
  if (start !== -1) {
    try {
      const payload = JSON.parse(error.slice(start))
      if (typeof payload.error === 'string') detail = payload.error
      else if (typeof payload.error?.message === 'string') detail = payload.error.message
    } catch { /* Some providers return plain-text errors. */ }
  }
  if (!/exceeded[^\n]*quota|quota exceeded|reached[^\n]*GPU limit/i.test(detail)) return null
  const budget = detail.match(/([\d.]+)s requested vs\.?\s*([\d.]+)s left/i)
  const resetWait = detail.match(/Try again in ([\d :.,a-z]+?)(?:\.\s|$)/i)?.[1]?.trim()
  return {
    message: budget
      ? `ZeroGPU has ${budget[2]} seconds of quota left, but this read reserves ${budget[1]} seconds. The image was not analyzed.`
      : 'ZeroGPU refused this read because the available GPU quota was exceeded. The image was not analyzed.',
    resetWait,
  }
}
