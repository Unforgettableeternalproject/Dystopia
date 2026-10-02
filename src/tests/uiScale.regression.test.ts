// 字級縮放防回歸掃描
// 掃描 src/**/*.svelte|ts|css，凡是寫死的絕對字級（px / pt）沒有透過 --ui-scale 計算者，一律失敗並列出位置。
// 縮放來源只有 app.css 的 `--ui-scale: 1;`（不含 px），因此不需要任何允許清單。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const EXTS = new Set(['.svelte', '.ts', '.css']);
const SELF = join(SRC, 'tests', 'uiScale.regression.test.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p)) && p !== SELF) out.push(p);
  }
  return out;
}

// 任何含 px / pt 的值（含 {size}px、${n}px 等動態樣式字串）都必須透過 --ui-scale 計算；em / rem / % 相對於已縮放的根字級，允許
const ABS_UNIT = /(?:\d|}|\))\s*(px|pt)\b/;
const SCALED = /var\(\s*--ui-scale\s*\)/;

interface Rule { name: string; re: RegExp; bad: (m: RegExpExecArray) => boolean }

const RULES: Rule[] = [
  // CSS / inline style / JS 樣式字串中的 font-size: 13px
  {
    name: 'font-size 寫死絕對單位',
    re: /font-size\s*:\s*((?:\{[^}\n]*\}|[^;"'`}\n])*)/g,
    bad: m => ABS_UNIT.test(m[1]) && !SCALED.test(m[1]),
  },
  // font 簡寫：font: 12px monospace / font: bold 10px ...
  {
    name: 'font 簡寫寫死絕對單位',
    re: /(?<![-\w.])font\s*:\s*((?:\{[^}\n]*\}|[^;"'`}\n])*)/g,
    bad: m => ABS_UNIT.test(m[1]) && !SCALED.test(m[1]),
  },
  // 字級相關 CSS 變數定義：--le-font-sm: 13px
  {
    name: '字級變數定義寫死絕對單位',
    re: /(--[\w-]*font[\w-]*)\s*:\s*((?:\{[^}\n]*\}|[^;"'`}\n])*)/g,
    bad: m => ABS_UNIT.test(m[2]) && !SCALED.test(m[2]),
  },
  // SVG 屬性 / Svelte style directive：font-size="8"、style:font-size="12px"、font-size={9}
  {
    name: 'font-size 屬性寫死數值',
    re: /font-size\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+)/g,
    bad: m => !SCALED.test(m[1]) && (ABS_UNIT.test(m[1]) || /^["'{]?\s*\d/.test(m[1])),
  },
  // Canvas：ctx.font = '10px ...'
  {
    name: 'Canvas font 寫死絕對單位',
    re: /\.font\s*=\s*(['"`][^'"`]*['"`])/g,
    bad: m => ABS_UNIT.test(m[1]) && !SCALED.test(m[1]),
  },
  // JS 物件樣式：fontSize: 12 / fontSize = '12px'
  {
    name: 'fontSize 寫死數值',
    re: /fontSize\s*[:=]\s*['"`]?(\d[^,;'"`}\s]*)/g,
    bad: () => true,
  },
];

function scan(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.re.exec(line)) !== null) {
          if (rule.bad(m)) {
            hits.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  [${rule.name}]  ${m[0].trim()}`);
          }
        }
      }
    });
  }
  return hits;
}

describe('UI 字級縮放防回歸', () => {
  it('所有字級都必須透過 var(--ui-scale) 計算', () => {
    const hits = scan();
    expect(hits, `發現 ${hits.length} 處寫死字級：\n${hits.join('\n')}`).toEqual([]);
  });

  it('app.css 定義了 --ui-scale 預設值', () => {
    const css = readFileSync(join(SRC, 'app.css'), 'utf8');
    expect(css).toMatch(/--ui-scale\s*:\s*1\s*;/);
  });
});
