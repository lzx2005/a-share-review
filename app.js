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

export function stockCard(s) {
  let cls = 's-pct'
  if (s.changePercent === null || s.changePercent === undefined) cls += ' neutral'
  else if (s.changePercent < 0) cls += ' down'
  const conceptHtml = s.badge ? `<div class="s-concept">${s.badge}</div>` : ''
  const dragonHtml = s.isDragon ? '<div class="s-dragon">🐉 龙头</div>' : ''
  return `<div class="stock-card${s.isDragon ? ' dragon' : ''}">${dragonHtml}<div class="s-name">${s.name || '未知股票'}</div>${conceptHtml}<div class="${cls}">${fmtPct(s.changePercent)}</div></div>`
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

  async function loadDate(date, silent = false) {
    if (currentAC) currentAC.abort()
    const ac = new AbortController(); currentAC = ac
    const my = ++reqSeq
    if (!silent) setActiveLoading(date)
    setHidden('#errorBanner', true); setHidden('#emptyBanner', true)
    if (!silent) setHidden('#skeletonSummary,#skeletonSentiment,#skeletonThemes', true)
    try {
      const r = await fetch(DATA_URL_TPL.replace('<date>', date), { cache: 'no-cache', signal: ac.signal })
      if (my !== reqSeq) return
      if (r.status === 404) {
        if (silent) { console.warn('[silent refresh] 404:', date); return }    // 静默 404 不破坏现状有 UI
        state.mode = 'empty'; setHidden('#emptyBanner', false); renderState(); return
      }
      state.report = await r.json()
      reconcile()
      state.mode = 'ready'
    } catch (e) {
      if (e.name === 'AbortError' || my !== reqSeq) return
      if (silent) { console.warn('[silent refresh] error:', e); return }        // 静默失败保旧 UI
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
    // 更新时间元素(每 60s 静默拉取后也走这里更新)
    const upEl = document.getElementById('updatedAt')
    if (upEl) upEl.textContent = (state.report && state.report.updatedAt) ? state.report.updatedAt : '--'
  }

  // 盘中每 60s 静默拉取当前 date 最新数据(update state.report 复用 renderState 重画, 不刷页 + 不骨架屏);
  // 仅当 tab 可见(document.visibilityState 'visible')且当前 mode 已 ready + 有 state.date 时触发。
  let autoRefreshTimer = null
  function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer)
    autoRefreshTimer = setInterval(() => {
      if (state.mode !== 'ready' || !state.date) return
      if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return
      const el = document.querySelector('.updated-at')
      if (el) { el.classList.add('refreshing'); setTimeout(() => el.classList.remove('refreshing'), 1200) }
      loadDate(state.date, true)
    }, 60000)
  }

  function renderReport() {
    const r = state.report
    renderSummary(r.marketSummary)
    renderSentiment(r.sentiment)
    renderThemes(r.themes)
    setHidden('#summaryGrid,#sentimentPanel,#themeList', false)
  }

  // 龙头首阴(buy_signals 15:20 更新):只看板块龙头(最高连板,并列取先封)断板后的 T+1/T+2。
  // 按板块名挂到对应题材卡梯队最上方(龙头位);对不上板块的落到此独立面板(其他板块)。
  // 9:27 竞价弱转强(涨幅≥1% 且量比≥1.2)Bark 提醒介入,收盘破首阴收×0.93 作废。
  function renderYinPool(list) {
    const panel = document.getElementById('yinPoolPanel')
    if (!panel) return
    if (!list || !list.length) { panel.hidden = true; panel.innerHTML = ''; return }
    panel.innerHTML = `<header class="lag-title">🐉 龙头首阴观察池 · 其他板块 <span class="lag-sub">只看板块龙头断板(最高连板·并列取先封)· T+1/T+2 竞价弱转强介入(9:27 Bark)· 破首阴收×0.93 作废</span></header>
      <div class="lag-grid">${list.map(yinCard).join('')}</div>`
    panel.hidden = false
  }

  function yinCard(x) {
    const margin = (x.breakMarginPct === null || x.breakMarginPct === undefined) ? '--'
      : (x.breakMarginPct > 0 ? '+' : '') + x.breakMarginPct + '%'
    const yc = (x.yinClose === null || x.yinClose === undefined) ? '--' : x.yinClose
    const lc = (x.lastClose === null || x.lastClose === undefined) ? '--' : x.lastClose
    return `<div class="stock-card yin-card">
      <div class="s-name">${x.name || x.id}<span class="lag-code">${x.id}</span></div>
      <div class="s-concept">前${x.streak}板龙头 · 阴${x.yinDays}天</div>
      <div class="lag-metrics">首阴收 <em>${yc}</em> · 最近收 <em>${lc}</em> · 距作废线 <em>${margin}</em></div>
    </div>`
  }

  function yinRow(list) {
    return `<div class="ladder-row yin-row">
      <span class="ladder-badge yin-badge">首阴(${list.length})</span>
      <div class="ladder-slot"><div class="stock-grid">${list.map(yinCard).join('')}</div></div>
    </div>`
  }

  // 潜在补涨·低位股(buy_signals 14:30/15:20 扫描写入):按板块名挂到对应题材卡梯队末尾(一板之后),
  // 对不上板块的剩余候选落到底部「其他板块」专区;全区无数据自动隐藏。
  function renderLaggards(list) {
    const panel = document.getElementById('laggardPanel')
    if (!panel) return
    if (!list || !list.length) { panel.hidden = true; panel.innerHTML = ''; return }
    panel.innerHTML = `<header class="lag-title">🌱 潜在补涨 · 其他板块 <span class="lag-sub">持续发酵板块内尚未启动 · 每日 14:30 / 15:20 扫描 · 小仓试错去弱留强</span></header>
      <div class="lag-grid">${list.map(laggardCard).join('')}</div>`
    panel.hidden = false
  }

  function laggardCard(x) {
    const pctCls = (x.changePercent === null || x.changePercent === undefined) ? 'neutral'
      : (x.changePercent < 0 ? 'down' : '')
    const pct5 = x.pct5d === null || x.pct5d === undefined ? '--' : fmtPct(x.pct5d)
    const pos = x.position === null || x.position === undefined ? '--' : x.position + '%'
    const score = x.score === null || x.score === undefined ? '--' : x.score
    return `<div class="stock-card lag-card">
      <div class="s-name">${x.name || x.id}<span class="lag-code">${x.id}</span></div>
      <div class="lag-metrics">今日 <em class="s-pct ${pctCls}">${fmtPct(x.changePercent)}</em> · 5日 <em>${pct5}</em> · 位置 <em>${pos}</em> · 评分 <em>${score}</em></div>
    </div>`
  }

  function laggardRow(list) {
    return `<div class="ladder-row lag-row">
      <span class="ladder-badge lag-badge">补涨(${list.length})</span>
      <div class="ladder-slot"><div class="stock-grid">${list.map(laggardCard).join('')}</div></div>
    </div>`
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
    const allLag = (state.report && state.report.laggardCandidates) || []
    const allYin = (state.report && state.report.dragonYinPool) || []
    if (!list.length) {
      document.getElementById('themeList').innerHTML = '<section class="empty-banner"><p>暂无题材数据</p></section>'
      renderYinPool(allYin)
      renderLaggards(allLag)
      return
    }
    const used = new Set()
    const usedYin = new Set()
    document.getElementById('themeList').innerHTML = list.map(t => {
      const mine = allLag.filter(x => x.boardName === t.name)
      mine.forEach(x => used.add(x.id))
      const myYin = allYin.filter(x => x.boardName === t.name)
      myYin.forEach(x => usedYin.add(x.id))
      return themeCard(t, mine, myYin)
    }).join('')
    list.forEach(t => t.ladders.forEach((l, li) => bindExpand(t.id, l.boardCount, li)))
    renderYinPool(allYin.filter(x => !usedYin.has(x.id)))
    renderLaggards(allLag.filter(x => !used.has(x.id)))
  }

  function themeCard(t, laggards, yins) {
    const yRow = yins && yins.length ? yinRow(yins) : ''
    const ladders = t.ladders.map((l, i) => ladderRow(t.id, l, i)).join('')
    const lagRow = laggards && laggards.length ? laggardRow(laggards) : ''
    return `<section class="theme-card">
      <aside class="theme-summary">
        <div class="t-name">${t.name}</div>
        <div class="t-meta">共 ${t.stockCount} 只</div>
        <span class="badge-hi">最高 ${t.highestBoardCount} 板</span>
        <span class="badge-today">今涨停 ${t.limitUpCount}</span>
      </aside>
      <div class="theme-ladders">${yRow}${ladders}${lagRow}</div>
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
    startAutoRefresh()
  }

  boot()
}
