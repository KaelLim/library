export type ConversionKind = 'year' | 'date' | 'time' | 'quantity';

export interface Conversion {
  original: string;
  replacement: string;
  kind: ConversionKind;
}

export interface NormalizeResult {
  text: string;
  conversions: Conversion[];
}

const CJK_DIGITS: Record<string, number> = {
  '〇': 0, '○': 0, '零': 0,
  '一': 1, '壹': 1,
  '二': 2, '貳': 2, '兩': 2,
  '三': 3, '參': 3,
  '四': 4, '肆': 4,
  '五': 5, '伍': 5,
  '六': 6, '陸': 6,
  '七': 7, '柒': 7,
  '八': 8, '捌': 8,
  '九': 9, '玖': 9,
};

const CJK_TENS: Record<string, number> = { '十': 10, '廿': 20, '卅': 30, '卌': 40 };

function digit(ch: string): number | null {
  return ch in CJK_DIGITS ? CJK_DIGITS[ch] : null;
}

/** Interpret a positional-notation Chinese digit sequence (each char = one digit). */
function positionalToNumber(seq: string): number | null {
  let n = 0;
  for (const ch of seq) {
    const d = digit(ch);
    if (d === null) return null;
    n = n * 10 + d;
  }
  return n;
}

/** Interpret a small (1–99) multiplicative CJK number with optional tens char. */
function smallMultiplicative(seq: string): number | null {
  // Match forms: X, X十, 十, 十X, X十Y, 廿, 廿X, 卅, 卅X
  if (seq.length === 1) {
    if (seq === '兩') return 2;
    return digit(seq) ?? CJK_TENS[seq] ?? null;
  }
  // Look for tens char in the sequence
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] in CJK_TENS) {
      const tensValue = CJK_TENS[seq[i]];
      const leadStr = seq.slice(0, i);
      const tailStr = seq.slice(i + 1);
      let lead = 1;
      if (leadStr.length === 1) {
        const d = digit(leadStr);
        if (d === null) return null;
        lead = d;
      } else if (leadStr.length > 1) {
        return null;
      }
      let tail = 0;
      if (tailStr.length === 1) {
        const d = digit(tailStr);
        if (d === null) return null;
        tail = d;
      } else if (tailStr.length > 1) {
        return null;
      }
      // 十/廿/卅 are already the ×10 unit or higher
      const value = (tensValue === 10 ? lead * 10 : tensValue) + tail;
      return value;
    }
  }
  return null;
}

const YEAR_REGEX = /[〇○零一二三四五六七八九]{4}年/g;
// (?<![第〇○零一二三四五六七八九十廿卅兩壹貳參肆伍陸柒捌玖百千萬]) — same rationale as QUANTITY_REGEX below:
// preserves ordinals like 第一日/第一月 and prevents mid-run matches inside longer multiplicative
// numbers like 一百二十三日.
const MONTH_DAY_REGEX = new RegExp(
  '(?<![第〇○零一二三四五六七八九十廿卅兩壹貳參肆伍陸柒捌玖百千萬])(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅[一]?|[一二三四五六七八九])(月|日)',
  'g',
);
const HOUR_MINUTE_REGEX = new RegExp(
  '(?<![第〇○零一二三四五六七八九十廿卅兩壹貳參肆伍陸柒捌玖百千萬])(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|[一二三四五六七八九])(時|點|分)',
  'g',
);

const MEASURE_WORD_GROUP = '(人|位|名|次|場|件|戶|所|間|棟|輛|台|支|隻|張|冊|本|篇|坪|公斤|公里|公尺|元|年|週年)';
// (?<!第) — ordinals like 第一次, 第一年 stay Chinese per spec preservation rule.
// Also exclude any preceding CJK numeral/hundred/thousand/ten-thousand char so a match can't
// start mid-run inside a longer (3+ digit) multiplicative number like 一百二十三 — without this,
// the 'g' flag would still find "二十三人" as a substring match starting right after "百".
const QUANTITY_REGEX = new RegExp(
  `(?<![第〇○零一二三四五六七八九十廿卅兩壹貳參肆伍陸柒捌玖百千萬])(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅[一二三四五六七八九]?|[一二三四五六七八九兩])${MEASURE_WORD_GROUP}`,
  'g',
);

export function normalizeNumbers(input: string): NormalizeResult {
  const conversions: Conversion[] = [];

  let text = input.replace(YEAR_REGEX, (match) => {
    const digits = match.slice(0, 4);
    const n = positionalToNumber(digits);
    if (n === null) return match;
    const replacement = `${n}年`;
    conversions.push({ original: match, replacement, kind: 'year' });
    return replacement;
  });

  text = text.replace(MONTH_DAY_REGEX, (match, unit) => {
    const numPart = match.slice(0, -1);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'date' });
    return replacement;
  });

  text = text.replace(HOUR_MINUTE_REGEX, (match, unit) => {
    const numPart = match.slice(0, -1);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    // range check
    const isHour = unit === '時' || unit === '點';
    if (isHour && (n < 0 || n > 24)) return match;
    if (unit === '分' && (n < 0 || n > 59)) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'time' });
    return replacement;
  });

  text = text.replace(QUANTITY_REGEX, (match, unit) => {
    const numPart = match.slice(0, -unit.length);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'quantity' });
    return replacement;
  });

  return { text, conversions };
}
