/* 軽量シンタックスハイライト（Python / C++ / JavaScript） */
window.Syntax = (() => {
  'use strict';

  const words = (s) => new Set(s.trim().split(/\s+/));

  const LANGS = {
    python: {
      re: /(#.*)|([rbfuRBFU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[jJ]?)\b|\.\d+)|([A-Za-z_]\w*)/g,
      groups: ['com', 'str', 'pre', 'num', 'word'],
      keywords: words(`False None True and as assert async await break class continue def del elif else
        except finally for from global if import in is lambda nonlocal not or pass raise return try while
        with yield match case self`),
      builtins: words(`print input int str float len range list map filter sorted reversed sum min max abs
        set dict tuple enumerate zip open pow divmod round bool chr ord bin hex oct any all iter next
        isinstance type super object frozenset bytes repr hash id format sys math itertools collections
        heapq bisect functools deque defaultdict Counter lru_cache cache gcd lcm sqrt isqrt inf`),
    },
    cpp: {
      re: /(\/\/.*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#.*)|(\b(?:0[xX][\da-fA-F']+|0[bB][01']+|\d[\d']*\.?[\d']*(?:[eE][+-]?\d+)?)[uUlLfF]*\b|\.\d+)|([A-Za-z_]\w*)/gm,
      groups: ['com', 'str', 'pre', 'num', 'word'],
      keywords: words(`alignas alignof auto bool break case catch char class const constexpr consteval
        continue decltype default delete do double else enum explicit extern false float for friend goto
        if inline int long mutable namespace new noexcept nullptr operator private protected public
        register return short signed sizeof static static_cast struct switch template this throw true try
        typedef typename union unsigned using virtual void volatile while size_t`),
      builtins: words(`std cin cout cerr endl vector string map set multiset pair queue deque stack
        priority_queue unordered_map unordered_set array bitset tuple ll ull ld make_pair make_tuple
        sort reverse unique lower_bound upper_bound min max swap abs accumulate iota fill greater less
        int64_t uint64_t int32_t begin end push_back emplace_back pop_back size empty first second
        printf scanf memset gcd lcm atcoder`),
    },
    javascript: {
      re: /(\/\/.*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?n?)\b|\.\d+)|([A-Za-z_$][\w$]*)/g,
      groups: ['com', 'str', 'num', 'word'],
      keywords: words(`async await break case catch class const continue debugger default delete do else
        export extends false finally for function if import in instanceof let new null of return static
        super switch this throw true try typeof undefined var void while with yield`),
      builtins: words(`console require process Math Number String Array Object Map Set BigInt JSON
        parseInt parseFloat Infinity NaN Symbol Promise Date RegExp Error`),
    },
  };

  const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

  function tokenize(text, lang) {
    const def = LANGS[lang];
    const tokens = [];
    if (!def) { tokens.push([null, text]); return tokens; }
    const re = new RegExp(def.re.source, def.re.flags);
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) tokens.push([null, text.slice(last, m.index)]);
      let cls = null;
      for (let g = 0; g < def.groups.length; g++) {
        if (m[g + 1] === undefined) continue;
        cls = def.groups[g];
        break;
      }
      if (cls === 'word') {
        const w = m[0];
        if (def.keywords.has(w)) cls = 'kw';
        else if (def.builtins.has(w)) cls = 'bi';
        else if (/^\s*\(/.test(text.slice(re.lastIndex, re.lastIndex + 40))) cls = 'fn';
        else cls = null;
      }
      tokens.push([cls, m[0]]);
      last = re.lastIndex;
    }
    if (last < text.length) tokens.push([null, text.slice(last)]);
    return tokens;
  }

  /** 1 行ずつ <div class="ln"> で包んだ HTML を返す（行番号は CSS カウンタで表示） */
  function renderLines(text, lang) {
    const lines = [''];
    for (const [cls, value] of tokenize(text, lang)) {
      const parts = value.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push('');
        if (!part) return;
        const html = escapeHtml(part);
        lines[lines.length - 1] += cls ? `<span class="tok-${cls}">${html}</span>` : html;
      });
    }
    // 空行も 1 行分の高さを持たせる
    return lines.map((l) => `<div class="ln">${l || ' '}</div>`).join('');
  }

  return { renderLines, supports: (lang) => lang in LANGS };
})();
