<template>
  <section class="page" data-module="trashrack">
    <header class="page-head">
      <div>
        <h2>拦污栅台账</h2>
        <p class="page-desc">
          维护拦污栅，围绕栅体编号、所属机组、前后压差、清污次数做登记、筛选与状态流转。
          清污次数与历史清污记录同源；确认完成清污须录入清后实测压差，清污优先序自动重排。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/trashrack-cleaning">清污优先序</RouterLink>
        <RouterLink class="btn" to="/trashrack-history">清污概览与历史记录</RouterLink>
        <button class="btn ghost" type="button" @click="exportRows">导出拦污栅清单</button>
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
      <span class="legend-item legend-over">压差超限：{{ overLimitCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
              {{ formatPressure(row[column]) }}
              <span v-if="isOver(row)" class="tag tag-over">超限</span>
            </template>
            <template v-else-if="column === '清污次数'">{{ row[column] }}</template>
            <template v-else>{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="row.status === '待清理'" class="link" type="button" @click="schedule(row)">
              安排清理
            </button>
            <button v-if="row.status === '清理中'" class="link" type="button" @click="openComplete(row)">
              确认完成
            </button>
            <button
              v-if="row.status !== '已损坏'"
              class="link danger"
              type="button"
              @click="markBroken(row)"
            >
              登记损坏
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无拦污栅数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 台拦污栅；台账确认完成清污后，清污优先序与历史记录同步更新。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <CleaningDialog
      :open="dialogOpen"
      mode="complete"
      :rack-code="activeCode"
      :default-operator="store.operator"
      @close="dialogOpen = false"
      @complete="handleComplete"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  completeCleaning,
  PRESSURE_LIMIT,
  reconcileCleaning,
  setRackStatus,
} from '@/api/cleaning-service'
import { downloadEntries, filterRows, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

import CleaningDialog from '@/views/trashrack-cleaning/CleaningDialog.vue'

const store = useSessionStore()
const meta = moduleMeta('trashrack')
const columns = ['栅体编号', '所属机组', '前后压差', '清污次数', '清污方式', '清理日期', '清理人员', '栅体状态']
const statuses = ['待清理', '清理中', '已清理', '已损坏']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 2)
const dialogOpen = ref(false)
const activeCode = ref('')

const allRows = ref<EntryRow[]>([])

const stats = computed(() => [
  { label: '待清理栅体', value: allRows.value.filter((row) => row.status === '待清理').length },
  { label: '已清理栅体', value: allRows.value.filter((row) => row.status === '已清理').length },
  { label: '最大压差(m)', value: maxPressure.value.toFixed(2) },
  { label: '超限栅体', value: overLimitCount.value },
])
const maxPressure = computed(() =>
  allRows.value.reduce((max, row) => {
    const value = Number(row['前后压差'])
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0),
)
const overLimitCount = computed(
  () => allRows.value.filter((row) => isOver(row)).length,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOver(row: EntryRow): boolean {
  const value = Number(row['前后压差'])
  return Number.isFinite(value) && value > PRESSURE_LIMIT
}

function formatPressure(value: string | number | boolean): string {
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(2) : '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function schedule(row: EntryRow) {
  errorMessage.value = ''
  const result = setRackStatus(String(row['栅体编号']), '清理中')
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function markBroken(row: EntryRow) {
  errorMessage.value = ''
  const result = setRackStatus(String(row['栅体编号']), '已损坏')
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function openComplete(row: EntryRow) {
  activeCode.value = String(row['栅体编号'])
  dialogOpen.value = true
}

function handleComplete(payload: {
  栅体编号: string
  清理日期: string
  清污方式: string
  清理人: string
  清后实测压差: number
  备注: string
}) {
  const result = completeCleaning(payload)
  dialogOpen.value = false
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    allRows.value = listEntries(meta.key).items
    rows.value = filterRows(allRows.value, filters.value)
    total.value = allRows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '拦污栅列表读取失败'
  }
}

onMounted(() => {
  // 台账页加载即对账：历史缺项补齐、去重、次数统一到实测那一份。
  reconcileCleaning()
  reload()
})
</script>
