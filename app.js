// 题材复盘 app 纯原生 ESM,无构建。顶部 export 给 tests/test_app_pure.mjs 用。
// 底部 if(typeof window!=='undefined') boot() 守卫,node 单测时不触发 DOM。

const BOARD_CN = ['零', '一', '二', '三', '四', '五', '六']  // 0-6,7+ 走数字降级

export function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '暂无涨幅'
  if (n === 0 || n === 0.0) return '0.00%'
  const sign = n > 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

export function boardName(k) {
  if (!k || k < 0) return ''
  if (k < BOARD_CN.length) return BOARD_CN[k] + '板'
  return k + '板'
}

export function boardLevels(k) {
  if (k >= 5) return 'high'
  if (k >= 3) return 'mid'
  if (k === 2) return 'low'
  return 'base'
}

export function boardAccent(k) {
  return { cls: boardLevels(k), name: boardName(k) }
}

export function validTheme(t) {
  return Array.isArray(t.ladders) && t.ladders.some(l => l.stocks && l.stocks.length > 0)
}

export function dataAnomalyNote(theme, poolSummary, limitUpCount) {
  const ladderSum = theme.ladders.reduce((s, l) => s + l.totalCount, 0)
  let n = 0
  if (ladderSum !== theme.limitUpCount) n++
  if (poolSummary && poolSummary.reduce((s, x) => s + x.stockCount, 0) !== limitUpCount) n++
  return n
}

// ===== 以下为浏览器渲染相关,node 单测不导入 =====
if (typeof window !== 'undefined') {
  const DATA_URL_TPL = './data/<date>.json'   // 本地预览;部署 cp 时改为 './data/<date>.json'(常量,见 spec §11.4)
  const AVAILABLE_URL = './available_dates.json'
  let reqSeq = 0
  let currentAC = null
  const state = { mode: 'skeleton', date: null, dates: [], report: null, anomaly: 0 }
  const uiState = new Map()                     // theme_id+board → expanded bool

  async function fetchAvailable() {
    try {
      const r = await fetch(AVAILABLE_URL, { cache: 'no-cache' })
      if (r.ok) state.dates = (await r.json()).dates || []
    } catch (e) { state.dates = [] }
  }

  function latestDate() { return state.dates[state.dates.length - 1] || null }

  async function loadDate(date) {
    if (currentAC) currentAC.abort()
    const ac = new AbortController(); currentAC = ac
    const my = ++reqSeq
    setActiveLoading(date)
    setHidden('#errorBanner', true); setHidden('#emptyBanner', true); setHidden('#skeletonSummary,#skeletonSentiment,#skeletonThemes', true)
    try {
      const r = await fetch(DATA_URL_TPL.replace('<date>', date), { cache: 'no-cache', signal: ac.signal })
      if (my !== reqSeq) return
      if (r.status === 404) { state.mode = 'empty'; setHidden('#emptyBanner', false); renderState(); return }
      state.report = await r.json()
      reconcile()
      state.mode = 'ready'
    } catch (e) {
      if (e.name === 'AbortError' || my !== reqSeq) return
      state.mode = 'page-error'; setHidden('#errorBanner', false)
    }
    renderState()
  }

  function reconcile() {
    state.anomaly = 0
    if (!state.report) return
    for (const t of state.report.themes || []) {
      state.anomaly += dataAnomalyNote(t, null, t.limitUpCount)
    }
    const poolSum = (state.report.sentiment || {}).poolLadderSummary || []
    if (poolSum.reduce((s, x) => s + x.stockCount, 0) !== (state.report.marketSummary || {}).limitUpCount) state.anomaly++
    if (state.anomaly > 0) console.warn(`[anomaly] dataAnomaly=${state.anomaly}`)
    else console.log('[ok] dataAnomaly=0')
  }

  function setActiveLoading(date) {
    state.date = date
    const d = document.getElementById('dateDisplay')
    if (d) d.querySelector('.date-main').textContent = date + ' ' + (state.report?.weekday || '')
  }

  function setHidden(sel, hide) {
    document.querySelectorAll(sel).forEach(e => e.hidden = hide)
  }

  function renderState() {
    if (state.mode === 'skeleton') return
    if (state.mode === 'ready') renderReport()
    const banner = document.getElementById('statusBanner')
    if (state.mode === 'ready') banner.textContent = `已加载 ${state.report.tradeDate} ${state.report.weekday} 涨停题材复盘 / dataAnomaly=${state.anomaly}`
  }

  function renderReport() {
    const r = state.report
    renderSummary(r.marketSummary)
    renderSentiment(r.sentiment)
    renderThemes(r.themes)
    setHidden('#summaryGrid,#sentimentPanel,#themeList', false)
  }

  function renderSummary(ms) {
    const items = [
      { label: '上证指数', value: fmtIdxPct(ms.indexChangePercent), sub: r_subTradeDate(), cls: clsPct(ms.indexChangePercent) },
      { label: '涨停', value: String(ms.limitUpCount ?? ''), sub: '只', cls: 'up-color' },
      { label: '涨停成功率', value: successRateText(ms.limitUpSuccessRate), sub: '封板质量', cls: 'up-color' },
      { label: '跌停', value: String(ms.limitDownCount ?? ''), sub: '只', cls: 'down-color' },
    ].filter(c => c.value !== '' && c.value !== null)
    document.getElementById('summaryGrid').innerHTML = items.map(c =>
      `<div class="summary-card"><div class="label">${c.label}</div><div class="value ${c.cls}">${c.value}</div><div class="sub">${c.sub}</div></div>`
    ).join('')
  }

  function fmtIdxPct(v) { return v === null || v === undefined ? '' : fmtPct(v) }
  function clsPct(v) { return v === null || v === undefined ? '' : (v > 0 ? 'up-color' : v < 0 ? 'down-color' : 'neutral') }
  function successRateText(v) { return v === null || v === undefined ? '' : (Math.round(v) + '%') }
  function r_subTradeDate() { return state.report ? state.report.tradeDate : '' }

  function renderSentiment(s) {
    if (!s) { setHidden('#sentimentPanel', true); return }
    const order = [
      { label: '一进二', toTag: () => promotionTag('一进二', s.promotion1To2) },
      { label: '二进三', toTag: () => promotionTag('二进三', s.promotion2To3) },
      { label: '昨连板', toTag: () => perfTag('昨连板 ', s.previousLadderPerformance) },
      { label: '昨涨停', toTag: () => perfTag('昨涨停 ', s.previousLimitUpPerformance) },
      { label: '最高板', toTag: () => highestTag(s.highestBoard) },
      { label: '池内梯队', toTag: () => poolLadderTag(s.poolLadderSummary) },
      { label: '热门题材', toTag: () => hotThemeTag(s.hotTheme) },
      { label: '池内首板', toTag: () => simpleTag('池内首板 ', s.poolFirstBoardCount) },
      { label: '池内连板', toTag: () => simpleTag('池内连板 ', s.poolContinuousBoardCount) },
      { label: '池内断板', toTag: () => simpleTag('池内断板 ', s.poolBrokenBoardCount) },
    ]
    const html = order.map(o => o.toTag()).filter(x => x).join('')
    document.getElementById('sentimentPanel').innerHTML = html
  }

  function promotionTag(label, p) {
    if (!p || p.rate === null || p.rate === undefined) return ''
    return tag(label, `${p.previousCount}→${p.currentCount} <em>(${Math.round(p.rate)}%)</em>`)
  }
  function perfTag(label, v) { return v === null || v === undefined ? '' : tag(label, `<em>${fmtPct(v)}</em>`) }
  function highestTag(h) { return !h ? '' : tag('最高板 ', `${h.stockName} · <em>${h.boardCount}板</em>`) }
  function poolLadderTag(arr) {
    if (!arr || !arr.length) return ''
    const txt = arr.map(x => `${x.boardCount}板×${x.stockCount}`).join(' ')
    return tag('池内梯队 ', txt, true)
  }
  function hotThemeTag(h) { return !h ? '' : tag('热门题材 ', `${h.name} <em>${h.stockCount}</em>`) }
  function simpleTag(label, v) { return v === null || v === undefined ? '' : tag(label, `<em>${v}</em>`) }
  function tag(label, inner, long = false) {
    return `<span class="tag${long ? ' long' : ''}">${label} ${inner}</span>`
  }

  function renderThemes(themes) {
    const list = (themes || []).filter(validTheme)
    if (!list.length) { document.getElementById('themeList').innerHTML = '<section class="empty-banner"><p>暂无题材数据</p></section>'; return }
    document.getElementById('themeList').innerHTML = list.map(themeCard).join('')
    list.forEach(t => t.ladders.forEach((l, li) => bindExpand(t.id, l.boardCount, li)))
  }

  function themeCard(t) {
    const ladders = t.ladders.map((l, i) => ladderRow(t.id, l, i)).join('')
    return `<section class="theme-card">
      <aside class="theme-summary">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">共 ${t.stockCount} 只</div>
        <span class="badge-hi">最高 ${t.highestBoardCount} 板</span>
        <span class="badge-today">今涨停 ${t.limitUpCount}</span>
      </aside>
      <div class="theme-ladders">${ladders}</div>
    </section>`
  }

  function ladderRow(themeId, l, ladderIdx) {
    const acc = boardAccent(l.boardCount)
    const expandedKey = themeId + ':' + l.boardCount
    const alwaysOpen = l.boardCount >= 3
    const visible = (uiState.get(expandedKey) || alwaysOpen) ? l.stocks : l.stocks.slice(0, _defaultVisible())
    const overflow = l.stocks.length - visible.length
    return `<div class="ladder-row" data-key="${expandedKey}">
      <span class="ladder-badge ${acc.cls}">${acc.name}(${l.stocks.length})</span>
      <div class="ladder-slot"><div class="stock-grid">${visible.map(stockCard).join('')}</div>
      ${overflow > 0 ? `<button class="expand-btn" type="button" data-key="${expandedKey}" aria-expanded="false">展开全部 ${l.stocks.length} 只</button>` : ''}
      </div>
    </div>`
  }

  function stockCard(s) {
    let cls = 's-pct'
    if (s.changePercent === null || s.changePercent === undefined) cls += ' neutral'
    else if (s.changePercent < 0) cls += ' down'
    const badgeHtml = s.badge ? `<span class="badge">${s.badge}</span>` : ''
    return `<div class="stock-card"><div class="s-name">${s.name || '未知股票'}${badgeHtml}</div><div class="${cls}">${fmtPct(s.changePercent)}</div></div>`
  }

  function _defaultVisible() { return window.matchMedia('(max-width:700px)').matches ? 6 : 4 }

  function bindExpand(themeId, boardCount, ladderIdx) {
    const btn = document.querySelector(`.expand-btn[data-key="${themeId}:${boardCount}"]`)
    if (!btn) return
    btn.addEventListener('click', () => {
      const k = btn.dataset.key
      uiState.set(k, !uiState.get(k))
      renderThemes(state.report.themes)   // 整体 re-render,展开/折回一致(替代 plan 原版 replaceWith 死代码)
    })
  }

  function bindUI() {
    document.getElementById('prevDay').addEventListener('click', () => gotoStep(-1))
    document.getElementById('nextDay').addEventListener('click', () => gotoStep(1))
    document.getElementById('btnRetry').addEventListener('click', () => loadDate(state.date))
    document.getElementById('openCal').addEventListener('click', openCalendar)
  }

  async function gotoStep(dir) {
    const i = state.dates.indexOf(state.date)
    const ni = i + dir
    if (ni < 0 || ni >= state.dates.length) return
    await loadDate(state.dates[ni])
    updateNavButtons()
  }

  function updateNavButtons() {
    const i = state.dates.indexOf(state.date)
    document.getElementById('prevDay').disabled = i <= 0
    document.getElementById('nextDay').disabled = i >= state.dates.length - 1
  }

  function openCalendar() {
    const diag = document.getElementById('calDialog')
    const grid = document.getElementById('calGrid')
    grid.innerHTML = state.dates.map(d => `<button class="cal-day" data-d="${d}">${d}</button>`).join('')
    grid.querySelectorAll('.cal-day').forEach(b => b.addEventListener('click', () => {
      diag.close(); loadDate(b.dataset.d).then(updateNavButtons)
    }))
    diag.showModal()
  }

  async function boot() {
    bindUI()
    await fetchAvailable()
    const hashDate = (location.hash || '').replace('#', '')
    const start = state.dates.includes(hashDate) ? hashDate : latestDate()
    if (!start) { state.mode = 'empty'; setHidden('#emptyBanner', false); renderState(); return }
    await loadDate(start)
    updateNavButtons()
  }

  boot()
}
