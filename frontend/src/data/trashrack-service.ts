import { allRows, saveAllRows } from './local-store'
import { SEED_ROWS } from './seed'
import type { ActionResult, EntryRow } from './types'

/**
 * 拦污栅清污领域服务：拦污栅台账、清污次序、清污概览三页只读本文件，
 * 压差与清污次数都来自 localStorage 里同一份数据，跨页面天然一致。
 *
 * 设计要点（对应现场约定）：
 * 1. 历史清污记录按清理日期回填；早期只登记了清理人、没写清污方式的，
 *    统一补成「人工清污」——早期没有清污机械，作业以人工为主，该判断
 *    写进该条记录与台账的备注，来源标为「历史台账补录」。
 * 2. 台账的「清污次数 / 最近一次清污」以清污记录逐条对账后回填，
 *    保证「跨页面的清污条数相同」，不会一边清完一边还排在第一位。
 * 3. 两条取值路径（人工台账 vs 现场实测）打架时，以现场实测为准，
 *    并把台账的值统一成实测值；现场实测之外的来源只作历史留档。
 * 4. 重复导入（同栅体同清理日期）只保留一次，不新增行。
 */

const RACK_KEY = 'trashrack'
const LOG_KEY = 'trashrackLog'
export const PRESSURE_LIMIT_DEFAULT = 2.0
export const POST_CLEAN_PRESSURE = 0.15
const FILL_METHOD = '人工清污'
const FILL_REASON = '历史台账缺清污方式，按早期人工作业惯例补录为人工清污'
const MEASURED_SOURCE = '现场实测'

export type RackView = {
  id: number
  row: EntryRow
  rackNo: string
  unit: string
  pressure: number
  limit: number
  overLimit: boolean
  cleanCount: number
  lastMethod: string
  lastDate: string
  lastWorker: string
  hasLog: boolean
  priority: number
}

export type ImportResult = {
  accepted: number
  duplicated: number
  overridden: number
  logsAdded: number
  pressureUpdated: number
  errors: string[]
}

function text(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value).trim()
}

function num(row: EntryRow, field: string): number {
  const value = Number(row[field])
  return Number.isFinite(value) ? value : 0
}

function parseNumber(value: string): number {
  const matched = value.match(/-?\d+(\.\d+)?/)
  return matched ? Number(matched[0]) : NaN
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 后台台账动作（安排清理 / 登记损坏）仍走通用状态机，但要保证写回的是同一份数据。
export function rackStatusRows(): EntryRow[] {
  return allRows()[RACK_KEY] ?? []
}

let backfilled = false

/**
 * 历史台账补录（幂等）：
 * - 清污记录按时间顺序排好；缺清污方式的历史条目补「人工清污」并写清理由与来源；
 * - 以清污记录为准回填台账的清污次数与最近一次清污快照，缺项处写清来源。
 * 仅在数据确实缺项时改写，重复执行不会重复补。
 */
export function ensureBackfilled(): { racks: EntryRow[]; logs: EntryRow[]; fixed: boolean } {
  const store = allRows()
  const racks = store[RACK_KEY] ? [...store[RACK_KEY]] : clone(SEED_ROWS[RACK_KEY] ?? [])
  const logs = store[LOG_KEY] ? [...store[LOG_KEY]] : clone(SEED_ROWS[LOG_KEY] ?? [])
  let fixed = false

  const sorted = [...logs].sort((a, b) =>
    text(a, '清理日期') < text(b, '清理日期') ? -1 : 1,
  )
  for (const log of sorted) {
    let changed = false
    if (!text(log, '清污方式')) {
      log['清污方式'] = FILL_METHOD
      changed = true
    }
    if (!text(log, '数据来源')) {
      log['数据来源'] = '历史台账补录'
      changed = true
    }
    if (!text(log, '备注')) {
      log['备注'] = FILL_REASON
      changed = true
    }
    if (changed) fixed = true
  }
  // 保持历史记录按时间顺序排列
  const wasOrdered = logs.every(
    (log, index) => index === 0 || text(logs[index - 1], '清理日期') <= text(log, '清理日期'),
  )
  if (!wasOrdered) {
    logs.sort((a, b) => (text(a, '清理日期') < text(b, '清理日期') ? -1 : 1))
    fixed = true
  }

  // 以清污记录为「清污条数」的唯一准数，逐条回填台账
  const lastByRack = new Map<string, EntryRow>()
  const countByRack = new Map<string, number>()
  for (const log of logs) {
    const rackNo = text(log, '栅体编号')
    countByRack.set(rackNo, (countByRack.get(rackNo) ?? 0) + 1)
    const prev = lastByRack.get(rackNo)
    if (!prev || text(prev, '清理日期') <= text(log, '清理日期')) {
      lastByRack.set(rackNo, log)
    }
  }

  racks.forEach((rack, index) => {
    const rackNo = text(rack, '栅体编号')
    const count = countByRack.get(rackNo) ?? 0
    const last = lastByRack.get(rackNo)
    const next: EntryRow = { ...rack }
    let changed = false

    if (num(next, '清污次数') !== count) {
      next['清污次数'] = count
      changed = true
    }
    if (last) {
      const snapshot: Array<[string, string]> = [
        ['清污方式', text(last, '清污方式')],
        ['清理日期', text(last, '清理日期')],
        ['清理人员', text(last, '清理人员')],
      ]
      for (const [field, value] of snapshot) {
        if (text(next, field) !== value) {
          next[field] = value
          changed = true
        }
      }
    } else if (count === 0) {
      // 没有清污记录的栅体也要把台账快照留空，并在备注里写明，页面另给说明行
      for (const field of ['清污方式', '清理日期', '清理人员']) {
        if (text(next, field) !== '') {
          next[field] = ''
          changed = true
        }
      }
      const note = '无清污记录'
      if (!text(next, '备注').includes(note)) {
        next['备注'] = text(next, '备注') ? `${note}；${text(next, '备注')}` : note
        changed = true
      }
    }
    if (changed) {
      racks[index] = next
      fixed = true
    }
  })

  if (fixed || !backfilled) {
    saveAllRows({ ...allRows(), [RACK_KEY]: racks, [LOG_KEY]: logs })
  }
  backfilled = true
  return { racks, logs, fixed }
}

export function rackUnits(racks: EntryRow[] = ensureBackfilled().racks): string[] {
  return [...new Set(racks.map((row) => text(row, '所属机组')).filter(Boolean))].sort()
}

export function pressureLimitOf(row: EntryRow): number {
  const value = num(row, '压差上限')
  return value > 0 ? value : PRESSURE_LIMIT_DEFAULT
}

function toView(row: EntryRow, index: number): RackView {
  const logs = ensureBackfilled().logs.filter((log) => text(log, '栅体编号') === text(row, '栅体编号'))
  const cleanCount = num(row, '清污次数')
  const last = [...logs].sort((a, b) => (text(a, '清理日期') < text(b, '清理日期') ? 1 : -1))[0]
  const pressure = num(row, '前后压差')
  const limit = pressureLimitOf(row)
  return {
    id: row.id,
    row,
    rackNo: text(row, '栅体编号'),
    unit: text(row, '所属机组'),
    pressure,
    limit,
    overLimit: pressure > limit,
    cleanCount,
    lastMethod: last ? text(last, '清污方式') : '',
    lastDate: last ? text(last, '清理日期') : '',
    lastWorker: last ? text(last, '清理人员') : '',
    hasLog: logs.length > 0,
    priority: index + 1,
  }
}

/**
 * 清污优先次序：已损坏栅体不参与排程；其余按压差从大到小排，
 * 刚确认清完的栅体压差已降到残压，自然沉到队尾，不会继续占第一位。
 * 同压差时清污次数少的在前（长期未清的优先），再同则按栅体编号。
 */
export function priorityRacks(unit = ''): RackView[] {
  const { racks } = ensureBackfilled()
  const scoped = racks.filter((row) => !unit || text(row, '所属机组') === unit)
  return scoped
    .filter((row) => text(row, 'status') !== '已损坏')
    .map(toView)
    .sort((a, b) => {
      if (b.pressure !== a.pressure) return b.pressure - a.pressure
      if (a.cleanCount !== b.cleanCount) return a.cleanCount - b.cleanCount
      return a.rackNo.localeCompare(b.rackNo, 'zh-Hans-CN')
    })
    .map((item, index) => ({ ...item, priority: index + 1 }))
}

export function damagedRacks(unit = ''): RackView[] {
  const { racks } = ensureBackfilled()
  return racks
    .filter((row) => text(row, 'status') === '已损坏')
    .filter((row) => !unit || text(row, '所属机组') === unit)
    .map(toView)
}

export type OverviewStats = {
  total: number
  pending: number
  cleaning: number
  done: number
  damaged: number
  overLimit: number
  totalCleans: number
  noLog: number
  maxPressure: number
  units: number
  logs: number
  todo: RackView[]
  byUnit: { unit: string; total: number; overLimit: number; pending: number }[]
}

export function loadStats(): OverviewStats {
  const { racks, logs } = ensureBackfilled()
  const ranked = priorityRacks()
  const status = (row: EntryRow) => text(row, 'status')
  return {
    total: racks.length,
    pending: racks.filter((row) => status(row) === '待清理').length,
    cleaning: racks.filter((row) => status(row) === '清理中').length,
    done: racks.filter((row) => status(row) === '已清理').length,
    damaged: racks.filter((row) => status(row) === '已损坏').length,
    overLimit: ranked.filter((item) => item.overLimit).length,
    totalCleans: racks.reduce((sum, row) => sum + num(row, '清污次数'), 0),
    noLog: racks.filter((row) => num(row, '清污次数') === 0).length,
    maxPressure: ranked.length ? ranked[0].pressure : 0,
    units: rackUnits(racks).length,
    logs: logs.length,
    todo: ranked.filter((item) => text(item.row, 'status') !== '已清理'),
    byUnit: rackUnits(racks).map((unit) => {
      const items = ranked.filter((item) => item.unit === unit)
      return {
        unit,
        total: items.length,
        overLimit: items.filter((item) => item.overLimit).length,
        pending: items.filter((item) => status(item.row) !== '已清理').length,
      }
    }),
  }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 确认完成清污：台账状态转「已清理」，追加一条清污记录并把次数 +1，
 * 最近一次清污快照同步刷新，压差回落为实测残压——次序页随之重排。
 * 同一栅体同一天只记一条，防止重复确认。
 */
export function completeCleaning(
  id: number,
  payload: { method: string; worker: string; date: string; pressure: number },
): ActionResult {
  const { racks, logs } = ensureBackfilled()
  const index = racks.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拦污栅` }
  }
  const rack = racks[index]
  const rackNo = text(rack, '栅体编号')
  const date = payload.date || new Date().toISOString().slice(0, 10)

  if (text(rack, 'status') === '已损坏') {
    return { ok: false, message: `${rackNo} 已登记损坏，不能确认清污完成` }
  }
  const duplicated = logs.some(
    (log) => text(log, '栅体编号') === rackNo && text(log, '清理日期') === date,
  )
  const nextRack: EntryRow = {
    ...rack,
    status: '已清理',
    pending: false,
    abnormal: false,
    前后压差: Number(payload.pressure.toFixed(2)),
    清污次数: duplicated ? num(rack, '清污次数') : num(rack, '清污次数') + 1,
    清污方式: payload.method,
    清理日期: date,
    清理人员: payload.worker,
    数据来源: MEASURED_SOURCE,
  }
  const nextRacks = [...racks]
  nextRacks[index] = nextRack

  let nextLogs = logs
  if (!duplicated) {
    const entry: EntryRow = {
      id: nextId(logs),
      status: '已清理',
      pending: false,
      abnormal: false,
      栅体编号: rackNo,
      所属机组: text(rack, '所属机组'),
      清理日期: date,
      清污方式: payload.method,
      清理人员: payload.worker,
      数据来源: MEASURED_SOURCE,
      备注: '清污完成后现场复测确认',
    }
    nextLogs = [...logs, entry].sort((a, b) =>
      text(a, '清理日期') < text(b, '清理日期') ? -1 : 1,
    )
  }
  saveAllRows({ ...allRows(), [RACK_KEY]: nextRacks, [LOG_KEY]: nextLogs })
  return {
    ok: true,
    message: duplicated
      ? `${rackNo} 当日已有清污记录，只更新台账状态与复测压差，不重复计数`
      : `${rackNo} 清污完成已同步台账，清污次数更新为 ${nextRack['清污次数']}`,
  }
}

/** 台账状态机动作（安排清理 / 登记损坏），与通用流转保持同一语义。 */
export function changeRackStatus(id: number, action: string, target: string): ActionResult {
  const { racks } = ensureBackfilled()
  const index = racks.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的拦污栅` }
  }
  const current = text(racks[index], 'status')
  if (current === target) {
    return { ok: false, message: `拦污栅已经是「${target}」，不用重复操作` }
  }
  const nextRacks = [...racks]
  nextRacks[index] = {
    ...racks[index],
    status: target,
    pending: target !== '已清理' && target !== '已损坏',
    abnormal: action === '登记损坏',
  }
  saveAllRows({ ...allRows(), [RACK_KEY]: nextRacks })
  return { ok: true, message: `拦污栅已${action}，当前状态「${target}」` }
}

/**
 * 导入现场实测 CSV（表头中文）：
 * 栅体编号, 所属机组, 清理日期, 清污方式, 清理人员, 前后压差, 压差上限, 备注
 * - 清污记录：同栅体同清理日期视为重复，只保留一次；
 * - 压差：与台账已有值不一致（含人工台账 vs 现场实测打架）时，以现场实测覆盖统一；
 * - 清污方式缺项：按同一规则补「人工清污」并写明理由。
 */
export function importMeasuredCsv(content: string): ImportResult {
  const result: ImportResult = {
    accepted: 0,
    duplicated: 0,
    overridden: 0,
    logsAdded: 0,
    pressureUpdated: 0,
    errors: [],
  }
  const records = parseCsv(content)
  if (records.length === 0) {
    result.errors.push('文件里没有可导入的记录')
    return result
  }
  const header = records[0].map((cell) => cell.replace(/^﻿/, '').trim())
  const col = (name: string) => header.findIndex((cell) => cell === name)
  const required = ['栅体编号']
  for (const name of required) {
    if (col(name) < 0) {
      result.errors.push(`缺少必填列：${name}`)
      return result
    }
  }
  const cRack = col('栅体编号')
  const cUnit = col('所属机组')
  const cDate = col('清理日期')
  const cMethod = col('清污方式')
  const cWorker = col('清理人员')
  const cPressure = col('前后压差')
  const cLimit = col('压差上限')
  const cNote = col('备注')

  ensureBackfilled()
  const store = allRows()
  const racks = [...(store[RACK_KEY] ?? [])]
  let logs = [...(store[LOG_KEY] ?? [])]

  records.slice(1).forEach((cells, lineNo) => {
    const rackNo = (cells[cRack] ?? '').trim()
    if (!rackNo) return
    const line = lineNo + 2
    const rackIndex = racks.findIndex((row) => text(row, '栅体编号') === rackNo)
    if (rackIndex < 0) {
      result.errors.push(`第${line}行：台账中没有栅体 ${rackNo}，已跳过`)
      return
    }
    const date = cDate >= 0 ? (cells[cDate] ?? '').trim() : ''
    const methodRaw = cMethod >= 0 ? (cells[cMethod] ?? '').trim() : ''
    const worker = cWorker >= 0 ? (cells[cWorker] ?? '').trim() : ''
    const note = cNote >= 0 ? (cells[cNote] ?? '').trim() : ''
    const filled = !methodRaw
    result.accepted += 1

    // 有清理日期 => 一条清污记录（幂等）
    if (date) {
      const exists = logs.some(
        (log) => text(log, '栅体编号') === rackNo && text(log, '清理日期') === date,
      )
      if (exists) {
        result.duplicated += 1
      } else {
        logs.push({
          id: nextId(logs),
          status: '已清理',
          pending: false,
          abnormal: false,
          栅体编号: rackNo,
          所属机组: cUnit >= 0 ? (cells[cUnit] ?? '').trim() || text(racks[rackIndex], '所属机组') : text(racks[rackIndex], '所属机组'),
          清理日期: date,
          清污方式: methodRaw || FILL_METHOD,
          清理人员: worker,
          数据来源: MEASURED_SOURCE,
          备注: filled ? FILL_REASON : note,
        })
        result.logsAdded += 1
      }
    }

    // 压差实测值：两条路径打架时以现场实测为准
    const nextRack: EntryRow = { ...racks[rackIndex] }
    if (cUnit >= 0 && cells[cUnit]?.trim()) {
      nextRack['所属机组'] = cells[cUnit].trim()
    }
    if (cLimit >= 0) {
      const limitValue = parseNumber(cells[cLimit] ?? '')
      if (Number.isFinite(limitValue) && limitValue > 0 && num(nextRack, '压差上限') !== limitValue) {
        nextRack['压差上限'] = limitValue
      }
    }
    if (cPressure >= 0) {
      const measured = parseNumber(cells[cPressure] ?? '')
      if (Number.isFinite(measured)) {
        const rounded = Number(measured.toFixed(2))
        if (num(nextRack, '前后压差') !== rounded || text(nextRack, '数据来源') !== MEASURED_SOURCE) {
          nextRack['前后压差'] = rounded
          nextRack['数据来源'] = MEASURED_SOURCE
          result.pressureUpdated += 1
          if (text(racks[rackIndex], '数据来源') !== MEASURED_SOURCE) {
            result.overridden += 1
          }
        }
      }
    }
    if (date) {
      const sameDayLog = logs
        .filter((log) => text(log, '栅体编号') === rackNo && text(log, '清理日期') === date)
        .sort((a, b) => (text(a, '清理日期') < text(b, '清理日期') ? 1 : -1))[0]
      if (sameDayLog) {
        nextRack['清污方式'] = text(sameDayLog, '清污方式')
        nextRack['清理日期'] = date
        nextRack['清理人员'] = text(sameDayLog, '清理人员')
      }
    }
    racks[rackIndex] = nextRack
  })

  // 以清污记录为准再对一次账（次数、最近快照）
  const countByRack = new Map<string, number>()
  const lastByRack = new Map<string, EntryRow>()
  for (const log of logs) {
    const rackNo = text(log, '栅体编号')
    countByRack.set(rackNo, (countByRack.get(rackNo) ?? 0) + 1)
    const prev = lastByRack.get(rackNo)
    if (!prev || text(prev, '清理日期') <= text(log, '清理日期')) {
      lastByRack.set(rackNo, log)
    }
  }
  racks.forEach((rack, index) => {
    const rackNo = text(rack, '栅体编号')
    const count = countByRack.get(rackNo)
    if (count === undefined) return
    const last = lastByRack.get(rackNo)
    const next = { ...rack }
    if (num(next, '清污次数') !== count) {
      next['清污次数'] = count
    }
    if (last) {
      next['清污方式'] = text(last, '清污方式')
      next['清理日期'] = text(last, '清理日期')
      next['清理人员'] = text(last, '清理人员')
    }
    racks[index] = next
  })
  logs.sort((a, b) => (text(a, '清理日期') < text(b, '清理日期') ? -1 : 1))

  saveAllRows({ ...allRows(), [RACK_KEY]: racks, [LOG_KEY]: logs })
  return result
}

// 支持引号包裹与逗号转义的简单 CSV 解析
function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = content.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i]
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && src[i + 1] === '\n') i += 1
      row.push(field)
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }
  return rows
}

export function measuredTemplate(): string {
  const header = ['栅体编号', '所属机组', '清理日期', '清污方式', '清理人员', '前后压差', '压差上限', '备注']
  const sample = ['TRAS-3F-01', '3号机组', '2026-10-05', '机械清污', '值班管理员', '0.18', '2.0', '清污后现场实测']
  return `﻿${header.join(',')}\n${sample.join(',')}\n`
}

/** 另存清污次序：导出的行数与页面当前栅体总数严格一致（含无记录栅体的说明行）。 */
export function exportPriorityCsv(unit = ''): { filename: string; content: string } {
  const ranked = priorityRacks(unit)
  const damaged = damagedRacks(unit).map((item) => ({ item, flag: '已损坏不参与排程' }))
  const header = [
    '优先次序', '栅体编号', '所属机组', '前后压差(m)', '压差上限(m)', '压差状态',
    '清污次数', '上次清污方式', '上次清理日期', '上次清理人员', '当前状态', '备注',
  ]
  const lines = [header.join(',')]
  const csvCell = (value: string | number) => {
    const s = String(value ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  ranked.forEach((item) => {
    lines.push(
      [
        item.priority,
        item.rackNo,
        item.unit,
        item.pressure.toFixed(2),
        item.limit.toFixed(2),
        item.overLimit ? '超上限' : '正常',
        item.cleanCount,
        item.hasLog ? item.lastMethod : '无清污记录',
        item.hasLog ? item.lastDate : '—',
        item.hasLog ? item.lastWorker : '—',
        text(item.row, 'status'),
        item.overLimit
          ? `压差超上限${item.limit.toFixed(2)}m，上次清理：${item.hasLog ? item.lastDate : '从无清污记录'}`
          : text(item.row, '备注'),
      ].map(csvCell).join(','),
    )
  })
  damaged.forEach(({ item, flag }) => {
    lines.push(
      [
        '—', item.rackNo, item.unit, item.pressure.toFixed(2), item.limit.toFixed(2), '损坏',
        item.cleanCount, item.hasLog ? item.lastMethod : '无清污记录',
        item.hasLog ? item.lastDate : '—', item.hasLog ? item.lastWorker : '—',
        text(item.row, 'status'), flag,
      ].map(csvCell).join(','),
    )
  })
  const total = ranked.length + damaged.length
  const suffix = unit ? `-${unit}` : ''
  return {
    filename: `拦污栅清污次序${suffix}.csv`,
    content: `﻿${lines.join('\n')}\n# 共${total}台拦污栅，与页面总数一致\n`,
  }
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
