'use strict';

/* ────────────────────────── статистика ────────────────────────── */

const Z = { 90: 1.6448536, 95: 1.9599640, 99: 2.5758293 };

// erf, Abramowitz & Stegun 7.1.26 (|err| < 1.5e-7)
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const npdf = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
const clamp01 = v => Math.min(1, Math.max(0, v));

// Одна выборка: p̂, стандартная ошибка, интервал (нормальное приближение;
// при p = 0 или p = 1 — интервал Уилсона, т.к. SE там вырождается в ноль).
function stat(n, x, zc) {
  const p = x / n;
  const se = Math.sqrt(p * (1 - p) / n);
  let lo, hi;
  if (se > 0) {
    lo = p - zc * se;
    hi = p + zc * se;
  } else {
    const z2 = zc * zc, c = 1 / (1 + z2 / n);
    const center = (p + z2 / (2 * n)) * c;
    const half = zc * c * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
    lo = center - half;
    hi = center + half;
  }
  const sd = se > 0
    ? se
    : Math.sqrt((((x + 0.5) / (n + 1)) * (1 - (x + 0.5) / (n + 1))) / n) || 1e-6;
  return { n, x, p, se, sd, lo: clamp01(lo), hi: clamp01(hi), rough: Math.min(n * p, n * (1 - p)) < 5 };
}

// Две выборки: z-тест разницы долей без объединения дисперсий — та же SE,
// что и у интервала разницы, поэтому вывод всегда согласован с картинкой.
function compare(a, b, zc) {
  const d = b.p - a.p;
  const se = Math.sqrt(a.se ** 2 + b.se ** 2) || Math.sqrt(a.sd ** 2 + b.sd ** 2);
  const z = se > 0 ? d / se : 0;
  return {
    d, se, z,
    p: 2 * (1 - ncdf(Math.abs(z))),
    lo: d - zc * se,
    hi: d + zc * se,
    sig: Math.abs(z) > zc,
    rel: a.p > 0 ? d / a.p : null
  };
}

/* ────────────────────────── формат ────────────────────────── */

const ru = (v, d) => v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 2) => ru(v * 100, d) + '%';
const ppn = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + ru(Math.abs(v) * 100, d);
const pp = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + ru(Math.abs(v) * 100, d) + ' п.п.';
const pval = p => p < 0.001 ? 'p < 0,001' : 'p = ' + ru(p, 3);
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const digits = s => (String(s).match(/\d/g) || []).join('').replace(/^0+(?=\d)/, '');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// процент без хвостовых нулей: 5 / 5,6 / 0,125
const fmtRate = v => {
  const x = v * 100;
  return x.toFixed(x >= 1 ? 2 : x >= 0.1 ? 3 : 4).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',');
};

// сколько знаков нужно, чтобы интервал не выглядел нулевым
function decFor(widthPp) {
  if (widthPp < 0.02) return 4;
  if (widthPp < 0.2) return 3;
  return 2;
}

/* ────────────────────────── поля ввода ────────────────────────── */

const $ = id => document.getElementById(id);
const S = {
  a: { n: $('nA'), x: $('xA'), p: $('pA'), pane: $('paneA'), ci: $('ciA'), name: 'A' },
  b: { n: $('nB'), x: $('xB'), p: $('pB'), pane: $('paneB'), ci: $('ciB'), name: 'B' }
};
const dist = $('dist'), diff = $('diff'), tip = $('tip');

const iget = el => { const d = digits(el.value); return d === '' ? null : Number(d); };
const fget = el => {
  const s = el.value.replace(',', '.').trim();
  if (s === '' || s === '.') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const setInt = (el, v) => { el.value = group(String(Math.max(0, Math.round(v)))); };
const setPct = (el, v) => { el.value = fmtRate(v); };

// целое: только цифры, пробелы по разрядам, каретка на месте
function onInt(e) {
  const el = e.target;
  const before = (el.value.slice(0, el.selectionStart).match(/\d/g) || []).length;
  const fmt = group(digits(el.value));
  el.value = fmt;
  let i = 0, c = 0;
  while (i < fmt.length && c < before) { if (/\d/.test(fmt[i])) c++; i++; }
  el.setSelectionRange(i, i);
}

// процент: цифры и один разделитель, максимум 4 знака после него
function onPct(e) {
  const el = e.target;
  const caret = el.selectionStart;
  const raw = el.value;
  let out = '', sep = false, dec = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') { if (sep && dec++ >= 4) continue; out += ch; }
    else if ((ch === ',' || ch === '.') && !sep && out !== '') { sep = true; out += ','; }
  }
  if (out !== raw) {
    el.value = out;
    el.setSelectionRange(Math.max(0, caret - (raw.length - out.length)), Math.max(0, caret - (raw.length - out.length)));
  }
}

// количество и процент — два входа в одно и то же число, держим их согласованными
function sync(s, changed) {
  const n = iget(s.n), x = iget(s.x), p = fget(s.p);
  if (changed === 'n') {
    if (n === null || n <= 0) return;
    if (x !== null) setPct(s.p, x / n);
    else if (p !== null) setInt(s.x, n * p / 100);
  } else if (changed === 'x') {
    if (x === null || n === null || n <= 0) s.p.value = '';
    else setPct(s.p, x / n);
  } else {
    if (p === null) s.x.value = '';
    else if (n !== null && n > 0) setInt(s.x, n * p / 100);
  }
}

for (const k of ['a', 'b']) {
  for (const f of ['n', 'x', 'p']) {
    const el = S[k][f];
    el.addEventListener('input', e => { (f === 'p' ? onPct : onInt)(e); sync(S[k], f); render(); });
    el.addEventListener('focus', render);
    el.addEventListener('blur', render);
    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const up = e.key === 'ArrowUp' ? 1 : -1;
      if (f === 'p') {
        const step = (e.shiftKey ? 1 : 0.1) * up;
        el.value = fmtRate(Math.max(0, ((fget(el) || 0) + step)) / 100);
      } else {
        const step = (e.shiftKey ? 10 : 1) * up;
        el.value = group(String(Math.max(0, (iget(el) || 0) + step)));
      }
      sync(S[k], f);
      render();
    });
  }
}

let cl = Number(localStorage.getItem('cl')) || 95;
let hoverX = null;
let last = null;

/* ── тема: два положения, по умолчанию — системная ── */
const themeBox = $('theme');
const mq = matchMedia('(prefers-color-scheme: dark)');

function applyTheme(t, persist) {
  document.documentElement.dataset.theme = t;
  if (persist) localStorage.setItem('theme', t);
  const next = t === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему';
  themeBox.setAttribute('aria-pressed', String(t === 'dark'));
  themeBox.title = next;
  themeBox.setAttribute('aria-label', next);
}

applyTheme(localStorage.getItem('theme') || (mq.matches ? 'dark' : 'light'), false);
// пока выбор не сделан вручную, следуем за системой
mq.addEventListener('change', e => {
  if (!localStorage.getItem('theme')) applyTheme(e.matches ? 'dark' : 'light', false);
});
themeBox.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
});

$('conf').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  cl = Number(b.dataset.cl);
  localStorage.setItem('cl', cl);
  for (const x of $('conf').children) {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-checked', String(x === b));
  }
  render();
});

const warnBox = $('warn');
$('warnHint').addEventListener('click', e => {
  e.stopPropagation();
  const open = warnBox.classList.toggle('open');
  $('warnHint').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', () => {
  warnBox.classList.remove('open');
  $('warnHint').setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    warnBox.classList.remove('open');
    $('warnHint').setAttribute('aria-expanded', 'false');
  }
});

$('reset').addEventListener('click', () => {
  for (const k of ['a', 'b']) for (const f of ['n', 'x', 'p']) S[k][f].value = '';
  S.a.n.focus();
  render();
});

dist.addEventListener('mousemove', e => {
  if (!last || !last.a) return;
  const r = dist.getBoundingClientRect();
  hoverX = last.sx.inv((e.clientX - r.left) * (488 / r.width));
  paintHover();
});
dist.addEventListener('mouseleave', () => { hoverX = null; paintHover(); });

/* ────────────────────────── масштабы ────────────────────────── */

function scale(d0, d1, p0, p1) {
  const k = (p1 - p0) / ((d1 - d0) || 1);
  const f = v => p0 + (v - d0) * k;
  f.inv = px => d0 + (px - p0) / k;
  f.d0 = d0; f.d1 = d1;
  return f;
}

function ticks(d0, d1, target) {
  const raw = (d1 - d0) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return { vals: out, dec: Math.max(0, Math.ceil(-Math.log10(step * 100) + 0.001)) };
}

function area(v0, v1, mu, sd, sx, sy, base, steps = 88) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const v = v0 + (v1 - v0) * i / steps;
    d += (i ? 'L' : 'M') + sx(v).toFixed(1) + ' ' + sy(npdf(v, mu, sd)).toFixed(1) + ' ';
  }
  return d + `L${sx(v1).toFixed(1)} ${base} L${sx(v0).toFixed(1)} ${base} Z`;
}

function line(v0, v1, mu, sd, sx, sy, steps = 88) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const v = v0 + (v1 - v0) * i / steps;
    d += (i ? 'L' : 'M') + sx(v).toFixed(1) + ' ' + sy(npdf(v, mu, sd)).toFixed(1) + ' ';
  }
  return d;
}

/* ────────────────────────── отрисовка ────────────────────────── */

function render() {
  const zc = Z[cl];
  $('clCaption').textContent = '· ДИ ' + cl + '%';

  const read = s => {
    const n = iget(s.n), x = iget(s.x);
    const filled = s.n.value !== '' || s.x.value !== '' || s.p.value !== '';
    const bad = n !== null && x !== null && x > n;
    s.x.classList.toggle('bad', bad);
    s.p.classList.toggle('bad', bad);
    if (bad || n === null || x === null || n <= 0) return { filled, bad, s: null };
    return { filled, bad, s: stat(n, x, zc) };
  };

  const A = read(S.a), B = read(S.b);
  const a = A.s, b = B.s;
  const bTouched = B.filled || [S.b.n, S.b.x, S.b.p].includes(document.activeElement);
  S.b.pane.classList.toggle('idle', !bTouched);
  S.a.pane.classList.toggle('idle', !A.filled);

  const panel = (r, s, el, empty) => {
    if (r.bad) { el.innerHTML = 'конверсий больше посетителей'; return; }
    if (!s) { el.innerHTML = esc(empty); return; }
    const d = decFor((s.hi - s.lo) * 100);
    el.innerHTML = `ДИ ${cl}%: <b>${esc(pct(s.lo, d))} — ${esc(pct(s.hi, d))}</b> <i>±${esc(ru((s.hi - s.lo) / 2 * 100, d))} п.п.</i>`;
  };
  panel(A, a, S.a.ci, 'введите числа');
  panel(B, b, S.b.ci, bTouched ? 'введите числа' : 'для сравнения');

  const c = a && b ? compare(a, b, zc) : null;
  const vEl = $('verdict');
  if (!c) {
    vEl.classList.add('idle');
    $('vMain').innerHTML = a ? 'Добавьте вторую выборку' : 'Одна выборка — интервал, две — сравнение';
    $('vSub').innerHTML = a ? 'чтобы сравнить конверсии' : '';
  } else {
    vEl.classList.remove('idle');
    const dec = decFor(Math.abs(c.hi - c.lo) * 100);
    $('vMain').innerHTML = c.sig
      ? `Конверсия <span class="${c.d > 0 ? 's-b' : 's-a'}">${c.d > 0 ? 'B' : 'A'}</span> больше`
      : 'Разница не значима';
    const rel = c.rel !== null ? ` (${c.rel > 0 ? '+' : '−'}${ru(Math.abs(c.rel) * 100, 1)}% отн.)` : '';
    $('vSub').innerHTML = `${esc(pp(c.d, dec))}${esc(rel)}`
      + ` · погрешность (ДИ ${cl}%): от ${esc(ppn(c.lo, dec))} до ${esc(pp(c.hi, dec))}`
      + ` <i>${esc(pval(c.p))}</i>`;
  }

  const rough = (a && a.rough) || (b && b.rough);
  $('warn').hidden = !rough;
  if (rough) {
    $('warnText').textContent = 'мало наблюдений — оценка приблизительная';
    $('warnPop').innerHTML = hintText(a, b);
  }

  const sx = drawDist(a, b);
  last = { a, b, sx };
  drawDiff(c);
  paintHover();

  localStorage.setItem('v', JSON.stringify(['a', 'b'].flatMap(k => ['n', 'x', 'p'].map(f => S[k][f].value))));
}

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
}

// что именно «мало» и сколько нужно — показываем на числах самой узкой выборки
function hintText(a, b) {
  const worst = [['A', a], ['B', b]]
    .filter(r => r[1])
    .map(([name, s]) => ({ name, k: Math.round(Math.min(s.x, s.n - s.x)), fail: s.n - s.x < s.x }))
    .sort((p, q) => p.k - q.k)[0];
  const what = worst
    ? `${worst.k} ${plural(worst.k, worst.fail
        ? ['посетитель без конверсии', 'посетителя без конверсии', 'посетителей без конверсии']
        : ['конверсия', 'конверсии', 'конверсий'])}`
    : '';
  return '<p><b>Что значит «мало наблюдений»</b></p>'
    + '<p>Интервал и p-value считаются по нормальному приближению. Оно честно работает, когда в каждой '
    + 'выборке набралось <b>хотя бы 5 конверсий и хотя бы 5 посетителей без конверсии</b> (надёжнее — от 10). '
    + 'Дело не в самом трафике: если конверсия редкая, то и при 100 000 посетителей конверсий может быть мало.</p>'
    + (worst ? `<p>Сейчас узкое место — выборка <b>${worst.name}</b>: ${esc(what)}.</p>` : '')
    + '<p>Границы интервала и p-value в этой зоне смещены, читайте их как грубую прикидку. '
    + 'Надёжный ответ даст либо больше данных, либо точный тест Фишера.</p>';
}

/* ── график 1: распределения выборок и их интервалы ── */
function drawDist(a, b) {
  const W = 488, padL = 56, padR = 56, top = 12, base = 96;
  const barY = [115, 132], axisY = 156;
  const list = [a, b].map((s, i) => s && {
    s, name: i ? 'B' : 'A',
    color: i ? 'var(--series-b)' : 'var(--series-a)',
    fill: i ? 'var(--fill-b)' : 'var(--fill-a)',
    fillCi: i ? 'var(--fill-b-ci)' : 'var(--fill-a-ci)'
  }).filter(Boolean);

  if (!list.length) {
    dist.innerHTML = `<text x="${W / 2}" y="74" text-anchor="middle" font-size="11.5" fill="var(--text-muted)">здесь появится распределение</text>`;
    return scale(0, 1, padL, W - padR);
  }

  let d0 = Math.min(...list.map(o => Math.min(o.s.p - 4 * o.s.sd, o.s.lo)));
  let d1 = Math.max(...list.map(o => Math.max(o.s.p + 4 * o.s.sd, o.s.hi)));
  if (d1 - d0 < 1e-6) { d0 -= 5e-4; d1 += 5e-4; }
  const padv = (d1 - d0) * 0.07;
  d0 = Math.max(0, d0 - padv); d1 = Math.min(1, d1 + padv);
  const sx = scale(d0, d1, padL, W - padR);
  const maxDens = Math.max(...list.map(o => npdf(o.s.p, o.s.p, o.s.sd)));
  const sy = v => base - (v / maxDens) * (base - top);

  const t = ticks(d0, d1, 4);
  let g = '';
  for (const v of t.vals) {
    const x = sx(v).toFixed(1);
    g += `<line x1="${x}" y1="${top - 2}" x2="${x}" y2="${axisY - 15}" stroke="var(--grid)" stroke-width="1"/>`;
    g += `<text x="${x}" y="${axisY}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)" font-variant-numeric="tabular-nums">${esc(pct(v, t.dec))}</text>`;
  }
  g += `<line x1="${padL - 6}" y1="${base}" x2="${W - padR + 6}" y2="${base}" stroke="var(--border)" stroke-width="1"/>`;

  let marks = '', labels = '';
  list.forEach((o, row) => {
    const s = o.s;
    const v0 = Math.max(d0, s.p - 4.2 * s.sd), v1 = Math.min(d1, s.p + 4.2 * s.sd);
    marks += `<path d="${area(v0, v1, s.p, s.sd, sx, sy, base)}" fill="${o.fill}"/>`;
    marks += `<path d="${area(Math.max(v0, s.lo), Math.min(v1, s.hi), s.p, s.sd, sx, sy, base)}" fill="${o.fillCi}"/>`;
    marks += `<path d="${line(v0, v1, s.p, s.sd, sx, sy)}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    marks += `<line x1="${sx(s.p).toFixed(1)}" y1="${sy(npdf(s.p, s.p, s.sd)).toFixed(1)}" x2="${sx(s.p).toFixed(1)}" y2="${base}" stroke="${o.color}" stroke-width="1" stroke-dasharray="2 2" opacity=".5"/>`;

    const y = barY[row], xlo = sx(s.lo), xhi = sx(s.hi), xp = sx(s.p);
    marks += `<line x1="${xlo.toFixed(1)}" y1="${y}" x2="${xhi.toFixed(1)}" y2="${y}" stroke="${o.color}" stroke-width="3" stroke-linecap="round" opacity=".4"/>`;
    marks += `<circle cx="${xp.toFixed(1)}" cy="${y}" r="3.5" fill="${o.color}" stroke="var(--surface-1)" stroke-width="2"/>`;
    const dec = decFor((s.hi - s.lo) * 100);
    labels += `<text x="4" y="${y + 3.5}" font-size="9.5" font-weight="600" fill="var(--text-secondary)">${o.name}</text>`;
    labels += `<text x="${(xlo - 6).toFixed(1)}" y="${y + 3.5}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-variant-numeric="tabular-nums">${esc(pct(s.lo, dec))}</text>`;
    labels += `<text x="${(xhi + 6).toFixed(1)}" y="${y + 3.5}" font-size="9" fill="var(--text-muted)" font-variant-numeric="tabular-nums">${esc(pct(s.hi, dec))}</text>`;

    const peakY = sy(npdf(s.p, s.p, s.sd));
    labels += `<circle cx="${(xp + 7).toFixed(1)}" cy="${(peakY - 7).toFixed(1)}" r="2.8" fill="${o.color}"/>`;
    labels += `<text x="${(xp + 13).toFixed(1)}" y="${(peakY - 3.8).toFixed(1)}" font-size="10" font-weight="600" fill="var(--text-secondary)">${o.name}</text>`;
  });

  dist.innerHTML = g + marks + labels +
    `<line id="cross" x1="0" y1="${top - 2}" x2="0" y2="${axisY - 15}" stroke="var(--text-secondary)" stroke-width="1" opacity="0"/>`;
  dist.setAttribute('aria-label', list.map(o => `${o.name}: ${pct(o.s.p)}, интервал ${pct(o.s.lo)} — ${pct(o.s.hi)}`).join('; '));
  return sx;
}

/* ── график 2: распределение разницы, ноль как опора ── */
function drawDiff(c) {
  const fig = $('diffFig');
  if (!c) { fig.hidden = true; return; }
  fig.hidden = false;

  const W = 488, padL = 26, padR = 26, top = 6, base = 58, barY = 74, axisY = 92;
  const sd = c.se || 1e-9;
  let d0 = Math.min(c.d - 4 * sd, c.lo, 0), d1 = Math.max(c.d + 4 * sd, c.hi, 0);
  if (d1 - d0 < 1e-9) { d0 -= 5e-4; d1 += 5e-4; }
  const padv = (d1 - d0) * 0.08;
  d0 -= padv; d1 += padv;
  const sx = scale(d0, d1, padL, W - padR);
  const sy = v => base - (v / npdf(c.d, c.d, sd)) * (base - top);

  const win = c.d > 0 ? 'b' : 'a';
  const color = c.sig ? `var(--series-${win})` : 'var(--neutral-mark)';
  const fill = c.sig ? `var(--fill-${win})` : 'var(--neutral-fill)';
  const fillCi = c.sig ? `var(--fill-${win}-ci)` : 'var(--neutral-fill-ci)';

  const t = ticks(d0, d1, 4);
  let g = '';
  for (const v of t.vals) {
    const x = sx(v).toFixed(1);
    g += `<line x1="${x}" y1="${top - 2}" x2="${x}" y2="${barY + 7}" stroke="var(--grid)" stroke-width="1"/>`;
    g += `<text x="${x}" y="${axisY}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)" font-variant-numeric="tabular-nums">${esc(ru(v * 100, t.dec))}</text>`;
  }
  g += `<line x1="${padL - 6}" y1="${base}" x2="${W - padR + 6}" y2="${base}" stroke="var(--border)" stroke-width="1"/>`;

  const v0 = Math.max(d0, c.d - 4.2 * sd), v1 = Math.min(d1, c.d + 4.2 * sd);
  let m = `<path d="${area(v0, v1, c.d, sd, sx, sy, base)}" fill="${fill}"/>`;
  m += `<path d="${area(Math.max(v0, c.lo), Math.min(v1, c.hi), c.d, sd, sx, sy, base)}" fill="${fillCi}"/>`;
  m += `<path d="${line(v0, v1, c.d, sd, sx, sy)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  // ноль — главный ориентир: интервал его накрывает или нет
  const x0 = sx(0), zeroLeft = x0 < (padL + W - padR) / 2;
  m += `<line x1="${x0.toFixed(1)}" y1="${top}" x2="${x0.toFixed(1)}" y2="${barY + 7}" stroke="var(--text-primary)" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/>`;
  m += `<text x="${(x0 + (zeroLeft ? 5 : -5)).toFixed(1)}" y="${top + 8}" text-anchor="${zeroLeft ? 'start' : 'end'}" font-size="9.5" font-weight="600" fill="var(--text-primary)" stroke="var(--surface-1)" stroke-width="3" paint-order="stroke">0</text>`;

  m += `<line x1="${sx(c.lo).toFixed(1)}" y1="${barY}" x2="${sx(c.hi).toFixed(1)}" y2="${barY}" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity=".4"/>`;
  m += `<circle cx="${sx(c.d).toFixed(1)}" cy="${barY}" r="3.5" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/>`;

  const dec = decFor(Math.abs(c.hi - c.lo) * 100);
  diff.innerHTML = g + m;
  diff.setAttribute('aria-label', `Разница B − A: ${pp(c.d, dec)}, интервал ${pp(c.lo, dec)} … ${pp(c.hi, dec)}`);
}

/* ── слой наведения ── */
function paintHover() {
  const cross = dist.querySelector('#cross');
  if (!last || !last.a || hoverX === null || !cross) {
    if (cross) cross.setAttribute('opacity', '0');
    tip.hidden = true;
    return;
  }
  const sx = last.sx;
  const v = Math.min(sx.d1, Math.max(sx.d0, hoverX));
  const px = sx(v);
  cross.setAttribute('x1', px.toFixed(1));
  cross.setAttribute('x2', px.toFixed(1));
  cross.setAttribute('opacity', '0.3');

  const d = decFor((last.a.hi - last.a.lo) * 100);
  const rows = [['A', last.a], ['B', last.b]].filter(r => r[1]).map(([nm, s]) =>
    `<div>${nm} · <i>${v >= s.lo && v <= s.hi ? 'внутри интервала' : 'вне интервала'}</i></div>`).join('');
  tip.innerHTML = `<b>${esc(pct(v, d))}</b>${rows}`;
  tip.hidden = false;

  const fig = $('distFig').getBoundingClientRect();
  const svgRect = dist.getBoundingClientRect();
  const left = (svgRect.left - fig.left) + px * (svgRect.width / 488);
  tip.style.left = Math.max(0, Math.min(fig.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
  tip.style.top = '2px';
}

/* ────────────────────────── старт ────────────────────────── */

try {
  const saved = JSON.parse(localStorage.getItem('v') || '[]');
  if (saved.length === 6) {
    ['a', 'b'].forEach((k, i) => ['n', 'x', 'p'].forEach((f, j) => { S[k][f].value = saved[i * 3 + j] || ''; }));
  }
} catch (e) { /* пустой старт */ }

for (const btn of $('conf').children) {
  const on = Number(btn.dataset.cl) === cl;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(on));
}
render();
S.a.n.focus();
S.a.n.setSelectionRange(S.a.n.value.length, S.a.n.value.length);
