<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>{{ mode === 'complete' ? `确认完成清污 · ${rackCode}` : `登记实测压差 · ${rackCode}` }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <form v-if="mode === 'complete'" class="modal-body" @submit.prevent="submit">
        <label class="form-item">
          <span>清理日期 *</span>
          <input v-model="form.date" type="date" required />
        </label>
        <label class="form-item">
          <span>清污方式 *</span>
          <select v-model="form.method" required>
            <option value="">请选择</option>
            <option>人工清污</option>
            <option>机械清污</option>
          </select>
        </label>
        <label class="form-item">
          <span>清理人 *</span>
          <input v-model="form.operator" required placeholder="现场清理人" />
        </label>
        <label class="form-item">
          <span>清后实测压差(m) *</span>
          <input v-model="form.pressure" type="number" step="0.01" min="0" required placeholder="清污后现场实测" />
        </label>
        <label class="form-item">
          <span>备注</span>
          <input v-model="form.remark" placeholder="选填" />
        </label>
        <p class="modal-tip">提交后追加历史清污记录、按实测回写台账压差与清污次数，优先序立即重排。</p>
        <footer class="modal-foot">
          <button class="btn primary" type="submit">确认完成</button>
          <button class="btn ghost" type="button" @click="close">取消</button>
        </footer>
      </form>

      <form v-else class="modal-body" @submit.prevent="submit">
        <label class="form-item">
          <span>当前实测压差(m) *</span>
          <input v-model="pressure" type="number" step="0.01" min="0" required placeholder="现场实测前后压差" autofocus />
        </label>
        <p class="modal-tip">只更新台账实测压差并立即重排优先序；清污记录与次数不变。两条路径统一取这份实测值。</p>
        <footer class="modal-foot">
          <button class="btn primary" type="submit">保存实测值</button>
          <button class="btn ghost" type="button" @click="close">取消</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  mode: 'complete' | 'measure'
  rackCode: string
  defaultOperator: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'complete', payload: {
    栅体编号: string
    清理日期: string
    清污方式: string
    清理人: string
    清后实测压差: number
    备注: string
  }): void
  (e: 'measure', payload: { 栅体编号: string; pressure: number }): void
}>()

function today() {
  return new Date().toISOString().slice(0, 10)
}

const form = reactive({
  date: today(),
  method: '机械清污',
  operator: props.defaultOperator,
  pressure: '',
  remark: '',
})
const pressure = ref('')

watch(
  () => props.open,
  (open) => {
    if (open && props.mode === 'complete') {
      form.date = today()
      form.pressure = ''
      form.remark = ''
      form.operator = props.defaultOperator
    }
    if (open && props.mode === 'measure') {
      pressure.value = ''
    }
  },
)

function close() {
  emit('close')
}

function submit() {
  if (props.mode === 'complete') {
    const value = Number(form.pressure)
    if (!Number.isFinite(value) || value < 0) {
      return
    }
    emit('complete', {
      栅体编号: props.rackCode,
      清理日期: form.date,
      清污方式: form.method,
      清理人: form.operator,
      清后实测压差: value,
      备注: form.remark,
    })
  } else {
    const value = Number(pressure.value)
    if (!Number.isFinite(value) || value < 0) {
      return
    }
    emit('measure', { 栅体编号: props.rackCode, pressure: value })
  }
}
</script>
