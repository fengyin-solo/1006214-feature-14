<template>
  <section class="page" data-module="trashrack-history">
    <header class="page-head">
      <div>
        <h2>清污概览与历史记录</h2>
        <p class="page-desc">
          历史清污记录按清理日期从早到晚回填；早期只登记清理人、未登记方式的，按清污机投运时点补齐
          （{{ MACHINE_SINCE }} 前补人工清污，之后补机械清污），理由与来源写入备注。重复导入按
          栅体编号+清理日期+清理人去重，只保留一次。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/trashrack">拦污栅台账</RouterLink>
        <RouterLink class="btn primary" to="/trashrack-cleaning">清污优先序</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in overview.cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <h3 class="panel-title">压差超限（立即清污）</h3>
        <ul class="panel-list">
          <li v-for="row in overview.overLimit" :key="`over-${row.id}`">
            {{ row.priority }}. {{ row.栅体编号 }} · {{ row.所属机组 }} ·
            <em class="pressure-over">{{ row.前后压差.toFixed(2) }} m</em>
            ｜上次清理 {{ row.清理日期 || '无清污记录' }}
          </li>
          <li v-if="!overview.overLimit.length" class="muted">无超限栅体</li>
        </ul>
      </section>
      <section class="panel">
        <h3 class="panel-title">无清污记录栅体</h3>
        <ul class="panel-list">
          <li v-for="row in overview.noRecord" :key="`none-${row.id}`">
            {{ row.栅体编号 }} · {{ row.所属机组 }} · 当前压差 {{ row.前后压差.toFixed(2) }} m
            <span class="tag" :class="row.超限 ? 'tag-over' : 'tag-empty'">{{ row.超限 ? '已超限，尽快首清' : '留档观察' }}</span>
          </li>
          <li v-if="!overview.noRecord.length" class="muted">所有栅体均有清污记录</li>
        </ul>
      </section>
      <section class="panel">
        <h3 class="panel-title">近期清污（最新 5 条）</h3>
        <ul class="panel-list">
          <li v-for="rec in recentHistory" :key="rec.id">
            {{ rec.清理日期 }} · {{ rec.栅体编号 }}（{{ rec.所属机组 }}）· {{ rec.清污方式 }} · {{ rec.清理人 }}
          </li>
        </ul>
      </section>
      <section class="panel">
        <h3 class="panel-title">跨页清污条数核对</h3>
        <ul class="panel-list">
          <li>历史记录去重后合计：<strong>{{ overview.history.length }}</strong> 条</li>
          <li>台账「清污次数」合计：<strong>{{ ledgerTotal }}</strong> 次</li>
          <li>优先序取值合计：<strong>{{ overview.totalCleanings }}</strong> 次</li>
          <li :class="consistent ? 'ok-text' : 'error-text'">
            {{ consistent ? '三条路径一致，以实测历史记录为准' : '口径不一致，请点击下方重新对账' }}
          </li>
        </ul>
      </section>
    </div>

    <section class="panel import-panel">
      <h3 class="panel-title">导入历史清污记录（重复导入不会多出一行）</h3>
      <p class="muted small">
        每行一条，格式：栅体编号,清理日期,清理人,清污方式(可空),清后实测压差(可空),备注(可空)。清污方式留空时按投运时点自动补齐并写明来源。
      </p>
      <textarea v-model="importText" class="import-area" rows="6" :placeholder="sampleRows"></textarea>
      <div class="import-actions">
        <button class="btn primary" type="button" @click="doImport">导入并对账</button>
        <button class="btn" type="button" @click="importText = sampleRows">填入示例（含重复行/缺方式行）</button>
        <button class="btn ghost" type="button" @click="reconcile">重新对账</button>
      </div>
      <ul v-if="importMessages.length" class="import-messages">
        <li v-for="(item, index) in importMessages" :key="index" class="small">{{ item }}</li>
      </ul>
    </section>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>机组筛选</span>
        <select v-model="unit" @change="reload">
          <option value="">全部机组</option>
          <option v-for="item in overview.units" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item grow">
        <span>检索栅体编号 / 清理人 / 方式</span>
        <input v-model="keyword" placeholder="输入关键字" @input="reload" />
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>清理日期</th>
          <th>清污方式</th>
          <th>清理人</th>
          <th>清后实测压差(m)</th>
          <th>数据来源</th>
          <th>备注（缺项补齐理由）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(rec, index) in filteredHistory" :key="rec.id" :class="{ 'row-fixed': rec.fixedNote }">
          <td>{{ index + 1 }}</td>
          <td>{{ rec.栅体编号 }}</td>
          <td>{{ rec.所属机组 }}</td>
          <td>{{ rec.清理日期 }}</td>
          <td>
            {{ rec.清污方式 }}
            <span v-if="rec.fixedNote" class="tag tag-fixed">补齐</span>
          </td>
          <td>{{ rec.清理人 }}</td>
          <td>{{ rec.清后实测压差 === '' ? '—' : rec.清后实测压差 }}</td>
          <td>{{ rec.数据来源 }}</td>
          <td class="remark-cell">{{ rec.备注 || '—' }}</td>
        </tr>
        <tr v-if="!filteredHistory.length">
          <td colspan="9" class="empty-state">没有符合条件的历史记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredHistory.length }} 条历史记录（按清理日期升序）；清污次数口径全站统一。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  cleaningOverview,
  importCleaningRecords,
  MACHINE_SINCE,
  reconcileCleaning,
} from '@/api/cleaning-service'
import { listRows } from '@/data/local-store'
import type { CleaningRecord, EntryRow } from '@/data/types'

type HistoryRow = CleaningRecord & { fixedNote: boolean }

const sampleRows = [
  'TR-201,2026-09-15,王海涛,机械清污,0.5,汛后复查清污',
  'TR-301,2026-09-18,孙明远,,0.6,投运后首次清污',
  'TR-201,2026-09-15,王海涛,机械清污,0.5,汛后复查清污',
  'TR-101,2023-08-08,周建国,,',
].join('\n')

const overview = ref(cleaningOverview())
const history = ref<HistoryRow[]>([])
const unit = ref('')
const keyword = ref('')
const importText = ref('')
const importMessages = ref<string[]>([])
const message = ref('')
const messageOk = ref(true)

const recentHistory = computed(() => [...history.value].reverse().slice(0, 5))
const ledgerTotal = computed(() =>
  listRows('trashrack').reduce((sum, row: EntryRow) => sum + (Number(row['清污次数']) || 0), 0),
)
const consistent = computed(
  () =>
    overview.value.history.length === overview.value.totalCleanings &&
    overview.value.totalCleanings === ledgerTotal.value,
)

const filteredHistory = computed(() => {
  const key = keyword.value.trim()
  return history.value.filter((rec) => {
    if (unit.value && rec.所属机组 !== unit.value) {
      return false
    }
    if (key && !`${rec.栅体编号}${rec.清理人}${rec.清污方式}`.includes(key)) {
      return false
    }
    return true
  })
})

function decorate(records: CleaningRecord[]): HistoryRow[] {
  return records.map((rec) => ({
    ...rec,
    fixedNote: rec.备注.includes('未登记方式'),
  }))
}

function reload() {
  overview.value = cleaningOverview()
  history.value = decorate(overview.value.history)
}

function reconcile() {
  const report = reconcileCleaning()
  reload()
  const corrections = report.countCorrections.length
  message.value = `对账完成：去重删除 ${report.removedDuplicates} 条，补齐清污方式 ${report.fixedMethods} 条，校正台账次数 ${corrections} 台`
  messageOk.value = true
}

function doImport() {
  const lines = importText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const drafts = lines.map((line) => {
    const [栅体编号, 清理日期, 清理人, 清污方式, 清后实测压差, 备注] = line.split(',').map((part) => part?.trim() ?? '')
    return { 栅体编号, 清理日期, 清理人, 清污方式, 清后实测压差, 备注 }
  })
  const result = importCleaningRecords(drafts)
  importMessages.value = result.messages
  importText.value = ''
  reload()
  message.value = `导入完成：新增 ${result.added} 条，重复跳过 ${result.duplicates} 条，未增加多余行`
  messageOk.value = true
}

onMounted(() => {
  reconcileCleaning()
  reload()
})
</script>
