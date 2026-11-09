export function pagination(params) {
  const read = (key, fallback, minimum, maximum) => {
    const raw = params.get(key)
    if (raw === null) return fallback
    if (!/^\d+$/.test(raw)) throw new Error('Pagination requires integer limit and offset.')
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Pagination is outside the supported range.')
    return value
  }
  return { limit: read('limit',25,1,100), offset: read('offset',0,0,1000000) }
}
