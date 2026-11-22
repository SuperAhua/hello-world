(function () {
  'use strict';

  var P = window.LedgerParser;
  var parseInputs = P.parseInputs;
  var parseInput = P.parseInput;
  var catColor = P.catColor;
  var ymd = P.ymd;
  var pad = P.pad;

  var STORAGE_KEY = 'shoujizhang.entries.v1';
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var entries = [];
  var viewYear = 0, viewMonth = 0;
  var selectedDate = '';
  var activeTab = 'record';
  var toastTimer = null;
  var searchQuery = '';
  var statsCache = null;

  /* 手选分类：catPick 是当前展开的选择器，catOverride 记住"这句话第几笔"被改成了什么 */
  var catPick = null;
  var catOverride = { key: '', map: {} };

  /* ---------------- 账户与快捷标签 ---------------- */
  var ACC_KEY = 'shoujizhang.accounts.v1';
  var TPL_KEY = 'shoujizhang.tpls.v1';
  var ACC_COLORS = ['#1677ff', '#1aad19', '#f0a500', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
  var PSEUDO_ACC = { id: '', name: '未指定', color: '#9aa4b2', initial: 0 };

  // 储蓄是个虚拟账户：存钱 = 从某个账户「转到」储蓄。
  // 钱没花掉，只是换了个口袋，所以既不算支出也不算收入，但余额要跟着走。
  var SAVINGS_ID = 'acc_savings';
  var SAVINGS_ACC = { id: SAVINGS_ID, name: '储蓄', color: '#0891b2', initial: 0, builtin: true };

  var DEFAULT_ACCOUNTS = [
    { id: 'acc_alipay', name: '支付宝', color: '#1677ff' },
    { id: 'acc_wechat', name: '微信', color: '#1aad19' },
    { id: 'acc_bank', name: '银行卡', color: '#f0a500' },
    { id: 'acc_cash', name: '现金', color: '#8b5cf6' }
  ];

  var DEFAULT_TPLS = [
    { id: 'q_zaofan', name: '早饭', category: '餐饮' },
    { id: 'q_wufan', name: '午饭', category: '餐饮' },
    { id: 'q_wanfan', name: '晚饭', category: '餐饮' },
    { id: 'q_kafei', name: '咖啡', category: '餐饮' },
    { id: 'q_naicha', name: '奶茶', category: '餐饮' },
    { id: 'q_dache', name: '打车', category: '交通' },
    { id: 'q_ditie', name: '地铁', category: '交通' },
    { id: 'q_chaoshi', name: '超市', category: '日用' }
  ];

  var accounts = [];
  var currentAccId = '';
  // 账户视图：非空时所有"看账"的地方只显示这个账户（'' = 全部账户）
  var accView = '';
  var tpls = [];
  var quickId = null;
  var modalSave = null;

  /* ---------------- 设置（预算 / AI） ---------------- */
  var SET_KEY = 'shoujizhang.settings.v1';
  var AI_CACHE_KEY = 'shoujizhang.ai.v1';
  var settings = {
    budget: 0,
    apiBase: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    sendDetail: false,
    hide: {},         // 单账户余额隐藏：{ 账户id: true, __total__: true }
    mode: 'normal'    // 显示模式：normal 全部可见 / expense 只看支出
  };
  var aiBusy = false;
  var aiAbort = null;

  function loadSettings() {
    try {
      var o = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (o && typeof o === 'object') {
        if (isFinite(o.budget) && o.budget > 0) settings.budget = Number(o.budget);
        if (typeof o.apiBase === 'string') settings.apiBase = o.apiBase;
        if (typeof o.apiKey === 'string') settings.apiKey = o.apiKey;
        if (typeof o.model === 'string') settings.model = o.model;
        settings.sendDetail = !!o.sendDetail;
        if (o.hide && typeof o.hide === 'object') settings.hide = o.hide;
        settings.mode = (o.mode === 'expense') ? 'expense' : 'normal';
        if (!o.mode && o.privacy) settings.mode = 'expense';   // 兼容旧的 privacy 字段
      }
    } catch (err) { }
  }

  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (err) { }
  }

  function hasAI() {
    return !!(settings.apiKey && settings.apiBase && settings.model);
  }

  /* ---------------- 余额可见性 ----------------
     纯粹是显示层的开关，不动任何数据：隐藏的账户照常参与总余额计算，
     统计页也照常统计。键是账户 id；总余额用 __total__，储蓄用 acc_savings。 */
  var HIDE_TOTAL = '__total__';
  var EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 12S5.9 5.6 12 5.6 21.8 12 21.8 12 18.1 18.4 12 18.4 2.2 12 2.2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 12S5.9 5.6 12 5.6 21.8 12 21.8 12 18.1 18.4 12 18.4 2.2 12 2.2 12z"/><circle cx="12" cy="12" r="2.8"/><line x1="3.8" y1="3.8" x2="20.2" y2="20.2"/></svg>';

  function isBalHidden(key) {
    if (isExpenseOnly()) return true;   // 只看支出时，余额一律不显示
    return !!(settings.hide && settings.hide[key]);
  }

  /* 「只看支出」模式：余额、收入、结余全部下掉，页面上只剩花了多少。
     数据一分不动，统计照常算，切回「全部」立刻恢复。 */
  function isExpenseOnly() { return settings.mode === 'expense'; }

  function toggleBalHidden(key) {
    settings.hide = settings.hide || {};
    if (settings.hide[key]) delete settings.hide[key];
    else settings.hide[key] = true;
    saveSettings();
  }

  /* 显示模式：全部 / 只看支出。选完存本地，下次打开还是这个模式。 */
  function toggleMode() {
    settings.mode = isExpenseOnly() ? 'normal' : 'expense';
    saveSettings();
    syncModeItem();
    renderAll();
    showToast(isExpenseOnly()
      ? '已切到「只看支出」：余额、收入、结余都收起来了'
      : '已切回「全部」：余额和收入都回来了');
  }

  function syncModeItem() {
    var el = $('#mm-mode');
    if (!el) return;
    el.textContent = '显示模式：' + (isExpenseOnly() ? '只看支出' : '全部');
    el.classList.toggle('on', isExpenseOnly());
  }

  function maskMoney() { return '••••'; }


  function $(sel) { return document.querySelector(sel); }

  /* ---------------- 格式化 ---------------- */
  function fmt(n) {
    if (!isFinite(n)) n = 0;
    var r = Math.round(n * 100) / 100;
    return r.toLocaleString('zh-CN', {
      minimumFractionDigits: Number.isInteger(r) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function fmtSigned(n) {
    return (n < 0 ? '-¥' : '¥') + fmt(Math.abs(n));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tint(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a || 0.12) + ')';
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function timeLabel(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- 存储 ---------------- */
  function loadEntries() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = JSON.parse(raw || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (e) {
        return e && typeof e.date === 'string' && typeof e.amount === 'number' && isFinite(e.amount);
      }).map(function (e) {
        return {
          id: e.id || uid(),
          date: e.date,
          amount: e.amount,
          item: e.item || '支出',
          category: e.category || '其他',
          type: (e.type === 'income' || e.type === 'transfer') ? e.type : 'expense',
          account: typeof e.account === 'string' ? e.account : '',
          toAccount: typeof e.toAccount === 'string' ? e.toAccount : '',
          raw: e.raw || '',
          note: typeof e.note === 'string' ? e.note.slice(0, 120) : '',
          ts: typeof e.ts === 'number' ? e.ts : Date.now()
        };
      });
    } catch (err) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
      showToast('保存失败：浏览器存储空间不足');
    }
  }

  /* ---------------- 账户 ---------------- */
  function defaultAccounts() {
    return DEFAULT_ACCOUNTS.map(function (a) {
      return { id: a.id, name: a.name, color: a.color, initial: 0 };
    });
  }

  function loadAccounts() {
    var list = null, cur = '';
    try {
      var o = JSON.parse(localStorage.getItem(ACC_KEY) || 'null');
      if (o && Array.isArray(o.list)) { list = o.list; cur = o.current || ''; }
    } catch (err) { }

    if (!list || !list.length) {
      accounts = defaultAccounts();
      currentAccId = accounts[0].id;
      return;
    }

    accounts = list.filter(function (a) {
      return a && a.id && a.name;
    }).map(function (a, i) {
      return {
        id: String(a.id),
        name: String(a.name).slice(0, 10),
        initial: isFinite(a.initial) ? Number(a.initial) : 0,
        color: a.color || ACC_COLORS[i % ACC_COLORS.length]
      };
    });
    if (!accounts.length) accounts = defaultAccounts();

    var ok = false;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === cur) ok = true;
    currentAccId = ok ? cur : accounts[0].id;
  }

  function saveAccounts() {
    try {
      localStorage.setItem(ACC_KEY, JSON.stringify({ list: accounts, current: currentAccId }));
    } catch (err) { }
  }

  function accById(id) {
    if (id === SAVINGS_ID) return SAVINGS_ACC;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === id) return accounts[i];
    return PSEUDO_ACC;
  }

  function accIdByName(name) {
    var n = String(name || '').trim();
    if (!n) return '';
    if (n === '储蓄' || n === SAVINGS_ACC.name) return SAVINGS_ID;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].name === n) return accounts[i].id;
    return '';
  }

  function isTransfer(e) { return e && e.type === 'transfer'; }
  function isSpend(e) { return e && e.type === 'expense'; }
  function isIncome(e) { return e && e.type === 'income'; }

  /* ---------------- 账户视图 ----------------
     点某个账户 = 只看这本账：支出/收入按账户算，转账只要有一端是这个账户就都算进来
     （转出是钱少了、转入是钱多了，都是这本账上的事）。 */
  function inAccView(e, id) {
    if (!id) return true;
    if ((e.account || '') === id) return true;
    return isTransfer(e) && (e.toAccount || '') === id;
  }

  function accScoped(list) {
    if (!accView) return list;
    return list.filter(function (e) { return inAccView(e, accView); });
  }

  function accViewName() {
    return accView ? accById(accView).name : '';
  }

  // 点账户：切到这本账，顺便把它设成当前记账账户；再点一次回到全部
  function viewAcc(id) {
    if (!id) return;
    if (id !== SAVINGS_ID) setCurrentAcc(id);   // 储蓄不是记账账户，只切视图
    accView = (accView === id) ? '' : id;
    var box = document.getElementById('day-card');
    if (box) box.classList.remove('is-searching');
    renderAll();
    showToast(accView
      ? '现在只看 <b>' + esc(accViewName()) + '</b> 的账 · 新记账也会记到这里'
      : '已回到 <b>全部账户</b>');
  }

  function clearAccView() {
    if (!accView) return;
    accView = '';
    renderAll();
  }

  // 列表里怎么显示一笔账：转账既不带 + 也不带 -，账户写成「A → B」
  function entrySign(e) { return e.type === 'income' ? '+' : (isTransfer(e) ? '' : '-'); }
  function entryAmtCls(e) { return e.type === 'income' ? ' income' : (isTransfer(e) ? ' transfer' : ''); }
  function entryAccText(e) {
    if (isTransfer(e)) return accById(e.account || '').name + ' → ' + accById(e.toAccount || '').name;
    return e.account ? accById(e.account).name : '未指定';
  }

  // 某账户已记账的净流入：收入 - 支出 + 转入 - 转出
  function accFlow(id) {
    var s = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var from = e.account || '', to = e.toAccount || '';
      if (isTransfer(e)) {
        if (from === id) s -= e.amount;
        if (to === id) s += e.amount;
        continue;
      }
      if (from !== id) continue;
      s += e.type === 'income' ? e.amount : -e.amount;
    }
    return s;
  }

  // 余额 = 期初余额 + 已记账净流入（储蓄没有期初，全靠存取累积）
  function accBalance(id) {
    if (id === SAVINGS_ID) return accFlow(SAVINGS_ID);
    return (id ? (accById(id).initial || 0) : 0) + accFlow(id);
  }

  function hasSavings() {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (isTransfer(e) && ((e.account || '') === SAVINGS_ID || (e.toAccount || '') === SAVINGS_ID)) return true;
    }
    return false;
  }

  function hasUnknownAcc() {
    for (var i = 0; i < entries.length; i++) if (!entries[i].account) return true;
    return false;
  }

  function renderWallet() {
    // 只看支出：整块余额栏收起，不留「¥••••」这种刻意的占位
    var walletEl = document.querySelector('.wallet');
    if (walletEl) walletEl.hidden = isExpenseOnly();

    var rows = accounts.slice();
    if (hasUnknownAcc()) rows.push(PSEUDO_ACC);

    // 总余额只算真实账户；「未指定」是早期没记账户的老账，没有期初余额，
    // 把它并进来会把总支出的负数重复计一次，导致总额偏小
    var sum = 0, html = '';
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      var bal = a.id ? accBalance(a.id) : accFlow('');
      if (a.id) sum += bal;
      var hid = isBalHidden(a.id);
      html += '<button class="w-item' + (a.id === currentAccId ? ' sel' : '') + (a.id === accView ? ' view' : '') +
        '" type="button" data-acc="' + esc(a.id) + '" title="' +
        (a.id === accView ? '再点一次回到全部账户' : '点这里只看这本账') + '">' +
        '<i class="w-dot" style="background:' + a.color + '"></i>' +
        '<span class="w-name">' + esc(a.name) + '</span>' +
        '<b class="w-amt' + (!hid && bal < -0.005 ? ' neg' : '') + '">' + (hid ? maskMoney() : fmtSigned(bal)) + '</b>' +
        '</button>';
    }
    $('#wallet-list').innerHTML = html;

    // 储蓄单独一格：计入总资产，但不算支出。放滚动区外面，才不会被账户挤到看不见
    var saveEl = $('#wallet-save');
    if (saveEl) {
      if (hasSavings()) {
        var sv = accBalance(SAVINGS_ID);
        sum += sv;
        var svHid = isBalHidden(SAVINGS_ID);
        saveEl.innerHTML = '<i class="w-dot" style="background:' + SAVINGS_ACC.color + '"></i>' +
          '<span class="w-name">储蓄</span>' +
          '<b class="w-amt' + (!svHid && sv < -0.005 ? ' neg' : '') + '">' + (svHid ? maskMoney() : fmtSigned(sv)) + '</b>' +
          '<button class="bal-eye' + (svHid ? ' off' : '') + '" type="button" data-eye="' + SAVINGS_ID +
          '" title="' + (svHid ? '显示储蓄余额' : '隐藏储蓄余额') + '">' + (svHid ? EYE_OFF_SVG : EYE_SVG) + '</button>';
        saveEl.hidden = false;
        saveEl.classList.toggle('view', accView === SAVINGS_ID);
        saveEl.title = accView === SAVINGS_ID
          ? '再点一次回到全部账户'
          : '点这里只看储蓄的账 · 存进去的钱不计入支出';
      } else {
        saveEl.hidden = true;
        saveEl.innerHTML = '';
      }
    }

    var sumEl = $('#wallet-sum');
    var totHid = isBalHidden(HIDE_TOTAL);
    sumEl.textContent = totHid ? maskMoney() : fmtSigned(sum);
    sumEl.classList.toggle('neg', !totHid && sum < -0.005);

    // 一个余额都还没设过时，按钮改成「设置余额」，比「管理账户」更像下一步动作
    var blank = true;
    for (var k = 0; k < accounts.length; k++) if (accounts[k].initial) blank = false;
    $('#wallet-manage').textContent = blank ? '设置余额' : '管理账户';

    renderBudgetMeter();
  }

  // 本月（真实当月）预算：余额栏一行小字 + 卡片底部一条细进度
  function renderBudgetMeter() {
    var textEl = $('#wallet-budget'), meter = $('#wallet-meter'), fill = $('#wallet-meter-fill');
    if (!textEl || !meter || !fill) return;

    if (!(settings.budget > 0)) {
      textEl.hidden = true;
      meter.hidden = true;
      var blk = $('#budget-block');
      if (blk) blk.hidden = true;
      return;
    }

    var now = new Date();
    var used = sumBy(monthEntries(now.getFullYear(), now.getMonth()), 'expense');
    var pct = used / settings.budget * 100;
    var over = used > settings.budget;
    var left = settings.budget - used;

    textEl.hidden = false;
    textEl.classList.toggle('over', over);
    textEl.textContent = over
      ? ('超支 ¥' + fmt(-left))
      : ('预算剩 ¥' + fmt(left) + ' · ' + Math.round(pct) + '%');

    meter.hidden = false;
    meter.classList.toggle('over', over);
    fill.style.width = Math.max(1.5, Math.min(100, pct)) + '%';

    // 统计页的小结卡里给一份更完整的
    var blk2 = $('#budget-block');
    if (blk2) {
      blk2.hidden = false;
      $('#bb-val').textContent = '¥' + fmt(used) + ' / ¥' + fmt(settings.budget);
      $('#bb-fill').style.width = Math.max(1.5, Math.min(100, pct)) + '%';
      $('#bb-fill').classList.toggle('over', over);

      var days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      var leftDays = days - now.getDate() + 1;
      var tip;
      if (over) {
        tip = '已超出预算 ¥' + fmt(-left) + '，接下来 ' + leftDays + ' 天建议只花必需品。';
      } else {
        tip = '已用 ' + Math.round(pct) + '%，剩下 ' + leftDays + ' 天，每天可用 ¥' + fmt(left / Math.max(1, leftDays)) + '。';
      }
      $('#bb-tip').textContent = tip;
    }
  }

  function setCurrentAcc(id) {
    if (!accById(id).id) return;
    currentAccId = id;
    saveAccounts();
    renderWallet();
    if (!$('#quick-input').hidden) renderQuickTip();
  }

  /* ---------------- 快捷标签 ---------------- */
  function loadTpls() {
    var list = null;
    try {
      var o = JSON.parse(localStorage.getItem(TPL_KEY) || 'null');
      if (Array.isArray(o)) list = o;
    } catch (err) { }

    if (!list || !list.length) {
      tpls = DEFAULT_TPLS.map(function (t) { return { id: t.id, name: t.name, category: t.category, last: 0 }; });
      return;
    }
    tpls = list.filter(function (t) { return t && t.name; }).map(function (t, i) {
      return {
        id: String(t.id || ('q_' + i + '_' + uid())),
        name: String(t.name).slice(0, 8),
        category: t.category || '其他',
        last: isFinite(t.last) ? Number(t.last) : 0
      };
    });
    if (!tpls.length) tpls = DEFAULT_TPLS.map(function (t) { return { id: t.id, name: t.name, category: t.category, last: 0 }; });
  }

  function saveTpls() {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(tpls)); } catch (err) { }
  }

  function tplById(id) {
    for (var i = 0; i < tpls.length; i++) if (tpls[i].id === id) return tpls[i];
    return null;
  }

  function renderQuick() {
    var box = $('#quick-tags');
    var html = '';
    for (var i = 0; i < tpls.length; i++) {
      var t = tpls[i];
      html += '<button class="q-tag' + (t.id === quickId ? ' on' : '') + '" type="button" data-tpl="' + esc(t.id) + '" title="' +
        esc(t.category) + '">' +
        '<i style="background:' + catColor(t.category) + '"></i>' + esc(t.name) +
        '</button>';
    }
    box.innerHTML = html;
  }

  function renderQuickTip() {
    var t = tplById(quickId);
    if (!t) return;
    var d = selectedDateObj();
    $('#qi-tip').textContent = '回车即记账 · ' + t.category + ' · 记到 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + accById(currentAccId).name;
  }

  function openQuick(id) {
    var t = tplById(id);
    if (!t) return;
    quickId = id;
    var input = $('#qi-amount');
    input.value = '';
    input.placeholder = t.last ? String(t.last) : '金额';
    var tag = $('#qi-tag');
    tag.textContent = t.name;
    tag.style.color = catColor(t.category);
    $('#quick-input').hidden = false;
    renderQuickTip();
    renderQuick();
    input.focus();
  }

  function closeQuick() {
    quickId = null;
    $('#quick-input').hidden = true;
    $('#qi-amount').value = '';
    renderQuick();
  }

  function submitQuick() {
    var t = tplById(quickId);
    if (!t) return;
    var raw = String($('#qi-amount').value || '');
    var v = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (!isFinite(v) || v <= 0) {
      showToast('先输个金额，例如 <b>25</b>');
      $('#qi-amount').focus();
      return;
    }
    v = Math.round(v * 100) / 100;

    var entry = {
      id: uid(),
      date: selectedDate,
      amount: v,
      item: t.name,
      category: t.category,
      type: t.category === '收入' ? 'income' : (t.category === '储蓄' ? 'transfer' : 'expense'),
      account: currentAccId,
      raw: t.name + v,
      ts: Date.now()
    };
    if (t.category === '储蓄') entry.toAccount = SAVINGS_ID;
    entries.push(entry);
    save();

    t.last = v;
    saveTpls();
    closeQuick();
    renderAll();

    showToast('已记账：' + esc(t.category) + ' · ' + esc(t.name) + ' <b>¥' + fmt(v) + '</b> · ' +
      esc(accById(currentAccId).name), {
      label: '撤销',
      onClick: function () { removeByIds([entry]); }
    });
  }

  /* ---------------- 顶部 ---------------- */
  function renderTop() {
    var prefix = viewYear + '-' + pad(viewMonth + 1);
    var total = 0;
    var src = accScoped(entries);
    var isSave = accView === SAVINGS_ID;
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (e.date.slice(0, 7) !== prefix) continue;
      // 储蓄没有"支出"，只有存进去多少
      if (isSave) { if (isTransfer(e) && e.toAccount === SAVINGS_ID) total += e.amount; }
      else if (e.type === 'expense') total += e.amount;
    }
    var now = new Date();
    var isCur = (viewYear === now.getFullYear() && viewMonth === now.getMonth());
    var label = isSave ? '本月存入' : (isCur ? '本月支出' : (viewMonth + 1) + '月支出');
    $('#top-label').textContent = (accView ? accViewName() + ' · ' : '') + label;
    $('#top-total').textContent = '¥' + fmt(total);
  }

  /* ---------------- 账户视图提示条 ---------------- */
  function renderAccBar() {
    var el = $('#acc-bar');
    if (!el) return;
    if (!accView) { el.hidden = true; el.innerHTML = ''; return; }

    var prefix = viewYear + '-' + pad(viewMonth + 1);
    var exp = 0, inc = 0, put = 0, take = 0, m = accScoped(entries);
    for (var i = 0; i < m.length; i++) {
      if (m[i].date.slice(0, 7) !== prefix) continue;
      if (m[i].type === 'expense') exp += m[i].amount;
      else if (m[i].type === 'income') inc += m[i].amount;
      else if (isTransfer(m[i])) {
        if (m[i].toAccount === SAVINGS_ID) put += m[i].amount;
        if (m[i].account === SAVINGS_ID) take += m[i].amount;
      }
    }

    var acc = accById(accView);
    // 储蓄没有收支，只有存进去、取出来
    var sub = accView === SAVINGS_ID
      ? (viewMonth + 1) + '月 存入 ¥' + fmt(put) + (take > 0 ? ' · 取出 ¥' + fmt(take) : '')
      : (viewMonth + 1) + '月 支出 ¥' + fmt(exp) + (inc > 0 && !isExpenseOnly() ? ' · 收入 ¥' + fmt(inc) : '');
    el.innerHTML = '<i class="ab-dot" style="background:' + acc.color + '"></i>' +
      '<b class="ab-name">' + esc(acc.name) + '</b>' +
      '<span class="ab-sub">' + sub + '</span>' +
      '<button class="ab-all" type="button" data-acc-all="1">看全部账户</button>';
    el.hidden = false;
  }

  /* ---------------- 日历 ---------------- */
  function buildDayMap() {
    var map = {};
    var src = accScoped(entries);
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (!map[e.date]) map[e.date] = { exp: 0, inc: 0, put: 0, take: 0, cats: [] };
      var d = map[e.date];
      if (e.type === 'transfer') {
        // 转账不算收支，但储蓄视图要看得见「哪天存了、哪天取了」
        if ((e.toAccount || '') === SAVINGS_ID) d.put += e.amount;
        else if ((e.account || '') === SAVINGS_ID) d.take += e.amount;
        continue;
      }
      if (e.type === 'income') {
        d.inc += e.amount;
        if (d.cats.indexOf('收入') === -1) d.cats.push('收入');
      } else {
        d.exp += e.amount;
        if (d.cats.indexOf(e.category) === -1) d.cats.push(e.category);
      }
    }
    return map;
  }

  // 日历格子里的金额要挤进 ~44px 宽：金额越大越省略小数点，超十万压成「1.2万」
  function moneyShort(n) {
    if (n >= 100000) {
      var w = n / 10000;
      return (w >= 10 ? Math.round(w) : Math.round(w * 10) / 10) + '万';
    }
    // 千元以上丢掉小数（-1,899.9 → -1,900），否则加个符号就放不进格子
    var digits = n >= 1000 ? 0 : 1;
    return (digits ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString('zh-CN', {
      minimumFractionDigits: 0, maximumFractionDigits: digits
    });
  }

  // 格子窄、金额长时，按最宽的那一笔等比缩小整块字号，避免省略号或撑破格子
  function fitCalendarAmounts() {
    var cal = $('#calendar');
    if (!cal) return;
    cal.style.removeProperty('--damt-scale');
    if (!document.createRange) return;
    var nodes = cal.querySelectorAll('.damt');
    var need = 1;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.textContent) continue;
      var range = document.createRange();
      range.selectNodeContents(n);
      var tw = range.getBoundingClientRect().width;   // 文字实际宽度，避免 scrollWidth 取整误差
      var box = n.getBoundingClientRect().width - 2;  // 左右各留 1px
      if (tw > 0 && tw > box) need = Math.min(need, box / tw);
    }
    if (need < 0.985) cal.style.setProperty('--damt-scale', Math.max(0.68, need * 0.99).toFixed(3));
  }

  // 日均的「天数」口径：本月只算到今天为止的每一天（没记账的那天也在里面，视为当天没花钱），
  // 已经过去的月份按整月天数算；未来月份还没开始，返回 0
  function avgDays(y, m) {
    var now = new Date();
    if (y === now.getFullYear() && m === now.getMonth()) return now.getDate();
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return 0;
    return new Date(y, m + 1, 0).getDate();
  }

  // 消费热力分档：把本月有支出的日子按金额排名，按排名比例给 1-5 档。
  // 比「除以单日最高值」稳：遇到房租这类大额时其余日子照样能分出层次；
  // 天天花得差不多时也不会整月都变成最深色。金额相同的日子同档。
  function heatMap(exps) {
    var a = exps.filter(function (v) { return v > 0; }).sort(function (x, y) { return x - y; });
    var n = a.length, map = {}, i = 0;
    // 有支出的日子太少时不铺满 5 档，免得月初只记了一笔就红得很吓人
    var span = Math.min(4, Math.max(1, n - 1));
    while (i < n) {
      var j = i;
      while (j + 1 < n && a[j + 1] === a[i]) j++;
      var p = n > 1 ? ((i + j) / 2) / (n - 1) : 1;   // 同值取中位排名
      map[a[i]] = 1 + Math.round(p * span);
      i = j + 1;
    }
    return map;
  }

  function renderCalendar() {
    $('#cal-title').textContent = viewYear + '年' + (viewMonth + 1) + '月';

    var map = buildDayMap();
    var firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    var dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    var prevDim = new Date(viewYear, viewMonth, 0).getDate();
    var todayStr = ymd(new Date());
    var cells = [];
    var i;

    for (i = firstDow - 1; i >= 0; i--) cells.push({ out: true, num: prevDim - i });
    for (i = 1; i <= dim; i++) {
      var ds = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(i);
      cells.push({ out: false, num: i, date: ds, today: ds === todayStr, sel: ds === selectedDate, data: map[ds] });
    }
    var nx = 1;
    while (cells.length % 7 !== 0) cells.push({ out: true, num: nx++ });

    // 本月汇总（顺便收集每天支出，用来给热力分档）
    var mExp = 0, mInc = 0, mPut = 0, mTake = 0, activeDays = 0, exps = [];
    var savingView = (accView === SAVINGS_ID);
    for (i = 0; i < cells.length; i++) {
      var cc = cells[i];
      if (cc.out || !cc.data) continue;
      mExp += cc.data.exp;
      mInc += cc.data.inc;
      mPut += (cc.data.put || 0);
      mTake += (cc.data.take || 0);
      if (cc.data.exp > 0) exps.push(cc.data.exp);
      if (cc.data.exp > 0 || cc.data.inc > 0 || cc.data.put > 0 || cc.data.take > 0) activeDays++;
    }
    var hmap = heatMap(exps);

    var html = '';
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.out) {
        html += '<div class="day out"><span class="dnum">' + c.num + '</span></div>';
        continue;
      }
      var dots = '', tip = '';
      var has = !!(c.data && (c.data.exp > 0 || c.data.inc > 0 || c.data.put > 0 || c.data.take > 0));
      if (c.data) {
        var cats = c.data.cats.slice(0, 3);
        for (var k = 0; k < cats.length; k++) {
          dots += '<i style="background:' + catColor(cats[k]) + '"></i>';
        }
        var bits = [];
        if (c.data.exp > 0) bits.push('支出 ¥' + fmt(c.data.exp));
        if (c.data.inc > 0 && !isExpenseOnly()) bits.push('收入 ¥' + fmt(c.data.inc));
        if (c.data.put > 0) bits.push('存入 ¥' + fmt(c.data.put));
        if (c.data.take > 0) bits.push('取出 ¥' + fmt(c.data.take));
        tip = (viewMonth + 1) + '月' + c.num + '日' + (bits.length ? ' · ' + bits.join(' · ') : '');
      }
      // 金额就在日期正下方：支出 -金额，收入 +金额（收支格式统一带符号）
      // 没有记录也留一个空占位，保证同一行的日期对齐
      var amt = '<span class="damt"></span>';
      if (savingView) {
        // 储蓄这本账里没有支出，只有「存进去」和「取出来」
        var net = (c.data ? (c.data.put || 0) - (c.data.take || 0) : 0);
        if (c.data && net > 0) amt = '<span class="damt inc">+' + moneyShort(net) + '</span>';
        else if (c.data && net < 0) amt = '<span class="damt exp">-' + moneyShort(-net) + '</span>';
      } else if (c.data && c.data.exp > 0) {
        amt = '<span class="damt exp">-' + moneyShort(c.data.exp) + '</span>';
      } else if (c.data && c.data.inc > 0 && !isExpenseOnly()) {
        amt = '<span class="damt inc">+' + moneyShort(c.data.inc) + '</span>';
      }
      // 消费热力：按当天支出在「本月单日最高」里的位置分 5 档，一眼看出哪天花得狠
      var heat = '';
      var hl = (c.data && c.data.exp > 0) ? (hmap[c.data.exp] || 0) : 0;
      if (hl) heat = ' data-heat="' + hl + '"';
      html += '<button class="day' + (c.sel ? ' sel' : '') + (c.today ? ' today' : '') + (has ? ' has' : '') +
        '" data-date="' + c.date + '" title="' + esc(tip) + '"' + heat + '>' +
        '<span class="dnum">' + c.num + '</span>' +
        amt +
        '<span class="dots">' + dots + '</span>' +
        '</button>';
    }
    $('#calendar').innerHTML = html;
    fitCalendarAmounts();

    // 头部汇总条：本月支出 / 日均 / 收入（无收入时显示记账天数），就在日历正上方
    var isThisMonth = (viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth());
    var avgN = avgDays(viewYear, viewMonth);
    var avg = avgN ? mExp / avgN : 0;
    var avgLab = isThisMonth ? ('已过 ' + avgN + ' 天') : (avgN ? '全月 ' + avgN + ' 天' : '—');

    // 看的是往月就写「10月支出」，别一律叫「本月」
    var mLabel = isThisMonth ? '本月' : (viewMonth + 1) + '月';

    // 储蓄这本账里没有「支出/收入」，只有存进去、取出来和净存了多少
    if (savingView) {
      var svNet = mPut - mTake;
      $('#cal-sum').innerHTML =
        '<div class="cs"><span class="cs-l">' + mLabel + '存入</span>' +
          (mPut > 0 ? '<b class="cs-v inc">+¥' + fmt(mPut) + '</b>' : '<b class="cs-v cs-zero">¥0</b>') + '</div>' +
        '<div class="cs"><span class="cs-l">' + mLabel + '取出</span>' +
          (mTake > 0 ? '<b class="cs-v">-¥' + fmt(mTake) + '</b>' : '<b class="cs-v cs-zero">¥0</b>') + '</div>' +
        '<div class="cs cs-avg"><span class="cs-l">净存</span>' +
          '<b class="cs-v">' + fmtSigned(svNet) + '</b></div>';
      fitCalSum();
      return;
    }

    var csExp = mExp > 0
      ? '<b class="cs-v">-¥' + fmt(mExp) + '</b>'
      : '<b class="cs-v cs-zero">¥0</b>';

    var csThird = (mInc > 0 && !isExpenseOnly())
      ? '<span class="cs-l">' + mLabel + '收入</span><b class="cs-v inc">+¥' + fmt(mInc) + '</b>'
      : '<span class="cs-l">记账天数</span><b class="cs-v">' + activeDays + ' 天</b>';

    $('#cal-sum').innerHTML =
      '<div class="cs"><span class="cs-l">' + mLabel + '支出</span>' + csExp + '</div>' +
      '<div class="cs cs-avg"><span class="cs-l">日均<em>' + avgLab + '</em>' +
        (avgN ? '<i class="cs-d">·' + avgN + '天</i>' : '') + '</span>' +
        '<b class="cs-v">¥' + fmt(Math.round(avg)) + '</b></div>' +
      '<div class="cs">' + csThird + '</div>';
    fitCalSum();
  }

  // 汇总条只有三格宽，金额带小数就容易被省略号切掉；按列宽等比缩字号兜住，
  // 三格取同一个最终字号，免得一条里三个数字大小不一
  function fitCalSum() {
    var box = $('#cal-sum');
    if (!box) return;
    var vals = [].slice.call(box.querySelectorAll('.cs-v'));
    if (!vals.length) return;
    var sizes = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      v.style.fontSize = '';
      var size = parseFloat(getComputedStyle(v).fontSize) || 12.5;
      for (var k = 0; k < 14; k++) {
        if (v.scrollWidth <= v.clientWidth + 0.5) break;
        if (!(size > 9.5)) break;
        size -= 0.5;
        v.style.fontSize = size + 'px';
      }
      sizes.push(parseFloat(getComputedStyle(v).fontSize) || size);
    }
    var use = Math.min.apply(null, sizes);
    if (!isFinite(use)) return;
    for (var j = 0; j < vals.length; j++) vals[j].style.fontSize = use + 'px';
  }

  /* ---------------- 当日明细 ---------------- */
  var PLACEHOLDER = '如 中饭20 晚饭39';

  // 选中的不是今天时，明确告诉用户「这一笔会记到哪天」
  function renderDayBadge(isToday, m, d, week) {
    var el = $('#day-badge');
    var input = $('#nl-input');
    if (isToday) {
      if (el) { el.hidden = true; el.innerHTML = ''; }
      if (input) input.placeholder = PLACEHOLDER;
      return;
    }
    if (el) {
      el.hidden = false;
      el.innerHTML = '<span class="bd-dot"></span>' +
        '<span>这一笔记到 <b>' + m + '月' + d + '日</b> <span class="bd-week">' + week + '</span></span>' +
        '<span class="bd-tip">不写日期就记在这天，写了日期以输入为准</span>' +
        '<button class="bd-btn" type="button" id="badge-today">记今天</button>';
      var btn = $('#badge-today');
      if (btn) btn.addEventListener('click', goToday);
    }
    if (input) input.placeholder = m + '月' + d + '日：中饭20';
  }

  function renderDay() {
    if (searchQuery) { renderSearch(); return; }
    var card = document.getElementById('day-card');
    if (card) card.classList.remove('is-searching');

    var parts = selectedDate.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    var dt = new Date(y, m - 1, d);
    var isToday = selectedDate === ymd(new Date());

    $('#day-title').textContent = m + '月' + d + '日';
    $('#day-sub').textContent = WEEK[dt.getDay()] + (isToday ? ' · 今天' : '') +
      (accView ? ' · 只看' + accViewName() : '');
    renderDayBadge(isToday, m, d, WEEK[dt.getDay()]);

    var list = accScoped(entries).filter(function (e) { return e.date === selectedDate; });
    list.sort(function (a, b) { return b.ts - a.ts; });

    var exp = 0, inc = 0, trs = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.type === 'income') inc += it.amount;
      else if (it.type === 'transfer') trs += it.amount;
      else exp += it.amount;
    }

    // 0 的那一项就别占位置了：只有收入的一天写「支出 ¥0」纯属噪音
    var totals = exp > 0 ? '<div><span>支出</span><strong>¥' + fmt(exp) + '</strong></div>' : '';
    if (inc > 0 && !isExpenseOnly()) totals += '<div class="inc"><span>收入</span><strong>¥' + fmt(inc) + '</strong></div>';
    if (trs > 0) totals += '<div class="tr"><span>' + (accView === SAVINGS_ID ? '存取' : '转账') +
      '</span><strong>¥' + fmt(trs) + '</strong></div>';
    $('#day-totals').innerHTML = totals;

    renderDaySummary(list, exp, inc);

    var box = $('#day-list');
    if (!list.length) {
      var who = accView ? esc(accViewName()) + ' ' : '';
      box.innerHTML = '<div class="empty"><b>' + who + '这一天还没有记账</b>在上方输入框说一句话就能记上<br>例如「今天打车35」或「中饭20 晚饭39」</div>';
      return;
    }

    var html = '';
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var color = catColor(e.category);
      var sign = entrySign(e);
      html += '<div class="entry" data-id="' + esc(e.id) + '">' +
        '<span class="dot" style="background:' + color + '"></span>' +
        '<div class="entry-main">' +
        '<div class="entry-title">' + esc(e.item) + '</div>' +
        '<div class="entry-sub">' +
        '<span class="cat-tag" style="color:' + color + ';background:' + tint(color) + '">' + esc(e.category) + '</span>' +
        '<span class="entry-acc">' + esc(entryAccText(e)) + '</span>' +
        '<span>' + timeLabel(e.ts) + '</span>' +
        '</div>' +
        (e.note ? '<div class="entry-note">' + esc(e.note) + '</div>' : '') +
        '</div>' +
        (e.type === 'income' && isExpenseOnly()
          ? '<div class="entry-amt is-masked" title="只看支出模式下不显示收入金额">—</div>'
          : '<div class="entry-amt' + entryAmtCls(e) + '" title="点这里补细节">' + sign + '¥' + fmt(e.amount) + '</div>') +
        '<button class="entry-del" data-del="' + e.id + '" title="删除这笔">×</button>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------------- 当日分类汇总 ---------------- */
  function renderDaySummary(list, exp, inc) {
    var box = $('#day-summary');
    if (!box) return;
    box.classList.remove('is-noteonly');

    var byCat = {}, cnt = {}, order = [], trs = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.type === 'income') continue;
      if (e.type === 'transfer') { trs += e.amount; continue; }   // 转账不参与占比
      if (!byCat[e.category]) { byCat[e.category] = 0; cnt[e.category] = 0; order.push(e.category); }
      byCat[e.category] += e.amount;
      cnt[e.category]++;
    }

    var trNote = trs > 0 ? '转账/储蓄 ¥' + fmt(trs) + ' 不计入' : '';
    // 看的是往月就不能说「今天」
    var dayWord = (selectedDate === ymd(new Date())) ? '今天' : '这天';

    if (!order.length) {
      // 只有收入 / 转账的一天没有分类可汇总，只留一句说明（手机上这行是唯一的汇总）
      if (inc > 0 || trs > 0) box.classList.add('is-noteonly');
      box.innerHTML = (inc > 0 || trs > 0)
        ? '<div class="ds-head"><b>分类汇总</b><span class="ds-note">' +
          (inc > 0 ? dayWord + '只有收入' + (isExpenseOnly() ? '' : ' ¥' + fmt(inc)) : dayWord + '没有支出') +
          (trNote ? ' · ' + trNote : '') + '</span></div>'
        : '';
      return;
    }

    order.sort(function (a, b) { return byCat[b] - byCat[a]; });

    // 一天就一笔，日头和这笔明细已经把话说完了，再来一句「日用 ¥360.50 100%」纯属重复
    if (order.length === 1 && cnt[order[0]] === 1 && !(inc > 0) && !(trs > 0)) {
      box.innerHTML = '';
      return;
    }

    var bar = '', pills = '';
    for (var j = 0; j < order.length; j++) {
      var name = order[j];
      var val = byCat[name];
      var col = catColor(name);
      var pct = exp > 0 ? Math.round(val / exp * 100) : 0;
      // 只有一类时这根彩条必然是满格，画了反而像进度条
      if (order.length > 1) bar += '<i style="width:' + (exp > 0 ? val / exp * 100 : 0) + '%;background:' + col + '"></i>';
      pills += '<span class="ds-pill"><i style="background:' + col + '"></i>' + esc(name) +
        ' <b>¥' + fmt(val) + '</b>' +
        (cnt[name] > 1 ? '<em>' + cnt[name] + '笔</em>' : '') +
        '<em>' + pct + '%</em></span>';
    }

    var note = list.length + ' 笔 · 支出 ¥' + fmt(exp);
    if (inc > 0 && !isExpenseOnly()) note += ' · 收入 ¥' + fmt(inc);
    if (trNote) note += ' · ' + trNote;

    box.innerHTML = '<div class="ds-head"><b>分类汇总</b><span class="ds-note">' + note + '</span></div>' +
      (bar ? '<div class="ds-bar">' + bar + '</div>' : '') +
      '<div class="ds-pills">' + pills + '</div>';
  }

  /* ---------------- 搜索 ---------------- */
  // 匹配规则：数字词只比金额（"128" 能搜到 128 / 1280 / 3128），
  // 文字词比项目/分类/原话/账户；空格分隔多个词时要求全部命中。
  function searchHits(q) {
    var raw = String(q || '').trim().toLowerCase();
    if (!raw) return [];
    var toks = raw.split(/[\s,，、]+/).filter(function (t) { return t; });
    var out = [];
    var pool = accScoped(entries);   // 账户视图下只搜这本账

    for (var i = 0; i < pool.length; i++) {
      var e = pool[i];
      var hay = (e.item + ' ' + e.category + ' ' + (e.note || '') + ' ' + (e.raw || '') + ' ' +
        (e.account ? accById(e.account).name : '未指定') + ' ' +
        (isTransfer(e) ? accById(e.toAccount || '').name : '')).toLowerCase();
      var amtStr = String(e.amount);
      var amtFmt = fmt(e.amount).replace(/,/g, '');
      var ok = true;

      for (var j = 0; j < toks.length; j++) {
        var t = toks[j].replace(/^[¥￥]/, '').replace(/[元块]$/, '');
        if (/^\d+(\.\d+)?$/.test(t)) {
          if (amtStr.indexOf(t) === -1 && amtFmt.indexOf(t) === -1) { ok = false; break; }
        } else if (hay.indexOf(toks[j]) === -1) {
          ok = false; break;
        }
      }
      if (ok) out.push(e);
    }

    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.ts - a.ts;
    });
    return out;
  }

  function renderSearch() {
    var card = document.getElementById('day-card');
    if (card) card.classList.add('is-searching');
    var clearBtn = $('#search-clear');
    if (clearBtn) clearBtn.hidden = !searchQuery;

    var hits = searchHits(searchQuery);
    var exp = 0, inc = 0, trs = 0;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].type === 'income') inc += hits[i].amount;
      else if (hits[i].type === 'transfer') trs += hits[i].amount;
      else exp += hits[i].amount;
    }

    $('#day-title').textContent = '搜索结果';
    $('#day-sub').textContent = '「' + searchQuery + '」· ' +
      (hits.length ? hits.length + ' 笔' : '没有匹配') +
      (accView ? ' · 只在 ' + accViewName() + ' 里找' : ' · 已翻遍所有月份');

    // 0 的那一项就别占位置了：只有收入的一天写「支出 ¥0」纯属噪音
    var totals = exp > 0 ? '<div><span>支出</span><strong>¥' + fmt(exp) + '</strong></div>' : '';
    if (inc > 0 && !isExpenseOnly()) totals += '<div class="inc"><span>收入</span><strong>¥' + fmt(inc) + '</strong></div>';
    if (trs > 0) totals += '<div class="tr"><span>' + (accView === SAVINGS_ID ? '存取' : '转账') +
      '</span><strong>¥' + fmt(trs) + '</strong></div>';
    $('#day-totals').innerHTML = totals;

    $('#day-summary').innerHTML = '';

    var box = $('#day-list');
    if (!hits.length) {
      box.innerHTML = '<div class="empty"><b>没找到相关记录</b>' +
        '换个金额或关键词试试，比如「128」「咖啡」「支付宝」<br>空格可以组合多个条件，如「咖啡 25」</div>';
      return;
    }

    var html = '';
    for (var j = 0; j < hits.length; j++) {
      var e = hits[j];
      var color = catColor(e.category);
      var p = e.date.split('-');
      var yy = p[0] === String(viewYear) ? '' : p[0].slice(2) + '年';
      var sign = entrySign(e);
      html += '<div class="entry" data-id="' + esc(e.id) + '">' +
        '<span class="dot" style="background:' + color + '"></span>' +
        '<div class="entry-main">' +
        '<div class="entry-title">' + esc(e.item) + '</div>' +
        '<div class="entry-sub">' +
        '<span class="entry-date">' + yy + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日</span>' +
        '<span class="cat-tag" style="color:' + color + ';background:' + tint(color) + '">' + esc(e.category) + '</span>' +
        '<span class="entry-acc">' + esc(entryAccText(e)) + '</span>' +
        '</div>' +
        (e.note ? '<div class="entry-note">' + esc(e.note) + '</div>' : '') +
        '</div>' +
        (e.type === 'income' && isExpenseOnly()
          ? '<div class="entry-amt is-masked" title="只看支出模式下不显示收入金额">—</div>'
          : '<div class="entry-amt' + entryAmtCls(e) + '" title="点这里补细节">' + sign + '¥' + fmt(e.amount) + '</div>') +
        '<button class="entry-del" data-del="' + e.id + '" title="删除这笔">×</button>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  function clearSearch() {
    searchQuery = '';
    var card = document.getElementById('day-card');
    if (card) card.classList.remove('is-searching');
    var clearBtn = $('#search-clear');
    if (clearBtn) clearBtn.hidden = true;
    renderDay();
  }

  /* ---------------- 输入解析预览 ---------------- */
  function selectedDateObj() {
    var p = String(selectedDate).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  }

  // 解析基准 = 当前选中的那天：没说日期就记在那天，「今天/昨天」也以那天为参照
  function parseForInput(text) {
    // 把账户名交给解析器，「支付宝转银行卡500」才能认出两端
    var names = accounts.map(function (a) { return a.name; });
    return parseInputs(text, { base: selectedDateObj(), today: new Date(), accounts: names });
  }

  /* ---------------- 手动选分类 ---------------- */
  // 自动识别只是"猜"，人说了算：记住「原话 + 第几笔」被改成了哪个分类
  function overrideFor(raw, idx) {
    if (catOverride.key !== raw) return '';
    return catOverride.map[idx] || '';
  }

  function setOverride(raw, idx, cat) {
    if (catOverride.key !== raw) catOverride = { key: raw, map: {} };
    if (cat) catOverride.map[idx] = cat; else delete catOverride.map[idx];
  }

  // 把手动分类盖到解析结果上；收支类型跟着分类走（选「收入」就是进账）
  function applyOverrides(r, raw) {
    if (!r || !r.ok) return r;
    r.items.forEach(function (p, i) {
      var c = overrideFor(raw, i);
      if (!c) return;
      if (c === '储蓄') {
        // 手选「储蓄」= 这笔钱存起来了：改成转账，统计里不算支出
        p.category = c;
        p.color = catColor(c);
        p.type = 'transfer';
        p.fromName = p.fromName || '';
        p.toName = '储蓄';
      } else if (c === P.TRANSFER_CAT) {
        // 手选「转账」= 钱在两个账户之间挪，既不是支出也不是收入
        p.category = c;
        p.color = P.TRANSFER_COLOR;
        p.type = 'transfer';
        p.item = (p.fromName || '当前账户') + ' → ' + (p.toName || '未指定');
      } else if (c === '收入') {
        p.category = c;
        p.color = catColor(c);
        p.type = 'income';
        p.toName = '';
      } else {
        p.category = c;
        p.color = catColor(c);
        p.type = 'expense';
        if (p.toName === '储蓄') p.toName = '';
      }
      p.manual = true;
    });
    var f = r.items[0];
    r.category = f.category;
    r.color = f.color;
    r.type = f.type;
    return r;
  }

  // 预览里别显示「当前账户」，直接写当前账户真名，省得用户猜
  function dispItem(p) {
    return String(p.item || '').replace(/当前账户/g, accById(currentAccId).name);
  }

  function catTag(p, idx) {
    var c = p.color || catColor(p.category);
    return '<button type="button" class="cat-tag cat-tag-btn' + (p.manual ? ' is-manual' : '') + '"' +
      ' data-cat-idx="' + idx + '"' +
      ' style="color:' + c + ';background:' + tint(c) + '"' +
      ' title="点一下自己选分类">' + esc(p.category) +
      '<i class="ct-caret">▾</i></button>';
  }

  function renderCatPick(r, raw) {
    var box = $('#cat-pick');
    if (!box) return;
    if (!catPick || !r || !r.ok || !r.items[catPick.idx]) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var idx = catPick.idx;
    var cur = r.items[idx].category;
    var chips = P.CATEGORIES.map(function (c) {
      var on = c.name === cur;
      return '<button type="button" class="cp-chip' + (on ? ' is-on' : '') + '" data-cat="' + esc(c.name) + '"' +
        ' style="' + (on ? 'color:' + c.color + ';border-color:' + c.color + ';background:' + tint(c.color, 0.14) : '') + '">' +
        esc(c.name) + '</button>';
    }).join('');
    // 「转账」不在分类词典里（它只是个收支属性），单独补一个，识别错了也能手动改
    chips += '<button type="button" class="cp-chip' + (cur === P.TRANSFER_CAT ? ' is-on' : '') + '" data-cat="' +
      esc(P.TRANSFER_CAT) + '" style="' + (cur === P.TRANSFER_CAT
        ? 'color:' + P.TRANSFER_COLOR + ';border-color:' + P.TRANSFER_COLOR + ';background:' + tint(P.TRANSFER_COLOR, 0.14)
        : '') + '">' + esc(P.TRANSFER_CAT) + '</button>';
    box.innerHTML = '<span class="cp-lab">' + (r.count > 1 ? '第 ' + (idx + 1) + ' 笔记作' : '这笔记作') + '</span>' +
      chips +
      '<button type="button" class="cp-chip cp-auto" data-cat="">自动识别</button>';
    box.hidden = false;
  }

  function toggleCatPick(idx) {
    catPick = (catPick && catPick.idx === idx) ? null : { idx: idx };
    updatePreview();
  }

  function chooseCat(name) {
    if (!catPick) return;
    var raw = $('#nl-input').value;
    setOverride(raw, catPick.idx, name);
    catPick = null;
    updatePreview();
    if (name) showToast('这笔记作 <b>' + esc(name) + '</b>');
  }

  function updatePreview() {
    var input = $('#nl-input');
    var box = $('#preview');
    var text = input.value;
    if (!text.trim()) {
      box.innerHTML = '';
      box.parentNode.classList.add('is-empty');
      renderCatPick(null, text);
      return;
    }
    box.parentNode.classList.remove('is-empty');
    var r = applyOverrides(parseForInput(text), text);
    box.classList.remove('is-multi');
    if (!r.ok) {
      box.innerHTML = '<span class="pv-warn">' + (r.reason === 'amount' ? '还没识别到金额，试着加上「25元」' : '先输入一句话') + '</span>';
      renderCatPick(null, text);
      return;
    }

    // 单笔：保持一行紧凑展示
    if (r.count === 1) {
      var p = r.items[0];
      box.innerHTML = '<span class="pv-lead">将记为</span>' +
        catTag(p, 0) +
        '<span>' + esc(dispItem(p)) + '</span>' +
        (p.accName ? '<span class="pv-acc">' + esc(p.accName) + '</span>' : '') +
        '<span class="pv-sep">·</span><strong>' + entrySign(p) + '¥' + fmt(p.amount) + '</strong>' +
        '<span class="pv-sep">·</span><span>' + esc(p.dateLabel) + '</span>';
      renderCatPick(r, text);
      return;
    }

    // 多笔：逐条列出，确认无误再一次性入账
    var exp = 0, inc = 0, trn = 0;
    var rows = r.items.map(function (p, i) {
      if (p.type === 'income') inc += p.amount;
      else if (p.type === 'transfer') trn += p.amount;
      else exp += p.amount;
      return '<li>' +
        catTag(p, i) +
        '<span class="pv-item">' + esc(dispItem(p)) + '</span>' +
        (p.accName ? '<span class="pv-acc">' + esc(p.accName) + '</span>' : '') +
        '<span class="pv-date">' + esc(p.dateLabel) + '</span>' +
        '<strong class="pv-amt' + entryAmtCls(p) + '">' +
        entrySign(p) + '¥' + fmt(p.amount) + '</strong>' +
        '</li>';
    }).join('');

    var head = '识别到 <b>' + r.count + '</b> 笔';
    if (exp > 0) head += ' · 支出 <b>¥' + fmt(exp) + '</b>';
    if (inc > 0) head += ' · 收入 <b class="pv-inc">¥' + (isExpenseOnly() ? '—' : fmt(inc)) + '</b>';
    if (trn > 0) head += ' · 转账 <b>¥' + fmt(trn) + '</b>';

    box.classList.add('is-multi');
    box.innerHTML = '<div class="pv-multi">' +
      '<div class="pv-head">' + head + '</div>' +
      '<ul class="pv-list">' + rows + '</ul>' +
      '</div>';
    renderCatPick(r, text);
  }

  function submitEntry() {
    var input = $('#nl-input');
    var rawText = input.value;
    var r = applyOverrides(parseForInput(rawText), rawText);
    if (!r.ok) {
      showToast(r.reason === 'amount' ? '没找到金额，试着说「咖啡25元」' : '先输入一句话再记账');
      input.focus();
      return;
    }

    var base = Date.now();
    var added = r.items.map(function (p, i) {
      var entry = {
        id: uid(),
        date: p.date,
        amount: p.amount,
        item: p.item,
        category: p.category,
        type: p.type,
        // 句子里点名了账户（「微信 奶茶18」）就记到那个账户
        account: (p.accName && accIdByName(p.accName)) || currentAccId,
        raw: r.raw,
        ts: base + i
      };
      if (p.type === 'transfer') {
        // 转出方没写就用当前账户；转入方没写就是「未指定」（钱确实出去了）
        var fromId = p.fromName ? accIdByName(p.fromName) : currentAccId;
        var toId = p.toName ? accIdByName(p.toName) : '';
        // 「从储蓄取出来」没说去处 → 回到当前账户
        if (!toId && p.fromName === P.SAVINGS_NAME) toId = currentAccId;
        entry.account = fromId || currentAccId;
        if (toId === entry.account && toId !== SAVINGS_ID) toId = '';
        entry.toAccount = toId || '';
        if (entry.category === P.TRANSFER_CAT) {
          entry.item = accById(entry.account).name + ' → ' + accById(entry.toAccount || '').name;
        } else if (entry.item.indexOf('当前账户') !== -1) {
          entry.item = entry.item.replace(/当前账户/g, accById(entry.account).name);
        }
      }
      entries.push(entry);
      return entry;
    });
    save();

    input.value = '';
    catPick = null;
    catOverride = { key: '', map: {} };
    updatePreview();

    // 账默认就落在当前选中日，视图保持不动；
    // 只有输入的日期落在别的日子时才跟过去，好让用户看到刚记的那笔
    var curPrefix = viewYear + '-' + pad(viewMonth + 1);
    var allOnSelected = r.items.every(function (p) { return p.date === selectedDate; });
    if (!allOnSelected) {
      var f0 = r.items[0];
      selectedDate = f0.date;
      if (f0.date.slice(0, 7) !== curPrefix) {
        viewYear = parseInt(f0.date.slice(0, 4), 10);
        viewMonth = parseInt(f0.date.slice(5, 7), 10) - 1;
      }
    }
    renderAll();

    var undo = { label: '撤销', onClick: function () { removeByIds(added); } };

    if (added.length === 1) {
      var e0 = added[0];
      // 转账的名字本身就是「A → B」，再叠一个分类就重复了
      var head0 = isTransfer(e0) ? (e0.category === P.TRANSFER_CAT ? '已转账：' : '已存钱：') : '已记账：';
      var what0 = isTransfer(e0) ? esc(e0.item) : esc(e0.category) + ' · ' + esc(e0.item);
      showToast(head0 + what0 + ' <b>¥' + fmt(e0.amount) + '</b>（' + esc(r.items[0].dateLabel) + '）', undo);
      return;
    }

    var exp = 0, inc = 0, trn = 0, daySet = {};
    added.forEach(function (e) {
      daySet[e.date] = 1;
      if (e.type === 'income') inc += e.amount;
      else if (e.type === 'transfer') trn += e.amount;
      else exp += e.amount;
    });
    var msg = '已记 <b>' + added.length + '</b> 笔';
    if (exp > 0) msg += ' · 支出 <b>¥' + fmt(exp) + '</b>';
    if (inc > 0 && !isExpenseOnly()) msg += ' · 收入 <b>¥' + fmt(inc) + '</b>';
    if (trn > 0) msg += ' · 转账 <b>¥' + fmt(trn) + '</b>';
    var days = Object.keys(daySet);
    msg += '（' + (days.length === 1 ? esc(r.items[0].dateLabel) : days.length + ' 天') + '）';
    showToast(msg, undo);
  }

  function removeByIds(list) {
    var ids = {};
    list.forEach(function (e) { ids[e.id] = true; });
    entries = entries.filter(function (e) { return !ids[e.id]; });
    save();
    renderAll();
    showToast('已撤销 <b>' + list.length + '</b> 笔', {
      label: '恢复',
      onClick: function () {
        list.forEach(function (e) { entries.push(e); });
        save();
        renderAll();
        showToast('已恢复 <b>' + list.length + '</b> 笔');
      }
    });
  }

  function removeById(id, silent) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) {
        var removed = entries.splice(i, 1)[0];
        save();
        renderAll();
        if (!silent) {
          showToast('已删除 ' + esc(removed.item) + ' <b>¥' + fmt(removed.amount) + '</b>', {
            label: '撤销',
            onClick: function () {
              entries.push(removed);
              save();
              renderAll();
              showToast('已恢复');
            }
          });
        }
        return;
      }
    }
  }

  /* ---------------- Toast ---------------- */
  function showToast(html, action) {
    var el = $('#toast');
    el.innerHTML = '<span>' + html + '</span>';
    if (action) {
      var btn = document.createElement('button');
      btn.className = 'undo';
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        el.classList.remove('show');
        clearTimeout(toastTimer);
        action.onClick();
      });
      el.appendChild(btn);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, action ? 5200 : 3000);
  }

  /* ---------------- 统计 ---------------- */
  function monthEntries(y, m, src) {
    var prefix = y + '-' + pad(m + 1);
    return (src || entries).filter(function (e) { return e.date.slice(0, 7) === prefix; });
  }

  function sumBy(list, type) {
    var s = 0;
    for (var i = 0; i < list.length; i++) if (list[i].type === type) s += list[i].amount;
    return s;
  }

  function renderStats() {
    var now = new Date();
    var nowStr = ymd(now);
    var dow = (now.getDay() + 6) % 7;
    var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    var weekFrom = ymd(mon), weekTo = ymd(sun);
    // 账户视图下统计也只算这本账
    var src = accScoped(entries);

    var weekTotal = 0;
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (e.type === 'expense' && e.date >= weekFrom && e.date <= weekTo) weekTotal += e.amount;
    }

    var yearTotal = 0;
    for (var j = 0; j < src.length; j++) {
      var e2 = src[j];
      if (e2.type === 'expense' && e2.date.slice(0, 4) === String(viewYear)) yearTotal += e2.amount;
    }

    var list = monthEntries(viewYear, viewMonth, src);
    var expList = list.filter(function (x) { return x.type === 'expense'; });
    var monthTotal = sumBy(list, 'expense');
    var monthInc = sumBy(list, 'income');
    // 存进储蓄的钱和账户互转都不算收支，单独统计一笔，好让人知道钱去哪了
    var saveTotal = 0, transferTotal = 0;
    for (var t1 = 0; t1 < list.length; t1++) {
      if (list[t1].type !== 'transfer') continue;
      if (list[t1].category === '储蓄') saveTotal += list[t1].amount;
      else transferTotal += list[t1].amount;
    }

    var dayTotals = {};
    for (var k = 0; k < expList.length; k++) {
      dayTotals[expList[k].date] = (dayTotals[expList[k].date] || 0) + expList[k].amount;
    }
    var activeDays = Object.keys(dayTotals).length;
    var maxDay = null;
    Object.keys(dayTotals).forEach(function (d) {
      if (!maxDay || dayTotals[d] > maxDay.value) {
        maxDay = { date: d, value: dayTotals[d], label: (parseInt(d.slice(5, 7), 10)) + '月' + (parseInt(d.slice(8, 10), 10)) + '日' };
      }
    });

    var isCur = (viewYear === now.getFullYear() && viewMonth === now.getMonth());

    // 卡片
    $('#stat-week').textContent = '¥' + fmt(weekTotal);
    $('#stat-week-sub').textContent = (mon.getMonth() + 1) + '月' + mon.getDate() + '日 - ' + (sun.getMonth() + 1) + '月' + sun.getDate() + '日';
    $('#stat-month-label').textContent = isCur ? '本月支出' : (viewMonth + 1) + '月支出';
    $('#stat-month').textContent = '¥' + fmt(monthTotal);
    $('#stat-month-sub').innerHTML = esc((accView ? accViewName() + ' · ' : '') + viewYear + '年' + (viewMonth + 1) + '月 · ' + activeDays + ' 天有记账') +
      (saveTotal > 0 ? '<br><span class="nowrap">储蓄 ¥' + fmt(saveTotal) + ' 未计入支出</span>' : '');
    $('#stat-year').textContent = '¥' + fmt(yearTotal);
    $('#stat-year-sub').textContent = viewYear + '年 · ' + src.filter(function (x) { return x.date.slice(0, 4) === String(viewYear); }).length + ' 笔记录';
    // 收入卡：只看支出模式下不遮不藏，直接换成「日均支出」——同一格给支出维度的信息
    var incLab = $('#stat-income-lab'), incVal = $('#stat-income');
    if (isExpenseOnly()) {
      var avgN2 = avgDays(viewYear, viewMonth);
      if (incLab) incLab.textContent = '日均支出';
      incVal.textContent = '¥' + fmt(Math.round(avgN2 ? monthTotal / avgN2 : 0));
      incVal.classList.remove('income');
      $('#stat-income-sub').textContent = avgN2 ? ('按 ' + avgN2 + ' 天算') : '本月暂无支出';
    } else {
      if (incLab) incLab.textContent = '本月收入';
      incVal.textContent = '¥' + fmt(monthInc);
      incVal.classList.add('income');
      $('#stat-income-sub').textContent = monthInc > 0 ? ('结余 ' + fmtSigned(monthInc - monthTotal)) : '本月暂无收入记录';
    }

    // 图表标题
    var chartWho = accView ? accViewName() + ' · ' : '';
    $('#pie-title').textContent = chartWho + (isCur ? '本月' : (viewMonth + 1) + '月') + '消费分类';
    $('#line-title').textContent = chartWho + (isCur ? '本月' : (viewMonth + 1) + '月') + '每日支出';
    $('#pie-note').textContent = expList.length ? ('共 ' + expList.length + ' 笔 · 点色块看明细') : '';
    // 日均按「已过的每一天」算：没记账的那天也占一天
    var avgN = avgDays(viewYear, viewMonth);
    var avgPerDay = avgN ? monthTotal / avgN : 0;
    $('#line-note').textContent = activeDays ? ('日均 ¥' + fmt(Math.round(avgPerDay)) + ' · 点某天可跳转') : '';

    // 分类聚合
    var byCat = {};
    for (var n = 0; n < expList.length; n++) {
      byCat[expList[n].category] = (byCat[expList[n].category] || 0) + expList[n].amount;
    }
    var catData = Object.keys(byCat).map(function (name) {
      return { name: name, value: byCat[name], color: catColor(name) };
    }).sort(function (a, b) { return b.value - a.value; });

    // 每日趋势
    var dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    var lastDay = isCur ? now.getDate() : dim;
    if (lastDay < 1) lastDay = 1;
    var labels = [], values = [];
    for (var d = 1; d <= lastDay; d++) {
      var ds = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(d);
      labels.push(String(d));
      values.push(dayTotals[ds] || 0);
    }

    renderPie(catData, monthTotal);
    renderLine(labels, values, monthTotal, avgPerDay);

    // 供饼图/折线图点击后查明细
    statsCache = {
      expList: expList,
      total: monthTotal,
      y: viewYear,
      m: viewMonth
    };

    // 上月对比
    var lmY = viewMonth === 0 ? viewYear - 1 : viewYear;
    var lmM = viewMonth === 0 ? 11 : viewMonth - 1;
    var lastTotal = sumBy(monthEntries(lmY, lmM, src), 'expense');

    $('#insight').innerHTML = buildInsight(catData, monthTotal, monthInc, lastTotal, activeDays, maxDay, avgN, saveTotal);

    renderBudgetMeter();
    renderAI();
  }

  function buildInsight(catData, total, income, lastTotal, activeDays, maxDay, avgN, saveTotal) {
    var parts = [];
    if (!total) {
      parts.push('这个月还没有支出记录，记上第一笔就能看到小结了。');
    } else {
      var top = catData[0];
      var pct = Math.round(top.value / total * 100);
      parts.push('本月你一共花了 <b>¥' + fmt(total) + '</b>，其中 <b>' + esc(top.name) + '</b> 花得最多，占 <b>' + pct + '%</b>（¥' + fmt(top.value) + '）。');

      if (lastTotal > 0) {
        var diff = total - lastTotal;
        if (Math.abs(diff) < 0.01) {
          parts.push('和上月花得一模一样，消费节奏很稳定。');
        } else if (diff > 0) {
          parts.push('比上月多花了 <b>¥' + fmt(diff) + '</b>，上升 ' + Math.round(diff / lastTotal * 100) + '%。');
        } else {
          parts.push('比上月少花了 <b>¥' + fmt(-diff) + '</b>，下降 ' + Math.round(-diff / lastTotal * 100) + '%。');
        }
      } else {
        parts.push('上月没有支出记录，下个月就能做环比了。');
      }

      var sentence = '本月有 <b>' + activeDays + '</b> 天记了账，按 <b>' + (avgN || activeDays) + '</b> 天算，日均支出 <b>¥' +
        fmt(Math.round(total / (avgN || activeDays))) + '</b>';
      if (maxDay) sentence += '，单日最高是 ' + maxDay.label + ' 的 <b>¥' + fmt(maxDay.value) + '</b>。';
      else sentence += '。';
      parts.push(sentence);
    }
    if (income > 0 && !isExpenseOnly()) {
      parts.push('本月收入 <b>¥' + fmt(income) + '</b>，结余 <b>' + fmtSigned(income - total) + '</b>。');
    }
    if (saveTotal > 0) {
      parts.push('另外存进储蓄 <b>¥' + fmt(saveTotal) + '</b>，这笔不算支出，但也确实从手头账户里挪走了。');
    }
    return parts.map(function (p) { return '<p>' + p + '</p>'; }).join('');
  }

  /* ---------------- 图表 ---------------- */
  // 点饼图某一块 → 列出这一类里的每一笔
  function openCatDetail(cat) {
    var c = statsCache;
    if (!c) return;

    var list = c.expList.filter(function (e) { return e.category === cat; });
    if (!list.length) return;
    list = list.slice().sort(function (a, b) { return b.amount - a.amount; });

    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i].amount;
    var pct = c.total > 0 ? Math.round(sum / c.total * 100) : 0;
    var color = catColor(cat);

    var rows = '';
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var p = e.date.split('-');
      rows += '<button class="pd-row" type="button" data-id="' + esc(e.id) + '">' +
        '<span class="pd-date">' + parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '</span>' +
        '<span class="pd-item">' + esc(e.item) + '</span>' +
        '<span class="pd-acc">' + esc(e.account ? accById(e.account).name : '未指定') + '</span>' +
        '<b class="pd-amt">¥' + fmt(e.amount) + '</b>' +
        '</button>';
    }

    openModal({
      title: cat + ' · 明细',
      sub: (c.m + 1) + '月 · ' + list.length + ' 笔 · 合计 ¥' + fmt(sum) +
        ' · 占本月支出 ' + pct + '%（笔均 ¥' + fmt(sum / list.length) + '）',
      html: '<div class="pd-rule"><i style="width:' + Math.max(pct, 2) + '%;background:' + color + '"></i></div>' +
        '<div class="pd-list">' + rows + '</div>' +
        '<div class="pd-tip">点任意一笔可以改金额、分类或日期</div>',
      readonly: true
    });
  }

  function chartBox(el, msg, cta) {
    if (el.__inst) {
      try { el.__inst.dispose(); } catch (err) { }
      el.__inst = null;
    }
    el.innerHTML = '<div class="chart-empty">' +
      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 2.5L20 7"/></svg>' +
      '<p>' + msg + '</p>' +
      (cta === false ? '' : '<button class="ghost-btn" data-go-record="1">去记一笔</button>') +
      '</div>';
  }

  function chartInstance(el) {
    if (!window.echarts) return null;
    if (el.querySelector('.chart-empty')) el.innerHTML = '';
    var inst = window.echarts.getInstanceByDom(el);
    if (!inst) inst = window.echarts.init(el);
    el.__inst = inst;
    return inst;
  }

  function renderPie(data, total) {
    var el = document.getElementById('pie-chart');
    if (!data.length) { chartBox(el, '这个月还没有支出记录'); return; }
    if (!window.echarts) { el.innerHTML = fallbackBars(data); return; }

    var inst = chartInstance(el);
    if (!inst) return;
    inst.setOption({
      color: data.map(function (d) { return d.color; }),
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(23,26,31,.93)',
        borderWidth: 0,
        padding: [9, 12],
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: function (p) { return p.name + '　¥' + fmt(p.value) + '　' + p.percent + '%'; }
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 13,
        pageIconColor: '#667085',
        pageTextStyle: { color: '#98a2b3' },
        textStyle: { color: '#667085', fontSize: 12 }
      },
      series: [{
        type: 'pie',
        cursor: 'pointer',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 5 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 5,
          itemStyle: { shadowBlur: 16, shadowColor: 'rgba(16,24,40,.2)' }
        },
        data: data.map(function (d) { return { name: d.name, value: d.value }; })
      }]
    }, true);

    inst.off('click');
    inst.on('click', function (p) {
      if (p && p.name) openCatDetail(p.name);
    });
    inst.resize();
  }

  function renderLine(labels, values, total, avgPerDay) {
    var el = document.getElementById('line-chart');
    if (!labels.length || !total) { chartBox(el, '这个月还没有支出记录', false); return; }
    if (!window.echarts) { el.innerHTML = fallbackTrend(values); return; }

    var inst = chartInstance(el);
    if (!inst) return;

    var avg = avgPerDay || 0;

    inst.setOption({
      grid: { left: 6, right: 16, top: 22, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(23,26,31,.93)',
        borderWidth: 0,
        padding: [9, 12],
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: function (params) {
          var p = params[0];
          return (viewMonth + 1) + '月' + p.axisValue + '日　支出 ¥' + fmt(p.value);
        }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: '#e9ebf0' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#98a2b3',
          fontSize: 11,
          interval: Math.max(0, Math.ceil(labels.length / 9) - 1)
        }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#f1f3f7' } },
        axisLabel: {
          color: '#98a2b3',
          fontSize: 11,
          formatter: function (v) { return v >= 1000 ? (v / 1000) + 'k' : v; }
        }
      },
      series: [{
        type: 'line',
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: labels.length <= 8,
        data: values,
        lineStyle: { width: 2.5, color: '#3f5bd9' },
        itemStyle: { color: '#3f5bd9', borderColor: '#fff', borderWidth: 2 },
        areaStyle: {
          color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(63,91,217,.24)' },
            { offset: 1, color: 'rgba(63,91,217,0)' }
          ])
        },
        markLine: avg > 0 ? {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: '#cdd3dd', type: 'dashed', width: 1 },
          data: [{ yAxis: Math.round(avg) }]
        } : undefined
      }]
    }, true);

    // 点折线某一天 → 跳回记账页并选中那天
    inst.off('click');
    inst.on('click', function (p) {
      var d = parseInt(p && p.axisValue, 10);
      if (!d) return;
      jumpToDate(viewYear + '-' + pad(viewMonth + 1) + '-' + pad(d));
    });
    inst.resize();
  }

  function jumpToDate(ds) {
    selectedDate = ds;
    searchQuery = '';
    var si = $('#search-input');
    if (si) si.value = '';
    if (activeTab !== 'record') switchTab('record');
    renderAll();
    var d = new Date(parseInt(ds.slice(0, 4), 10), parseInt(ds.slice(5, 7), 10) - 1, parseInt(ds.slice(8, 10), 10));
    showToast('已跳到 <b>' + (d.getMonth() + 1) + '月' + d.getDate() + '日</b>，可以直接记账');
  }

  function fallbackBars(data) {
    var max = 1;
    for (var i = 0; i < data.length; i++) if (data[i].value > max) max = data[i].value;
    var html = '<div class="fbars">';
    for (var j = 0; j < data.length; j++) {
      var d = data[j];
      html += '<div class="fbar" data-cat="' + esc(d.name) + '"><span class="fname">' + esc(d.name) + '</span>' +
        '<div class="ftrack"><i style="width:' + Math.max(2, d.value / max * 100) + '%;background:' + d.color + '"></i></div>' +
        '<span class="fval">¥' + fmt(d.value) + '</span></div>';
    }
    return html + '</div>';
  }

  function fallbackTrend(values) {
    var max = 1;
    for (var i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
    var html = '<div class="ftrend">';
    for (var j = 0; j < values.length; j++) {
      html += '<div class="ftbar" title="' + (j + 1) + '日 ¥' + fmt(values[j]) + '">' +
        '<i style="height:' + Math.max(1.5, values[j] / max * 100) + '%"></i>' +
        (values.length <= 16 || (j + 1) % 5 === 0 ? '<span>' + (j + 1) + '</span>' : '<span></span>') +
        '</div>';
    }
    return html + '</div>';
  }

  /* ---------------- 渲染入口 ---------------- */
  // 示例句只在完全没有记录时充当引导，有账目后自动让位
  function renderChipLine() {
    var line = $('.chips-line');
    if (line) line.hidden = entries.length > 0;
  }

  function renderAll() {
    // 正在看的账户被删掉了就退回全部账户，免得整页空白
    if (accView && !accById(accView).id) accView = '';
    renderChipLine();
    renderWallet();
    renderAccBar();
    renderTop();
    renderCalendar();
    renderDay();
    if (activeTab === 'stats') renderStats();
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(o) {
    $('#modal-title').textContent = o.title || '';
    var sub = $('#modal-sub');
    if (o.sub) { sub.textContent = o.sub; sub.hidden = false; } else { sub.textContent = ''; sub.hidden = true; }
    $('#modal-body').innerHTML = o.html || '';
    var saveBtn = $('#modal-save');
    saveBtn.textContent = o.saveText || '保存';
    saveBtn.hidden = !!o.readonly;
    $('#modal-cancel').textContent = o.readonly ? '关闭' : '取消';
    modalSave = o.onSave || null;
    $('#modal-mask').hidden = false;
    document.body.classList.add('mask-on');
  }

  function closeModal() {
    $('#modal-mask').hidden = true;
    document.body.classList.remove('mask-on');
    modalSave = null;
  }

  function accRowHtml(a) {
    var val = a.id ? accBalance(a.id).toFixed(2) : '';
    var hid = a.id ? isBalHidden(a.id) : false;
    return '<div class="acc-row" data-id="' + esc(a.id || '') + '">' +
      '<input class="f-inp acc-name" maxlength="10" autocomplete="off" value="' + esc(a.name || '') + '" placeholder="账户名">' +
      '<label class="acc-bal"><span>¥</span>' +
      '<input class="acc-bal-in" type="text" inputmode="decimal" autocomplete="off" value="' + val + '" placeholder="0.00">' +
      '</label>' +
      (a.id ? '<button class="row-eye' + (hid ? ' off' : '') + '" type="button" data-eye="' + esc(a.id) +
        '" title="' + (hid ? '显示这个账户的余额' : '隐藏这个账户的余额') + '">' + (hid ? EYE_OFF_SVG : EYE_SVG) + '</button>' : '') +
      '<button class="row-x" type="button" title="删除这个账户">×</button>' +
      '</div>';
  }

  function tplRowHtml(t) {
    var opts = '';
    for (var i = 0; i < P.CATEGORIES.length; i++) {
      var c = P.CATEGORIES[i];
      opts += '<option value="' + esc(c.name) + '"' + (c.name === t.category ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }
    return '<div class="tpl-row" data-id="' + esc(t.id || '') + '">' +
      '<input class="f-inp tpl-name" maxlength="8" autocomplete="off" value="' + esc(t.name || '') + '" placeholder="名称，如 早饭">' +
      '<select class="f-inp tpl-cat">' + opts + '</select>' +
      '<button class="row-x" type="button" title="删除这个标签">×</button>' +
      '</div>';
  }

  function openAccModal() {
    var html = '';
    for (var i = 0; i < accounts.length; i++) html += accRowHtml(accounts[i]);
    openModal({
      title: '账户与余额',
      sub: '余额 = 期初余额 + 收入 − 支出。直接填你现在各账户里的钱就行，保存后会自动扣掉已记的收支；删除账户时它里面的记录会变成「未指定」。点右侧眼睛可隐藏该账户余额，只影响显示，不影响统计。',
      html: '<div id="acc-rows">' + html + '</div>' +
        '<button class="add-row" type="button" data-add="acc">＋ 添加账户</button>',
      saveText: '保存',
      onSave: saveAccModal
    });
  }

  function saveAccModal() {
    var rows = document.querySelectorAll('#acc-rows .acc-row');
    var kept = [], removed = [], i;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var id = row.getAttribute('data-id');
      var old = id ? accById(id) : null;

      if (row.classList.contains('del')) { if (id) removed.push(id); continue; }

      var name = row.querySelector('.acc-name').value.trim();
      if (!name) { if (old) name = old.name; else continue; }

      var vRaw = String(row.querySelector('.acc-bal-in').value || '').replace(/[^0-9.\-]/g, '');
      var v = parseFloat(vRaw);
      if (!isFinite(v)) v = old ? accBalance(id) : 0;

      kept.push({
        id: old ? id : 'acc_' + uid(),
        name: name.slice(0, 10),
        color: old ? old.color : ACC_COLORS[kept.length % ACC_COLORS.length],
        initial: Math.round((v - (old ? accFlow(id) : 0)) * 100) / 100
      });
    }

    if (!kept.length) { showToast('至少保留一个账户'); return false; }

    accounts = kept;
    var ok = false;
    for (i = 0; i < accounts.length; i++) if (accounts[i].id === currentAccId) ok = true;
    if (!ok) currentAccId = accounts[0].id;

    if (removed.length) {
      for (i = 0; i < entries.length; i++) {
        if (removed.indexOf(entries[i].account) !== -1) entries[i].account = '';
      }
      save();
    }
    saveAccounts();
    renderWallet();
    renderDay();
    showToast('账户已更新');
  }

  function openTplModal() {
    var html = '';
    for (var i = 0; i < tpls.length; i++) html += tplRowHtml(tpls[i]);
    openModal({
      title: '快捷标签',
      sub: '点标签、输金额、回车就记上了。分类决定它归到哪一类，也会跟着进统计。',
      html: '<div id="tpl-rows">' + html + '</div>' +
        '<button class="add-row" type="button" data-add="tpl">＋ 添加标签</button>',
      saveText: '保存',
      onSave: saveTplModal
    });
  }

  function saveTplModal() {
    var rows = document.querySelectorAll('#tpl-rows .tpl-row');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.classList.contains('del')) continue;
      var name = row.querySelector('.tpl-name').value.trim();
      if (!name) continue;
      var id = row.getAttribute('data-id');
      var old = id ? tplById(id) : null;
      out.push({
        id: old ? id : 'q_' + uid(),
        name: name.slice(0, 8),
        category: row.querySelector('.tpl-cat').value,
        last: old ? old.last : 0
      });
    }
    if (!out.length) { showToast('至少保留一个快捷标签'); return false; }
    tpls = out;
    saveTpls();
    if (quickId && !tplById(quickId)) closeQuick();
    renderQuick();
    showToast('快捷标签已更新');
  }

  /* ---------------- 修改单笔 ---------------- */
  function entryById(id) {
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
    return null;
  }

  function catOptions(cur) {
    var opts = '';
    // 「转账」不在常规分类里，只有本身是转账的这笔才补一个选项
    if (cur === P.TRANSFER_CAT) opts += '<option value="' + esc(P.TRANSFER_CAT) + '" selected>转账</option>';
    for (var i = 0; i < P.CATEGORIES.length; i++) {
      var c = P.CATEGORIES[i];
      opts += '<option value="' + esc(c.name) + '"' + (c.name === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }
    return opts;
  }

  function accOptions(cur, withSavings) {
    var opts = '';
    if (withSavings) {
      opts += '<option value="' + SAVINGS_ID + '"' + (cur === SAVINGS_ID ? ' selected' : '') + '>储蓄</option>';
    }
    for (var i = 0; i < accounts.length; i++) {
      opts += '<option value="' + esc(accounts[i].id) + '"' + (accounts[i].id === cur ? ' selected' : '') + '>' + esc(accounts[i].name) + '</option>';
    }
    return (cur ? '' : '<option value="" selected>未指定</option>') + opts;
  }

  /* ---------------- 账目细节（备注） ---------------- */
  function noteDateLabel(date) {
    var p = String(date).split('-');
    return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  }

  // 点明细行里的金额 → 只写这一笔的细节，一屏搞定
  function openNoteModal(id) {
    var e = entryById(id);
    if (!e) return;
    openModal({
      title: '这一笔的细节',
      sub: e.category + ' · ' + e.item + ' · ¥' + fmt(e.amount) + ' · ' + noteDateLabel(e.date),
      html: '<div class="note-form">' +
        '<textarea id="ef-note" class="f-note" rows="3" maxlength="120" ' +
        'placeholder="比如：吃了包子油条，加一杯豆浆">' + esc(e.note || '') + '</textarea>' +
        '<div class="note-tip">回车保存 · Shift + 回车换行</div>' +
        '</div>',
      saveText: e.note ? '保存' : '记下',
      onSave: function () { return saveNoteModal(e); }
    });
    bindNoteKeys();
  }

  function bindNoteKeys() {
    setTimeout(function () {
      var t = $('#ef-note');
      if (!t) return;
      t.focus();
      try { t.setSelectionRange(t.value.length, t.value.length); } catch (err) { }
      t.addEventListener('keydown', function (ev) {
        // 中文输入法选词时的回车不算保存
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
          ev.preventDefault();
          $('#modal-save').click();
        }
      });
    }, 60);
  }

  function cleanNote(v) {
    return String(v || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; })
      .join('\n')
      .slice(0, 120);
  }

  function saveNoteModal(e) {
    var v = cleanNote($('#ef-note').value);
    if (v === (e.note || '')) return;
    e.note = v;
    save();
    renderAll();
    showToast(v ? '细节已记下' : '细节已清空');
  }

  function openEntryModal(id) {
    var e = entryById(id);
    if (!e) return;
    openModal({
      title: '修改这一笔',
      sub: e.raw && e.raw !== e.item ? '原话：' + e.raw : '',
      html: '<div class="edit-form">' +
        '<label class="ef-row"><span>项目</span><input class="f-inp" id="ef-item" maxlength="24" autocomplete="off" value="' + esc(e.item) + '"></label>' +
        '<label class="ef-row"><span>金额</span><span class="ef-money"><i>¥</i>' +
        '<input id="ef-amount" inputmode="decimal" autocomplete="off" value="' + e.amount.toFixed(2) + '"></span></label>' +
        '<label class="ef-row"><span>分类</span><select class="f-inp" id="ef-cat">' + catOptions(e.category) + '</select></label>' +
        '<label class="ef-row"><span>' + (isTransfer(e) ? '转出' : '账户') + '</span><select class="f-inp" id="ef-acc">' + accOptions(e.account || '') + '</select></label>' +
        (isTransfer(e) ? '<label class="ef-row"><span>转入</span><select class="f-inp" id="ef-acc-to">' + accOptions(e.toAccount || '', true) + '</select></label>' : '') +
        '<label class="ef-row"><span>日期</span><input class="f-inp" id="ef-date" type="date" value="' + esc(e.date) + '"></label>' +
        '<label class="ef-row ef-row-top"><span>细节</span><textarea class="f-inp f-note" id="ef-note" rows="2" maxlength="120" placeholder="比如：吃了包子油条">' + esc(e.note || '') + '</textarea></label>' +
        '</div>',
      saveText: '保存修改',
      onSave: function () { return saveEntryModal(e); }
    });
    setTimeout(function () {
      var el = $('#ef-amount');
      if (el) { el.focus(); el.select(); }
    }, 50);
  }

  function saveEntryModal(e) {
    var name = String($('#ef-item').value || '').trim();
    var amt = parseFloat(String($('#ef-amount').value || '').replace(/[^0-9.]/g, ''));
    var date = String($('#ef-date').value || '');
    if (!isFinite(amt) || amt <= 0) { showToast('金额要大于 0'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('日期填完整一下'); return false; }

    var cat = $('#ef-cat').value;
    e.amount = Math.round(amt * 100) / 100;
    e.item = (name || cat).slice(0, 24);
    e.category = cat;
    e.account = $('#ef-acc').value || '';

    // 分类是「转账」或「储蓄」时，这笔仍然是转账，不算支出
    if (cat === P.TRANSFER_CAT || cat === '储蓄') {
      var toSel = $('#ef-acc-to');
      var to = cat === '储蓄' ? SAVINGS_ID : ((toSel && toSel.value) || e.toAccount || '');
      if (!to) { showToast('选一下转到哪个账户'); return false; }
      if (to === e.account) { showToast('转出和转入不能是同一个账户'); return false; }
      e.type = 'transfer';
      e.toAccount = to;
      // 名字本来就是「A → B」的，跟着账户改，别让标题和右侧账户对不上
      if (cat === P.TRANSFER_CAT && String(e.item).indexOf('→') !== -1) {
        e.item = accById(e.account || '').name + ' → ' + accById(to).name;
      }
    } else {
      e.type = cat === '收入' ? 'income' : 'expense';
      delete e.toAccount;
    }

    var noteEl = $('#ef-note');
    if (noteEl) {
      var nv = cleanNote(noteEl.value);
      if (nv) e.note = nv; else delete e.note;
    }

    if (date !== e.date) {
      e.date = date;
      selectedDate = date;
      if (date.slice(0, 7) !== viewYear + '-' + pad(viewMonth + 1)) {
        viewYear = parseInt(date.slice(0, 4), 10);
        viewMonth = parseInt(date.slice(5, 7), 10) - 1;
      }
    }
    save();
    renderAll();
    showToast('已修改：' + esc(e.category) + ' · ' + esc(e.item) + ' <b>¥' + fmt(e.amount) + '</b>');
  }

  /* ---------------- 设置：预算与 AI 接入 ---------------- */
  function openSettings() {
    var html =
      '<div class="set-sec">' +
        '<div class="set-h">月度预算</div>' +
        '<label class="ef-row"><span>每月预算</span>' +
          '<input class="f-inp" id="set-budget" inputmode="decimal" autocomplete="off" value="' +
          (settings.budget > 0 ? settings.budget : '') + '" placeholder="例如 5000，留空表示不设预算">' +
        '</label>' +
        '<p class="set-hint">设好后，余额栏会常驻显示本月已用比例和剩余额度，超支会变红。</p>' +
      '</div>' +
      '<div class="set-sec">' +
        '<div class="set-h">AI 收支分析</div>' +
        '<label class="ef-row"><span>接口地址</span>' +
          '<input class="f-inp" id="set-base" autocomplete="off" spellcheck="false" value="' + esc(settings.apiBase) + '" placeholder="https://api.deepseek.com/v1">' +
        '</label>' +
        '<label class="ef-row"><span>模型</span>' +
          '<input class="f-inp" id="set-model" autocomplete="off" spellcheck="false" value="' + esc(settings.model) + '" placeholder="deepseek-chat">' +
        '</label>' +
        '<label class="ef-row"><span>API Key</span>' +
          '<input class="f-inp" id="set-key" type="password" autocomplete="off" spellcheck="false" value="' + esc(settings.apiKey) + '" placeholder="sk-...">' +
        '</label>' +
        '<label class="set-check"><input type="checkbox" id="set-detail"' + (settings.sendDetail ? ' checked' : '') + '>' +
          '<span>连同每笔的项目名和备注一起发送（分析更具体）</span></label>' +
        '<div class="set-test-row">' +
          '<button class="ghost-btn" id="set-test" type="button">测试连接</button>' +
          '<span class="set-test-msg" id="set-test-msg"></span>' +
        '</div>' +
        '<p class="set-hint">兼容 OpenAI 格式的接口都行（DeepSeek、Kimi、智谱、通义、本机 Ollama）。填到 <code>/v1</code> 这一层就行，程序会自动补全路径。Key 只存在这台设备的浏览器里，不会发到别处。</p>' +
      '</div>';

    openModal({
      title: '设置',
      sub: '预算与 AI 分析。改完点保存即生效。',
      html: html,
      saveText: '保存',
      onSave: saveSettingsModal
    });

    $('#set-test').addEventListener('click', function () { testConnection(this); });
  }

  function saveSettingsModal() {
    var b = parseFloat(String($('#set-budget').value || '').replace(/[^0-9.]/g, ''));
    settings.budget = (isFinite(b) && b > 0) ? Math.round(b * 100) / 100 : 0;

    var base = String($('#set-base').value || '').trim().replace(/\/+$/, '');
    settings.apiBase = base || 'https://api.deepseek.com/v1';
    settings.model = String($('#set-model').value || '').trim() || 'deepseek-chat';
    settings.apiKey = String($('#set-key').value || '').trim();
    settings.sendDetail = !!$('#set-detail').checked;

    saveSettings();
    renderBudgetMeter();
    renderAI();
    showToast('设置已保存');
  }

  // 把用户填的地址补成完整的 chat/completions 端点
  function aiEndpoint() {
    var b = String(settings.apiBase || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (/\/chat\/completions$/.test(b)) return b;
    if (/\/v\d+[a-z]*$/i.test(b)) return b + '/chat/completions';
    if (/^https?:\/\/[^/]+$/i.test(b)) return b + '/v1/chat/completions';
    return b + '/chat/completions';
  }

  function aiHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + settings.apiKey
    };
  }

  function aiErrorText(status, body) {
    var detail = '';
    try {
      var j = JSON.parse(body);
      detail = (j.error && (j.error.message || j.error.type)) || j.message || '';
    } catch (err) {
      detail = String(body || '').slice(0, 120);
    }
    if (status === 401 || status === 403) return 'API Key 无效或没有权限（' + status + '）' + (detail ? '：' + detail : '');
    if (status === 404) return '接口地址不对（404），检查路径是否缺了 /v1';
    if (status === 429) return '请求太频繁或额度已用尽（429）';
    if (status >= 500) return '接口服务出错（' + status + '）' + (detail ? '：' + detail : '');
    return '请求失败（' + status + '）' + (detail ? '：' + detail : '');
  }

  function testConnection(btn) {
    var msg = $('#set-test-msg');
    var key = String($('#set-key').value || '').trim();
    if (!key) { msg.textContent = '先填 API Key'; msg.className = 'set-test-msg bad'; return; }

    // 用弹窗里当前填的值试，不必先保存
    var savedBase = settings.apiBase, savedKey = settings.apiKey, savedModel = settings.model;
    settings.apiBase = String($('#set-base').value || '').trim() || savedBase;
    settings.apiKey = key;
    settings.model = String($('#set-model').value || '').trim() || savedModel;

    btn.disabled = true;
    msg.textContent = '连接中…';
    msg.className = 'set-test-msg';

    fetch(aiEndpoint(), {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: '回复两个字：可用' }],
        max_tokens: 8,
        stream: false
      })
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) throw new Error(aiErrorText(res.status, t));
        var j = JSON.parse(t);
        var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        msg.textContent = '连接正常 · ' + (c ? c.trim().slice(0, 12) : '已返回结果');
        msg.className = 'set-test-msg good';
      });
    }).catch(function (err) {
      msg.textContent = (err && err.message) ? err.message : '连接失败，检查网络或该接口是否允许浏览器直接调用';
      msg.className = 'set-test-msg bad';
    }).then(function () {
      btn.disabled = false;
      settings.apiBase = savedBase;
      settings.apiKey = savedKey;
      settings.model = savedModel;
    });
  }

  /* ---------------- AI 收支分析 ---------------- */
  function aiMonthStats(y, m) {
    var list = monthEntries(y, m);
    var exp = list.filter(function (x) { return x.type === 'expense'; });
    var inc = list.filter(function (x) { return x.type === 'income'; });
    var expTotal = sumBy(list, 'expense');
    var incTotal = sumBy(list, 'income');

    // 储蓄与账户互转都不算收支，但要告诉模型，否则它会以为钱凭空消失了
    var saveTotal = 0, moveTotal = 0;
    for (var ti = 0; ti < list.length; ti++) {
      if (list[ti].type !== 'transfer') continue;
      if (list[ti].category === '储蓄') saveTotal += list[ti].amount;
      else moveTotal += list[ti].amount;
    }

    var byCat = {}, byAcc = {}, byDay = {};
    for (var i = 0; i < exp.length; i++) {
      var e = exp[i];
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      var acc = e.account ? accById(e.account).name : '未指定';
      byAcc[acc] = (byAcc[acc] || 0) + e.amount;
      byDay[e.date] = (byDay[e.date] || 0) + e.amount;
    }

    var cats = Object.keys(byCat).map(function (k) {
      return {
        name: k,
        amount: Math.round(byCat[k] * 100) / 100,
        pct: expTotal ? Math.round(byCat[k] / expTotal * 100) : 0,
        count: exp.filter(function (x) { return x.category === k; }).length
      };
    }).sort(function (a, b) { return b.amount - a.amount; });

    var accs = Object.keys(byAcc).map(function (k) {
      return { name: k, amount: Math.round(byAcc[k] * 100) / 100 };
    }).sort(function (a, b) { return b.amount - a.amount; });

    var days = Object.keys(byDay).length;
    var maxDay = null;
    Object.keys(byDay).forEach(function (d) {
      if (!maxDay || byDay[d] > maxDay.amount) maxDay = { date: d, amount: Math.round(byDay[d] * 100) / 100 };
    });

    var top = exp.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 8).map(function (e) {
      var o = { date: e.date, item: e.item, category: e.category, amount: e.amount };
      if (settings.sendDetail && e.note) o.note = e.note;
      return o;
    });

    // 上月对比
    var pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y;
    var prevExp = sumBy(monthEntries(py, pm), 'expense');

    // 日均口径与日历一致：本月算到今天，过去的月份按整月
    var avgD = avgDays(y, m);

    // 近半年趋势
    var trend = [];
    for (var k = 5; k >= 0; k--) {
      var d2 = new Date(y, m - k, 1);
      trend.push({
        month: (d2.getMonth() + 1) + '月',
        expense: Math.round(sumBy(monthEntries(d2.getFullYear(), d2.getMonth()), 'expense') * 100) / 100
      });
    }

    return {
      period: y + '-' + pad(m + 1),
      expense: Math.round(expTotal * 100) / 100,
      income: Math.round(incTotal * 100) / 100,
      savings: Math.round(saveTotal * 100) / 100,
      transfers: Math.round(moveTotal * 100) / 100,
      balance: Math.round((incTotal - expTotal) * 100) / 100,
      count: exp.length,
      activeDays: days,
      daysCovered: avgD,
      avgPerDay: avgD ? Math.round(expTotal / avgD * 100) / 100 : 0,
      avgPerActiveDay: days ? Math.round(expTotal / days * 100) / 100 : 0,
      maxDay: maxDay,
      categories: cats,
      accounts: accs,
      topExpenses: top,
      prevMonthExpense: Math.round(prevExp * 100) / 100,
      momChange: prevExp > 0 ? Math.round((expTotal - prevExp) / prevExp * 1000) / 10 : null,
      trend: trend
    };
  }

  function aiMessages(stats) {
    var sys = '你是一位务实、克制的个人财务顾问。你看到的是中文记账 App 导出的月度汇总（JSON）。' +
      '请只基于给定数字分析，绝不编造不存在的数据；不写客套话，不重复罗列全部数字。' +
      '注意：expense 已排除存进储蓄的钱，savings 是当月存入储蓄的金额，transfers 是账户之间互转，' +
      '两者都不算支出也不算收入，分析时别把它们并进支出里。';

    var user = '这是我 ' + stats.period + ' 的账本数据：\n' + JSON.stringify(stats) + '\n\n' +
      '请输出四部分，用 Markdown 小标题：\n' +
      '### 一句话结论\n' +
      '### 结构分析\n（占比最高或明显偏高的类别，结合数字说明；与上月对比）\n' +
      '### 值得注意\n（大额单笔、环比突变、同类别高频小额等，最多 3 条）\n' +
      '### 三条建议\n（必须具体、可执行，贴合这份数据，不要"少喝奶茶"这类空话）\n\n' +
      '要求：简体中文，400 字以内，语气像熟人给建议。';

    return [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];
  }

  function aiCacheAll() {
    try {
      var o = JSON.parse(localStorage.getItem(AI_CACHE_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (err) { return {}; }
  }

  function aiCacheGet(stats) {
    var c = aiCacheAll()[stats.period];
    if (!c || !c.text) return null;
    // 数据变了就不再复用，避免给出过时的分析
    if (c.sig !== aiSig(stats)) return null;
    return c;
  }

  function aiSig(stats) {
    return [stats.expense, stats.income, stats.savings, stats.transfers, stats.count, stats.activeDays].join('/');
  }

  function aiCacheSet(stats, text) {
    var all = aiCacheAll();
    all[stats.period] = { text: text, sig: aiSig(stats), at: Date.now() };
    var keys = Object.keys(all);
    if (keys.length > 8) {
      keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
      while (keys.length > 8) delete all[keys.shift()];
    }
    try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(all)); } catch (err) { }
  }

  // 极简 Markdown：标题 / 列表 / 粗体 / 行内代码，够用且不会被注入
  function inlineMd(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function miniMd(src) {
    var lines = String(src || '').split('\n');
    var out = [], list = null;
    function flush() { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '').trim();
      if (!line) { flush(); continue; }
      var h = line.match(/^#{1,6}\s*(.+)$/);
      if (h) { flush(); out.push('<h4>' + inlineMd(h[1]) + '</h4>'); continue; }
      var li = line.match(/^[-*•]\s+(.+)$/);
      if (li) { if (!list) list = []; list.push('<li>' + inlineMd(li[1]) + '</li>'); continue; }
      var ol = line.match(/^(\d+)[.、)]\s*(.+)$/);
      if (ol) { if (!list) list = []; list.push('<li><i>' + ol[1] + '.</i> ' + inlineMd(ol[2]) + '</li>'); continue; }
      flush();
      out.push('<p>' + inlineMd(line) + '</p>');
    }
    flush();
    return out.join('');
  }

  function renderAI() {
    var badge = $('#ai-badge'), body = $('#ai-body'), run = $('#ai-run');
    if (!badge || !body || !run) return;

    $('.ai-card').classList.toggle('has-ai', hasAI());

    var cfgBtn = $('#ai-settings');
    if (cfgBtn) cfgBtn.hidden = !hasAI();

    if (!hasAI()) {
      badge.textContent = '未配置';
      badge.className = 'ai-badge';
      run.textContent = '去设置';
      body.innerHTML = '<p class="ai-empty">配置一次大模型接口，就能让 AI 读懂你的账本：支出结构、异常项、还能省下哪些钱。</p>';
      return;
    }

    badge.textContent = settings.model;
    badge.className = 'ai-badge on';
    if (!aiBusy) run.textContent = '生成分析';

    var stats = aiMonthStats(viewYear, viewMonth);
    var hit = aiCacheGet(stats);

    if (aiBusy) return;

    if (hit) {
      body.innerHTML = '<div class="ai-render">' + miniMd(hit.text) + '</div>' +
        '<div class="ai-foot"><span>' + timeAgo(hit.at) + ' 生成 · ' + settings.model + '</span>' +
        '<button class="ai-redo" type="button" data-ai-redo>重新生成</button></div>';
    } else {
      body.innerHTML = '<p class="ai-empty">点「生成分析」，AI 会读完' +
        (viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth() ? '本月' : (viewMonth + 1) + '月') +
        '的 ' + stats.count + ' 笔支出，给出结构分析和省钱建议。' +
        (stats.count === 0 ? '（这个月还没有支出记录）' : '') + '</p>';
    }
  }

  function timeAgo(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  function aiSetBusy(on) {
    aiBusy = on;
    var run = $('#ai-run');
    var card = $('.ai-card');
    if (run) run.textContent = on ? '停止' : '生成分析';
    if (card) card.classList.toggle('is-loading', on);
  }

  function aiFail(msg) {
    var body = $('#ai-body');
    if (body) {
      body.innerHTML = '<div class="ai-error"><b>分析失败</b><p>' + esc(msg) + '</p>' +
        '<button class="ghost-btn" type="button" data-ai-settings>检查设置</button></div>';
    }
    showToast('AI 分析失败，请检查设置');
  }

  function runAI() {
    if (aiBusy) { if (aiAbort) aiAbort.abort(); return; }
    if (!hasAI()) { openSettings(); return; }

    var stats = aiMonthStats(viewYear, viewMonth);
    if (stats.count === 0) { showToast('这个月还没有支出记录'); return; }

    var body = $('#ai-body');
    body.innerHTML = '<div class="ai-render" id="ai-live"></div>';
    var live = $('#ai-live');
    aiSetBusy(true);

    var text = '';
    var lastPaint = 0;
    aiAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    function paint(force) {
      var now = Date.now();
      if (!force && now - lastPaint < 90) return;
      lastPaint = now;
      live.innerHTML = miniMd(text) + '<i class="ai-caret"></i>';
      body.scrollTop = body.scrollHeight;
    }

    var ctrl = aiAbort;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);

    fetch(aiEndpoint(), {
      method: 'POST',
      headers: aiHeaders(),
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({
        model: settings.model,
        messages: aiMessages(stats),
        temperature: 0.6,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error(aiErrorText(res.status, t)); });
      }
      // 不支持流式（或返回整包）时直接取 JSON
      if (!res.body || typeof res.body.getReader !== 'function') {
        return res.json().then(function (j) {
          var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          text = c || '';
          paint(true);
        });
      }

      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';

      function handle(line) {
        var s = line.trim();
        if (!s || s.indexOf('data:') !== 0) return;
        var d = s.slice(5).trim();
        if (!d || d === '[DONE]') return;
        try {
          var j = JSON.parse(d);
          var ch = j.choices && j.choices[0];
          var piece = (ch.delta && ch.delta.content) || (ch.message && ch.message.content) || '';
          if (piece) { text += piece; paint(false); }
        } catch (err) { }
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { paint(true); return; }
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          for (var i = 0; i < parts.length; i++) handle(parts[i]);
          return pump();
        });
      }
      return pump();
    }).then(function () {
      clearTimeout(timeout);
      aiSetBusy(false);
      aiAbort = null;

      if (!text.trim()) { aiFail('接口没有返回内容，可能是模型名写错或额度不足'); return; }

      aiCacheSet(stats, text);
      renderAI();
    }).catch(function (err) {
      clearTimeout(timeout);
      aiSetBusy(false);
      aiAbort = null;

      if (err && err.name === 'AbortError') {
        if (text.trim()) { aiCacheSet(stats, text); renderAI(); showToast('已停止生成'); }
        else showToast('已取消');
        return;
      }
      var m = (err && err.message) ? err.message : '网络异常';
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
        m = '连不上接口。可能是网络问题，或该接口不允许浏览器直接调用（CORS）。';
      }
      aiFail(m);
    });
  }

  /* ---------------- 全量备份 ---------------- */
  function backupJson() {
    if (!entries.length) { showToast('还没有数据可以备份'); return; }
    var data = {
      app: 'shoujizhang',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: entries,
      accounts: accounts,
      currentAcc: currentAccId,
      tpls: tpls
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = '随手记备份_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('已备份 <b>' + entries.length + '</b> 条记录（含账户与标签）');
  }

  /* 内容指纹：同日、同类型、同金额、同项目、同账户 → 视为同一笔可疑记录 */
  function entrySig(e) {
    return [e.date, e.type, e.amount, e.item, e.account].join('|');
  }

  function sortEntries() {
    entries.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
  }

  /* 合并导入：只补充新记录，绝不删除已有数据 */
  function restoreJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result || '')); } catch (err) { showToast('这个文件不是有效的备份'); return; }
      if (!data || !Array.isArray(data.entries)) { showToast('备份文件格式不对'); return; }

      var incoming = data.entries.filter(function (e) {
        return e && typeof e.date === 'string' && typeof e.amount === 'number' && isFinite(e.amount);
      }).map(function (e) {
        return {
          id: e.id || uid(),
          date: e.date,
          amount: e.amount,
          item: e.item || '支出',
          category: e.category || '其他',
          type: (e.type === 'income' || e.type === 'transfer') ? e.type : 'expense',
          account: typeof e.account === 'string' ? e.account : '',
          toAccount: typeof e.toAccount === 'string' ? e.toAccount : '',
          raw: e.raw || '',
          note: typeof e.note === 'string' ? e.note.slice(0, 120) : '',
          ts: typeof e.ts === 'number' ? e.ts : Date.now()
        };
      });
      if (!incoming.length) { showToast('这个备份里没有可导入的记录'); return; }

      // 给现有数据建索引：id / 内容+时间戳（完全相同）/ 内容（疑似同一笔）
      var ids = {}, sigTs = {}, sigs = {};
      entries.forEach(function (e) {
        ids[e.id] = 1;
        sigTs[entrySig(e) + '|' + e.ts] = 1;
        sigs[entrySig(e)] = 1;
      });

      var fresh = [], suspects = [], dupCount = 0;
      incoming.forEach(function (e) {
        var sig = entrySig(e);
        if (ids[e.id] || sigTs[sig + '|' + e.ts]) { dupCount++; return; }
        ids[e.id] = 1;
        sigTs[sig + '|' + e.ts] = 1;
        if (sigs[sig]) suspects.push(e); else fresh.push(e);
      });

      var msg = '备份里有 ' + incoming.length + ' 条记录，当前已有 ' + entries.length + ' 条。\n\n'
        + '将补充 ' + fresh.length + ' 条新记录'
        + (dupCount ? '，跳过 ' + dupCount + ' 条完全重复的' : '')
        + '。\n不会删除或覆盖任何现有数据。\n\n继续导入吗？';
      if (!confirm(msg)) return;

      var added = fresh.slice();
      var skipSus = 0;
      if (suspects.length) {
        // 只看日期/项目/金额，可能是同一笔的重复记账 —— 交给用户定
        var skipSusp = confirm('另有 ' + suspects.length + ' 条与现有记录「同日期、同项目、同金额」，'
          + '但时间戳不同，可能你已经记过同一笔了。\n\n'
          + '【确定】跳过这些，只导入明确的 ' + fresh.length + ' 条（推荐）\n'
          + '【取消】连这些一起导入，共 ' + (fresh.length + suspects.length) + ' 条');
        if (skipSusp) skipSus = suspects.length;
        else added = added.concat(suspects);
      }

      // id 撞车但内容不同 → 换一个 id，避免两条记录互相覆盖
      added.forEach(function (e) {
        while (ids[e.id]) e.id = uid();
        ids[e.id] = 1;
      });

      if (added.length) {
        entries = entries.concat(added);
        sortEntries();
        save();
      }

      // 账户：只补缺，不动现有的名称、初始余额
      if (Array.isArray(data.accounts) && data.accounts.length) {
        var accIds = {}, addedAcc = 0;
        accounts.forEach(function (a) { accIds[a.id] = 1; });
        data.accounts.forEach(function (a) {
          if (!a || !a.id || !a.name || accIds[String(a.id)]) return;
          accounts.push({
            id: String(a.id),
            name: String(a.name).slice(0, 10),
            initial: isFinite(a.initial) ? Number(a.initial) : 0,
            color: a.color || ACC_COLORS[accounts.length % ACC_COLORS.length]
          });
          accIds[String(a.id)] = 1;
          addedAcc++;
        });
        if (addedAcc) saveAccounts();
      }

      // 快捷标签：只补缺，保留本地已有的金额记忆
      if (Array.isArray(data.tpls) && data.tpls.length) {
        var tplIds = {}, addedTpl = 0;
        tpls.forEach(function (t) { tplIds[t.id] = 1; });
        data.tpls.forEach(function (t, i) {
          if (!t || !t.name) return;
          var tid = String(t.id || ('q_' + i));
          if (tplIds[tid]) return;
          tpls.push({ id: tid, name: String(t.name).slice(0, 8), category: t.category || '其他', last: isFinite(t.last) ? Number(t.last) : 0 });
          tplIds[tid] = 1;
          addedTpl++;
        });
        if (addedTpl) { saveTpls(); closeQuick(); renderQuick(); }
      }

      // 跳到最新一条导入记录所在的月份，方便马上核对
      var latest = '';
      added.forEach(function (e) { if (e.date > latest) latest = e.date; });
      if (latest) {
        var lp = latest.split('-');
        viewYear = parseInt(lp[0], 10);
        viewMonth = parseInt(lp[1], 10) - 1;
        selectedDate = latest;
      }
      renderAll();

      if (!added.length) {
        showToast(dupCount || skipSus ? '没有新增记录，备份里的都已存在' : '这个备份没有可导入的内容');
        return;
      }
      var tip = '已补充 <b>' + added.length + '</b> 条记录';
      if (dupCount) tip += '，跳过重复 ' + dupCount + ' 条';
      if (skipSus) tip += '，跳过疑似重复 ' + skipSus + ' 条';
      showToast(tip);
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 交互 ---------------- */
  function switchTab(name) {
    activeTab = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    var nav = document.querySelector('.tabs');
    if (nav) nav.setAttribute('data-active', name);
    document.getElementById('view-record').classList.toggle('hidden', name !== 'record');
    document.getElementById('view-stats').classList.toggle('hidden', name !== 'stats');
    if (name === 'stats') {
      requestAnimationFrame(function () { renderStats(); });
    }
  }

  function changeMonth(delta) {
    var d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    var now = new Date();
    if (viewYear === now.getFullYear() && viewMonth === now.getMonth()) {
      selectedDate = ymd(now);
    } else {
      // 切到别的月份时别死板地停在 1 号：优先停在那个月最后一条有记账的日子
      var prefix = viewYear + '-' + pad(viewMonth + 1);
      var last = '';
      for (var i = 0; i < entries.length; i++) {
        var ds = entries[i].date;
        if (ds.slice(0, 7) === prefix && ds > last) last = ds;
      }
      selectedDate = last || (prefix + '-01');
    }
    renderAll();
  }

  function goToday() {
    var now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    selectedDate = ymd(now);
    renderAll();
  }

  function exportCsv() {
    var list = monthEntries(viewYear, viewMonth).slice();
    if (!list.length) { showToast('这个月还没有记录可以导出'); return; }
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts; });

    var rows = [['日期', '类型', '分类', '项目', '账户', '转入账户', '金额', '细节']];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var kind = e.type === 'income' ? '收入' : (e.type === 'transfer' ? '转账' : '支出');
      rows.push([e.date, kind, e.category, e.item,
        e.account ? accById(e.account).name : '未指定',
        isTransfer(e) ? accById(e.toAccount || '').name : '',
        e.amount.toFixed(2), e.note || '']);
    }
    var csv = '\ufeff' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '账单_' + viewYear + '年' + (viewMonth + 1) + '月.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('已导出 ' + list.length + ' 条记录');
  }

  function seedDemo() {
    if (entries.length && !confirm('示例数据会追加到现有记录中，继续吗？')) return;

    var plan = [
      [0, '餐饮', '午饭', 32], [0, '交通', '地铁', 6],
      [1, '餐饮', '咖啡', 25], [1, '购物', 'T恤', 129], [1, '收入', '红包', 200],
      [2, '餐饮', '奶茶', 18], [2, '交通', '打车', 35],
      [3, '日用', '超市', 86], [3, '餐饮', '早饭', 12],
      [4, '娱乐', '电影', 45], [5, '餐饮', '火锅', 168],
      [6, '交通', '公交', 2], [6, '餐饮', '外卖', 29],
      [8, '学习', '书', 59], [9, '医疗', '药', 38],
      [10, '通讯', '话费', 50], [11, '收入', '工资', 8000],
      [12, '购物', '运动鞋', 299], [13, '餐饮', '咖啡', 25],
      [15, '居住', '水电费', 120], [17, '餐饮', '晚饭', 68],
      [19, '娱乐', '健身月卡', 199], [21, '交通', '打车', 41],
      [23, '餐饮', '奶茶', 16], [26, '日用', '纸巾', 39],
      [28, '餐饮', '聚餐', 210], [31, '购物', '外套', 399],
      [34, '交通', '加油', 300], [38, '餐饮', '蛋糕', 158],
      [45, '娱乐', '演出门票', 280], [52, '收入', '奖金', 500],
      [2, '储蓄', '存钱', 1000], [9, '储蓄', '存定期', 3000]
    ];

    var base = new Date();
    base.setHours(12, 0, 0, 0);

    // 示例数据顺便给账户一点期初余额，好让余额栏看得出效果（仅在全是 0 时）
    var allZero = true;
    for (var z = 0; z < accounts.length; z++) if (accounts[z].initial) allZero = false;
    if (allZero) {
      var seedInit = [5200, 3800, 18000, 1600];
      for (var s = 0; s < accounts.length; s++) accounts[s].initial = seedInit[s % seedInit.length];
      saveAccounts();
    }

    for (var i = 0; i < plan.length; i++) {
      var p = plan[i];
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - p[0]);
      var row = {
        id: uid(),
        date: ymd(d),
        amount: p[3],
        item: p[2],
        category: p[1],
        type: p[1] === '收入' ? 'income' : (p[1] === '储蓄' ? 'transfer' : 'expense'),
        account: accounts[i % accounts.length].id,
        raw: '示例数据',
        ts: d.getTime() + (8 + (i * 3) % 12) * 3600000 + (i * 7) % 60 * 60000
      };
      if (row.type === 'transfer') row.toAccount = SAVINGS_ID;
      entries.push(row);
    }
    save();
    goToday();
    showToast('已载入 ' + plan.length + ' 条示例数据');
  }

  function clearAll() {
    if (!entries.length) { showToast('现在还没有任何数据'); return; }
    if (!confirm('确定要清空全部记账数据吗？此操作不可撤销。')) return;
    entries = [];
    save();
    renderAll();
    showToast('已清空全部数据');
  }

  function onModalBodyClick(e) {
    // 分类明细里点某一笔 → 直接进编辑
    var pd = e.target.closest('.pd-row[data-id]');
    if (pd) {
      var pid = pd.getAttribute('data-id');
      closeModal();
      openEntryModal(pid);
      return;
    }

    var x = e.target.closest('.row-x');
    if (x) {
      var row = x.closest('.acc-row, .tpl-row');
      if (!row) return;
      if (row.classList.contains('is-new') && !row.getAttribute('data-id')) {
        row.parentNode.removeChild(row);
        return;
      }
      var del = !row.classList.contains('del');
      row.classList.toggle('del', del);
      var fields = row.querySelectorAll('input, select');
      for (var i = 0; i < fields.length; i++) fields[i].disabled = del;
      return;
    }

    var add = e.target.closest('.add-row');
    if (!add) return;
    var kind = add.getAttribute('data-add');
    var wrap = document.createElement('div');

    if (kind === 'acc') {
      wrap.innerHTML = accRowHtml({ id: '', name: '', initial: 0 });
      var r1 = wrap.firstChild;
      r1.classList.add('is-new');
      $('#acc-rows').appendChild(r1);
      r1.querySelector('.acc-name').focus();
    } else {
      wrap.innerHTML = tplRowHtml({ id: '', name: '', category: '餐饮' });
      var r2 = wrap.firstChild;
      r2.classList.add('is-new');
      $('#tpl-rows').appendChild(r2);
      r2.querySelector('.tpl-name').focus();
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    var input = $('#nl-input');

    input.addEventListener('input', updatePreview);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) submitEntry();
    });
    $('#add-btn').addEventListener('click', submitEntry);

    // 点预览里的分类标签 → 展开分类选择器；选完即时生效（不等入账）
    $('#preview').addEventListener('mousedown', function (e) {
      if (e.target.closest('.cat-tag-btn')) e.preventDefault();  // 别把输入框的焦点抢走
    });
    $('#cat-pick').addEventListener('mousedown', function (e) {
      if (e.target.closest('.cp-chip')) e.preventDefault();
    });
    $('#preview').addEventListener('click', function (e) {
      var tag = e.target.closest('.cat-tag-btn');
      if (!tag) return;
      e.preventDefault();
      toggleCatPick(parseInt(tag.getAttribute('data-cat-idx'), 10) || 0);
    });

    $('#cat-pick').addEventListener('click', function (e) {
      var chip = e.target.closest('.cp-chip');
      if (!chip) return;
      chooseCat(chip.getAttribute('data-cat') || '');
    });

    // 点别处收起选择器（点输入框不算）
    document.addEventListener('click', function (e) {
      if (!catPick) return;
      if (e.target.closest('#cat-pick') || e.target.closest('.cat-tag-btn') || e.target.closest('#nl-input')) return;
      catPick = null;
      renderCatPick(null);
    });

    // 键盘：Esc 收起选择器
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && catPick) {
        e.stopPropagation();
        catPick = null;
        renderCatPick(null);
      }
    }, true);

    $('#prev-month').addEventListener('click', function () { changeMonth(-1); });
    $('#next-month').addEventListener('click', function () { changeMonth(1); });
    $('#today-btn').addEventListener('click', goToday);

    $('#calendar').addEventListener('click', function (e) {
      var btn = e.target.closest('.day[data-date]');
      if (!btn) return;
      selectedDate = btn.getAttribute('data-date');
      // 点日历就当退出搜索，回到那天的明细
      if (searchQuery) {
        searchQuery = '';
        if ($('#search-input')) $('#search-input').value = '';
      }
      renderCalendar();
      renderDay();
    });

    // 搜索
    var searchInput = $('#search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchQuery = searchInput.value.trim();
        $('#search-clear').hidden = !searchInput.value;
        if (searchQuery) renderSearch();
        else clearSearch();
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          searchInput.value = '';
          clearSearch();
        }
      });
      $('#search-clear').addEventListener('click', function () {
        searchInput.value = '';
        clearSearch();
        searchInput.focus();
      });
    }

    // 键盘快捷键：← → 切月，T 回今天，/ 定位搜索，G 切换记账/统计
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!$('#modal-mask').hidden) return;

      var t = e.target;
      var tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;

      if (e.key === 'ArrowLeft') { e.preventDefault(); changeMonth(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); changeMonth(1); }
      else if (e.key === 't' || e.key === 'T') { goToday(); }
      else if (e.key === '/') {
        e.preventDefault();
        switchTab('record');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
      } else if (e.key === 'g' || e.key === 'G') {
        switchTab(activeTab === 'record' ? 'stats' : 'record');
      }
    });

    // ECharts 不可用时，降级条形图也能点开分类明细
    $('#pie-chart').addEventListener('click', function (e) {
      var b = e.target.closest('.fbar[data-cat]');
      if (b) openCatDetail(b.getAttribute('data-cat'));
    });

    // 账户视图提示条上的「看全部账户」
    var accBar = $('#acc-bar');
    if (accBar) accBar.addEventListener('click', function (e) {
      if (e.target.closest('[data-acc-all]')) clearAccView();
    });

    // 储蓄那一格也能点开看它的账；点眼睛只切显示，不进视图
    var saveTile = $('#wallet-save');
    if (saveTile) saveTile.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-eye]')) return;
      if (!saveTile.hidden) viewAcc(SAVINGS_ID);
    });

    $('#day-list').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) { removeById(del.getAttribute('data-del')); return; }
      var row = e.target.closest('.entry[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id');
      // 点金额 → 只补这一笔的细节；点别处 → 改整笔
      if (e.target.closest('.entry-amt')) { openNoteModal(id); return; }
      openEntryModal(id);
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    $('#export-btn').addEventListener('click', exportCsv);

    // 「更多」菜单：备份 / 恢复 / 示例 / 清空
    var moreBtn = $('#more-btn'), moreMenu = $('#more-menu');
    function closeMore() {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    }
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = moreMenu.hidden;
      if (willOpen) syncModeItem();
      moreMenu.hidden = !willOpen;
      moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!moreMenu.hidden && !e.target.closest('.more-wrap')) closeMore();
    });
    moreMenu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      closeMore();
      if (act === 'settings') openSettings();
      else if (act === 'mode') toggleMode();
      else if (act === 'backup') backupJson();
      else if (act === 'restore') $('#restore-file').click();
      else if (act === 'seed') seedDemo();
      else if (act === 'clear') clearAll();
    });
    $('#restore-file').addEventListener('change', function () {
      if (this.files && this.files[0]) restoreJson(this.files[0]);
      this.value = '';
    });

    // 账户与余额
    $('#wallet-list').addEventListener('click', function (e) {
      var b = e.target.closest('.w-item');
      if (!b) return;
      var id = b.getAttribute('data-acc');
      if (id) { viewAcc(id); return; }

      // 「未指定」：早期没记账户的老账，一键归到当前账户
      var n = 0, i;
      for (i = 0; i < entries.length; i++) if (!entries[i].account) n++;
      if (!n) return;
      var target = accById(currentAccId);
      if (!confirm('有 ' + n + ' 条记录还没有归属账户（早期记的账）。\n要把它们全部归到「' + target.name + '」吗？')) return;
      for (i = 0; i < entries.length; i++) if (!entries[i].account) entries[i].account = currentAccId;
      save();
      renderAll();
      showToast('已把 ' + n + ' 条记录归到 ' + esc(target.name));
    });
    $('#wallet-manage').addEventListener('click', openAccModal);

    // 账户余额的眼睛（钱包区的储蓄格 + 账户弹窗里的每一行）。
    // 走捕获阶段，抢在储蓄格的「点开看这本账」之前把点击吃掉。
    document.addEventListener('click', function (e) {
      var eye = e.target.closest ? e.target.closest('[data-eye]') : null;
      if (!eye) return;
      e.preventDefault();
      e.stopPropagation();
      var key = eye.getAttribute('data-eye');
      if (!key) return;
      // 「只看支出」是粗粒度模式，单个账户的眼睛在它下面动不了，免得点了没反应
      if (isExpenseOnly()) {
        showToast('当前是「只看支出」模式，先切回「全部」再单独设置各账户');
        return;
      }
      toggleBalHidden(key);
      var hid = isBalHidden(key);
      eye.innerHTML = hid ? EYE_OFF_SVG : EYE_SVG;
      eye.classList.toggle('off', hid);
      eye.setAttribute('title', hid ? '显示余额' : '隐藏余额');
      renderWallet();
    }, true);

    // 设置 / AI 分析
    $('#ai-run').addEventListener('click', runAI);
    $('#ai-settings').addEventListener('click', openSettings);
    $('#ai-body').addEventListener('click', function (e) {
      if (e.target.closest('[data-ai-redo]')) runAI();
      else if (e.target.closest('[data-ai-settings]')) openSettings();
    });

    // 快捷记账
    $('#quick-tags').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tpl]');
      if (b) openQuick(b.getAttribute('data-tpl'));
    });
    $('#quick-add').addEventListener('click', openTplModal);
    $('#qi-ok').addEventListener('click', submitQuick);
    $('#qi-cancel').addEventListener('click', closeQuick);
    $('#qi-amount').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitQuick(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeQuick(); }
    });

    // 弹窗
    $('#modal-save').addEventListener('click', function () {
      if (!modalSave) { closeModal(); return; }
      if (modalSave() === false) return;
      closeModal();
    });
    $('#modal-cancel').addEventListener('click', closeModal);
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-mask').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    $('#modal-body').addEventListener('click', onModalBodyClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#modal-mask').hidden) closeModal();
    });

    document.getElementById('view-stats').addEventListener('click', function (e) {
      if (e.target.closest('[data-go-record]')) switchTab('record');
    });

    var chips = ['今天中饭20 晚饭39', '打车35', '前天奶茶18 电影45', '发工资8000', '支付宝转银行卡500', '存钱1000', '微信 奶茶18'];
    var box = $('#chips');
    chips.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.textContent = c;
      b.addEventListener('click', function () {
        input.value = c;
        updatePreview();
        input.focus();
      });
      box.appendChild(b);
    });

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        fitCalendarAmounts();
        fitCalSum();
        ['pie-chart', 'line-chart'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el && el.__inst) el.__inst.resize();
        });
      }, 160);
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    var now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    selectedDate = ymd(now);
    entries = loadEntries();
    loadSettings();
    loadAccounts();
    loadTpls();
    renderQuick();
    bindEvents();
    updatePreview();
    renderAll();
    renderAI();
    syncModeItem();
  }

  init();
})();
