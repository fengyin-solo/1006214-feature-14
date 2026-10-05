<template>
  <section class="page" data-module="trashrack-priority">
    <header class="page-head">
      <div>
        <h2>清污次序</h2>
        <p class="page-desc">
          按机组铺开的拦污栅清污对照表：压差与清污次数与拦污栅台账取同一份，
          按压差从大到小排出清污优先次序；台账确认清完后本页次序立即重排。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/trashrack">返回台账</RouterLink>
        <RouterLink class="btn" to="/trashrack/overview">清污概览</RouterLink>
        <button class="btn primary" type="button" @click="saveAs">另存清污次序</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">栅体总数（{{ unitLabel }}）</span>
        <strong class="stat-value">{{ ranked.length + damaged.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">压差超上限</span>
        <strong class="stat-value warn">{{ ranked.filter((i) => i.overLimit).length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">无清污记录</span>
        <strong class="stat-value">{{ ranked.filter((i) => !i.hasLog).length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计清污次数</span>
        <strong class="stat-value">{{ totalCleans }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>所属机组</span>
        <select v-model="unit">
          <option value="">全部机组</option>
          <option v-for="item in units" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <span class="filter-hint">筛选到某一台机组下的所有栅体</span>
    </form>

    <section v-if="overItems.length" class="alert-block">
      <h3 class="alert-title">压差超上限，需立即清污（上限 {{ overItems[0].limit.toFixed(2) }}m）</h3>
      <ul class="alert-list">
        <li v-for="item in overItems" :key="item.rackNo">
          <strong>{{ item.rackNo }}（{{ item.unit }}）</strong>
          压差 <span class="text-warn">{{ item.pressure.toFixed(2) }}m</span>，
          上次清理日期：{{ item.hasLog ? item.lastDate : '从无清污记录' }}
          <span v-if="!item.hasLog" class="muted-text">（没有清污记录，留行说明）</span>
        </li>
      </ul>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>优先次序</th>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>前后压差(m)</th>
          <th>压差上限(m)</th>
          <th>清污次数</th>
          <th>清污方式</th>
          <th>上次清理日期</th>
          <th>上次清理人员</th>
          <th>当前状态</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in ranked" :key="item.rackNo" :class="{ 'row-over': item.overLimit }">
          <td>
            <span :class="['rank-badge', item.overLimit ? 'rank-top' : '']">№{{ item.priority }}</span>
          </td>
          <td>{{ item.rackNo }}</td>
          <td>{{ item.unit }}</td>
          <td><span :class="{ 'text-warn': item.overLimit }">{{ item.pressure.toFixed(2) }}</span></td>
          <td>{{ item.limit.toFixed(2) }}</td>
          <td>{{ item.cleanCount }}</td>
          <td>{{ item.hasLog ? item.lastMethod : '无清污记录' }}</td>
          <td>{{ item.hasLog ? item.lastDate : '—' }}</td>
          <td>{{ item.hasLog ? item.lastWorker : '—' }}</td>
          <td>{{ item.row.status }}</td>
          <td class="muted-text">
            <template v-if="item.overLimit">
              压差超上限；上次清理：{{ item.hasLog ? item.lastDate : '从无清污记录' }}
            </template>
            <template v-else-if="!item.hasLog">无清污记录</template>
            <template v-else>{{ item.row['备注'] || '—' }}</template>
          </td>
        </tr>
        <tr v-for="item in damaged" :key="`damaged-${item.rackNo}`" class="row-damaged">
          <td>—</td>
          <td>{{ item.rackNo }}</td>
          <td>{{ item.unit }}</td>
          <td>{{ item.pressure.toFixed(2) }}</td>
          <td>{{ item.limit.toFixed(2) }}</td>
          <td>{{ item.cleanCount }}</td>
          <td>{{ item.hasLog ? item.lastMethod : '无清污记录' }}</td>
          <td>{{ item.hasLog ? item.lastDate : '—' }}</td>
          <td>{{ item.hasLog ? item.lastWorker : '—' }}</td>
          <td>已损坏</td>
          <td class="muted-text">栅体已损坏，不参与清污排程</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        当前 {{ unitLabel }} 共 {{ ranked.length + damaged.length }} 台（参与排程 {{ ranked.length }} 台，
        已损坏 {{ damaged.length }} 台）；另存文件行数与本总数一致。
      </span>
      <span v-if="savedHint" class="ok-text">{{ savedHint }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  damagedRacks,
  downloadTextFile,
  exportPriorityCsv,
  priorityRacks,
  rackUnits,
} from '@/data/trashrack-service'

const unit = ref('')
const units = ref<string[]>([])
const savedHint = ref('')

const ranked = computed(() => priorityRacks(unit.value))
const damaged = computed(() => damagedRacks(unit.value))
const overItems = computed(() => ranked.value.filter((item) => item.overLimit))
const totalCleans = computed(() =>
  ranked.value.reduce((sum, item) => sum + item.cleanCount, 0) +
  damaged.value.reduce((sum, item) => sum + item.cleanCount, 0),
)
const unitLabel = computed(() => unit.value || '全部机组')

function reload() {
  units.value = rackUnits()
}

watch(unit, () => {
  savedHint.value = ''
})

function saveAs() {
  const { filename, content } = exportPriorityCsv(unit.value)
  downloadTextFile(filename, content)
  savedHint.value = `已另存 ${filename}，共 ${ranked.value.length + damaged.value.length} 行，与页面台数一致`
}

onMounted(reload)
</script>
