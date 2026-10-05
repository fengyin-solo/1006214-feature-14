/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 历史清污记录：清污次数的「实测那一份」，台账次数由这里去重计数回写。
export type CleaningRecord = {
  id: number
  栅体编号: string
  所属机组: string
  清理日期: string
  清污方式: string
  清理人: string
  清后实测压差: number | string
  数据来源: string
  备注: string
}

// 清污优先行：由台账与历史记录现场计算，页面不另存。
export type CleaningPriorityRow = {
  id: number
  栅体编号: string
  所属机组: string
  前后压差: number
  清污次数: number
  清污方式: string
  清理日期: string
  清理人员: string
  栅体状态: string
  status: string
  超限: boolean
  无记录: boolean
  priority: number
}

export type CleaningImportResult = {
  added: number
  duplicates: number
  updated: number
  fixed: number
  messages: string[]
}
