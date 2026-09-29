// Throwaway #25 adapter: execute upstream functions, do not maintain a renderer fork.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(process.argv[2] || '/tmp/pindou-issue25-upstream');
const output = resolve(process.argv[3] || join(here, 'samples'));
const chrome = process.env.CHROME || '/usr/bin/google-chrome';
for (const family of ['Noto Sans CJK SC', 'DejaVu Sans Mono']) {
  const match = execFileSync('fc-match', ['-f', '%{family}', family], { encoding: 'utf8' });
  assert(match.includes(family), `Required approved font is missing: ${family}`);
}
const load = path => import(pathToFileURL(join(upstream, path)));
const { createPattern, serializePattern, parsePattern } = await load('packages/core/src/pattern.js');
const { getPaletteProvider } = await load('src/palettes/catalog.js');
const { hexToRgb } = await load('packages/core/src/color.js');
const { default: translations } = await load('src/i18n/zh-CN.js');
const palette = getPaletteProvider();
const source = await readFile(join(upstream, 'src/app.js'), 'utf8');
const fixtures = JSON.parse(await readFile(resolve(process.argv[4] || join(here, 'fixtures.json')), 'utf8'));
// Fail visibly if the upstream function boundaries change. No silent fallback renderer.
function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert(start >= 0, `Upstream function missing: ${name}`);
  const tail = source.slice(start);
  const end = tail.slice(1).search(/\n    (?:async )?function /) + 1;
  assert(end > 1, `Upstream boundary missing: ${name}`);
  return tail.slice(0, end).trim();
}
function replaceOnce(text, old, next) {
  assert.equal(text.split(old).length, 2, `Upstream anchor changed: ${old}`);
  return text.replace(old, next);
}
const original = extract('buildExportCanvas');
let instrumented = replaceOnce(original, 'function buildExportCanvas()', 'function renderObserved()');
// The upstream 9 px minimum collides with 3 px major lines at 19/20 px cells.
instrumented = replaceOnce(instrumented, 'const codeFont=Math.max(9,Math.floor(cell*.32));',
  'const codeFont=Math.max(7,Math.floor(cell*.32));');
instrumented = replaceOnce(instrumented, '      return canvas;', `      canvas.layout={ox,oy,cell,chartX,chartWidth,ruler,legendCols,legendStart,summaryY};
      return canvas;`);
instrumented = replaceOnce(instrumented,
  'ctx.fillStyle=color.displayHex;ctx.fillRect(x,y,swatch,swatch);',
  "const swatchWidth=mode==='inline'?128:swatch;swatches.push({index,count,box:[x,y,swatchWidth,swatch],itemWidth});ctx.fillStyle=color.displayHex;ctx.fillRect(x,y,swatchWidth,swatch);");
instrumented = replaceOnce(instrumented, 'swatch-1,swatch-1)', 'swatchWidth-1,swatch-1)');
instrumented = replaceOnce(instrumented, 'ctx.fillText(color.code,x+swatch/2,y+swatch/2);',
  "ctx.textAlign=mode==='inline'?'left':'center';ctx.fillText(color.code,mode==='inline'?x+6:x+swatch/2,y+swatch/2);");
// Only adapt the legend's two text positions and one swatch width; reuse the page renderer.
const nameLine = 'ctx.fillText(`${color.code} · ${localizedColorName(color)}`,x+39,y+10);';
instrumented = replaceOnce(instrumented, nameLine, `if(mode==='native')${nameLine}`);
instrumented = replaceOnce(instrumented, "ctx.fillStyle='#686c67';", "ctx.fillStyle=mode==='inline'?colorText(color.displayHex):'#686c67';");
instrumented = replaceOnce(instrumented, "ctx.fillText(t('export.count',{count:formatNumber(count)}),x+39,y+25);",
  "ctx.textAlign=mode==='below'?'center':'left';ctx.fillText(mode==='inline'?'('+formatNumber(count)+')':t('export.count',{count:formatNumber(count)}),mode==='below'?x+swatch/2:mode==='inline'?x+40:x+39,mode==='below'?y+39:mode==='native'?y+25:y+swatch/2);");
const functions = ['colorText', 'majorGridStops', 'drawMajorGrid', 'drawPhysicalBoardSeams',
  'getStats', 'currentPatternPlacement', 'localizedColorName', 'boardProfileLabel'].map(extract).join('\n');

await mkdir(output, { recursive: true });
const cases = [];
for (const fixture of fixtures) {
  const rows = fixture.rows.length, cols = fixture.rows[0].length, cells = fixture.rows.flat();
  assert(rows >= 4 && cols >= 4 && rows*cols <= 40000);
  assert(fixture.rows.every(row => row.length === cols));
  const expected = {};
  for (const code of cells) {
    assert(code === null || palette.colors.some(c => c.code === code), `Invalid code: ${code}`);
    if (code !== null) expected[code] = (expected[code] || 0) + 1;
  }
  assert.deepEqual(expected, fixture.expected);
  assert.equal(cells.filter(c => c === null).length, fixture.blankCount);
  const pattern = createPattern({ width: cols, height: rows, cells, title: fixture.id,
    metadata: { origin: 'self-authored geometric fixture; no source image', issue: 25 } });
  pattern.createdAt = '2026-09-29T00:00:00.000Z';
  let projectJsonRoundtrip = 'passed';
  try {
    const roundtrip = parsePattern(serializePattern(pattern));
    assert.deepEqual(roundtrip.grid.cells, cells);
  } catch (error) {
    if ((cols > 160 || rows > 160) && error.message.startsWith('Invalid pattern dimensions:')) {
      projectJsonRoundtrip = error.message; // Preserve the upstream import limit as a measured gap.
    } else throw error;
  }
  assert.deepEqual(pattern.statistics.beadCounts, expected);
  assert.equal(pattern.statistics.emptyCells, fixture.blankCount);
  const modes = fixture.modes || (fixture.id === 'white-blank' ? ['native', 'right-count', 'no-legend'] : ['right-count', 'no-legend']);
  for (const mode of modes) cases.push({ id: `${fixture.id}-${mode}`, mode, pattern,
    expected, blankCount: fixture.blankCount, projectJsonRoundtrip });
}

const temp = await mkdtemp('/tmp/pindou-issue25-run-');
const browser = await readFile(join(here, 'browser.js'), 'utf8');
const bootstrap = `const PALETTE=${JSON.stringify(palette.colors)};
const words=${JSON.stringify(translations)};
const cases=${JSON.stringify(cases)};
const hexToRgb=${hexToRgb.toString()};
const t=(key,args={})=>{if(!words[key])throw Error(key);return words[key].replace(/\\{(\\w+)\\}/g,(_,k)=>String(args[k]));};
const formatNumber=n=>new Intl.NumberFormat('zh-CN',{useGrouping:false}).format(n);
const DEVICE_LIMITS={exportPixels:12000000}, BOARD_PROFILES={mini52:{cells:52}}, APP_VERSION='1.3.0';
let state,els,mode,swatches=[];
${functions}\n${original}\n${instrumented}\n${browser}`;
const html = '<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>' + bootstrap.replaceAll('</script', '<\\/script') + '</script>';
const page = join(temp, 'run.html');
await writeFile(page, html);
const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${temp}/profile`,
  '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, XDG_DATA_HOME: `${temp}/xdg` } });
const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
assert(match, 'Browser produced no result');
const result = JSON.parse(match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
assert(!result.error, result.error);
for (const sample of result.samples) {
  const dir = join(output, sample.id);
  await mkdir(join(dir, 'crops'), { recursive: true });
  for (const [name, base64] of Object.entries(sample.images))
    await writeFile(join(dir, name), Buffer.from(base64, 'base64'));
  for (const [name, data] of Object.entries(sample.labels))
    await writeFile(join(dir, `${name}.json`), JSON.stringify(data, null, sample.checks.beads>1000?0:2) + '\n');
}
let cliProbe = null;
if(result.samples.some(s=>s.id==='white-blank-native')) {
const cliPath = join(output, 'cli-probe.json');
execFileSync(process.execPath, [join(upstream, 'bin/bead-grid.mjs'),
  join(output, 'white-blank-native/cli-input.png'), '-w', '6', '-h', '6',
  '--mode', 'pixel', '--white-mode', 'keep', '--merge', '0', '-o', cliPath], { stdio: 'pipe' });
const cli = JSON.parse(await readFile(cliPath, 'utf8'));
assert(!cli.grid.cells.includes('H1'), 'Upstream H1 quantization behavior changed; recheck assumptions');
cliProbe={ explicitInputH1: 4, outputH1: cli.statistics.beadCounts.H1 || 0,
  statistics: cli.statistics, note: 'Default quantization is NOT the training answer source.' };
}
const summary = { upstream: 'https://github.com/zwhy149/bead-grid-studio', upstreamVersion: '1.3.0',
  sourceRevision: execFileSync('git', ['-C', upstream, 'describe', '--always', '--tags'], { encoding: 'utf8' }).trim(),
  browser: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(),
  fonts: ['Noto Sans CJK SC (OFL-1.1)', 'DejaVu Sans Mono (Bitstream Vera / public domain changes)'],
  cliProbe,
  samples: result.samples.map(s => ({ id: s.id, ...s.checks })) };
await writeFile(join(output, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>生成器复用小样</title>
<style>body{font-family:sans-serif;margin:24px}section{border-top:1px solid #bbb;margin-top:24px}figure{display:inline-block;vertical-align:top;margin:8px}img{max-width:46vw;height:auto}a{margin-right:16px}</style>
<h1>现成生成器复用：${result.samples.length} 张自制样本</h1><p>左：图纸；右：标注。蓝框为本体、绿框为图例项、粉框为字形、青色填充为空格。点击图片查看原始大小。</p>
<p>真实度待用户验收；按每张图的实际尺寸、文字密度与已列限制判断。</p>
${result.samples.map(s => `<section><h2>${s.id}：${s.checks.beads} 颗 / ${s.checks.colors} 色</h2><p><a href="${s.id}/answer.json">答案</a><a href="${s.id}/detection.json">检测框</a><a href="${s.id}/cells.json">逐格标签</a></p>${['sheet','overlay'].map(n=>`<figure><a href="${s.id}/${n}.png"><img alt="${s.id} ${n}" src="${s.id}/${n}.png"></a><figcaption>${n==='sheet'?'图纸':'标注叠加'}</figcaption></figure>`).join('')}</section>`).join('\n')}`);
console.log(JSON.stringify(summary, null, 2));
