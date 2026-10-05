<template>
  <section class="page" data-module="trashrack-cleaning">
    <header class="page-head">
      <div>
        <h2>拦污栅清污优先序</h2>
        <p class="page-desc">
          按机组铺开的清污对照表：压差、清污次数与拦污栅台账取同一份数据，按现场实测前后压差从大到小排序；
          台账确认完成清污后，次序与次数立即跟着变。压差上限 {{ limit }} m。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/trashrack">拦污栅台账</RouterLink>
        <RouterLink class="btn ghost" to="/trashrack-history">历史清污记录</RouterLink>
        <button class="btn primary" type="button" @click="saveOrder">另存清污次序</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>所属机组</span>
        <select v-model="unit" @change="reload">
          <option value="">全部机组</option>
          <option v-for="item in units" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <button class="btn ghost" type="button" @click="unit = ''; reload()">全部栅体</button>
    </form>

    <section v-if="overLimitRows.length" class="alert-panel">
      <h3 class="alert-title">压差超限栅体（超过 {{ limit }} m，优先安排清污）</h3>
      <ul class="alert-list">
        <li v-for="row in overLimitRows" :key="row.id">
          <strong>{{ row.栅体编号 }}</strong>（{{ row.所属机组 }}）实测压差
          <em>{{ row.前后压差.toFixed(2) }} m</em>，全序第 {{ row.priority }} 位；
          上次清理：{{ row.清理日期 || '无清污记录' }}<template v-if="row.清理人员">（{{ row.清理人员 }}）</template>
        </li>
      </ul>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>优先序</th>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>前后压差(m)</th>
          <th>清污次数</th>
          <th>清污方式</th>
          <th>上次清理日期</th>
          <th>清理人</th>
          <th>台账状态</th>
          <th>清污记录</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-over': row.超限, 'row-done': row.status === '已清理' }">
          <td><strong>{{ row.priority }}</strong></td>
          <td>{{ row.栅体编号 }}</td>
          <td>{{ row.所属机组 }}</td>
          <td>
            <span :class="row.超限 ? 'pressure-over' : ''">{{ row.前后压差.toFixed(2) }}</span>
            <span v-if="row.超限" class="tag tag-over">超限</span>
          </td>
          <td>{{ row.清污次数 }}</td>
          <td>{{ row.清污方式 || '—' }}</td>
          <td>{{ row.清理日期 || '—' }}</td>
          <td>{{ row.清理人员 || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row.无记录" class="tag tag-empty">无清污记录</span>
            <span v-else>有</span>
          </td>
          <td class="row-actions">
            <button v-if="row.status === '待清理'" class="link" type="button" @click="schedule(row)">安排清理</button>
            <button v-if="row.status === '清理中'" class="link" type="button" @click="openComplete(row)">确认完成</button>
            <button class="link" type="button" @click="openMeasure(row)">登记实测压差</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">该机组下没有拦污栅</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        当前显示 {{ rows.length }} 台 / 全站共 {{ totalRacks }} 台拦污栅；另存时导出行数与显示台数一致。
      </span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <section class="todo-panel">
      <h3 class="alert-title">清污待办（与现场台账同步）</h3>
      <ol v-if="todos.length" class="todo-list">
        <li v-for="row in todos" :key="`todo-${row.id}`">
          第 {{ row.priority }} 位 · {{ row.栅体编号 }}（{{ row.所属机组 }}）压差 {{ row.前后压差.toFixed(2) }} m
          <span v-if="row.超限" class="tag tag-over">超限</span>
          ——{{ row.status === '清理中' ? '正在清理，等待确认完成' : '等待安排清理' }}
        </li>
      </ol>
      <p v-else class="empty-state">暂无待办，所有栅体已清理。</p>
    </section>

    <CleaningDialog
      :open="dialog.open"
      :mode="dialog.mode"
      :rack-code="dialog.rackCode"
      :default-operator="store.operator"
      @close="dialog.open = false"
      @complete="handleComplete"
      @measure="handleMeasure"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  completeCleaning,
  downloadCleaningOrder,
  listCleaningPriority,
  listCleaningTodos,
  PRESSURE_LIMIT,
  rackUnits,
  reconcileCleaning,
  registerMeasuredPressure,
  setRackStatus,
} from '@/api/cleaning-service'
import type { CleaningPriorityRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const limit = PRESSURE_LIMIT

const rows = ref<CleaningPriorityRow[]>([])
const todos = ref<CleaningPriorityRow[]>([])
const units = ref<string[]>([])
const unit = ref('')
const totalRacks = ref(0)
const message = ref('')
const messageOk = ref(true)

const dialog = reactive({ open: false, mode: 'complete' as 'complete' | 'measure', rackCode: '' })

const overLimitRows = computed(() => rows.value.filter((row) => row.超限))
const cards = computed(() => [
  { label: '拦污栅总数', value: totalRacks.value },
  { label: '压差超限', value: overLimitRows.value.length },
  { label: '清污待办', value: todos.value.length },
  { label: '无清污记录', value: rows.value.filter((row) => row.无记录).length },
])

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  rows.value = listCleaningPriority(unit.value)
  todos.value = listCleaningTodos(unit.value)
  totalRacks.value = listCleaningPriority().length
  units.value = rackUnits()
}

function schedule(row: CleaningPriorityRow) {
  const result = setRackStatus(row.栅体编号, '清理中')
  notify(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function openComplete(row: CleaningPriorityRow) {
  dialog.mode = 'complete'
  dialog.rackCode = row.栅体编号
  dialog.open = true
}

function openMeasure(row: CleaningPriorityRow) {
  dialog.mode = 'measure'
  dialog.rackCode = row.栅体编号
  dialog.open = true
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
  dialog.open = false
  notify(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function handleMeasure(payload: { 栅体编号: string; pressure: number }) {
  const result = registerMeasuredPressure(payload.栅体编号, payload.pressure)
  dialog.open = false
  notify(result.message, result.ok)
  if (result.ok) {
    reload()
  }
}

function saveOrder() {
  const { rows: exported, total } = downloadCleaningOrder(unit.value)
  const shown = rows.value.length
  notify(
    exported === shown
      ? `已另存清污次序：导出 ${exported} 行，与页面 ${shown} 台栅体一致（全站 ${total} 台）。`
      : `导出行数 ${exported} 与页面台数 ${shown} 不一致，请重新对账`,
    exported === shown,
  )
}

onMounted(() => {
  // 进页面先对账统一：补齐早期缺项、去重、按实测历史校正台账次数。
  reconcileCleaning()
  reload()
})
</script>
