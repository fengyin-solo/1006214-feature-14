import { CLEANING_HISTORY_KEY, listRows, saveRows } from '@/data/local-store'
import type {
  CleaningImportResult,
  CleaningPriorityRow,
  CleaningRecord,
  EntryRow,
} from '@/data/types'

// 拦污栅清污业务：台账(trashrack) + 历史清污记录(trashrack-history) 两份数据在这里对账统一。
// 取值原则：
//   1. 前后压差永远以现场实测那一份为准（台账当前实测压差 / 清污完成时录入的清后实测压差），
//      历史导入或任何第二路径都不覆盖实测值；
//   2. 清污次数以去重后的历史清污记录条数为唯一口径，台账里的「清污次数」只是缓存，
//      对账发现不一致时回写台账，跨页面取到的永远是同一份；
//   3. 重复导入按自然键（栅体编号+清理日期+清理人）去重，只保留一次，不会多出一行。

export const TRASHRACK_KEY = 'trashrack'
export const PRESSURE_LIMIT = 3.0
// 本厂机械清污机 2024-01-01 投运：早期纸质台账只登记了清理人、没登记清污方式，
// 投运前不可能用机械清污，故按时间补齐——投运前补「人工清污」，之后补「机械清污」。
export const MACHINE_SINCE = '2024-01-01'

export type RecordDraft = {
  栅体编号: string
  所属机组?: string
  清理日期: string
  清污方式?: string
  清理人: string
  清后实测压差?: number | string
  数据来源?: string
  备注?: string
}

type RawRecord = Record<string, string | number | boolean>

function recordKey(code: string, date: string, operator: string): string {
  return `${code.trim()}|${date.trim()}|${operator.trim()}`
}

// 缺项补齐：清污方式缺失时按清污机投运时点推断，理由与来源写进备注（幂等，不重复追加）。
function normalizeRecord(raw: RawRecord, unitFallback = ''): CleaningRecord & { fixed: boolean } {
  const code = String(raw['栅体编号'] ?? '').trim()
  const date = String(raw['清理日期'] ?? '').trim()
  const operator = String(raw['清理人'] ?? '').trim()
  let method = String(raw['清污方式'] ?? '').trim()
  const source = String(raw['数据来源'] ?? '').trim() || '历史台账补录'
  let remark = String(raw['备注'] ?? '').trim()
  const postPressure = raw['清后实测压差'] ?? ''

  let fixed = false
  if (!method) {
    fixed = true
    method = date < MACHINE_SINCE ? '人工清污' : '机械清污'
    const reason =
      date < MACHINE_SINCE
        ? `原台账只登记清理人未登记方式；本厂${MACHINE_SINCE}机械清污机投运，投运前无机械清污条件，按人工清污补齐`
        : '原台账只登记清理人未登记方式；机械清污机已投运，按机械清污补齐'
    remark = remark ? `${remark}；${reason}` : reason
  }

  return {
    id: Number(raw['id'] ?? 0),
    栅体编号: code,
    所属机组: String(raw['所属机组'] ?? '').trim() || unitFallback,
    清理日期: date,
    清污方式: method,
    清理人: operator,
    清后实测压差: typeof postPressure === 'number' ? postPressure : String(postPressure).trim(),
    数据来源: source,
    备注: remark,
    fixed,
  } as CleaningRecord & { fixed: boolean }
}

function listHistoryRaw(): EntryRow[] {
  return listRows(CLEANING_HISTORY_KEY)
}

function saveHistory(rows: EntryRow[]): void {
  saveRows(CLEANING_HISTORY_KEY, rows)
}

function listRacks(): EntryRow[] {
  return listRows(TRASHRACK_KEY)
}

export function pressureValue(value: string | number | boolean | undefined): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

// 历史记录：按清理日期从早到晚回填，缺项补齐，自然键去重。
export function listCleaningHistory(): CleaningRecord[] {
  const unitMap = new Map(listRacks().map((row) => [String(row['栅体编号']), String(row['所属机组'] ?? '')]))
  const seen = new Set<string>()
  const records: CleaningRecord[] = []
  for (const raw of listHistoryRaw()) {
    const rec = normalizeRecord(raw, unitMap.get(String(raw['栅体编号'])) ?? '')
    const key = recordKey(rec.栅体编号, rec.清理日期, rec.清理人)
    if (!rec.栅体编号 || !rec.清理日期 || !rec.清理人 || seen.has(key)) {
      continue
    }
    seen.add(key)
    records.push(rec)
  }
  return records.sort((a, b) => a.清理日期.localeCompare(b.清理日期))
}

export type SyncReport = {
  fixedMethods: number
  removedDuplicates: number
  countCorrections: { 栅体编号: string; 台账次数: number; 实测次数: number }[]
  total: number
}

// 对账统一：历史记录去重 + 缺项补齐后，把清污次数与最近一次清污信息回写台账。
// 不触碰台账当前实测压差。幂等。
export function reconcileCleaning(): SyncReport {
  const unitMap = new Map(listRacks().map((row) => [String(row['栅体编号']), String(row['所属机组'] ?? '')]))
  const seen = new Set<string>()
  const deduped: EntryRow[] = []
  let fixedMethods = 0
  let removedDuplicates = 0

  for (const raw of listHistoryRaw()) {
    const normalized = normalizeRecord(raw, unitMap.get(String(raw['栅体编号'])) ?? '')
    if (normalized.fixed) {
      fixedMethods += 1
    }
    const key = recordKey(normalized.栅体编号, normalized.清理日期, normalized.清理人)
    if (!normalized.栅体编号 || !normalized.清理日期 || !normalized.清理人 || seen.has(key)) {
      removedDuplicates += 1
      continue
    }
    seen.add(key)
    const { fixed, ...clean } = normalized
    deduped.push({ ...(raw as EntryRow), ...clean })
  }
  deduped.sort((a, b) => String(a['清理日期']).localeCompare(String(b['清理日期'])))
  deduped.forEach((row, index) => {
    row.id = index + 1
  })

  // 以历史实测条数为唯一口径统计每台栅体的清污次数。
  const latestByRack = new Map<string, CleaningRecord>()
  const countByRack = new Map<string, number>()
  for (const row of deduped) {
    const code = String(row['栅体编号'])
    countByRack.set(code, (countByRack.get(code) ?? 0) + 1)
    const prev = latestByRack.get(code)
    if (!prev || String(row['清理日期']) >= prev.清理日期) {
      latestByRack.set(code, normalizeRecord(row))
    }
  }

  const racks = listRacks()
  const countCorrections: SyncReport['countCorrections'] = []
  const nextRacks = racks.map((rack) => {
    const code = String(rack['栅体编号'])
    const actual = countByRack.get(code) ?? 0
    const ledgerCount = Number(rack['清污次数'] ?? 0) || 0
    const updated: EntryRow = { ...rack }
    if (ledgerCount !== actual) {
      countCorrections.push({ 栅体编号: code, 台账次数: ledgerCount, 实测次数: actual })
      updated['清污次数'] = actual
    }
    const latest = latestByRack.get(code)
    if (latest) {
      // 最近一次清污信息回写台账；实测压差留给现场更新，不在这里改。
      updated['清污方式'] = latest.清污方式
      updated['清理日期'] = latest.清理日期
      updated['清理人员'] = latest.清理人
    }
    return updated
  })

  saveHistory(deduped)
  saveRows(TRASHRACK_KEY, nextRacks)

  return { fixedMethods, removedDuplicates, countCorrections, total: deduped.length }
}

// 清污优先序：实测压差从大到小；优先级编号在全量上排，筛选机组后名次保持不变。
export function listCleaningPriority(unit = ''): CleaningPriorityRow[] {
  const rows = listRacks()
  const counts = new Map<string, number>()
  for (const rec of listCleaningHistory()) {
    counts.set(rec.栅体编号, (counts.get(rec.栅体编号) ?? 0) + 1)
  }
  const merged: CleaningPriorityRow[] = rows.map((row) => {
    const code = String(row['栅体编号'])
    const pressure = pressureValue(row['前后压差'])
    return {
      id: Number(row.id),
      栅体编号: code,
      所属机组: String(row['所属机组'] ?? ''),
      前后压差: Number.isFinite(pressure) ? pressure : 0,
      清污次数: counts.get(code) ?? 0,
      清污方式: String(row['清污方式'] ?? ''),
      清理日期: String(row['清理日期'] ?? ''),
      清理人员: String(row['清理人员'] ?? ''),
      栅体状态: String(row['栅体状态'] ?? ''),
      status: String(row.status ?? ''),
      超限: Number.isFinite(pressure) && pressure > PRESSURE_LIMIT,
      无记录: !counts.has(code),
      priority: 0,
    }
  })
  merged.sort((a, b) => b.前后压差 - a.前后压差 || a.栅体编号.localeCompare(b.栅体编号))
  merged.forEach((row, index) => {
    row.priority = index + 1
  })
  const target = unit.trim()
  return target ? merged.filter((row) => row.所属机组 === target) : merged
}

// 待办清单：非已清理/已损坏的栅体就是现场待办，与台账同一存储，天然同步。
export function listCleaningTodos(unit = ''): CleaningPriorityRow[] {
  return listCleaningPriority(unit).filter(
    (row) => row.status !== '已清理' && row.status !== '已损坏',
  )
}

export function rackUnits(): string[] {
  return [...new Set(listRacks().map((row) => String(row['所属机组'] ?? '')).filter(Boolean))]
}

type CompleteDraft = {
  栅体编号: string
  清理日期: string
  清污方式: string
  清理人: string
  清后实测压差: number | string
  备注?: string
}

function findRack(code: string): { rows: EntryRow[]; index: number } | null {
  const rows = listRacks()
  const index = rows.findIndex((row) => String(row['栅体编号']) === code)
  return index < 0 ? null : { rows, index }
}

function appendHistory(draft: RecordDraft, source: string): 'added' | 'duplicate' {
  const history = listHistoryRaw()
  const key = recordKey(draft.栅体编号, draft.清理日期, draft.清理人)
  if (
    history.some(
      (row) =>
        recordKey(String(row['栅体编号']), String(row['清理日期']), String(row['清理人'])) === key,
    )
  ) {
    return 'duplicate'
  }
  const normalized = normalizeRecord({ ...draft, 数据来源: source })
  history.push({ status: '已登记', pending: false, abnormal: false, ...normalized, id: 0 })
  saveHistory(history)
  return 'added'
}

// 台账确认完成清污：追加/去重历史记录 → 对账回写次数 → 清后实测压差写回台账并退出首位。
export function completeCleaning(draft: CompleteDraft): {
  ok: boolean
  message: string
  priority?: number
} {
  const found = findRack(draft.栅体编号)
  if (!found) {
    return { ok: false, message: `台账中没有栅体 ${draft.栅体编号}` }
  }
  if (!draft.清理日期 || !draft.清污方式 || !draft.清理人) {
    return { ok: false, message: '清理日期、清污方式、清理人都必须填写' }
  }
  const postPressure = Number(draft.清后实测压差)
  if (!Number.isFinite(postPressure) || postPressure < 0) {
    return { ok: false, message: '清后实测压差必须是不小于 0 的数值' }
  }

  const added = appendHistory(
    {
      栅体编号: draft.栅体编号,
      清理日期: draft.清理日期,
      清污方式: draft.清污方式,
      清理人: draft.清理人,
      清后实测压差: postPressure,
      备注: draft.备注,
    },
    '现场清污记录',
  )

  reconcileCleaning()
  // 实测压差以本次清污后的现场实测为准，直接写台账。
  const after = listRacks()
  const index = after.findIndex((row) => String(row['栅体编号']) === draft.栅体编号)
  after[index] = {
    ...after[index],
    status: '已清理',
    pending: false,
    abnormal: postPressure > PRESSURE_LIMIT,
    '前后压差': postPressure,
    '栅体状态': postPressure > PRESSURE_LIMIT ? '压差超限' : '正常',
  }
  saveRows(TRASHRACK_KEY, after)

  const priority = listCleaningPriority().find(
    (row) => row.栅体编号 === draft.栅体编号,
  )?.priority
  return {
    ok: true,
    message:
      added === 'duplicate'
        ? `${draft.栅体编号} 当天已有同一清理人的记录，未重复登记；次数与优先序已按实测更新（当前第 ${priority} 位）`
        : `${draft.栅体编号} 清污已完成并同步台账，清后实测压差 ${postPressure} m，当前优先序第 ${priority} 位`,
    priority,
  }
}

// 现场实测压差登记：只更新台账实测值，优先序立即重排；不改清污记录与次数。
export function registerMeasuredPressure(
  code: string,
  pressure: number,
): { ok: boolean; message: string } {
  const found = findRack(code)
  if (!found) {
    return { ok: false, message: `台账中没有栅体 ${code}` }
  }
  if (!Number.isFinite(pressure) || pressure < 0) {
    return { ok: false, message: '实测压差必须是不小于 0 的数值' }
  }
  const { rows, index } = found
  rows[index] = {
    ...rows[index],
    '前后压差': pressure,
    abnormal: pressure > PRESSURE_LIMIT,
    '栅体状态': pressure > PRESSURE_LIMIT ? '压差超限' : '正常',
  }
  saveRows(TRASHRACK_KEY, rows)
  return { ok: true, message: `${code} 实测压差已登记为 ${pressure} m，两条路径统一取这份实测值` }
}

export function setRackStatus(code: string, target: '清理中' | '已损坏'): {
  ok: boolean
  message: string
} {
  const found = findRack(code)
  if (!found) {
    return { ok: false, message: `台账中没有栅体 ${code}` }
  }
  const { rows, index } = found
  if (String(rows[index].status) === target) {
    return { ok: false, message: `${code} 已经是「${target}」` }
  }
  rows[index] = {
    ...rows[index],
    status: target,
    pending: target === '清理中',
    abnormal: target === '已损坏' || Boolean(rows[index].abnormal),
  }
  saveRows(TRASHRACK_KEY, rows)
  return { ok: true, message: `${code} 已${target === '清理中' ? '安排清理' : '登记损坏'}` }
}

// 批量导入历史清污记录：自然键去重（含重复导入同一批），缺项补齐后对账统一台账。
export function importCleaningRecords(drafts: RecordDraft[]): CleaningImportResult {
  const existing = listHistoryRaw()
  const unitMap = new Map(listRacks().map((row) => [String(row['栅体编号']), String(row['所属机组'] ?? '')]))
  const keys = new Set(
    existing.map((row) =>
      recordKey(String(row['栅体编号']), String(row['清理日期']), String(row['清理人'])),
    ),
  )

  let added = 0
  let duplicates = 0
  let fixed = 0
  const messages: string[] = []

  for (const draft of drafts) {
    const code: string = draft.栅体编号?.trim() ?? ''
    const date: string = draft.清理日期?.trim() ?? ''
    const operator: string = draft.清理人?.trim() ?? ''
    if (!code || !date || !operator) {
      messages.push('有一行缺少栅体编号、清理日期或清理人，已跳过')
      continue
    }
    if (!unitMap.has(code)) {
      messages.push(`${code} 不在拦污栅台账中，已跳过`)
      continue
    }
    const key = recordKey(code, date, operator)
    if (keys.has(key)) {
      duplicates += 1
      continue
    }
    keys.add(key)
    const normalized = normalizeRecord({
      ...draft,
      栅体编号: code,
      清理日期: date,
      清理人: operator,
      所属机组: draft.所属机组 || unitMap.get(code) || '',
      数据来源: draft.数据来源 || `页面导入 ${new Date().toISOString().slice(0, 10)}`,
    })
    if (normalized.fixed) {
      fixed += 1
    }
    existing.push({ status: '已登记', pending: false, abnormal: false, ...normalized, id: 0 })
    added += 1
  }

  saveHistory(existing)
  const before = listRacks().reduce(
    (sum, row) => sum + ((Number(row['清污次数']) || 0) as number),
    0,
  )
  const report = reconcileCleaning()
  const after = listRacks().reduce((sum, row) => sum + ((Number(row['清污次数']) || 0) as number), 0)
  const updated = after - before
  messages.push(
    `新增 ${added} 条、重复跳过 ${duplicates} 条、本次补齐清污方式 ${fixed} 条；` +
      `台账清污次数按实测历史统一，共校正 ${report.countCorrections.length} 台栅体、跨页清污条数合计 ${after} 条（导入前台账合计 ${before} 条）`,
  )

  return { added, duplicates, updated, fixed, messages }
}

// 概览页关键条目。
export function cleaningOverview() {
  const priority = listCleaningPriority()
  const history = listCleaningHistory()
  const overLimit = priority.filter((row) => row.超限)
  const noRecord = priority.filter((row) => row.无记录)
  const units = rackUnits()
  const totalCleanings = priority.reduce((sum, row) => sum + row.清污次数, 0)
  return {
    cards: [
      { label: '拦污栅总数', value: priority.length },
      { label: '压差超限栅体', value: overLimit.length },
      { label: '清污待办', value: listCleaningTodos().length },
      { label: '累计清污条数', value: totalCleanings },
      { label: '历史清污记录', value: history.length },
      { label: '从未清污栅体', value: noRecord.length },
    ],
    overLimit,
    noRecord,
    units,
    history,
    priority,
    totalCleanings,
  }
}

// 另存清污优先序：导出行数与当前页面栅体总台数严格一致。
export function exportCleaningOrder(unit = ''): { filename: string; content: string; rows: number } {
  const rows = listCleaningPriority(unit)
  const header = ['优先序', '栅体编号', '所属机组', '前后压差(m)', '清污次数', '清污方式', '上次清理日期', '清理人', '是否超限', '清污记录']
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.priority,
        row.栅体编号,
        row.所属机组,
        row.前后压差,
        row.清污次数,
        row.清污方式,
        row.清理日期 || '无清污记录',
        row.清理人员 || '—',
        row.超限 ? `超限(>${PRESSURE_LIMIT}m)` : '正常',
        row.无记录 ? '无清污记录' : '有',
      ]
        .map(escape)
        .join(','),
    )
  }
  const scope = unit ? `-${unit}` : ''
  return {
    filename: `拦污栅清污优先序${scope}.csv`,
    content: `﻿${lines.join('\n')}`,
    rows: rows.length,
  }
}

export function downloadCleaningOrder(unit = ''): { rows: number; total: number } {
  const { filename, content, rows } = exportCleaningOrder(unit)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return { rows, total: listCleaningPriority().length }
}
