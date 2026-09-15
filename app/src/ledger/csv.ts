import { compareColorCode } from './catalog.ts'
import type { GapLine } from './types.ts'

function csvField(raw: string): string {
  let text = raw
  if (/^[=+\-@]/.test(text)) text = "'" + text
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"'
  return text
}

export function restockListCsv(patternName: string, generatedAt: string, gaps: GapLine[]): string {
  const positive = gaps.filter((g) => g.gap > 0).sort((a, b) => compareColorCode(a.code, b.code))
  const header = ['图纸名称', '生成时间', '色号', '缺口颗数']
  const lines = [header.map(csvField).join(',')]
  if (positive.length === 0) {
    lines.push([csvField(patternName), csvField(generatedAt), csvField(''), csvField('0')].join(','))
  } else {
    for (const g of positive) {
      lines.push([csvField(patternName), csvField(generatedAt), csvField(g.code), csvField(String(g.gap))].join(','))
    }
  }
  return lines.join('\n') + '\n'
}

export function restockListText(patternName: string, generatedAt: string, gaps: GapLine[]): string {
  const positive = gaps.filter((g) => g.gap > 0).sort((a, b) => compareColorCode(a.code, b.code))
  const body =
    positive.length === 0
      ? '当前足量，没有正缺口。'
      : positive.map((g) => g.code + ' 缺 ' + g.gap).join('\n')
  return (
    '补货清单（不是完整备份，不能用于恢复账本）\n图纸：' +
    patternName +
    '\n生成时间：' +
    generatedAt +
    '\n' +
    body +
    '\n'
  )
}
