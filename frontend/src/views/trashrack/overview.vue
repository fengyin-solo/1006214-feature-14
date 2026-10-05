<template>
  <section v-if="stats" class="page" data-module="trashrack-overview">
    <header class="page-head">
      <div>
        <h2>清污概览</h2>
        <p class="page-desc">
          拦污栅清污关键条目一览：超上限栅体、清污待办、各机组分布与清污条数，
          全部取自拦污栅台账同一份数据，与现场台账实时同步。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/trashrack">返回台账</RouterLink>
        <RouterLink class="btn primary" to="/trashrack/priority">看清污次序</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong :class="['stat-value', card.warn ? 'warn' : '']">{{ card.value }}</strong>
      </article>
    </div>

    <div class="ov-grid">
      <section class="ov-panel panel-alert">
        <h3>压差超上限栅体（优先处置）</h3>
        <ul class="ov-list">
          <li v-for="item in stats.todo.filter((i) => i.overLimit)" :key="item.rackNo">
            <span class="ov-main">{{ item.rackNo }} · {{ item.unit }}</span>
            <span class="ov-meta">
              压差 <strong class="text-warn">{{ item.pressure.toFixed(2) }}m</strong>
              / 上限 {{ item.limit.toFixed(2) }}m ｜ 上次清理：{{ item.hasLog ? item.lastDate : '从无清污记录' }}
            </span>
          </li>
          <li v-if="!stats.todo.some((i) => i.overLimit)" class="empty-inline">当前没有超上限栅体</li>
        </ul>
      </section>

      <section class="ov-panel">
        <h3>清污待办（与现场台账同步）</h3>
        <ol class="ov-list ov-ordered">
          <li v-for="item in stats.todo" :key="item.rackNo">
            <span class="ov-main">
              <span :class="['rank-badge', item.overLimit ? 'rank-top' : '']">№{{ item.priority }}</span>
              {{ item.rackNo }} · {{ item.unit }}
              <span class="tag-chip">{{ item.row.status }}</span>
            </span>
            <span class="ov-meta">
              压差 {{ item.pressure.toFixed(2) }}m ｜ 已清污 {{ item.cleanCount }} 次
              ｜ 上次：{{ item.hasLog ? item.lastDate : '无清污记录' }}
            </span>
          </li>
        </ol>
      </section>
    </div>

    <div class="ov-grid">
      <section class="ov-panel">
        <h3>按机组分布</h3>
        <table class="data-table">
          <thead>
            <tr><th>所属机组</th><th>栅体数</th><th>超上限</th><th>待清污</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in stats.byUnit" :key="row.unit">
              <td>{{ row.unit }}</td>
              <td>{{ row.total }}</td>
              <td><span :class="{ 'text-warn': row.overLimit > 0 }">{{ row.overLimit }}</span></td>
              <td>{{ row.pending }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="ov-panel">
        <h3>关键条目</h3>
        <ul class="kv-list">
          <li><span>栅体总数</span><strong>{{ stats.total }} 台 / {{ stats.units }} 台机组</strong></li>
          <li><span>待清理 / 清理中</span><strong>{{ stats.pending }} / {{ stats.cleaning }}</strong></li>
          <li><span>已清理 / 已损坏</span><strong>{{ stats.done }} / {{ stats.damaged }}</strong></li>
          <li><span>历史清污记录条数</span><strong>{{ stats.logs }} 条</strong></li>
          <li><span>台账累计清污次数</span><strong>{{ stats.totalCleans }} 次（与清污记录同一份）</strong></li>
          <li><span>无清污记录栅体</span><strong>{{ stats.noLog }} 台</strong></li>
          <li><span>当前最大压差</span><strong class="text-warn">{{ stats.maxPressure.toFixed(2) }} m</strong></li>
        </ul>
      </section>
    </div>

    <footer class="page-foot">
      <span>早期台账只登记清理人、未登记清污方式的记录，已按「早期人工作业」统一补录为人工清污，理由写入该记录备注。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadStats, type OverviewStats } from '@/data/trashrack-service'

const stats = ref<OverviewStats | null>(null)

const cards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: '栅体总数', value: s.total, warn: false },
    { label: '压差超上限', value: s.overLimit, warn: s.overLimit > 0 },
    { label: '待清污栅体', value: s.pending + s.cleaning, warn: false },
    { label: '累计清污次数', value: s.totalCleans, warn: false },
    { label: '清污记录条数', value: s.logs, warn: false },
  ]
})

onMounted(() => {
  stats.value = loadStats()
})
</script>
