import { GROUP_ORDER } from '../ledger/catalog.ts'
import type { StockRow } from '../ledger/types.ts'

/** 已录入的零余额仍属于库存；分组仅控制展示，不改变账本。 */
export function stockSections(rows: StockRow[], enteredOnly: boolean) {
  return GROUP_ORDER.map(group => {
    const family = rows.filter(row => row.code.startsWith(group))
    return {
      group,
      total: family.length,
      rows: enteredOnly ? family.filter(row => row.entered) : family,
    }
  }).filter(section => section.rows.length > 0)
}
