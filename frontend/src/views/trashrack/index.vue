<template>
  <section class="page" data-module="trashrack">
    <header class="page-head">
      <div>
        <h2>拦污栅管理</h2>
        <p class="page-desc">
          拦污栅台账是压差与清污次数的唯一来源：清污次序、清污概览与本页取同一份数据。
          在本页确认完成清污后，清污次数与优先次序即时联动。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/trashrack/priority">清污次序</RouterLink>
        <RouterLink class="btn" to="/trashrack/overview">清污概览</RouterLink>
        <button class="btn" type="button" @click="downloadTemplate">下载实测模板</button>
        <button class="btn primary" type="button" @click="triggerImport">导入现场实测</button>
        <input ref="fileInput" class="hidden-file" type="file" accept=".csv,text/csv" @change="handleImport" />
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-warn">压差超上限：{{ stats[1].value }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属机组</span>
        <select v-model="unitFilter">
          <option value="">全部机组</option>
          <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>栅体编号</span>
        <input v-model="keyword" placeholder="按栅体编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-over': isOver(row) }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '前后压差'">
              <span :class="{ 'text-warn': isOver(row) }">{{ formatNumber(row[column]) }}</span>
            </template>
            <template v-else-if="column === '清污次数'">{{ formatNumber(row[column]) }}</template>
            <template v-else-if="column === '清理日期'">{{ row[column] || '无清污记录' }}</template>
            <template v-else>{{ display(row, column) }}</template>
          </td>
          <td>
            <span :class="['status-tag', `status-${statusClass(row.status)}`]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待清理'"
              class="link"
              type="button"
              @click="runStatus(row, '安排清理')"
            >
              安排清理
            </button>
            <button
              v-if="String(row.status) === '待清理' || String(row.status) === '清理中'"
              class="link"
              type="button"
              @click="openComplete(row)"
            >
              确认完成
            </button>
            <button
              v-if="String(row.status) !== '已损坏'"
              class="link danger"
              type="button"
              @click="runStatus(row, '登记损坏')"
            >
              登记损坏
            </button>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">当前筛选条件下没有拦污栅</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 台拦污栅 · 清污记录 {{ stats[2].value }} 条，与次序页、概览页同一份数据</span>
      <span v-if="message" :class="messageError ? 'error-text' : 'ok-text'">{{ message }}</span>
    </footer>

    <div v-if="completing" class="modal-mask" @click.self="closeComplete">
      <div class="modal-card">
        <h3>确认完成清污 · {{ completing['栅体编号'] }}</h3>
        <p class="modal-desc">
          确认后台账追加一条清污记录、清污次数加一，压差回填为清污后实测残压，
          该栅体在清污次序中立即重排到队尾。
        </p>
        <label class="form-item">
          <span>清污方式</span>
          <select v-model="completeForm.method">
            <option>人工清污</option>
            <option>机械清污</option>
            <option>提栅清污</option>
          </select>
        </label>
        <label class="form-item">
          <span>清理人员</span>
          <input v-model="completeForm.worker" placeholder="清理人员" />
        </label>
        <label class="form-item">
          <span>清理日期</span>
          <input v-model="completeForm.date" type="date" />
        </label>
        <label class="form-item">
          <span>清污后实测压差(m)</span>
          <input v-model.number="completeForm.pressure" type="number" step="0.01" min="0" />
        </label>
        <p v-if="completeError" class="error-text">{{ completeError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeComplete">取消</button>
          <button class="btn primary" type="button" @click="submitComplete">确认完成</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { moduleMeta } from '@/api/local-service'
import {
  POST_CLEAN_PRESSURE,
  changeRackStatus,
  completeCleaning,
  downloadTextFile,
  ensureBackfilled,
  importMeasuredCsv,
  loadStats,
  measuredTemplate,
} from '@/data/trashrack-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('trashrack')
const columns = ['栅体编号', '所属机组', '前后压差', '压差上限', '清污次数', '清污方式', '清理日期', '清理人员', '数据来源', '栅体状态', '备注']

const session = useSessionStore()
const allRows = ref<EntryRow[]>([])
const units = ref<string[]>([])
const unitFilter = ref('')
const keyword = ref('')
const message = ref('')
const messageError = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const rows = computed(() =>
  allRows.value.filter(
    (row) =>
      (!unitFilter.value || String(row['所属机组']) === unitFilter.value) &&
      (!keyword.value.trim() || String(row['栅体编号']).includes(keyword.value.trim())),
  ),
)

const stats = computed(() => {
  const s = loadStats()
  return [
    { label: '待清理栅体', value: s.pending + s.cleaning },
    { label: '压差超上限', value: s.overLimit },
    { label: '累计清污次数', value: s.totalCleans },
  ]
})

const statusOrder = ['待清理', '清理中', '已清理', '已损坏']
const statusSummary = computed(() =>
  statusOrder.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function display(row: EntryRow, field: string): string {
  const value = row[field]
  if (value === undefined || value === null || String(value) === '') {
    return field === '清污方式' && Number(row['清污次数']) === 0 ? '无清污记录' : '—'
  }
  return String(value)
}

function formatNumber(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : '—'
}

function isOver(row: EntryRow): boolean {
  const limit = Number(row['压差上限']) || 2.0
  return Number(row['前后压差']) > limit
}

function statusClass(status: unknown): string {
  return {
    待清理: 'pending',
    清理中: 'working',
    已清理: 'done',
    已损坏: 'broken',
  }[String(status)] ?? 'pending'
}

function reload() {
  const { racks } = ensureBackfilled()
  allRows.value = racks
  units.value = [...new Set(racks.map((row) => String(row['所属机组'])))].sort()
}

function resetFilters() {
  unitFilter.value = ''
  keyword.value = ''
}

function flash(text: string, isError = false) {
  message.value = text
  messageError.value = isError
}

function runStatus(row: EntryRow, action: string) {
  const target = meta.actionTargets[action]
  const result = changeRackStatus(Number(row.id), action, target)
  flash(result.message, !result.ok)
  if (result.ok) reload()
}

const completing = ref<EntryRow | null>(null)
const completeForm = ref({ method: '机械清污', worker: '', date: '', pressure: POST_CLEAN_PRESSURE })
const completeError = ref('')

function openComplete(row: EntryRow) {
  completing.value = row
  completeForm.value = {
    method: String(row['清污方式'] || '机械清污'),
    worker: session.operator,
    date: new Date().toISOString().slice(0, 10),
    pressure: POST_CLEAN_PRESSURE,
  }
  completeError.value = ''
}

function closeComplete() {
  completing.value = null
}

function submitComplete() {
  if (!completing.value) return
  if (!completeForm.value.worker.trim()) {
    completeError.value = '请填写清理人员'
    return
  }
  if (!completeForm.value.date) {
    completeError.value = '请选择清理日期'
    return
  }
  const result = completeCleaning(Number(completing.value.id), { ...completeForm.value })
  if (!result.ok) {
    completeError.value = result.message
    return
  }
  closeComplete()
  reload()
  flash(result.message)
}

function triggerImport() {
  fileInput.value?.click()
}

function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = importMeasuredCsv(String(reader.result ?? ''))
    reload()
    if (result.errors.length) {
      flash(`导入完成但有 ${result.errors.length} 行跳过：${result.errors[0]}`, true)
    } else {
      flash(
        `导入 ${result.accepted} 行：新增清污记录 ${result.logsAdded} 条，重复跳过 ${result.duplicated} 条，` +
          `压差以实测覆盖 ${result.pressureUpdated} 处（其中人工台账与实测打架 ${result.overridden} 处，已统一为实测值）`,
      )
    }
  }
  reader.onerror = () => flash('文件读取失败', true)
  reader.readAsText(file, 'utf-8')
  input.value = ''
}

function downloadTemplate() {
  downloadTextFile('拦污栅现场实测导入模板.csv', measuredTemplate())
}

onMounted(reload)
</script>
