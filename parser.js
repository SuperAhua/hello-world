/**
 * 随手记 · 自然语言解析引擎
 * 输入："今天买咖啡花了25元" / "打车35" / "昨天奶茶18"
 * 输出：{ date, amount, item, category, type }
 */
(function (global) {
  'use strict';

  /* ==================================================================
     分类规则 v2
     ------------------------------------------------------------------
     判定顺序是硬编码的优先级，越靠前越"硬"，命中即返回：

     L0 强规则   一个说法只可能是一个类，用正则先判死：
                 「收红包」vs「发红包」、「苹果手机」vs「买苹果」。
     L1 最长匹配 命中的关键词越长越具体：「宽带费」压过「宽带」，
                 「地铁卡」压过「地铁」。旧版是把同类关键词长度相加，
                 「苹果手机」里 餐饮(苹果) 和 购物(手机) 恰好打平，
                 最后靠数组顺序定案，于是手机被记成了餐饮。
     L2 命中数量 关键词一样长时，命中的词更多的类目更可信。
     L3 类目权重 还平就按"越具体越优先"：医疗/居住 > 餐饮/购物。
     L4 兜底    其他。

     维护提示：新增词尽量写在最具体的类目里；一词多义（苹果、红包、
     宽带、会员）交给 L0 的 STRONG_RULES，别在两个类目里各写一遍。
     ================================================================== */
  var CATEGORIES = [
    {
      name: '收入', color: '#0f9d6e', weight: 40,
      keywords: ['工资', '薪水', '薪资', '月薪', '底薪', '奖金', '年终奖', '绩效', '提成', '报销',
        '退款', '退货', '退票', '利息', '分红', '兼职', '外快', '进账', '收入', '到账', '赚了',
        '稿费', '礼金', '中奖', '返现']
    },
    {
      name: '餐饮', color: '#f2803b', weight: 30,
      keywords: ['早餐', '早饭', '午餐', '午饭', '中饭', '晚餐', '晚饭', '夜宵', '宵夜', '吃饭',
        '外卖', '火锅', '烧烤', '面条', '拉面', '米线', '螺蛳粉', '麻辣烫', '烤肉', '炸鸡',
        '麦当劳', '肯德基', '星巴克', '瑞幸', '喜茶', '蜜雪冰城', '古茗', '奈雪', '库迪',
        '咖啡', '奶茶', '果汁', '饮料', '可乐', '雪碧', '啤酒', '白酒', '矿泉水', '下午茶',
        '零食', '水果', '苹果', '香蕉', '橘子', '橙子', '葡萄', '西瓜', '蛋糕', '面包',
        '汉堡', '寿司', '披萨', '包子', '豆浆', '油条', '买菜', '菜市场', '食堂', '聚餐']
    },
    {
      name: '交通', color: '#3b82f6', weight: 30,
      keywords: ['打车', '出租车', '滴滴', '网约车', '拼车', '顺风车', '高德', '哈啰', '青桔',
        '地铁', '公交', '公交车', '地铁卡', '公交卡', '高铁', '动车', '火车', '机票', '飞机',
        '加油', '油费', '加油卡', '停车', '停车费', '过路费', '高速费', 'ETC', '单车',
        '共享单车', '车费', '车票', '船票']
    },
    {
      name: '购物', color: '#a855f7', weight: 25,
      keywords: ['衣服', '裤子', '裙子', '鞋子', '球鞋', '外套', '卫衣', 'T恤', '袜子', '内衣',
        '淘宝', '天猫', '京东', '拼多多', '购物', '化妆品', '护肤品', '面膜', '口红', '香水',
        '数码', '手机', '电脑', '笔记本', '平板', '耳机', '相机', '键盘', '鼠标', '显示器',
        '充电器', '数据线', '包包', '背包', '手表', '首饰', '项链', '戒指', '眼镜', '家电',
        '冰箱', '洗衣机', '空调', '电视', '优衣库', '耐克', '阿迪', 'polo', '服饰']
    },
    {
      name: '日用', color: '#14b8a6', weight: 25,
      keywords: ['超市', '便利店', '全家', '罗森', '7-11', '洗发水', '沐浴露', '纸巾', '卫生纸',
        '牙膏', '牙刷', '洗衣液', '洗衣粉', '日用品', '生活用品', '垃圾袋', '毛巾', '清洁',
        '拖把', '洗洁精', '电池', '雨伞', '水杯', '保鲜膜', '厨房用品']
    },
    {
      name: '居住', color: '#6366f1', weight: 35,
      keywords: ['房租', '水电', '水费', '电费', '燃气', '天然气', '物业', '物业费', '取暖',
        '暖气', '维修', '押金', '房贷', '中介费', '装修', '家具']
    },
    {
      name: '娱乐', color: '#ec4899', weight: 25,
      keywords: ['电影', '电影票', '游戏', '充值', '唱歌', 'KTV', '旅游', '旅行', '门票',
        '演唱会', '音乐节', '健身', '健身房', '游泳', '桌游', '剧本杀', '密室', '酒吧',
        '按摩', '足疗', '演出', '会员', '视频会员', '爱奇艺', '腾讯视频', '优酷', 'B站',
        '露营', '滑雪', '棋牌']
    },
    {
      name: '医疗', color: '#ef4444', weight: 35,
      keywords: ['医院', '看病', '挂号', '门诊', '急诊', '体检', '牙医', '牙科', '买药', '药费',
        '药房', '药店', '口罩', '疫苗', '中医', '推拿', '药']
    },
    {
      name: '学习', color: '#0ea5e9', weight: 30,
      keywords: ['书', '书籍', '图书', '课程', '培训', '学费', '文具', '考试', '报名费', '网课',
        '教材', '讲座', '驾校', '考证', '真题']
    },
    {
      name: '通讯', color: '#8b5cf6', weight: 30,
      keywords: ['话费', '话费充值', '电话费', '手机费', '流量', '宽带', '宽带费', '网费',
        '网络费', '订阅', '网盘', 'VPN']
    },
    {
      name: '人情', color: '#f59e0b', weight: 30,
      keywords: ['礼物', '送礼', '请客', '份子钱', '随礼', '结婚', '生日', '满月', '探望',
        '孝敬', '给爸妈', '红包']
    },
    { name: '其他', color: '#94a3b8', weight: 0, keywords: [] }
  ];

  /* ---------------- L0：一词多义的硬规则 ---------------- */
  /* 顺序有意义：先判"收"，再判"发"，最后才是默认。 */
  var STRONG_RULES = [
    // 收红包 / 领红包 / 抢红包 → 收入；发红包 / 给红包 / 随份子 → 人情
    { re: /(收|领|抢|到账|退回|返).{0,3}红包|红包.{0,3}(收到|到账|退回)/, cat: '收入' },
    { re: /(发|送|给|包|随|转).{0,3}红包|红包.{0,3}(给|发|送)/, cat: '人情' },
    { re: /红包/, cat: '收入' },  // 光说「红包」默认按收到的算

    // 苹果/小米… + 硬件 → 购物；单独「苹果」按水果走餐饮
    { re: /(苹果|apple|小米|华为|荣耀|联想|戴森|索尼|三星).{0,4}(手机|电脑|平板|耳机|手表|笔记本|显示器|充电器)/i, cat: '购物' },

    // 「XX卡」充值 → 交通；「会员」类订阅 → 娱乐
    { re: /(地铁|公交|加油|停车).{0,1}卡/, cat: '交通' },
    { re: /(视频|音乐|网盘|云盘|游戏).{0,2}会员/, cat: '娱乐' },

    // 房租/水电这类固定支出，出现就压过其他词
    { re: /(房租|物业费|房贷|水电费)/, cat: '居住' }
  ];

  /* ---------------- 小工具 ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function safeDate(y, m, day) {
    var max = daysInMonth(y, m);
    var d = new Date(y, m, Math.min(Math.max(1, day), max));
    return d;
  }

  function catByName(name) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].name === name) return CATEGORIES[i];
    }
    return CATEGORIES[CATEGORIES.length - 1];
  }

  function catColor(name) { return catByName(name).color; }

  /* ---------------- 金额 ---------------- */
  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_UNIT = { '十': 10, '百': 100, '千': 1000, '万': 10000 };

  function cnToNum(str) {
    var result = 0, section = 0, num = 0, matched = false;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; matched = true; }
      else if (ch in CN_UNIT) {
        matched = true;
        var u = CN_UNIT[ch];
        if (u === 10000) {
          section = (section + num) * u;
          result += section;
          section = 0; num = 0;
        } else {
          if (num === 0) num = 1;
          section += num * u;
          num = 0;
        }
      }
    }
    if (!matched) return 0;
    return result + section + num;
  }

  function extractAmount(s) {
    var m;
    // ￥25 / ¥25
    m = s.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
    if (m) return { amount: parseFloat(m[1]), matched: m[0] };

    // 25元 / 25块 / 25块钱
    m = s.match(/(\d+(?:\.\d{1,2})?)\s*(?:块钱|块|元|圆|rmb|RMB|Rmb)/);
    if (m) return { amount: parseFloat(m[1]), matched: m[0] };

    // 二十五块
    m = s.match(/([零〇一二两三四五六七八九十百千万]{1,8})\s*(?:块钱|块|元|圆)/);
    if (m) {
      var v = cnToNum(m[1]);
      if (v > 0) return { amount: v, matched: m[0] };
    }

    // 兜底：取最后一个数字（"打车35"）
    var nums = [];
    var re = /(\d+(?:\.\d{1,2})?)/g, mm;
    while ((mm = re.exec(s)) !== null) nums.push(mm);
    if (nums.length) {
      var last = nums[nums.length - 1];
      return { amount: parseFloat(last[1]), matched: last[0] };
    }
    return null;
  }

  /* ---------------- 日期 ---------------- */
  /**
   * @param opts.keepMonth 补记模式：「5号」落在基准日所在月，不因为"未来"而回退到上个月
   */
  function parseDatePhrase(input, today, opts) {
    var s = input;
    var m;

    // 2026年11月4日
    m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      var d1 = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return { date: ymd(d1), label: (parseInt(m[2], 10)) + '月' + (parseInt(m[3], 10)) + '日', text: s.replace(m[0], ' ') };
    }

    // 11月4日
    m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      var mo = parseInt(m[1], 10), da = parseInt(m[2], 10);
      var y = today.getFullYear();
      var d2 = safeDate(y, mo - 1, da);
      if (d2.getTime() - startOfDay(today).getTime() > 86400000) d2 = safeDate(y - 1, mo - 1, da);
      return { date: ymd(d2), label: mo + '月' + da + '日', text: s.replace(m[0], ' ') };
    }

    // 11/4 或 11-4
    m = s.match(/(?:^|[^\d])(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?!\d)/);
    if (m) {
      var mo2 = parseInt(m[1], 10), da2 = parseInt(m[2], 10);
      if (mo2 >= 1 && mo2 <= 12 && da2 >= 1 && da2 <= 31) {
        var y2 = today.getFullYear();
        var d3 = safeDate(y2, mo2 - 1, da2);
        if (d3.getTime() - startOfDay(today).getTime() > 86400000) d3 = safeDate(y2 - 1, mo2 - 1, da2);
        return { date: ymd(d3), label: mo2 + '月' + da2 + '日', text: s.replace(m[0], ' ') };
      }
    }

    // 上周五 / 周三 / 星期日
    m = s.match(/(上|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
    if (m) {
      var map = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 };
      var target = map[m[2]];
      var base = startOfDay(today);
      var cur = (base.getDay() + 6) % 7;
      var delta = target - cur;
      if (m[1] === '上') delta -= 7;
      var d4 = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
      var prefix = m[1] === '上' ? '上周' : (m[1] === '这' || m[1] === '本' ? '本周' : '周');
      return { date: ymd(d4), label: prefix + m[2], text: s.replace(m[0], ' ') };
    }

    // 3天前
    m = s.match(/(\d{1,2})\s*天前/);
    if (m) {
      var n = parseInt(m[1], 10);
      var b5 = startOfDay(today);
      var d5 = new Date(b5.getFullYear(), b5.getMonth(), b5.getDate() - n);
      return { date: ymd(d5), label: n + '天前', text: s.replace(m[0], ' ') };
    }

    // 3号
    m = s.match(/(?:^|[^\d])(\d{1,2})\s*[号日](?!\d)/);
    if (m) {
      var day = parseInt(m[1], 10);
      if (day >= 1 && day <= 31) {
        var y6 = today.getFullYear(), mo6 = today.getMonth();
        var near = s.slice(Math.max(0, m.index - 4), m.index + m[0].length);
        var d6 = safeDate(y6, mo6, day);
        var prevMonth = function () {
          mo6 -= 1;
          if (mo6 < 0) { mo6 = 11; y6 -= 1; }
          d6 = safeDate(y6, mo6, day);
        };
        if (/上月|上个月|上个?月/.test(near)) {
          prevMonth();                       // 明说「上月28号」
        } else if (!(opts && opts.keepMonth) &&
          d6.getTime() - startOfDay(today).getTime() > 86400000) {
          prevMonth();                       // 以今天为基准时：还没到的号数按上个月算
        }
        // keepMonth（补记模式）下「5号」就落在基准日所在的这个月
        return { date: ymd(d6), label: (d6.getMonth() + 1) + '月' + d6.getDate() + '日', text: s.replace(m[0], ' ') };
      }
    }

    // 相对日期
    var rels = [
      [/大前天/, -3, '大前天'],
      [/前天/, -2, '前天'],
      [/昨天|昨晚|昨日/, -1, '昨天'],
      [/今天|今日|刚刚|刚才|今早|今晚/, 0, '今天'],
      [/明天|明早|明晚/, 1, '明天']
    ];
    for (var i = 0; i < rels.length; i++) {
      if (rels[i][0].test(s)) {
        var b7 = startOfDay(today);
        var d7 = new Date(b7.getFullYear(), b7.getMonth(), b7.getDate() + rels[i][1]);
        return { date: ymd(d7), label: rels[i][2], text: s.replace(rels[i][0], ' ') };
      }
    }

    return { date: ymd(today), label: '今天', text: s };
  }

  /* ---------------- 商品名清洗 ---------------- */
  var NOISE = /(花了|花掉|花费|一共|总共|大约|大概|差不多|左右|人均|买了|付了|付款|支付了|支付|消费了|消费|用了|用掉|充了|充值|交了|缴了|续了|订了|定了|请客|吃了|喝了|去了|又|还|和|跟)/g;

  function cleanItem(s) {
    var t = ' ' + s + ' ';
    t = t.replace(/[，,。.!！?？;；:：、~～\-—_]/g, ' ');
    t = t.replace(NOISE, ' ');
    // 去掉数量词：「买2杯咖啡」-> 「咖啡」
    t = t.replace(/\d+\s*[个件杯份斤只盒瓶张位人次袋包条双套台部本支根片粒颗箱桶罐把副碗盘]/g, ' ');
    // "买咖啡" -> "咖啡"，但 "买菜" 这种单字保留
    t = t.replace(/买(?=\s*[\u4e00-\u9fa5]{2})/g, ' ');
    t = t.replace(/(人民币|块钱|块|元|圆|整|钱)/g, ' ');
    // 时间名词不进商品名（「下午茶」保留）
    t = t.replace(/(周末|平时|上午|下午|晚上|早上|凌晨|夜里|今天|昨天|前天|大前天|明天|后天|今早|今晚|昨晚|刚刚|刚才|上月|本月|下月|上个月|这个月|下个月)(?!茶)/g, ' ');
    t = t.replace(/(^|\s)(我|俺|在|给|去|的|了)+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/^[的了个着]+/, '').replace(/[的了个着]+$/, '').trim();
    return t;
  }

  /* ---------------- 分类 ---------------- */
  /**
   * 核心判定：返回类名。
   * L0 硬规则 → L1 最长匹配 → L2 命中数 → L3 类目权重 → L4 其他
   */
  function classify(text) {
    var t = String(text || '');

    // L0
    for (var r = 0; r < STRONG_RULES.length; r++) {
      if (STRONG_RULES[r].re.test(t)) {
        return { category: STRONG_RULES[r].cat, hit: '规则', len: 0 };
      }
    }

    // L1 ~ L3
    var low = t.toLowerCase();
    var best = null;
    for (var i = 0; i < CATEGORIES.length; i++) {
      var c = CATEGORIES[i];
      var maxLen = 0, count = 0, hitWord = '';
      for (var j = 0; j < c.keywords.length; j++) {
        var kw = c.keywords[j];
        if (!kw) continue;
        if (low.indexOf(kw.toLowerCase()) === -1) continue;
        count++;
        if (kw.length > maxLen) { maxLen = kw.length; hitWord = kw; }
      }
      if (!maxLen) continue;
      var cand = { category: c.name, maxLen: maxLen, count: count, weight: c.weight || 0, hit: hitWord };
      if (!best) { best = cand; continue; }
      if (cand.maxLen > best.maxLen) best = cand;
      else if (cand.maxLen === best.maxLen) {
        if (cand.count > best.count) best = cand;
        else if (cand.count === best.count && cand.weight > best.weight) best = cand;
      }
    }

    return best || { category: '其他', hit: '', len: 0 };
  }

  function detectCategory(raw, item) {
    var res = classify((raw || '') + ' ' + (item || ''));
    return catByName(res.category);
  }

  /* ---------------- 多笔拆分 ---------------- */
  var QTY_UNITS = '个件杯份斤只盒瓶张位人次袋包条双套台部本支根片粒颗箱桶罐把副碗盘寸码层楼站晚岁倍';
  var DATE_UNITS = '年月日号点分秒天周折%％';
  // 分类词典里的英文词（KTV / VPN / polo…）说明这是"词"不是型号，"KTV 200" 的 200 得算金额
  var KNOWN_WORDS = (function () {
    var m = {};
    for (var i = 0; i < CATEGORIES.length; i++) {
      var kws = CATEGORIES[i].keywords;
      for (var j = 0; j < kws.length; j++) {
        if (/[a-z]/i.test(kws[j])) m[kws[j].toLowerCase()] = 1;
      }
    }
    return m;
  })();
  var AMT_UNIT_RE = /[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:块钱|块|元|圆)|[零〇一二两三四五六七八九十百千万]{1,8}\s*(?:块钱|块|元|圆)/g;
  var BARE_NUM_RE = /\d+(?:\.\d{1,2})?/g;

  function parseNumberToken(txt) {
    var t = txt.replace(/[¥￥\s]/g, '').replace(/(块钱|块|元|圆)$/, '');
    if (/^[\d.]+$/.test(t)) {
      var v = parseFloat(t);
      return isNaN(v) ? null : v;
    }
    var c = cnToNum(t);
    return c > 0 ? c : null;
  }

  /**
   * 在 free 掩码之上收集所有可当金额的片段。
   * 带单位的（25元 / 25块 / ¥25 / 二十五块）优先，其次才是裸数字（打车35）。
   * 日期里的数字、数量词（2个/3杯）、第2次 等已由掩码或规则排除。
   */
  function scanAmounts(s, free) {
    var hits = [];

    function occupy(start, end, amount) {
      if (!(amount > 0)) return false;
      for (var i = start; i < end; i++) if (!free[i]) return false;
      for (var j = 0; j < hits.length; j++) {
        if (!(end <= hits[j].start || start >= hits[j].end)) return false;
      }
      hits.push({ start: start, end: end, amount: amount });
      for (var k = start; k < end; k++) free[k] = false;
      return true;
    }

    var m;
    AMT_UNIT_RE.lastIndex = 0;
    while ((m = AMT_UNIT_RE.exec(s)) !== null) {
      occupy(m.index, m.index + m[0].length, parseNumberToken(m[0]));
    }

    BARE_NUM_RE.lastIndex = 0;
    while ((m = BARE_NUM_RE.exec(s)) !== null) {
      var st = m.index, en = m.index + m[0].length;
      var before = st > 0 ? s.charAt(st - 1) : '';
      var after = s.charAt(en);
      if (before === '¥' || before === '￥' || before === '第') continue;
      if (after && (QTY_UNITS.indexOf(after) !== -1 || DATE_UNITS.indexOf(after) !== -1)) continue;
      if (after && /[A-Za-z]/.test(after)) continue;          // 350ml / 42ma
      var prevNonSpace = st - 1;                              // iPhone 15 里的 15 是型号
      while (prevNonSpace >= 0 && s.charAt(prevNonSpace) === ' ') prevNonSpace--;
      if (prevNonSpace >= 0 && /[A-Za-z]/.test(s.charAt(prevNonSpace))) {
        // 往前取出这个英文词：是词典里的词（KTV / VPN / polo）就当金额，否则当型号跳过
        var we = prevNonSpace + 1, ws = prevNonSpace;
        while (ws - 1 >= 0 && /[A-Za-z0-9-]/.test(s.charAt(ws - 1))) ws--;
        if (!KNOWN_WORDS[s.slice(ws, we).toLowerCase()]) continue;
      }
      occupy(st, en, parseFloat(m[0]));
    }

    hits.sort(function (a, b) { return a.start - b.start; });
    return hits;
  }

  function firstDiffIndex(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) if (a.charAt(i) !== b.charAt(i)) return i;
    return n;
  }

  /**
   * parseDatePhrase 的匹配是把命中的那段换成一个空格。
   * 用「替换后必须等于它返回的 text」反推命中区间，比直接找首个差异位更准
   * （前缀可能是空格，直接找差异会偏移到日期本身，从而多吃一个字）。
   */
  function locateMatch(rest, dpText) {
    var len = rest.length - dpText.length + 1;
    if (len <= 0 || len > rest.length) return null;
    var i = firstDiffIndex(rest, dpText);
    for (var s = i; s >= Math.max(0, i - 4); s--) {
      if (rest.slice(0, s) + ' ' + rest.slice(s + len) === dpText) {
        // 正则里的 (?:^|[^\d]) 会连前缀分隔字符一起匹配（「地铁2号线」中的「铁」），裁掉
        var ch = rest.charAt(s);
        if (len > 1 && ch && !/\d/.test(ch) && /\d/.test(rest.charAt(s + 1))) {
          return { start: s + 1, len: len - 1 };
        }
        return { start: s, len: len };
      }
    }
    return null;
  }

  // parseDatePhrase 一次只吃掉一个日期，循环调用即可拿到句子里所有日期及其位置
  function findAllDates(s, today, opts) {
    var out = [], rest = s, offset = 0, guard = 0;
    while (rest.length && guard++ < 24) {
      var dp = parseDatePhrase(rest, today, opts);
      if (dp.text === rest) break;
      var loc = locateMatch(rest, dp.text);
      if (!loc) break;
      out.push({
        start: offset + loc.start,
        end: offset + loc.start + loc.len,
        date: dp.date,
        label: dp.label,
        // 「地铁2号线」里的 2号 不是日期，只屏蔽数字、不参与日期
        skip: rest.charAt(loc.start + loc.len) === '线'
      });
      offset += loc.start + loc.len;
      rest = rest.slice(loc.start + loc.len);
    }
    return out;
  }

  /**
   * 统一的日期显示：今天 -> 「今天」，今年 -> 「11月2日」，跨年 -> 「2025年12月31日」
   */
  function dateLabel(dateStr, realToday) {
    var p = String(dateStr).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (realToday && dateStr === ymd(realToday)) return '今天';
    if (realToday && y !== realToday.getFullYear()) return y + '年' + m + '月' + d + '日';
    return m + '月' + d + '日';
  }

  /**
   * 按金额切分：每个金额前的那段文字是它的商品名；
   * 若前段被"花了/付了"之类吃掉而变空（如「花了20吃饭」），则借用金额后面的文字。
   * 日期优先用本段自带的，没有就继承前面最近一次出现的日期，仍没有则落在 base（当前选中日）。
   */
  function buildItems(s, masked, amounts, dates, base, realToday) {
    var items = [];
    var prevEnd = 0;
    for (var i = 0; i < amounts.length; i++) {
      var am = amounts[i];
      var nextStart = (i + 1 < amounts.length) ? amounts[i + 1].start : s.length;
      var segStart = prevEnd;
      var primaryStart = prevEnd;
      var primaryEnd = Math.max(primaryStart, am.start);

      var itemName = cleanItem(masked.slice(primaryStart, primaryEnd));
      var descEnd, usedNext;
      if (itemName) {
        descEnd = primaryEnd;
        usedNext = false;
      } else {
        descEnd = nextStart;
        usedNext = true;
        itemName = cleanItem(masked.slice(am.end, descEnd));
      }

      var d = null, k;
      for (k = 0; k < dates.length; k++) {
        if (dates[k].start >= segStart && dates[k].start < am.end) d = dates[k];
      }
      if (!d) {
        for (k = 0; k < dates.length; k++) if (dates[k].end <= segStart) d = dates[k];
      }

      var localRaw = masked.slice(segStart, am.end);
      var cat = detectCategory(localRaw, itemName);
      var type = cat.name === '收入' ? 'income' : 'expense';
      if (!itemName) itemName = type === 'income' ? '收入' : cat.name;

      var dateStr = d ? d.date : ymd(base);
      items.push({
        date: dateStr,
        dateLabel: dateLabel(dateStr, realToday),
        amount: Math.round(am.amount * 100) / 100,
        item: itemName.slice(0, 24),
        category: cat.name,
        color: cat.color,
        type: type
      });

      prevEnd = usedNext ? descEnd : am.end;
    }
    return items;
  }

  /* ---------------- 主入口 ---------------- */
  /**
   * @param opts 可传 Date（基准日与自己相同），或 { base, today }：
   *   base  —— 解析「今天 / 昨天 / 3号」的基准，以及没写日期时落到哪一天（当前选中日）
   *   today —— 真实今天，仅用于把 label 显示成「今天」
   */
  function parseInputs(input, opts) {
    var raw = String(input == null ? '' : input).trim();

    var base, realToday;
    if (opts && typeof opts.getTime === 'function') {
      base = realToday = new Date(opts.getTime());
    } else if (opts && opts.base && typeof opts.base.getTime === 'function') {
      base = new Date(opts.base.getTime());
      realToday = (opts.today && typeof opts.today.getTime === 'function') ? new Date(opts.today.getTime()) : base;
    } else {
      base = realToday = new Date();
    }

    if (!raw) return { ok: false, reason: 'empty', raw: raw, items: [] };

    var s = raw;
    var masked = s.split('');
    var free = [];
    for (var fi = 0; fi < s.length; fi++) free[fi] = true;

    var m, t;
    // 时间词（下午3点 / 12:30）先屏蔽，避免里面的数字被当成金额
    var timeRe = /(上午|下午|中午|晚上|早上|凌晨|夜里)?\s*\d{1,2}\s*[点:：]\s*(\d{1,2})?\s*[分半]?/g;
    while ((m = timeRe.exec(s)) !== null) {
      if (!m[0].replace(/\s/g, '')) continue;
      for (t = m.index; t < m.index + m[0].length; t++) { free[t] = false; masked[t] = ' '; }
    }

    var keepMonth = ymd(base) !== ymd(realToday);
    var allDates = findAllDates(s, base, { keepMonth: keepMonth });
    var dates = [];
    for (var di = 0; di < allDates.length; di++) {
      for (t = allDates[di].start; t < allDates[di].end; t++) { free[t] = false; masked[t] = ' '; }
      if (!allDates[di].skip) dates.push(allDates[di]);
    }

    var amounts = scanAmounts(s, free);
    if (!amounts.length) return { ok: false, reason: 'amount', raw: raw, items: [], date: ymd(base) };

    var items = buildItems(s, masked.join(''), amounts, dates, base, realToday);
    var first = items[0];
    return {
      ok: true,
      raw: raw,
      items: items,
      count: items.length,
      date: first.date,
      dateLabel: first.dateLabel,
      amount: first.amount,
      item: first.item,
      category: first.category,
      color: first.color,
      type: first.type
    };
  }

  // 兼容旧的单笔调用
  function parseInput(input, now) { return parseInputs(input, now); }

  var API = {
    CATEGORIES: CATEGORIES,
    parseInput: parseInput,
    parseInputs: parseInputs,
    parseDatePhrase: parseDatePhrase,
    extractAmount: extractAmount,
    detectCategory: detectCategory,
    classify: classify,
    catByName: catByName,
    catColor: catColor,
    dateLabel: dateLabel,
    ymd: ymd,
    pad: pad
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (global) global.LedgerParser = API;
})(typeof window !== 'undefined' ? window : null);
