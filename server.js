/**
 * 菜单工作台后端服务器
 * 功能：房间管理(共享数据) + 小红书菜谱推荐抓取
 * 无外部依赖，仅使用 Node.js 内置模块
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var PORT = process.env.PORT || 3000;
var DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ========== 工具函数 ========== */
function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, status) {
  var body = JSON.stringify(data);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function serveStatic(req, res) {
  var url = req.url.split('?')[0];
  var filePath = path.join(__dirname, url === '/' ? '/index.html' : url);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, function(err, stat) {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ========== 房间数据管理 ========== */
function getRoomData(roomId) {
  var fp = path.join(DATA_DIR, roomId + '.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch(e) { return null; }
}

function saveRoomData(roomId, data) {
  var fp = path.join(DATA_DIR, roomId + '.json');
  fs.writeFileSync(fp, JSON.stringify(data));
}

/* ========== 小红书菜谱抓取 ========== */
async function fetchXHSRecipes(keyword) {
  var searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_search_result_notes';
  var res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.xiaohongshu.com/',
      'Cache-Control': 'no-cache'
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var html = await res.text();

  // 尝试提取 __INITIAL_STATE__
  var stateIdx = html.indexOf('window.__INITIAL_STATE__');
  if (stateIdx < 0) throw new Error('No __INITIAL_STATE__ found');

  // 用花括号深度匹配提取 JSON
  var jsonStart = html.indexOf('{', stateIdx);
  if (jsonStart < 0) throw new Error('No JSON start found');
  var depth = 0, jsonEnd = -1, inStr = false, esc = false;
  for (var i = jsonStart; i < html.length; i++) {
    var ch = html[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
  }
  if (jsonEnd < 0) throw new Error('No JSON end found');

  var jsonStr = html.substring(jsonStart, jsonEnd + 1);
  jsonStr = jsonStr.replace(/:\s*undefined/g, ':null');
  var state = JSON.parse(jsonStr);

  // 从 state 中提取笔记数据
  var notes = [];
  var paths = [
    function(s) { return s.search && s.search.notes && s.search.notes.data; },
    function(s) { return s.searchNotes && s.searchNotes.data; },
    function(s) { return s.feed && s.feed.notes; }
  ];
  for (var p = 0; p < paths.length; p++) {
    var data = paths[p](state);
    if (data && data.length) { notes = data; break; }
  }
  if (!notes.length) throw new Error('No notes in state');

  var recipes = notes.map(function(note) {
    var card = note.note_card || note.noteCard || note;
    var cover = card.cover || card.cover_url || {};
    var user = card.user || {};
    return {
      title: card.title || card.display_title || '',
      desc: card.desc || card.note_desc || '',
      image: cover.url || cover.url_default || '',
      link: 'https://www.xiaohongshu.com/explore/' + (note.id || note.note_id || ''),
      author: user.nickname || user.nick_name || '',
      likes: card.interact_info ? (card.interact_info.liked_count || '') : '',
      tags: keyword,
      emoji: '',
      source: 'xiaohongshu'
    };
  }).filter(function(r) { return r.title; });

  if (!recipes.length) throw new Error('No recipes extracted');
  return recipes;
}

/* ========== 精选菜谱数据库（fallback） ========== */
var CURATED = {
  '家常菜': [
    { title: '红烧肉', desc: '经典家常菜，肥而不腻，入口即化', emoji: '🥩', tags: ['硬菜','下饭'] },
    { title: '番茄炒蛋', desc: '最简单的家常菜，酸甜可口', emoji: '🍅', tags: ['快手','下饭'] },
    { title: '麻婆豆腐', desc: '麻辣鲜香，超级下饭', emoji: '🌶️', tags: ['川菜','下饭'] },
    { title: '可乐鸡翅', desc: '甜香入味，老少皆宜', emoji: '🍗', tags: ['家常','下饭'] },
    { title: '土豆炖牛肉', desc: '软烂入味，营养丰富', emoji: '🥘', tags: ['炖菜','硬菜'] },
    { title: '鱼香肉丝', desc: '酸甜微辣，经典川味', emoji: '🥕', tags: ['川菜','下饭'] },
    { title: '蒜蓉西兰花', desc: '清淡健康，5分钟搞定', emoji: '🥦', tags: ['素菜','快手'] },
    { title: '糖醋排骨', desc: '酸甜适中，肉质鲜嫩', emoji: '🍖', tags: ['硬菜','下饭'] }
  ],
  '减脂餐': [
    { title: '鸡胸肉沙拉', desc: '高蛋白低脂，减脂必备', emoji: '🥗', tags: ['减脂','沙拉'] },
    { title: '藜麦轻食碗', desc: '营养均衡，饱腹感强', emoji: '🥙', tags: ['减脂','健康'] },
    { title: '凉拌黄瓜', desc: '清脆爽口，低卡路里', emoji: '🥒', tags: ['减脂','凉菜'] },
    { title: '水煮鸡胸肉', desc: '最简单的蛋白质来源', emoji: '🍗', tags: ['减脂','高蛋白'] },
    { title: '牛油果吐司', desc: '健康早餐，营养满满', emoji: '🥑', tags: ['减脂','早餐'] },
    { title: '燕麦酸奶杯', desc: '饱腹又美味', emoji: '🥛', tags: ['减脂','早餐'] }
  ],
  '快手菜': [
    { title: '蛋炒饭', desc: '10分钟搞定，粒粒分明', emoji: '🍚', tags: ['快手','主食'] },
    { title: '葱油拌面', desc: '葱香四溢，简单美味', emoji: '🍜', tags: ['快手','主食'] },
    { title: '煎饺', desc: '底部金黄酥脆', emoji: '🥟', tags: ['快手','主食'] },
    { title: '芝士焗饭', desc: '拉丝芝士，幸福感爆棚', emoji: '🧀', tags: ['快手','主食'] },
    { title: '番茄鸡蛋面', desc: '酸甜暖胃，最快手', emoji: '🍝', tags: ['快手','主食'] },
    { title: '韩式泡菜炒饭', desc: '酸辣开胃，一锅搞定', emoji: '🍚', tags: ['快手','主食'] }
  ],
  '汤': [
    { title: '排骨玉米汤', desc: '清甜营养，老少皆宜', emoji: '🌽', tags: ['煲汤','营养'] },
    { title: '番茄蛋花汤', desc: '酸甜暖胃，5分钟搞定', emoji: '🍅', tags: ['快手','汤'] },
    { title: '冬瓜排骨汤', desc: '清热解暑，鲜美可口', emoji: '🥬', tags: ['煲汤','营养'] },
    { title: '银耳莲子汤', desc: '滋阴润肺，美容养颜', emoji: '🫘', tags: ['甜品','汤'] },
    { title: '乌鸡汤', desc: '滋补养生，女性朋友必备', emoji: '🐔', tags: ['煲汤','滋补'] },
    { title: '萝卜牛腩汤', desc: '牛腩软烂，萝卜清甜', emoji: '🥩', tags: ['煲汤','营养'] }
  ],
  '甜品': [
    { title: '双皮奶', desc: '奶香浓郁，入口即化', emoji: '🥛', tags: ['甜品','广式'] },
    { title: '椰汁西米露', desc: '清甜爽口，夏日必备', emoji: '🥥', tags: ['甜品','冷饮'] },
    { title: '红豆沙', desc: '绵密香甜，养颜补血', emoji: '🫘', tags: ['甜品','养生'] },
    { title: '焦糖布丁', desc: '丝滑细腻，焦香四溢', emoji: '🍮', tags: ['甜品','烘焙'] },
    { title: '草莓大福', desc: '软糯香甜，颜值超高', emoji: '🍓', tags: ['甜品','日式'] },
    { title: '芒果班戟', desc: '清新不腻，做法简单', emoji: '🥭', tags: ['甜品','冷饮'] }
  ],
  '早餐': [
    { title: '燕麦粥', desc: '营养健康，5分钟搞定', emoji: '🥣', tags: ['早餐','健康'] },
    { title: '鸡蛋灌饼', desc: '外酥里嫩，料足味美', emoji: '🥞', tags: ['早餐','快手'] },
    { title: '小笼包', desc: '皮薄馅大，汤汁丰富', emoji: '🥟', tags: ['早餐','中式'] },
    { title: '豆浆油条', desc: '经典中式早餐搭档', emoji: '🥛', tags: ['早餐','中式'] },
    { title: '手抓饼', desc: '层次分明，外酥里软', emoji: '🫓', tags: ['早餐','快手'] },
    { title: '三明治', desc: '营养均衡，携带方便', emoji: '🥪', tags: ['早餐','快手'] }
  ],
  '川菜': [
    { title: '水煮鱼', desc: '麻辣鲜香，鱼肉嫩滑', emoji: '🐟', tags: ['川菜','硬菜'] },
    { title: '回锅肉', desc: '肥而不腻，超级下饭', emoji: '🥩', tags: ['川菜','下饭'] },
    { title: '宫保鸡丁', desc: '花生酥脆，鸡丁鲜嫩', emoji: '🍗', tags: ['川菜','下饭'] },
    { title: '辣子鸡', desc: '香辣过瘾，越吃越香', emoji: '🌶️', tags: ['川菜','硬菜'] },
    { title: '毛血旺', desc: '麻辣鲜香，料足味浓', emoji: '🥘', tags: ['川菜','硬菜'] },
    { title: '鱼香茄子', desc: '酸甜微辣，下饭神器', emoji: '🍆', tags: ['川菜','下饭'] }
  ],
  '粤菜': [
    { title: '白切鸡', desc: '皮滑肉嫩，原汁原味', emoji: '🐔', tags: ['粤菜','硬菜'] },
    { title: '蒸排骨', desc: '鲜嫩多汁，豆豉飘香', emoji: '🍖', tags: ['粤菜','蒸菜'] },
    { title: '虾饺', desc: '皮薄馅鲜，晶莹剔透', emoji: '🦐', tags: ['粤菜','早茶'] },
    { title: '蜜汁叉烧', desc: '甜香四溢，肉质鲜嫩', emoji: '🥩', tags: ['粤菜','硬菜'] },
    { title: '豉油鸡', desc: '酱香浓郁，皮脆肉滑', emoji: '🍗', tags: ['粤菜','硬菜'] },
    { title: '老火靓汤', desc: '慢炖数小时，营养全在汤里', emoji: '🥣', tags: ['粤菜','煲汤'] }
  ],
  '烘焙': [
    { title: '戚风蛋糕', desc: '松软细腻，入口即化', emoji: '🎂', tags: ['烘焙','甜品'] },
    { title: '曲奇饼干', desc: '酥脆可口，奶香浓郁', emoji: '🍪', tags: ['烘焙','甜品'] },
    { title: '手撕面包', desc: '拉丝绵密，奶香十足', emoji: '🍞', tags: ['烘焙','早餐'] },
    { title: '自制披萨', desc: '料足味美，拉丝满分', emoji: '🍕', tags: ['烘焙','主食'] },
    { title: '葡式蛋挞', desc: '酥皮层次分明，蛋香浓郁', emoji: '🥧', tags: ['烘焙','甜品'] },
    { title: '奶油泡芙', desc: '外酥内软，奶油满满', emoji: '🧁', tags: ['烘焙','甜品'] }
  ]
};

var ALL_KEYWORDS = Object.keys(CURATED);

function getCuratedRecipes(keyword) {
  // 尝试匹配关键词到分类
  var matchKey = null;
  for (var i = 0; i < ALL_KEYWORDS.length; i++) {
    if (keyword.indexOf(ALL_KEYWORDS[i]) >= 0 || ALL_KEYWORDS[i].indexOf(keyword) >= 0) {
      matchKey = ALL_KEYWORDS[i]; break;
    }
  }
  // 没匹配到就从所有分类随机选
  if (!matchKey) {
    var allRecipes = [];
    ALL_KEYWORDS.forEach(function(k) { allRecipes = allRecipes.concat(CURATED[k]); });
    var shuffled = allRecipes.sort(function() { return Math.random() - 0.5; });
    return shuffled.slice(0, 8).map(function(r) {
      return Object.assign({}, r, {
        xhsUrl: 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(r.title),
        source: 'curated'
      });
    });
  }
  return CURATED[matchKey].map(function(r) {
    return Object.assign({}, r, {
      xhsUrl: 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(r.title),
      source: 'curated'
    });
  });
}

/* ========== HTTP 服务器 ========== */
var server = http.createServer(async function(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') { sendJson(res, {}); return; }

  var url = new URL(req.url, 'http://localhost:' + PORT);
  var pathname = url.pathname;
  var method = req.method;

  try {
    // 健康检查
    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, { status: 'ok', time: Date.now() });
      return;
    }

    // 创建房间
    if (pathname === '/api/room' && method === 'POST') {
      var roomId = crypto.randomBytes(4).toString('hex');
      var roomData = { dishes: [], mealPlans: {}, categories: ['荤菜','素菜','汤','主食','凉菜','甜品','零食'], createdAt: Date.now() };
      saveRoomData(roomId, roomData);
      console.log('[Room] Created: ' + roomId);
      sendJson(res, { roomId: roomId, data: roomData });
      return;
    }

    // 房间操作 /api/room/:id
    var roomMatch = pathname.match(/^\/api\/room\/([a-f0-9]+)$/);
    if (roomMatch) {
      var rid = roomMatch[1];
      if (method === 'GET') {
        var data = getRoomData(rid);
        if (!data) { sendJson(res, { error: 'Room not found' }, 404); return; }
        sendJson(res, data);
        return;
      }
      if (method === 'PUT') {
        var body = await parseBody(req);
        saveRoomData(rid, body);
        sendJson(res, { success: true });
        return;
      }
    }

    // 小红书菜谱推荐
    if (pathname === '/api/recommend' && method === 'GET') {
      var keyword = url.searchParams.get('keyword') || '家常菜';
      console.log('[Recommend] keyword: ' + keyword);
      try {
        var recipes = await fetchXHSRecipes(keyword);
        console.log('[Recommend] Got ' + recipes.length + ' recipes from XHS');
        sendJson(res, { recipes: recipes, source: 'xiaohongshu' });
      } catch(e) {
        console.log('[Recommend] XHS failed: ' + e.message + ', using curated');
        var curated = getCuratedRecipes(keyword);
        sendJson(res, { recipes: curated, source: 'curated', error: e.message });
      }
      return;
    }

    // 静态文件
    serveStatic(req, res);
  } catch(e) {
    console.error('[Error]', e.message);
    sendJson(res, { error: e.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('========================================');
  console.log('  菜单工作台服务器已启动');
  console.log('  本地访问: http://localhost:' + PORT);
  console.log('  局域网访问: http://[本机IP]:' + PORT);
  console.log('========================================');
  console.log('  API端点:');
  console.log('  GET  /api/health        - 健康检查');
  console.log('  POST /api/room          - 创建房间');
  console.log('  GET  /api/room/:id      - 获取房间数据');
  console.log('  PUT  /api/room/:id      - 更新房间数据');
  console.log('  GET  /api/recommend     - 菜谱推荐');
  console.log('========================================');
});
