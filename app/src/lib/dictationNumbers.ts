// Spoken measurements -> report notation: "one point two by zero point eight centimetres" -> "1.2 x 0.8 cm".
// Only numbers that are part of a measurement are rewritten, so "one of the nodules" stays as words.

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const UNITS: Record<string, string> = {
  centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm', cm: 'cm', cms: 'cm',
  millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm', mm: 'mm', mms: 'mm',
  millilitre: 'mL', millilitres: 'mL', milliliter: 'mL', milliliters: 'mL', ml: 'mL', cc: 'cc', ccs: 'cc',
  percent: '%', hu: 'HU',
}
const TWO_WORD_UNITS: Record<string, string> = { 'hounsfield unit': 'HU', 'hounsfield units': 'HU', 'per cent': '%' }
// "into" is how many Indian-English speakers say "by"; it and "times" need a unit to count as a measurement.
const SEPARATORS = new Set(['by', 'x', 'times', 'into'])

interface Token { lead: string; core: string; trail: string }
const split = (word: string): Token => {
  const m = word.match(/^([("']*)(.*?)([.,;:?!)"']*)$/) as RegExpMatchArray
  return { lead: m[1], core: m[2].toLowerCase(), trail: m[3] }
}

interface Num { value: string; end: number; spokenDecimal: boolean }

/** Read one number starting at token i: digits ("1.2", "12") or words ("twenty three", "zero point eight"). */
function readNumber(tokens: Token[], i: number): Num | null {
  const t = tokens[i]
  if (!t) return null
  let j = i
  let integer = ''
  let stop = false // A token with trailing punctuation ends the number.
  if (/^\d+(\.\d+)?$/.test(t.core)) {
    integer = t.core
    stop = !!t.trail
    j++
  } else {
    let value = -1
    const word = (k: number) => (tokens[k] && !stop ? tokens[k].core : '')
    const take = (k: number) => { stop = !!tokens[k].trail; return k + 1 }
    if (ONES[word(j)] !== undefined && word(j + 1) === 'hundred' && !tokens[j].trail) {
      value = ONES[word(j)] * 100
      j = take(take(j))
      if (word(j) === 'and' && (TENS[word(j + 1)] !== undefined || ONES[word(j + 1)] !== undefined)) j = take(j)
    }
    if (TENS[word(j)] !== undefined) {
      value = Math.max(0, value) + TENS[word(j)]
      j = take(j)
      if (ONES[word(j)] > 0 && ONES[word(j)] < 10) { value += ONES[word(j)]; j = take(j) }
    } else if (ONES[word(j)] !== undefined) {
      value = Math.max(0, value) + ONES[word(j)]
      j = take(j)
    }
    if (value < 0) return null
    integer = String(value)
  }
  let spokenDecimal = false
  if (!stop && tokens[j]?.core === 'point' && !tokens[j].trail) {
    let digits = ''
    let k = j + 1
    while (tokens[k] && !stop) {
      const c = tokens[k].core
      if (/^\d+$/.test(c)) digits += c
      else if (ONES[c] !== undefined && ONES[c] < 10) digits += String(ONES[c])
      else break
      stop = !!tokens[k].trail
      k++
    }
    if (digits) { integer += `.${digits}`; j = k; spokenDecimal = true }
  }
  // A lone "oh" is an exclamation, not zero.
  if (t.core === 'oh' && !spokenDecimal) return null
  return { value: integer, end: j, spokenDecimal }
}

function readUnit(tokens: Token[], i: number): { unit: string; end: number } | null {
  const a = tokens[i]
  if (!a) return null
  const b = tokens[i + 1]
  if (b && !a.trail && TWO_WORD_UNITS[`${a.core} ${b.core}`]) return { unit: TWO_WORD_UNITS[`${a.core} ${b.core}`], end: i + 2 }
  return UNITS[a.core] ? { unit: UNITS[a.core], end: i + 1 } : null
}

export function normaliseMeasurements(text: string): string {
  const raw = text.split(/\s+/).filter(Boolean)
  const tokens = raw.map(split)
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const first = readNumber(tokens, i)
    if (!first) { out.push(raw[i]); i++; continue }
    const values = [first.value]
    let spoken = first.spokenDecimal
    let needsUnit = false
    let end = first.end
    // Extend "a by b by c" while each piece ends cleanly (no punctuation in the middle of a measurement).
    while (!tokens[end - 1].trail && SEPARATORS.has(tokens[end]?.core) && !tokens[end].trail) {
      const next = readNumber(tokens, end + 1)
      if (!next) break
      if (tokens[end].core === 'into' || tokens[end].core === 'times') needsUnit = true
      values.push(next.value)
      spoken ||= next.spokenDecimal
      end = next.end
    }
    const unit = tokens[end - 1].trail ? null : readUnit(tokens, end)
    const isMeasurement = unit || (!needsUnit && (values.length > 1 || spoken))
    // Leave lone digits alone; only rewrite when something changes.
    const fromWords = raw.slice(i, end).some((w) => !/^[("']*\d+(\.\d+)?[.,;:?!)"']*$/.test(w))
    if (!isMeasurement || (!unit && values.length === 1 && !fromWords)) { out.push(raw[i]); i++; continue }
    const last = unit ? unit.end : end
    const suffix = unit ? (unit.unit === '%' ? '%' : ` ${unit.unit}`) : ''
    out.push(`${tokens[i].lead}${values.join(' x ')}${suffix}${tokens[last - 1].trail}`)
    i = last
  }
  return out.join(' ')
}
