// Service Worker — Task Manager Notifications + Telegram
// Handles background browser notifications and Telegram messages.
// Requires HTTP server (not file://). Launch start.bat to enable.

let timers = [];
let tg = { token: '', chatId: '', on: false };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE') {
    if (e.data.tg) tg = e.data.tg;
    scheduleAll(e.data.tasks);
    if (e.data.sessions) scheduleSessions(e.data.sessions);
  }
});

// ─── DATE UTILS ───
function p2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + p2(x.getMonth()+1) + '-' + p2(x.getDate());
}
function atTime(date, h, mi) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, mi, 0, 0);
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// ─── NEXT NOTIFICATION TIME ───
function nextNotificationMs(task) {
  if (!task.dueTime || task.completed) return null;
  const [h, mi]    = task.dueTime.split(':').map(Number);
  const now         = new Date();
  const todayStr    = localDateStr();
  const alreadyToday = task.notifiedDate === todayStr;
  const todayAt     = atTime(now, h, mi);
  const stillToday  = todayAt.getTime() > Date.now();

  switch (task.category) {
    case 'daily': {
      if (!alreadyToday && stillToday) return todayAt.getTime();
      return atTime(addDays(now, 1), h, mi).getTime();
    }
    case 'weekly': {
      if (!task.dueDate) {
        if (!alreadyToday && stillToday) return todayAt.getTime();
        return atTime(addDays(now, 1), h, mi).getTime();
      }
      const [wy,wm,wd] = task.dueDate.split('-').map(Number);
      const targetDow  = new Date(wy,wm-1,wd).getDay();
      const isToday    = now.getDay() === targetDow;
      if (isToday && !alreadyToday && stillToday) return todayAt.getTime();
      const daysAhead  = ((targetDow - now.getDay() + 7) % 7) || 7;
      return atTime(addDays(now, daysAhead), h, mi).getTime();
    }
    case 'monthly': {
      if (!task.dueDate) {
        if (!alreadyToday && stillToday) return todayAt.getTime();
        return atTime(addDays(now, 1), h, mi).getTime();
      }
      const [,,md] = task.dueDate.split('-').map(Number);
      const isToday = now.getDate() === md;
      if (isToday && !alreadyToday && stillToday) return todayAt.getTime();
      const next = new Date(now.getFullYear(), now.getMonth() + (isToday ? 1 : 0), md, h, mi, 0, 0);
      if (next.getDate() !== md) next.setDate(0);
      return next.getTime();
    }
    case 'once': {
      if (!task.dueDate || task.notifiedDate === task.dueDate) return null;
      const [oy,om,od] = task.dueDate.split('-').map(Number);
      const dueMs = new Date(oy,om-1,od,h,mi,0,0).getTime();
      return dueMs > Date.now() ? dueMs : null;
    }
    case 'yearly': {
      if (!task.dueDate) {
        if (!alreadyToday && stillToday) return todayAt.getTime();
        return atTime(addDays(now, 1), h, mi).getTime();
      }
      const [,ym,yd] = task.dueDate.split('-').map(Number);
      const isToday  = now.getMonth()+1 === ym && now.getDate() === yd;
      if (isToday && !alreadyToday && stillToday) return todayAt.getTime();
      return new Date(now.getFullYear() + (isToday ? 1 : 0), ym-1, yd, h, mi, 0, 0).getTime();
    }
  }
  return null;
}

// ─── TELEGRAM ───
const CAT_AR = {daily:'☀️ يومية',weekly:'📅 أسبوعية',monthly:'🗓️ شهرية',yearly:'🎯 سنوية',once:'📌 مرة واحدة'};
const PRI_AR = {high:'🔴 عالية',medium:'🟡 متوسطة',low:'🟢 منخفضة'};
const SEP    = '━━━━━━━━━━━━━━━━━━';

async function sendTelegram(task, headerOverride) {
  if (!tg.token || !tg.chatId || !tg.on) return;
  const [y,mo,d] = (task.dueDate||'').split('-').map(Number);
  let text = headerOverride ? `${headerOverride}\n\n` : `📋 *تذكير بمهمة*\n\n`;
  text += `📌 *${task.title}*\n${SEP}`;
  text += `\n📂 *التصنيف:* ${CAT_AR[task.category]||task.category}`;
  if (task.subcategory) text += ` › ${task.subcategory}`;
  text += `\n${PRI_AR[task.priority]||''} *الأولوية*`;
  if (task.dueDate || task.dueTime) {
    text += `\n⏰ *الموعد:*`;
    if (task.dueDate) text += ` ${d}/${mo}/${y}`;
    if (task.dueTime) text += ` 🕐 ${task.dueTime}`;
  }
  if (task.description) text += `\n📝 *ملاحظات:* ${task.description}`;
  if (task.checklist?.length) {
    const done = task.checklist.filter(x=>x.done).length;
    text += `\n✅ *قائمة المراجعة:* ${done}/${task.checklist.length} خطوة`;
  }
  try {
    await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: tg.chatId, text, parse_mode:'Markdown'})
    });
  } catch {}
}

// ─── SCHEDULE ───
function scheduleAll(tasks) {
  timers.forEach(clearTimeout);
  timers = [];
  tasks.forEach(scheduleOne);
}

function scheduleOne(task) {
  const nextMs = nextNotificationMs(task);
  if (!nextMs) return;
  const delay = nextMs - Date.now();
  if (delay <= 0 || delay > 48 * 3600000) return;

  const dateStr = localDateStr(new Date(nextMs));
  const id = setTimeout(() => {
    const body = task.description ||
      (CAT_AR[task.category]||'') + (task.subcategory ? ' · ' + task.subcategory : '');

    // 1. Browser notification
    self.registration.showNotification('📋 ' + task.title, {
      body, tag: task.id + '-' + dateStr, requireInteraction: true, dir: 'rtl', lang: 'ar'
    });

    // 2. Telegram message
    sendTelegram(task);

    // 3. Tell open tabs to mark as notified
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
      .then(cs => cs.forEach(c => c.postMessage({ type: 'NOTIFIED', taskId: task.id, date: dateStr })));

    // 4. Re-schedule for next recurrence
    setTimeout(() => scheduleOne({ ...task, notifiedDate: dateStr }), 65000);
  }, delay);

  timers.push(id);
}

// ─── SESSIONS ───
let sessTimers = [];

function scheduleSessions(sessions) {
  sessTimers.forEach(clearTimeout);
  sessTimers = [];
  const now = Date.now();
  for (const s of sessions) {
    if (!s.date || !s.time) continue;
    const [sy,sm,sd] = s.date.split('-').map(Number);
    const [sh,smi]   = s.time.split(':').map(Number);
    const sessMs     = new Date(sy,sm-1,sd,sh,smi,0,0).getTime();
    const ms1day     = sessMs - 24*3600000;
    const ms1hour    = sessMs - 3600000;

    function schedSess(fireMs, when, flagKey) {
      if (s[flagKey]) return;
      const delay = fireMs - now;
      if (delay <= 0 || delay > 49*3600000) return;
      sessTimers.push(setTimeout(async () => {
        // Browser notification
        self.registration.showNotification('⚖️ تذكير بجلسة', {
          body: `${s.client} | ${s.caseNum} | ${s.court}`,
          tag: `sess-${s.id}-${when}`, requireInteraction: true, dir: 'rtl'
        });
        // Telegram
        await sendTelegram(fmtSessMsg(s, when));
        // Notify page
        self.clients.matchAll({includeUncontrolled:true,type:'window'})
          .then(cs => cs.forEach(c => c.postMessage({type:'SESS_NOTIFIED',sessId:s.id,flag:flagKey})));
      }, delay));
    }

    schedSess(ms1day,  '1day',  'n1d');
    schedSess(ms1hour, '1hour', 'n1h');
  }
}

function fmtSessMsg(s, when) {
  const headers = {
    '1day':  '🏛️ *تذكير بجلسة — غداً*',
    '1hour': '⚠️ *تذكير عاجل — الجلسة بعد ساعة*'
  };
  const [y,m,d] = s.date.split('-').map(Number);
  let t = `${headers[when]||'🏛️ *تذكير بجلسة*'}\n\n${SEP}`;
  t += `\n👤 *الموكل:* ${s.client}`;
  if (s.sessType) t += `\n🏷️ *نوع الجلسة:* ${s.sessType}`;
  t += `\n📋 *رقم القضية:* ${s.caseNum}`;
  t += `\n🏛️ *المحكمة:* ${s.court}`;
  t += `\n📅 *التاريخ:* ${d}/${m}/${y}`;
  t += `\n🕐 *الوقت:* ${s.time}`;
  if (s.notes) t += `\n📝 *ملاحظات:* ${s.notes}`;
  return t;
}

// ─── NOTIFICATION CLICK ───
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./'))
  );
});
