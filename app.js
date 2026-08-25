(() => {
  "use strict";

  const STORAGE_KEY = "vitbSport.local.v1";
  const DATA_VERSION = 3;
  const root = document.querySelector("#view-root");
  const sidebar = document.querySelector("#sidebar");
  const menuButton = document.querySelector("#mobile-menu");
  const scrim = document.querySelector("#sidebar-scrim");
  const toastRegion = document.querySelector("#toast-region");
  const confirmDialog = document.querySelector("#confirm-dialog");
  const confirmCancelButton = document.querySelector("#confirm-cancel");
  const confirmOkButton = document.querySelector("#confirm-ok");

  const sportCatalog = {
    running: { name: "跑步", icon: "跑", tone: "#5f8ff6", wash: "#eef3ff" },
    swimming: { name: "游泳", icon: "泳", tone: "#3ea7bd", wash: "#e9f8fb" },
    jumpRope: { name: "跳绳", icon: "绳", tone: "#8c7cf2", wash: "#f2efff" },
    boxing: { name: "拳击", icon: "拳", tone: "#df615b", wash: "#fff0ef" },
    sanda: { name: "散打", icon: "散", tone: "#e16f46", wash: "#fff1e9" },
    cycling: { name: "骑行", icon: "骑", tone: "#42a36d", wash: "#eaf8ef" },
    hiking: { name: "徒步", icon: "徒", tone: "#a17645", wash: "#f8f0e5" },
    ball: { name: "球类", icon: "球", tone: "#f0a24b", wash: "#fff4e5" },
    custom: { name: "自定义", icon: "自", tone: "#718078", wash: "#f0f3f1" }
  };

  const planTypes = {
    training: { name: "力量训练", tone: "#86cc35" },
    sport: { name: "运动日", tone: "#5f8ff6" },
    rest: { name: "休息日", tone: "#9aa69f" }
  };

  const privacyMeta = {
    workouts: ["力量训练", "动作、负重、组次、RPE 与训练备注"],
    activities: ["运动记录", "距离、时长、心率和专项数据"],
    plans: ["训练计划", "计划内容与完成情况"],
    nutrition: ["饮食记录", "餐食、热量、营养素和饮水"],
    body: ["身体数据", "体重、围度等敏感身体信息"]
  };

  const viewMeta = {
    dashboard: ["首页", "今天也向目标靠近一点。"],
    training: ["训练记录", "记录每一次有效训练，让进步有据可循。"],
    activities: ["运动记录", "不同运动使用不同字段，保留真正有用的数据。"],
    plans: ["训练计划", "安排训练日、运动日和恢复日，保持长期节奏。"],
    nutrition: ["饮食记录", "把能量和营养素放进训练的整体视角。"],
    body: ["身体数据", "用稳定的记录观察趋势，不被单次波动影响。"],
    analytics: ["数据分析", "把训练量、运动表现和身体趋势放在一起看。"],
    members: ["Betty / Stephen", "同一台设备上的两个独立个人界面，记录互不混合。"],
    privacy: ["隐私与数据", "每类数据独立设置权限，并由你掌握本地备份。"]
  };

  const fixedMembers = [
    { id: "betty", name: "Betty", role: "个人训练空间", color: "#b7f36b", initial: "B" },
    { id: "stephen", name: "Stephen", role: "个人训练空间", color: "#8fb4ff", initial: "S" }
  ];

  let state = loadState();
  let currentView = "dashboard";
  let pendingPlanId = null;

  function dateOffset(offset) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function makeInitialState() {
    return {
      version: DATA_VERSION,
      settings: {
        activeMemberId: "betty",
        members: fixedMembers.map((member) => ({ ...member }))
      },
      privacy: {
        workouts: "private",
        activities: "private",
        plans: "private",
        nutrition: "private",
        body: "private"
      },
      workouts: [],
      activities: [],
      plans: [],
      nutrition: [],
      body: [],
      liveSessions: { betty: null, stephen: null }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeInitialState();
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      console.warn("Unable to load local data", error);
      return makeInitialState();
    }
  }

  function normalizeState(input) {
    const clean = makeInitialState();
    if (!input || typeof input !== "object") return clean;
    clean.settings.activeMemberId = input.settings?.activeMemberId === "stephen" ? "stephen" : "betty";
    clean.settings.members = fixedMembers.map((member) => ({ ...member }));
    Object.keys(clean.privacy).forEach((key) => {
      clean.privacy[key] = input.privacy?.[key] === "private" ? "private" : input.privacy?.[key] ? "shared" : clean.privacy[key];
    });
    ["workouts", "activities", "plans", "nutrition", "body"].forEach((key) => {
      clean[key] = Array.isArray(input[key])
        ? input[key].map((item) => ({
            ...item,
            memberId: item.memberId === "stephen" ? "stephen" : "betty",
            ...(["workouts", "activities"].includes(key) ? { status: item.status === "in_progress" ? "in_progress" : "completed" } : {})
          }))
        : [];
    });
    if (input.liveSessions && typeof input.liveSessions === "object") {
      clean.liveSessions.betty = input.liveSessions.betty || null;
      clean.liveSessions.stephen = input.liveSessions.stephen || null;
    }
    ["betty", "stephen"].forEach((memberId) => {
      const session = clean.liveSessions[memberId];
      if (!session) return;
      session.memberId = memberId;
      session.recordId = session.recordId || uid();
      if (!clean.workouts.some((item) => item.id === session.recordId)) {
        clean.workouts.push(liveWorkoutFromSession(session));
      }
    });
    clean.plans.forEach((plan) => {
      if (plan.type === "rest") return;
      const records = plan.type === "training" ? clean.workouts : clean.activities;
      let linked = records.find((item) => item.planId === plan.id && item.memberId === plan.memberId && item.status !== "in_progress");
      if (!linked && plan.completed) {
        linked = records.find((item) => item.memberId === plan.memberId && item.date === plan.date && item.status !== "in_progress" && !item.planId);
        if (linked) linked.planId = plan.id;
      }
      plan.completed = Boolean(linked);
    });
    return clean;
  }

  function saveState(message) {
    state.version = DATA_VERSION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (message) toast(message);
    } catch (error) {
      toast("本地保存失败，请检查浏览器存储空间。", true);
      console.error(error);
    }
  }

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseDate(value) {
    return new Date(`${value}T12:00:00`);
  }

  function formatDate(value, options = { month: "short", day: "numeric" }) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("zh-CN", options).format(parseDate(value));
  }

  function formatMinutes(value) {
    const minutes = Math.round(number(value));
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  function activeMember() {
    return state.settings.members.find((member) => member.id === state.settings.activeMemberId)
      || state.settings.members[0];
  }

  function recordsFor(key) {
    return recordsForMember(key, activeMember().id);
  }

  function recordsForMember(key, memberId) {
    return state[key].filter((item) => item.memberId === memberId);
  }

  function completedRecordsFor(key) {
    return completedRecordsForMember(key, activeMember().id);
  }

  function completedRecordsForMember(key, memberId) {
    return recordsForMember(key, memberId).filter((item) => item.status !== "in_progress");
  }

  function liveWorkoutFromSession(session, finished = false) {
    const completedSets = number(session.completedSets);
    const targetSets = Math.max(1, number(session.targetSets, 1));
    return {
      id: session.recordId,
      memberId: session.memberId,
      date: session.date || dateOffset(0),
      exercise: session.exercise,
      bodyPart: session.bodyPart,
      weight: number(session.weight),
      sets: completedSets,
      reps: number(session.reps),
      rest: number(session.rest),
      rpe: number(session.rpe, 7),
      duration: Math.max(finished ? 1 : 0, Math.round((Date.now() - number(session.startedAt, Date.now())) / 60000)),
      notes: finished
        ? `实时计数：完成 ${completedSets}/${targetSets} 组`
        : `实时计数进行中：${completedSets}/${targetSets} 组`,
      status: finished ? "completed" : "in_progress",
      source: "live",
      targetSets,
      planId: session.planId || null
    };
  }

  function updateLiveWorkout(session, finished = false) {
    const next = liveWorkoutFromSession(session, finished);
    const index = state.workouts.findIndex((item) => item.id === session.recordId);
    if (index >= 0) state.workouts[index] = { ...state.workouts[index], ...next };
    else state.workouts.push(next);
    return next;
  }

  function syncPlanCompletion(planId = null) {
    state.plans.forEach((plan) => {
      if (planId && plan.id !== planId) return;
      if (plan.type === "rest") return;
      const records = plan.type === "training" ? state.workouts : state.activities;
      plan.completed = records.some((item) => item.memberId === plan.memberId && item.planId === plan.id && item.status !== "in_progress");
    });
  }

  function currentLiveSession() {
    return state.liveSessions?.[activeMember().id] || null;
  }

  function startOfWeek(input = new Date()) {
    const date = new Date(input);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function weekDates() {
    const start = startOfWeek();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date.toISOString().slice(0, 10);
    });
  }

  function isThisWeek(value) {
    const date = parseDate(value);
    const start = startOfWeek();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return date >= start && date < end;
  }

  function sorted(items, direction = "desc") {
    return [...items].sort((a, b) => direction === "desc"
      ? String(b.date).localeCompare(String(a.date))
      : String(a.date).localeCompare(String(b.date)));
  }

  function pageHead(view, actions = "") {
    const [title, subtitle] = viewMeta[view];
    return `
      <div class="page-head">
        <div>
          <p class="eyebrow">VITB SPORT · LOCAL</p>
          <h1 class="page-title">${title}</h1>
          <p class="page-subtitle">${subtitle}</p>
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </div>`;
  }

  function emptyState(icon, title, message) {
    return `<div class="empty-state"><span>${icon}</span><strong>${title}</strong><p>${message}</p></div>`;
  }

  function statCard(label, value, unit, icon, note, tone, wash) {
    return `
      <article class="card stat-card" style="--tone:${tone};--wash:${wash}">
        <div class="stat-label"><span>${label}</span><span class="stat-icon">${icon}</span></div>
        <div class="stat-value">${value} <small>${unit}</small></div>
        <div class="stat-note">${note}</div>
      </article>`;
  }

  function weeklyOverviewFor(member) {
    const dates = weekDates();
    const workouts = completedRecordsForMember("workouts", member.id);
    const activities = completedRecordsForMember("activities", member.id);
    const plans = recordsForMember("plans", member.id);
    const weekWorkouts = workouts.filter((item) => isThisWeek(item.date));
    const weekActivities = activities.filter((item) => isThisWeek(item.date));
    const weekPlans = plans.filter((item) => isThisWeek(item.date));
    const sessions = [...weekWorkouts, ...weekActivities];
    const minutesByDay = dates.map((date) => sessions
      .filter((item) => item.date === date)
      .reduce((sum, item) => sum + number(item.duration), 0));
    const previousStart = startOfWeek();
    previousStart.setDate(previousStart.getDate() - 7);
    const currentStart = startOfWeek();
    const previousSessions = [...workouts, ...activities].filter((item) => {
      const date = parseDate(item.date);
      return date >= previousStart && date < currentStart;
    }).length;
    const completedPlans = weekPlans.filter((item) => item.completed).length;

    return {
      member,
      sessions: sessions.length,
      minutes: minutesByDay.reduce((sum, value) => sum + value, 0),
      minutesByDay,
      previousSessions,
      completedPlans,
      planCount: weekPlans.length,
      completion: weekPlans.length ? Math.round(completedPlans / weekPlans.length * 100) : null
    };
  }

  function weeklyChangeText(summary) {
    if (!summary.sessions && !summary.previousSessions) return "本周还没有记录";
    const change = summary.sessions - summary.previousSessions;
    if (change > 0) return `比上周多 ${change} 次`;
    if (change < 0) return `比上周少 ${Math.abs(change)} 次`;
    return "与上周持平";
  }

  function weeklyOverviewCard(summary, maxMinutes) {
    const active = summary.member.id === activeMember().id;
    const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
    const bars = summary.minutesByDay.map((minutes, index) => {
      const height = minutes && maxMinutes ? Math.max(8, Math.round(minutes / maxMinutes * 100)) : 0;
      return `<div class="weekly-bar-day" aria-label="周${weekdays[index]} ${minutes} 分钟"><span class="weekly-bar-track">${minutes ? `<span class="weekly-bar-fill" style="height:${height}%"></span>` : ""}</span><small>${weekdays[index]}</small></div>`;
    }).join("");

    return `
      <article class="weekly-member-card ${active ? "is-active" : ""}" style="--member-color:${esc(summary.member.color)}">
        <div class="weekly-member-head">
          <button class="weekly-member-switch" type="button" data-action="select-member" data-id="${summary.member.id}" aria-label="切换到 ${esc(summary.member.name)} 界面">
            <span class="weekly-member-avatar">${esc(summary.member.initial)}</span>
            <span><strong>${esc(summary.member.name)}</strong><small>${esc(weeklyChangeText(summary))}</small></span>
          </button>
          <span class="weekly-member-state">${active ? "当前界面" : "切换"}</span>
        </div>
        <div class="weekly-metrics">
          <div><span>训练次数</span><strong>${summary.sessions}<small> 次</small></strong></div>
          <div><span>运动时长</span><strong>${summary.minutes}<small> 分</small></strong></div>
          <div><span>计划完成</span><strong>${summary.completion ?? "—"}<small>${summary.completion === null ? "" : "%"}</small></strong></div>
        </div>
        <div class="weekly-bars" aria-label="${esc(summary.member.name)} 本周每天训练时长">${bars}</div>
        <div class="weekly-card-foot"><span>${summary.completedPlans}/${summary.planCount} 项计划完成</span><span>${summary.sessions ? formatMinutes(summary.minutes) : "等待第一次记录"}</span></div>
      </article>`;
  }

  function renderWeeklyOverview() {
    const summaries = state.settings.members.map(weeklyOverviewFor);
    const maxMinutes = Math.max(0, ...summaries.flatMap((summary) => summary.minutesByDay));
    const dates = weekDates();
    const range = `${formatDate(dates[0], { month: "numeric", day: "numeric" })}—${formatDate(dates[6], { month: "numeric", day: "numeric" })}`;

    return `
      <section class="dashboard-weekly-overview" aria-labelledby="weekly-overview-title">
        <div class="weekly-overview-head">
          <div>
            <p class="eyebrow">BETTY × STEPHEN · ${range}</p>
            <h1 id="weekly-overview-title">本周训练总览</h1>
            <p>两个人的训练次数、运动时长和计划完成情况。当前记录到 ${esc(activeMember().name)}。</p>
          </div>
          <div class="hero-actions">
            <button class="button button-primary" type="button" data-navigate="training" data-open="strength-composer">＋ 记录训练</button>
            <button class="button button-quiet" type="button" data-navigate="activities" data-open="activity-composer">记录运动</button>
          </div>
        </div>
        <div class="weekly-member-grid">${summaries.map((summary) => weeklyOverviewCard(summary, maxMinutes)).join("")}</div>
      </section>`;
  }

  function renderDashboard() {
    const workouts = completedRecordsFor("workouts");
    const activities = completedRecordsFor("activities");
    const plans = recordsFor("plans");
    const weekWorkouts = workouts.filter((item) => isThisWeek(item.date));
    const weekActivities = activities.filter((item) => isThisWeek(item.date));
    const weekPlans = plans.filter((item) => isThisWeek(item.date));
    const completedPlans = weekPlans.filter((item) => item.completed).length;
    const completion = weekPlans.length ? Math.round((completedPlans / weekPlans.length) * 100) : 0;
    const weekMinutes = [...weekWorkouts, ...weekActivities].reduce((sum, item) => sum + number(item.duration), 0);
    const todayPlans = plans.filter((item) => item.date === dateOffset(0));
    const recent = [
      ...workouts.map((item) => ({ ...item, category: "workout" })),
      ...activities.map((item) => ({ ...item, category: "activity" }))
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const liveSession = currentLiveSession();

    return `
      <section class="view">
        ${renderWeeklyOverview()}

        ${renderLiveCounter(liveSession)}

        <div class="grid grid-4 stats-mobile section-gap">
          ${statCard("本周训练", weekWorkouts.length, "次", "训", "只统计力量训练记录", "#689b2d", "#effbdd")}
          ${statCard("运动时长", weekMinutes, "分钟", "时", formatMinutes(weekMinutes), "#4f7dde", "#eef3ff")}
          ${statCard("计划完成率", completion, "%", "✓", `${completedPlans}/${weekPlans.length} 项已完成`, "#8a6ce0", "#f2efff")}
          ${statCard("最近 RPE", workouts[0]?.rpe ?? "—", workouts[0] ? "/ 10" : "", workouts[0] ? "强" : "—", workouts[0] ? `${esc(workouts[0].exercise)} · ${formatDate(workouts[0].date)}` : "暂无训练", "#d27645", "#fff3e7")}
        </div>

        <div class="grid grid-3 section-gap dashboard-main">
          <article class="card card-pad span-2">
            <div class="card-head">
              <div><h2 class="card-title">本周安排</h2><p class="card-subtitle">训练、运动与恢复保持平衡</p></div>
              <button class="button button-link" type="button" data-navigate="plans">查看计划 →</button>
            </div>
            ${renderWeekStrip(plans)}
          </article>

          <article class="card card-pad">
            <div class="card-head">
              <div><h2 class="card-title">今日训练</h2><p class="card-subtitle">${formatDate(dateOffset(0), { month: "long", day: "numeric", weekday: "long" })}</p></div>
              <div class="completion-ring" style="--value:${todayPlans.length ? Math.round(todayPlans.filter((item) => item.completed).length / todayPlans.length * 100) : 0}"><strong>${todayPlans.filter((item) => item.completed).length}/${todayPlans.length}</strong></div>
            </div>
            ${todayPlans.length ? `<div class="list">${todayPlans.map(planListItem).join("")}</div>` : emptyState("□", "今天暂无安排", "前往训练计划添加训练日、运动日或休息日。")}
          </article>
        </div>

        <div class="grid grid-2 section-gap">
          <article class="card card-pad">
            <div class="card-head"><div><h2 class="card-title">近 7 日运动时间</h2><p class="card-subtitle">力量训练与各类运动合计</p></div><span class="tag">${formatMinutes(weekMinutes)}</span></div>
            ${renderWeeklyMinutesChart(workouts, activities)}
          </article>
          <article class="card card-pad">
            <div class="card-head"><div><h2 class="card-title">最近记录</h2><p class="card-subtitle">最近完成的训练和运动</p></div><button class="button button-link" type="button" data-navigate="analytics">分析 →</button></div>
            ${recent.length ? `<div class="list">${recent.map(recentListItem).join("")}</div>` : emptyState("↗", "还没有记录", "添加第一次训练或运动后，记录会出现在这里。")}
          </article>
        </div>
      </section>`;
  }

  function renderLiveCounter(session) {
    if (!session) {
      const selectedPlan = recordsFor("plans").find((plan) => plan.id === pendingPlanId && plan.type === "training");
      return `
        <article class="card live-counter section-gap is-setup">
          <div class="live-counter-intro">
            <span class="live-kicker"><span class="live-pulse"></span>实时计数组</span>
            <h2>做完一组，立即按一下。</h2>
            <p>组数会马上保存在 ${esc(activeMember().name)} 的界面中。刷新或误关页面后，仍可从上次进度继续。</p>
          </div>
          <form class="live-setup-form" id="live-session-form">
            <div class="live-form-grid">
              ${planSelectField("training", selectedPlan?.id || "")}
              ${selectField("bodyPart", "训练部位", ["肩部", "胸部", "背部", "手臂", "腿部", "臀部", "核心", "全身"], "肩部")}
              ${field("exercise", "当前动作", "text", selectedPlan?.title || "", "例如：哑铃肩推", true, "live-exercise-field")}
              ${field("targetSets", "目标组数", "number", "6", "", true, "", "min=\"1\" max=\"30\"")}
              ${field("reps", "每组次数", "number", "6", "", true, "", "min=\"1\" max=\"999\"")}
              ${field("weight", "重量（kg）", "number", "", "选填", false, "", "min=\"0\" step=\"0.5\"")}
              ${field("rest", "组间休息（秒）", "number", "90", "", true, "", "min=\"0\" max=\"900\"")}
              ${field("rpe", "预计 RPE", "number", "7", "", false, "", "min=\"1\" max=\"10\"")}
            </div>
            <button class="button button-primary live-start-button" type="submit">开始实时计数 →</button>
          </form>
        </article>`;
    }

    const completed = number(session.completedSets);
    const target = Math.max(1, number(session.targetSets));
    const finished = completed >= target;
    const restRemaining = session.restEndsAt ? Math.max(0, Math.ceil((session.restEndsAt - Date.now()) / 1000)) : 0;
    const resting = restRemaining > 0;
    const percent = Math.min(100, Math.round(completed / target * 100));
    const setDots = Array.from({ length: target }, (_, index) => `<span class="set-dot ${index < completed ? "is-done" : index === completed ? "is-next" : ""}">${index < completed ? "✓" : index + 1}</span>`).join("");

    return `
      <article class="card live-counter section-gap is-active" style="--live-progress:${percent}%">
        <div class="live-session-head">
          <div>
            <span class="live-kicker"><span class="live-pulse"></span>${finished ? "目标已完成" : "正在计数 · 记录已同步"}</span>
            <h2>${esc(session.exercise)}</h2>
            <p>${esc(session.bodyPart)} · ${session.weight ? `${number(session.weight)} kg · ` : ""}${target} × ${number(session.reps)} · 休息 ${number(session.rest)} 秒</p>
          </div>
          <button class="button button-small live-discard" type="button" data-action="discard-live-session">${completed ? "结束本次" : "放弃本次"}</button>
        </div>
        <div class="live-session-body">
          <div class="live-progress-panel">
            <div class="live-count"><strong>${completed}</strong><span>/ ${target} 组</span></div>
            <div class="live-progress-track"><span></span></div>
            <div class="set-dots" aria-label="已完成 ${completed} 组，共 ${target} 组">${setDots}</div>
            <small>每组 ${number(session.reps)} 次${session.weight ? ` · ${number(session.weight)} kg` : ""}</small>
          </div>
          <div class="live-action-panel">
            ${finished ? `
              <div class="live-finished"><span>✓</span><strong>${target} 组全部完成</strong><small>训练记录已经同步；结束后会同时完成关联计划。</small></div>
              <button class="live-complete-button is-finish" type="button" data-action="finish-live-session">完成并保存</button>
            ` : `
              <div class="rest-status ${resting ? "is-resting" : ""}">
                <span>${resting ? "休息倒计时" : `下一组：第 ${completed + 1} 组`}</span>
                <strong id="rest-countdown">${resting ? formatCountdown(restRemaining) : "可以开始"}</strong>
                ${resting ? `<button type="button" data-action="skip-rest">跳过休息</button>` : ""}
              </div>
              <button class="live-complete-button" type="button" data-action="complete-live-set" ${resting ? "disabled" : ""}>
                <span>${resting ? "休息中" : `完成第 ${completed + 1} 组`}</span><small>${resting ? "倒计时结束后可记录下一组" : "做完后立即按一下"}</small>
              </button>
            `}
            <div class="live-secondary-actions">
              <button class="button button-quiet" type="button" data-action="undo-live-set" ${completed ? "" : "disabled"}>↶ 撤销上一组</button>
              ${completed && !finished ? `<button class="button button-dark" type="button" data-action="finish-live-session">提前结束并保存</button>` : ""}
            </div>
          </div>
        </div>
      </article>`;
  }

  function formatCountdown(seconds) {
    const safe = Math.max(0, Math.ceil(number(seconds)));
    const minutes = Math.floor(safe / 60);
    return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function renderWeekStrip(plans) {
    const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
    return `<div class="week-strip">${weekDates().map((date, index) => {
      const item = plans.find((plan) => plan.date === date);
      const meta = item ? planTypes[item.type] : null;
      return `<div class="day-card ${date === dateOffset(0) ? "is-today" : ""}">
        <small>周${weekdays[index]}</small><strong>${parseDate(date).getDate()}</strong>
        ${item ? `<div class="day-event ${item.completed ? "is-done" : ""}"><span class="event-dot" style="--tone:${meta.tone}"></span>${esc(item.title)}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function planListItem(item) {
    const meta = planTypes[item.type] || planTypes.training;
    return `<div class="list-item">
      ${planStatusButton(item)}
      <span class="list-icon" style="--tone:${meta.tone};--wash:${meta.tone}18">${item.type === "rest" ? "休" : item.type === "sport" ? "动" : "训"}</span>
      <span class="list-main"><strong>${esc(item.title)}</strong><small>${meta.name} · ${item.duration ? `${number(item.duration)} 分钟` : "未设置时长"}${item.type !== "rest" ? item.completed ? " · 已同步记录" : " · 等待记录" : ""}</small></span>
    </div>`;
  }

  function planStatusButton(item) {
    if (item.type === "rest") {
      return `<button class="check-button ${item.completed ? "is-done" : ""}" type="button" data-action="toggle-plan" data-id="${item.id}" aria-label="${item.completed ? "标记休息日为未完成" : "标记休息日为已完成"}">${item.completed ? "✓" : ""}</button>`;
    }
    if (item.completed) {
      return `<button class="check-button is-done" type="button" data-action="view-plan-record" data-id="${item.id}" aria-label="查看关联记录">✓</button>`;
    }
    return `<button class="check-button is-ready" type="button" data-action="start-plan" data-id="${item.id}" aria-label="${item.type === "training" ? "开始计划计数" : "记录计划运动"}">→</button>`;
  }

  function recentListItem(item) {
    if (item.category === "workout") {
      return `<div class="list-item"><span class="list-icon">训</span><span class="list-main"><strong>${esc(item.exercise)}</strong><small>${formatDate(item.date)} · ${esc(item.bodyPart)} · RPE ${number(item.rpe)}</small></span><span class="list-meta">${number(item.weight)} kg<br>${number(item.sets)}×${number(item.reps)}</span></div>`;
    }
    const meta = sportCatalog[item.sport] || sportCatalog.custom;
    return `<div class="list-item"><span class="list-icon" style="--tone:${meta.tone};--wash:${meta.wash}">${meta.icon}</span><span class="list-main"><strong>${meta.name}</strong><small>${formatDate(item.date)} · ${esc(item.notes || "运动记录")}</small></span><span class="list-meta">${activityPrimary(item)}<br>${number(item.duration)} 分钟</span></div>`;
  }

  function renderTraining() {
    const workouts = sorted(recordsFor("workouts"));
    return `
      <section class="view">
        ${pageHead("training", `<button class="button button-primary" type="button" data-open-details="strength-composer">＋ 新训练</button>`)}
        <details class="card composer" id="strength-composer">
          <summary><span class="composer-title"><strong>添加力量训练</strong><small>一次记录一个主要动作，便于追踪负重变化</small></span></summary>
          <form class="form-body" id="strength-form">
            <div class="form-grid">
              ${field("date", "日期", "date", dateOffset(0), "", true)}
              ${planSelectField("training", pendingPlanId || "")}
              ${selectField("bodyPart", "训练部位", ["胸部", "背部", "肩部", "手臂", "腿部", "臀部", "核心", "全身"], "腿部")}
              ${field("exercise", "动作", "text", "", "例如：杠铃深蹲", true, "span-2")}
              ${field("weight", "重量（kg）", "number", "", "0", true, "", "min=\"0\" step=\"0.5\"")}
              ${field("sets", "组数", "number", "", "4", true, "", "min=\"1\" max=\"99\"")}
              ${field("reps", "每组次数", "number", "", "8", true, "", "min=\"1\" max=\"999\"")}
              ${field("rest", "组间休息（秒）", "number", "", "90", true, "", "min=\"0\"")}
              ${field("duration", "训练时长（分钟）", "number", "", "45", true, "", "min=\"1\"")}
              <div class="field span-3"><label for="strength-rpe">主观强度 RPE</label><div class="range-row"><input id="strength-rpe" name="rpe" type="range" min="1" max="10" value="7"><output class="range-value" id="strength-rpe-value">7</output></div><small class="field-help">1 很轻松 · 7 有挑战 · 10 极限</small></div>
              <div class="field span-4"><label for="strength-notes">备注</label><textarea id="strength-notes" name="notes" placeholder="动作感受、疼痛、节奏或下次调整"></textarea></div>
            </div>
            <div class="form-actions"><button class="button button-quiet" type="reset">清空</button><button class="button button-primary" type="submit">保存训练</button></div>
          </form>
        </details>

        <article class="card section-gap">
          <div class="card-pad card-head"><div><h2 class="card-title">力量训练记录</h2><p class="card-subtitle">共 ${workouts.length} 条本地记录</p></div><span class="tag">仅本机</span></div>
          ${workouts.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日期 / 动作</th><th>部位</th><th>重量</th><th>训练量</th><th>休息</th><th>RPE</th><th>时长</th><th></th></tr></thead><tbody>${workouts.map(workoutRow).join("")}</tbody></table></div>` : emptyState("训", "还没有力量训练", "打开上方表单，保存第一次力量训练。")}
        </article>
      </section>`;
  }

  function workoutRow(item) {
    return `<tr>
      <td><span class="record-title">${esc(item.exercise)}${item.status === "in_progress" ? ` <span class="tag tag-live">进行中</span>` : ""}</span><span class="record-sub">${formatDate(item.date, { year: "numeric", month: "short", day: "numeric" })}${item.notes ? ` · ${esc(item.notes)}` : ""}</span></td>
      <td><span class="tag">${esc(item.bodyPart)}</span></td><td>${number(item.weight)} kg</td><td>${number(item.sets)} × ${number(item.reps)}</td><td>${number(item.rest)} 秒</td><td>${number(item.rpe)} / 10</td><td>${number(item.duration)} 分</td>
      <td><button class="danger-link" type="button" data-action="delete-record" data-collection="workouts" data-id="${item.id}">删除</button></td>
    </tr>`;
  }

  function renderActivities() {
    const activities = sorted(recordsFor("activities"));
    return `
      <section class="view">
        ${pageHead("activities", `<button class="button button-primary" type="button" data-open-details="activity-composer">＋ 新运动</button>`)}
        <details class="card composer" id="activity-composer">
          <summary><span class="composer-title"><strong>添加运动记录</strong><small>选择运动后会自动显示对应字段</small></span></summary>
          <form class="form-body" id="activity-form">
            <div class="form-grid">
              ${field("date", "日期", "date", dateOffset(0), "", true)}
              ${planSelectField("sport", pendingPlanId || "")}
              <div class="field"><label for="sport-type">运动类型</label><select id="sport-type" name="sport" required>${Object.entries(sportCatalog).map(([key, meta]) => `<option value="${key}">${meta.name}</option>`).join("")}</select></div>
              <div id="sport-fields" class="form-grid span-4">${activityFields("running")}</div>
              <div class="field span-4"><label for="activity-notes">备注</label><textarea id="activity-notes" name="notes" placeholder="路线、训练感受、装备或需要复盘的内容"></textarea></div>
            </div>
            <div class="form-actions"><button class="button button-quiet" type="reset">清空</button><button class="button button-primary" type="submit">保存运动</button></div>
          </form>
        </details>

        <div class="grid grid-4 stats-mobile section-gap">
          ${activityStat(activities, "running", "累计跑步", "km", (items) => sumDetails(items, "distance"), "跑")}
          ${activityStat(activities, "swimming", "累计游泳", "m", (items) => sumDetails(items, "distance"), "泳")}
          ${activityStat(activities, "jumpRope", "累计跳绳", "次", (items) => sumDetails(items, "count"), "绳")}
          ${statCard("累计运动", activities.reduce((sum, item) => sum + number(item.duration), 0), "分钟", "时", `${activities.length} 次运动记录`, "#d27645", "#fff3e7")}
        </div>

        <article class="card section-gap">
          <div class="card-pad card-head"><div><h2 class="card-title">全部运动记录</h2><p class="card-subtitle">共 ${activities.length} 条本地记录</p></div></div>
          ${activities.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日期 / 运动</th><th>关键数据</th><th>时长</th><th>备注</th><th></th></tr></thead><tbody>${activities.map(activityRow).join("")}</tbody></table></div>` : emptyState("↗", "还没有运动记录", "选择一种运动，表单会自动切换到对应指标。")}
        </article>
      </section>`;
  }

  function activityStat(activities, sport, label, unit, calculate, icon) {
    const items = activities.filter((item) => item.sport === sport);
    const meta = sportCatalog[sport];
    return statCard(label, round(calculate(items), 1), unit, icon, `${items.length} 次记录`, meta.tone, meta.wash);
  }

  function sumDetails(items, key) {
    return items.reduce((sum, item) => sum + number(item.details?.[key]), 0);
  }

  function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round(number(value) * factor) / factor;
  }

  function activityRow(item) {
    const meta = sportCatalog[item.sport] || sportCatalog.custom;
    return `<tr>
      <td><span class="record-title">${meta.name}</span><span class="record-sub">${formatDate(item.date, { year: "numeric", month: "short", day: "numeric" })}</span></td>
      <td><span class="tag" style="--tone:${meta.tone};--wash:${meta.wash}">${esc(activityPrimary(item))}</span><span class="record-sub">${esc(activitySecondary(item))}</span></td>
      <td>${number(item.duration)} 分钟</td><td>${esc(item.notes || "—")}</td>
      <td><button class="danger-link" type="button" data-action="delete-record" data-collection="activities" data-id="${item.id}">删除</button></td>
    </tr>`;
  }

  function activityPrimary(item) {
    const d = item.details || {};
    if (item.sport === "running") return `${number(d.distance)} km`;
    if (item.sport === "swimming") return `${number(d.distance)} m`;
    if (item.sport === "jumpRope") return `${number(d.count)} 次`;
    if (["boxing", "sanda"].includes(item.sport)) return `${number(d.rounds)} 回合`;
    if (["cycling", "hiking"].includes(item.sport)) return `${number(d.distance)} km`;
    if (item.sport === "ball") return d.ballType || "球类训练";
    return d.customName || "自定义运动";
  }

  function activitySecondary(item) {
    const d = item.details || {};
    if (item.sport === "running") return `配速 ${d.pace || "—"} · 心率 ${number(d.heartRate) || "—"}`;
    if (item.sport === "swimming") return `${d.stroke || "泳姿未填"} · ${number(d.poolLength)}m 池 · ${number(d.laps)} 趟`;
    if (item.sport === "jumpRope") return `${number(d.sets)} 组 · 最长连续 ${number(d.longest)} 次`;
    if (["boxing", "sanda"].includes(item.sport)) return `${d.content || "训练"} · ${number(d.roundDuration)} 分/回合 · 强度 ${number(d.intensity)}`;
    if (["cycling", "hiking"].includes(item.sport)) return `爬升 ${number(d.elevation)} m · 心率 ${number(d.heartRate) || "—"}`;
    if (item.sport === "ball") return `${d.focus || "综合练习"} · 强度 ${number(d.intensity)}`;
    return d.metric || "自定义指标";
  }

  function activityFields(sport) {
    if (sport === "running") return `
      ${field("duration", "时间（分钟）", "number", "", "35", true, "", "min=\"1\"")}
      ${field("distance", "距离（km）", "number", "", "5.0", true, "", "min=\"0\" step=\"0.01\"")}
      ${field("pace", "平均配速", "text", "", "例如 6:20", false)}
      ${field("heartRate", "平均心率（bpm）", "number", "", "145", false, "", "min=\"0\" max=\"240\"")}`;
    if (sport === "swimming") return `
      ${field("duration", "时间（分钟）", "number", "", "40", true, "", "min=\"1\"")}
      ${selectField("stroke", "泳姿", ["自由泳", "蛙泳", "仰泳", "蝶泳", "混合泳"], "自由泳")}
      ${field("distance", "距离（m）", "number", "", "1000", true, "", "min=\"0\"")}
      ${selectField("poolLength", "泳池长度", ["25", "50"], "50", "m")}
      ${field("laps", "趟数", "number", "", "20", true, "", "min=\"0\"")}`;
    if (sport === "jumpRope") return `
      ${field("duration", "时间（分钟）", "number", "", "20", true, "", "min=\"1\"")}
      ${field("count", "总次数", "number", "", "1000", true, "", "min=\"0\"")}
      ${field("sets", "组数", "number", "", "10", true, "", "min=\"1\"")}
      ${field("longest", "最长连续次数", "number", "", "180", false, "", "min=\"0\"")}`;
    if (["boxing", "sanda"].includes(sport)) return `
      ${field("duration", "总时间（分钟）", "number", "", "60", true, "", "min=\"1\"")}
      ${field("content", "训练内容", "text", "", "空击、靶练、实战…", true, "span-2")}
      ${field("rounds", "回合数", "number", "", "6", true, "", "min=\"1\"")}
      ${field("roundDuration", "每回合（分钟）", "number", "", "3", true, "", "min=\"0\" step=\"0.5\"")}
      ${field("technique", "技术重点", "text", "", "步法、组合拳、防守…", false, "span-2")}
      <div class="field span-2"><label for="sport-intensity">训练强度</label><div class="range-row"><input id="sport-intensity" name="intensity" type="range" min="1" max="10" value="7"><output class="range-value" id="sport-intensity-value">7</output></div></div>`;
    if (["cycling", "hiking"].includes(sport)) return `
      ${field("duration", "时间（分钟）", "number", "", "60", true, "", "min=\"1\"")}
      ${field("distance", "距离（km）", "number", "", "12", true, "", "min=\"0\" step=\"0.01\"")}
      ${field("elevation", "累计爬升（m）", "number", "", "120", false, "", "min=\"0\"")}
      ${field("heartRate", "平均心率（bpm）", "number", "", "135", false, "", "min=\"0\" max=\"240\"")}`;
    if (sport === "ball") return `
      ${field("duration", "时间（分钟）", "number", "", "60", true, "", "min=\"1\"")}
      ${selectField("ballType", "项目", ["篮球", "足球", "羽毛球", "网球", "乒乓球", "排球", "其他球类"], "篮球")}
      ${field("focus", "训练内容", "text", "", "比赛、技术、体能…", false)}
      <div class="field"><label for="sport-intensity">训练强度</label><div class="range-row"><input id="sport-intensity" name="intensity" type="range" min="1" max="10" value="6"><output class="range-value" id="sport-intensity-value">6</output></div></div>`;
    return `
      ${field("duration", "时间（分钟）", "number", "", "30", true, "", "min=\"1\"")}
      ${field("customName", "运动名称", "text", "", "例如：划船机", true)}
      ${field("metric", "关键数据", "text", "", "例如：5000 米 / 25 分钟", false, "span-2")}`;
  }

  function field(name, label, type, value = "", placeholder = "", required = false, className = "", attrs = "") {
    return `<div class="field ${className}"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? "required" : ""} ${attrs}></div>`;
  }

  function selectField(name, label, options, selected, suffix = "") {
    return `<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${options.map((option) => `<option value="${esc(option)}" ${String(option) === String(selected) ? "selected" : ""}>${esc(option)}${suffix}</option>`).join("")}</select></div>`;
  }

  function planSelectField(type, selected = "") {
    const plans = sorted(recordsFor("plans"), "asc").filter((plan) => plan.type === type && (!plan.completed || plan.id === selected));
    return `<div class="field"><label for="field-planId">关联计划（可选）</label><select id="field-planId" name="planId"><option value="">不关联计划</option>${plans.map((plan) => `<option value="${plan.id}" ${plan.id === selected ? "selected" : ""}>${formatDate(plan.date, { month: "numeric", day: "numeric" })} · ${esc(plan.title)}</option>`).join("")}</select></div>`;
  }

  function renderPlans() {
    const plans = sorted(recordsFor("plans"), "asc");
    const weekPlans = plans.filter((item) => isThisWeek(item.date));
    const completed = weekPlans.filter((item) => item.completed).length;
    const completion = weekPlans.length ? Math.round(completed / weekPlans.length * 100) : 0;
    return `
      <section class="view">
        ${pageHead("plans", `<button class="button button-primary" type="button" data-open-details="plan-composer">＋ 新计划</button>`)}
        <div class="grid grid-3">
          <article class="card card-pad span-2"><div class="card-head"><div><h2 class="card-title">本周计划</h2><p class="card-subtitle">周一至周日</p></div><span class="tag">${completed}/${weekPlans.length} 已完成</span></div>${renderWeekStrip(plans)}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">完成情况</h2><p class="card-subtitle">本周计划执行进度</p></div></div><div style="display:flex;align-items:center;justify-content:center;gap:18px"><div class="completion-ring" style="--value:${completion}"><strong>${completion}%</strong></div><div><strong>${completed} 项</strong><small style="display:block;color:var(--muted)">共 ${weekPlans.length} 项计划</small></div></div></article>
        </div>

        <details class="card composer section-gap" id="plan-composer">
          <summary><span class="composer-title"><strong>添加训练计划</strong><small>安排训练日、运动日或主动恢复</small></span></summary>
          <form class="form-body" id="plan-form">
            <div class="form-grid">
              ${field("date", "日期", "date", dateOffset(0), "", true)}
              <div class="field"><label for="plan-type">计划类型</label><select id="plan-type" name="type"><option value="training">力量训练</option><option value="sport">运动日</option><option value="rest">休息日</option></select></div>
              ${field("title", "计划名称", "text", "", "例如：上肢推", true, "span-2")}
              ${field("duration", "预计时长（分钟）", "number", "", "60", false, "", "min=\"0\"")}
              <div class="field span-3"><label for="plan-notes">说明</label><textarea id="plan-notes" name="notes" placeholder="重点动作、强度或恢复安排"></textarea></div>
            </div>
            <div class="form-actions"><button class="button button-quiet" type="reset">清空</button><button class="button button-primary" type="submit">保存计划</button></div>
          </form>
        </details>

        <article class="card card-pad section-gap"><div class="card-head"><div><h2 class="card-title">计划清单</h2><p class="card-subtitle">训练和运动保存记录后自动完成；休息日可手动完成</p></div></div>${plans.length ? `<div>${plans.map(planRow).join("")}</div>` : emptyState("□", "还没有训练计划", "为本周安排一个训练日、运动日或休息日。")}</article>
      </section>`;
  }

  function planRow(item) {
    const meta = planTypes[item.type] || planTypes.training;
    return `<div class="plan-row ${item.completed ? "is-done" : ""}">${planStatusButton(item)}<span class="plan-date">${formatDate(item.date, { month: "numeric", day: "numeric", weekday: "short" })}</span><span class="plan-title"><strong>${esc(item.title)}</strong><small><span class="event-dot" style="--tone:${meta.tone}"></span>${meta.name}${item.duration ? ` · ${number(item.duration)} 分钟` : ""}${item.notes ? ` · ${esc(item.notes)}` : ""}${item.type !== "rest" ? item.completed ? " · 已同步记录" : " · 等待记录" : ""}</small></span><button class="danger-link" type="button" data-action="delete-record" data-collection="plans" data-id="${item.id}">删除</button></div>`;
  }

  function renderNutrition() {
    const nutrition = sorted(recordsFor("nutrition"));
    const today = nutrition.find((item) => item.date === dateOffset(0));
    const latest = today || nutrition[0];
    const targets = { calories: 2200, protein: 140, carbs: 260, fat: 70, water: 2500 };
    return `
      <section class="view">
        ${pageHead("nutrition", `<button class="button button-primary" type="button" data-open-details="nutrition-composer">＋ 今日饮食</button>`)}
        <div class="grid grid-2">
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">${today ? "今日营养" : "最近一次营养"}</h2><p class="card-subtitle">${latest ? formatDate(latest.date, { year: "numeric", month: "long", day: "numeric" }) : "暂无记录"}</p></div></div>${latest ? renderMacros(latest, targets) : emptyState("◒", "还没有饮食记录", "记录热量、宏量营养素和饮水量。")}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">餐食明细</h2><p class="card-subtitle">早餐、午餐、晚餐和加餐</p></div></div>${latest ? renderMeals(latest.meals) : emptyState("餐", "暂无餐食", "保存饮食记录后会显示在这里。")}</article>
        </div>

        <details class="card composer section-gap" id="nutrition-composer">
          <summary><span class="composer-title"><strong>添加饮食记录</strong><small>同一天再次保存会增加一条独立记录</small></span></summary>
          <form class="form-body" id="nutrition-form">
            <div class="form-grid">
              ${field("date", "日期", "date", dateOffset(0), "", true)}
              ${field("calories", "热量（kcal）", "number", "", "2000", true, "", "min=\"0\"")}
              ${field("protein", "蛋白质（g）", "number", "", "120", true, "", "min=\"0\" step=\"0.1\"")}
              ${field("carbs", "碳水（g）", "number", "", "220", true, "", "min=\"0\" step=\"0.1\"")}
              ${field("fat", "脂肪（g）", "number", "", "60", true, "", "min=\"0\" step=\"0.1\"")}
              ${field("water", "饮水量（ml）", "number", "", "2000", true, "", "min=\"0\"")}
              ${field("breakfast", "早餐", "text", "", "食物和份量", false, "span-2")}
              ${field("lunch", "午餐", "text", "", "食物和份量", false, "span-2")}
              ${field("dinner", "晚餐", "text", "", "食物和份量", false, "span-2")}
              ${field("snack", "加餐", "text", "", "食物和份量", false, "span-2")}
            </div>
            <div class="form-actions"><button class="button button-quiet" type="reset">清空</button><button class="button button-primary" type="submit">保存饮食</button></div>
          </form>
        </details>

        <article class="card section-gap"><div class="card-pad card-head"><div><h2 class="card-title">饮食历史</h2><p class="card-subtitle">共 ${nutrition.length} 条记录</p></div></div>${nutrition.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>热量</th><th>蛋白质</th><th>碳水</th><th>脂肪</th><th>饮水</th><th></th></tr></thead><tbody>${nutrition.map((item) => `<tr><td>${formatDate(item.date, { year: "numeric", month: "short", day: "numeric" })}</td><td>${number(item.calories)} kcal</td><td>${number(item.protein)} g</td><td>${number(item.carbs)} g</td><td>${number(item.fat)} g</td><td>${number(item.water)} ml</td><td><button class="danger-link" type="button" data-action="delete-record" data-collection="nutrition" data-id="${item.id}">删除</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("◒", "暂无饮食历史", "记录后可在这里按日期回顾。")}</article>
      </section>`;
  }

  function renderMacros(item, targets) {
    const macros = [["热量", "calories", "kcal"], ["蛋白质", "protein", "g"], ["碳水", "carbs", "g"], ["脂肪", "fat", "g"]];
    return `<div class="macro-grid">${macros.map(([label, key, unit]) => `<div class="macro"><small>${label}</small><strong>${number(item[key])}<span> / ${targets[key]} ${unit}</span></strong><div class="progress-track" style="margin-top:8px"><div class="progress-fill" style="width:${Math.min(100, number(item[key]) / targets[key] * 100)}%"></div></div></div>`).join("")}</div><div style="margin-top:18px"><div class="metric-bar-head"><span>饮水</span><strong>${number(item.water)} / ${targets.water} ml</strong></div><div class="metric-bar"><span style="width:${Math.min(100, number(item.water) / targets.water * 100)}%"></span></div></div>`;
  }

  function renderMeals(meals = {}) {
    const rows = [["早餐", meals.breakfast], ["午餐", meals.lunch], ["晚餐", meals.dinner], ["加餐", meals.snack]];
    return `<div class="meal-list">${rows.map(([label, value]) => `<div class="meal-row"><strong>${label}</strong><span>${esc(value || "未记录")}</span></div>`).join("")}</div>`;
  }

  function renderBody() {
    const body = sorted(recordsFor("body"));
    const latest = body[0];
    const previous = body[1];
    return `
      <section class="view">
        ${pageHead("body", `<button class="button button-primary" type="button" data-open-details="body-composer">＋ 新数据</button>`)}
        <div class="grid grid-4 stats-mobile">
          ${statCard("当前体重", latest?.weight ?? "—", latest ? "kg" : "", "重", deltaNote(latest?.weight, previous?.weight, "kg"), "#689b2d", "#effbdd")}
          ${statCard("腰围", latest?.waist ?? "—", latest ? "cm" : "", "腰", deltaNote(latest?.waist, previous?.waist, "cm"), "#4f7dde", "#eef3ff")}
          ${statCard("臀围", latest?.hips ?? "—", latest ? "cm" : "", "臀", deltaNote(latest?.hips, previous?.hips, "cm"), "#8a6ce0", "#f2efff")}
          ${statCard("体脂率", latest?.bodyFat ?? "—", latest?.bodyFat ? "%" : "", "脂", deltaNote(latest?.bodyFat, previous?.bodyFat, "%"), "#d27645", "#fff3e7")}
        </div>

        <div class="grid grid-2 section-gap">
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">体重趋势</h2><p class="card-subtitle">最近 ${Math.min(body.length, 8)} 次记录</p></div></div>${body.length ? renderLineChart(sorted(body, "asc").slice(-8).map((item) => number(item.weight)), sorted(body, "asc").slice(-8).map((item) => formatDate(item.date)), "#86cc35") : emptyState("⌁", "暂无趋势", "至少记录一次身体数据后显示。")}</article>
          <details class="card composer" id="body-composer">
            <summary><span class="composer-title"><strong>添加身体数据</strong><small>建议在固定时间和相近条件下测量</small></span></summary>
            <form class="form-body" id="body-form"><div class="form-grid">
              ${field("date", "日期", "date", dateOffset(0), "", true)}
              ${field("weight", "体重（kg）", "number", "", "70.0", true, "", "min=\"0\" step=\"0.1\"")}
              ${field("waist", "腰围（cm）", "number", "", "80.0", false, "", "min=\"0\" step=\"0.1\"")}
              ${field("hips", "臀围（cm）", "number", "", "95.0", false, "", "min=\"0\" step=\"0.1\"")}
              ${field("chest", "胸围（cm）", "number", "", "95.0", false, "", "min=\"0\" step=\"0.1\"")}
              ${field("bodyFat", "体脂率（%）", "number", "", "20.0", false, "", "min=\"0\" max=\"100\" step=\"0.1\"")}
              <div class="field span-2"><label for="body-notes">备注</label><textarea id="body-notes" name="notes" placeholder="测量时间、状态或其他围度"></textarea></div>
            </div><div class="form-actions"><button class="button button-quiet" type="reset">清空</button><button class="button button-primary" type="submit">保存数据</button></div></form>
          </details>
        </div>

        <article class="card section-gap"><div class="card-pad card-head"><div><h2 class="card-title">身体数据历史</h2><p class="card-subtitle">敏感数据默认仅自己可见</p></div><span class="tag">${permissionLabel(state.privacy.body)}</span></div>${body.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>体重</th><th>腰围</th><th>臀围</th><th>胸围</th><th>体脂</th><th>备注</th><th></th></tr></thead><tbody>${body.map((item) => `<tr><td>${formatDate(item.date, { year: "numeric", month: "short", day: "numeric" })}</td><td>${number(item.weight)} kg</td><td>${item.waist ? `${number(item.waist)} cm` : "—"}</td><td>${item.hips ? `${number(item.hips)} cm` : "—"}</td><td>${item.chest ? `${number(item.chest)} cm` : "—"}</td><td>${item.bodyFat ? `${number(item.bodyFat)}%` : "—"}</td><td>${esc(item.notes || "—")}</td><td><button class="danger-link" type="button" data-action="delete-record" data-collection="body" data-id="${item.id}">删除</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("◇", "还没有身体数据", "记录体重和围度后即可查看趋势。")}</article>
      </section>`;
  }

  function deltaNote(current, previous, unit) {
    if (current == null) return "暂无记录";
    if (previous == null) return "首次记录";
    const delta = round(number(current) - number(previous), 1);
    return `较上次 ${delta > 0 ? "+" : ""}${delta} ${unit}`;
  }

  function renderAnalytics() {
    const workouts = completedRecordsFor("workouts");
    const activities = completedRecordsFor("activities");
    const body = sorted(recordsFor("body"), "asc");
    const totalMinutes = [...workouts, ...activities].reduce((sum, item) => sum + number(item.duration), 0);
    const running = sorted(activities.filter((item) => item.sport === "running"), "asc");
    const swimming = sorted(activities.filter((item) => item.sport === "swimming"), "asc");
    const strength = sorted(workouts, "asc");
    const sportShare = Object.keys(sportCatalog).map((key) => ({ key, value: activities.filter((item) => item.sport === key).reduce((sum, item) => sum + number(item.duration), 0) })).filter((item) => item.value > 0);
    return `
      <section class="view">
        ${pageHead("analytics", `<button class="button button-quiet" type="button" data-action="export-data">导出数据</button>`)}
        <div class="grid grid-4 stats-mobile">
          ${statCard("全部训练", workouts.length, "次", "训", `${new Set(workouts.map((item) => item.exercise)).size} 个动作`, "#689b2d", "#effbdd")}
          ${statCard("全部运动", activities.length, "次", "动", `${new Set(activities.map((item) => item.sport)).size} 类运动`, "#4f7dde", "#eef3ff")}
          ${statCard("累计时间", totalMinutes, "分钟", "时", formatMinutes(totalMinutes), "#8a6ce0", "#f2efff")}
          ${statCard("计划完成", recordsFor("plans").filter((item) => item.completed).length, "项", "✓", `共 ${recordsFor("plans").length} 项计划`, "#d27645", "#fff3e7")}
        </div>

        <div class="grid grid-2 section-gap">
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">运动时间占比</h2><p class="card-subtitle">按不同运动累计时长</p></div></div>${sportShare.length ? renderDonut(sportShare) : emptyState("◒", "暂无运动占比", "添加运动记录后自动统计。")}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">近 7 日训练次数</h2><p class="card-subtitle">力量训练与运动记录</p></div></div>${renderWeeklyCountBars(workouts, activities)}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">力量变化</h2><p class="card-subtitle">按训练记录观察主要重量</p></div></div>${strength.length ? renderLineChart(strength.slice(-8).map((item) => number(item.weight)), strength.slice(-8).map((item) => item.exercise), "#86cc35") : emptyState("训", "暂无力量数据", "保存力量训练后显示重量趋势。")}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">跑步距离</h2><p class="card-subtitle">每次跑步的公里数</p></div></div>${running.length ? renderLineChart(running.slice(-8).map((item) => number(item.details?.distance)), running.slice(-8).map((item) => formatDate(item.date)), "#5f8ff6") : emptyState("跑", "暂无跑步数据", "添加跑步记录后显示距离趋势。")}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">游泳距离</h2><p class="card-subtitle">每次游泳的米数</p></div></div>${swimming.length ? renderLineChart(swimming.slice(-8).map((item) => number(item.details?.distance)), swimming.slice(-8).map((item) => formatDate(item.date)), "#3ea7bd") : emptyState("泳", "暂无游泳数据", "添加游泳记录后显示距离趋势。")}</article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">身体数据趋势</h2><p class="card-subtitle">体重变化（kg）</p></div></div>${body.length ? renderLineChart(body.slice(-8).map((item) => number(item.weight)), body.slice(-8).map((item) => formatDate(item.date)), "#8c7cf2") : emptyState("◇", "暂无身体数据", "添加身体数据后显示趋势。")}</article>
        </div>
      </section>`;
  }

  function renderDonut(items) {
    const colors = ["#86cc35", "#5f8ff6", "#8c7cf2", "#f5a657", "#df615b", "#3ea7bd", "#42a36d", "#a17645", "#718078"];
    const total = items.reduce((sum, item) => sum + item.value, 0);
    let cursor = 0;
    const stops = items.map((item, index) => {
      const start = cursor;
      cursor += item.value / total * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    }).join(",");
    return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})" data-total="${total}\A 分钟"></div><div class="legend">${items.map((item, index) => `<div class="legend-item"><span class="legend-key"><span class="legend-swatch" style="--tone:${colors[index % colors.length]}"></span>${sportCatalog[item.key].name}</span><strong>${item.value} 分 · ${Math.round(item.value / total * 100)}%</strong></div>`).join("")}</div></div>`;
  }

  function renderWeeklyMinutesChart(workouts, activities) {
    const dates = weekDates();
    const values = dates.map((date) => [...workouts, ...activities].filter((item) => item.date === date).reduce((sum, item) => sum + number(item.duration), 0));
    return renderLineChart(values, ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], "#86cc35");
  }

  function renderWeeklyCountBars(workouts, activities) {
    const dates = weekDates();
    const values = dates.map((date) => [...workouts, ...activities].filter((item) => item.date === date).length);
    const max = Math.max(1, ...values);
    return `<div class="metric-bar-list">${values.map((value, index) => `<div><div class="metric-bar-head"><span>周${["一", "二", "三", "四", "五", "六", "日"][index]}</span><strong>${value} 次</strong></div><div class="metric-bar"><span style="width:${value / max * 100}%;--tone:${index === (new Date().getDay() || 7) - 1 ? "#86cc35" : "#aab7af"}"></span></div></div>`).join("")}</div>`;
  }

  function renderLineChart(values, labels, color) {
    const clean = values.map((value) => number(value));
    const width = 600;
    const height = 150;
    const padding = 12;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const points = clean.map((value, index) => {
      const x = clean.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (clean.length - 1);
      const y = height - padding - (value - min) / range * (height - padding * 2);
      return [round(x, 2), round(y, 2)];
    });
    const path = points.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
    const area = `${path} L${points.at(-1)[0]},${height} L${points[0][0]},${height} Z`;
    const visibleLabels = labels.map((label) => String(label).slice(0, 6));
    return `<div class="chart" style="--tone:${color}"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="趋势图：${clean.join(", ")}"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line class="chart-grid" x1="0" x2="600" y1="35" y2="35"/><line class="chart-grid" x1="0" x2="600" y1="80" y2="80"/><line class="chart-grid" x1="0" x2="600" y1="125" y2="125"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${points.map((point) => `<circle class="chart-dot" cx="${point[0]}" cy="${point[1]}" r="4"/>`).join("")}</svg><div class="chart-labels">${visibleLabels.map((label) => `<span>${esc(label)}</span>`).join("")}</div></div>`;
  }

  function renderMembers() {
    return `
      <section class="view">
        ${pageHead("members")}
        <article class="card card-pad">
          <div class="card-head"><div><h2 class="card-title">选择个人界面</h2><p class="card-subtitle">Betty 与 Stephen 各自记录、各自计数，不再使用单人/双人/多人模式</p></div><span class="tag">当前：${esc(activeMember().name)}</span></div>
          <div class="member-grid fixed-profile-grid">${state.settings.members.map(memberCard).join("")}</div>
        </article>
        <div class="grid grid-2 section-gap">
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">完全独立的数据空间</h2><p class="card-subtitle">切换界面后，所有模块自动切换</p></div></div><div class="stack"><div class="future-note">Betty 的训练、运动、计划、饮食和身体数据只显示在 Betty 界面。</div><div class="future-note">Stephen 的数据同样独立保存；正在进行的实时计数组也会分别保留。</div></div></article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">使用建议</h2><p class="card-subtitle">开始训练前先确认右上角名字</p></div></div><div class="stack"><div class="future-note">右上角可随时一键切换 Betty / Stephen。切换不会结束另一人的计数组。</div><div class="future-note">所有数据目前仍只保存在这台设备；需要换设备前请先导出 JSON 备份。</div></div></article>
        </div>
      </section>`;
  }

  function memberCard(member) {
    const active = member.id === activeMember().id;
    const live = Boolean(state.liveSessions?.[member.id]);
    return `<div class="member-card ${active ? "is-active" : ""}"><span class="avatar" style="background:${esc(member.color)}">${esc(member.initial)}</span><strong>${esc(member.name)}</strong><small>${esc(member.role)} · ${memberRecordCount(member.id)} 条记录${live ? " · 有进行中的计数" : ""}</small>${active ? `<span class="tag" style="position:absolute;top:12px;right:12px">当前界面</span>` : `<button class="button button-small button-quiet" type="button" data-action="select-member" data-id="${member.id}">切换到 ${esc(member.name)}</button>`}</div>`;
  }

  function memberRecordCount(memberId) {
    return ["workouts", "activities", "plans", "nutrition", "body"].reduce((sum, key) => sum + state[key].filter((item) => item.memberId === memberId).length, 0);
  }

  function renderPrivacy() {
    return `
      <section class="view">
        ${pageHead("privacy")}
        <div class="grid grid-2">
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">独立数据权限</h2><p class="card-subtitle">按数据类型设置 Betty 与 Stephen 之间的查看边界</p></div><span class="tag">隐私优先</span></div><div class="privacy-list">${Object.entries(privacyMeta).map(([key, meta]) => `<div class="privacy-row"><div><strong>${meta[0]}</strong><small>${meta[1]}</small></div><select data-privacy="${key}" aria-label="${meta[0]}权限"><option value="private" ${state.privacy[key] === "private" ? "selected" : ""}>仅数据本人</option><option value="shared" ${state.privacy[key] === "shared" ? "selected" : ""}>允许另一位查看</option></select></div>`).join("")}</div></article>
          <article class="card card-pad"><div class="card-head"><div><h2 class="card-title">当前数据边界</h2><p class="card-subtitle">第一阶段安全说明</p></div></div><div class="stack"><div class="future-note">所有内容仅写入当前浏览器的 localStorage，不会发送到 GitHub、Porkbun 或任何第三方服务。</div><div class="future-note">权限选项是未来后端的契约占位。接入同步时必须在服务端执行权限校验，不能只依赖前端隐藏。</div><div class="future-note">身体与饮食数据默认“仅自己”；导出的 JSON 文件可能包含敏感信息，请妥善保存。</div></div></article>
        </div>
        <article class="card card-pad section-gap"><div class="card-head"><div><h2 class="card-title">本地数据管理</h2><p class="card-subtitle">导出备份、导入恢复或清除当前设备数据</p></div></div><div class="data-actions"><div class="data-action-card"><strong>导出 JSON</strong><small>下载完整记录、成员和权限设置。</small><button class="button button-quiet" type="button" data-action="export-data">导出备份</button></div><div class="data-action-card"><strong>导入 JSON</strong><small>导入会替换当前浏览器里的全部数据。</small><label class="button button-quiet" for="import-file">选择文件</label><input class="file-input" id="import-file" type="file" accept="application/json"></div><div class="data-action-card"><strong>清除本地数据</strong><small>此操作不可撤销，请先导出备份。</small><button class="button button-danger" type="button" data-action="reset-data">清除数据</button></div></div></article>
      </section>`;
  }

  function permissionLabel(value) {
    return { private: "仅数据本人", shared: "允许另一位查看" }[value] || "仅数据本人";
  }

  function render() {
    const renderers = {
      dashboard: renderDashboard,
      training: renderTraining,
      activities: renderActivities,
      plans: renderPlans,
      nutrition: renderNutrition,
      body: renderBody,
      analytics: renderAnalytics,
      members: renderMembers,
      privacy: renderPrivacy
    };
    const renderer = renderers[currentView] || renderers.dashboard;
    root.innerHTML = renderer();
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === currentView));
    updateTopbar();
  }

  function updateTopbar() {
    const now = new Date();
    const member = activeMember();
    document.querySelector("#today-weekday").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now);
    document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(now);
    document.querySelectorAll(".profile-option").forEach((option) => {
      const profile = fixedMembers.find((item) => item.id === option.dataset.id);
      option.classList.toggle("is-active", option.dataset.id === member.id);
      option.style.setProperty("--profile-color", profile?.color || "#b7f36b");
      option.setAttribute("aria-pressed", String(option.dataset.id === member.id));
    });
  }

  function navigate(view, openId) {
    if (!viewMeta[view]) return;
    currentView = view;
    render();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (openId) requestAnimationFrame(() => {
      const details = document.getElementById(openId);
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function openSidebar() {
    sidebar.classList.add("is-open");
    menuButton.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebar.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  function toast(message, error = false) {
    const element = document.createElement("div");
    element.className = `toast${error ? " is-error" : ""}`;
    element.textContent = message;
    toastRegion.append(element);
    setTimeout(() => element.remove(), 3200);
  }

  function confirmAction(title, message) {
    if (!confirmDialog?.showModal) return Promise.resolve(window.confirm(message));
    document.querySelector("#confirm-title").textContent = title;
    document.querySelector("#confirm-message").textContent = message;
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "confirm"), { once: true });
    });
  }

  function closeConfirmDialog(result) {
    if (!confirmDialog?.open) return;
    confirmDialog.returnValue = result;
    confirmDialog.close();
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function addStrength(form) {
    const data = formData(form);
    state.workouts.push({ id: uid(), memberId: activeMember().id, date: data.date, exercise: data.exercise.trim(), bodyPart: data.bodyPart, weight: number(data.weight), sets: number(data.sets), reps: number(data.reps), rest: number(data.rest), rpe: number(data.rpe), duration: number(data.duration), notes: data.notes.trim(), status: "completed", planId: data.planId || null });
    if (data.planId) syncPlanCompletion(data.planId);
    pendingPlanId = null;
    saveState("力量训练已保存在本机。");
    render();
  }

  function addActivity(form) {
    const data = formData(form);
    const common = new Set(["date", "sport", "duration", "notes", "planId"]);
    const details = {};
    Object.entries(data).forEach(([key, value]) => {
      if (!common.has(key)) details[key] = /^-?\d+(\.\d+)?$/.test(value) ? number(value) : value.trim();
    });
    state.activities.push({ id: uid(), memberId: activeMember().id, date: data.date, sport: data.sport, duration: number(data.duration), notes: data.notes.trim(), details, status: "completed", planId: data.planId || null });
    if (data.planId) syncPlanCompletion(data.planId);
    pendingPlanId = null;
    saveState(`${sportCatalog[data.sport]?.name || "运动"}记录已保存。`);
    render();
  }

  function addPlan(form) {
    const data = formData(form);
    state.plans.push({ id: uid(), memberId: activeMember().id, date: data.date, type: data.type, title: data.title.trim(), duration: number(data.duration), notes: data.notes.trim(), completed: false });
    saveState("训练计划已保存。");
    render();
  }

  function addNutrition(form) {
    const data = formData(form);
    state.nutrition.push({ id: uid(), memberId: activeMember().id, date: data.date, calories: number(data.calories), protein: number(data.protein), carbs: number(data.carbs), fat: number(data.fat), water: number(data.water), meals: { breakfast: data.breakfast.trim(), lunch: data.lunch.trim(), dinner: data.dinner.trim(), snack: data.snack.trim() } });
    saveState("饮食记录已保存。");
    render();
  }

  function addBody(form) {
    const data = formData(form);
    state.body.push({ id: uid(), memberId: activeMember().id, date: data.date, weight: number(data.weight), waist: number(data.waist), hips: number(data.hips), chest: number(data.chest), bodyFat: number(data.bodyFat), notes: data.notes.trim() });
    saveState("身体数据已保存。");
    render();
  }

  function startLiveSession(form) {
    const data = formData(form);
    const memberId = activeMember().id;
    const sessionId = uid();
    const recordId = uid();
    state.liveSessions[memberId] = {
      id: sessionId,
      recordId,
      memberId,
      date: dateOffset(0),
      bodyPart: data.bodyPart,
      exercise: data.exercise.trim(),
      targetSets: Math.max(1, number(data.targetSets, 1)),
      reps: Math.max(1, number(data.reps, 1)),
      weight: number(data.weight),
      rest: Math.max(0, number(data.rest)),
      rpe: Math.min(10, Math.max(1, number(data.rpe, 7))),
      planId: data.planId || null,
      completedSets: 0,
      startedAt: Date.now(),
      restEndsAt: null,
      setLog: []
    };
    updateLiveWorkout(state.liveSessions[memberId]);
    pendingPlanId = null;
    saveState(`${activeMember().name} 的实时计数已开始。`);
    render();
  }

  function completeLiveSet() {
    const session = currentLiveSession();
    if (!session || number(session.completedSets) >= number(session.targetSets)) return;
    if (session.restEndsAt && session.restEndsAt > Date.now()) return;
    session.completedSets = number(session.completedSets) + 1;
    session.setLog = Array.isArray(session.setLog) ? session.setLog : [];
    session.setLog.push({ set: session.completedSets, completedAt: new Date().toISOString() });
    session.restEndsAt = session.completedSets < session.targetSets && session.rest > 0
      ? Date.now() + number(session.rest) * 1000
      : null;
    updateLiveWorkout(session);
    saveState(`第 ${session.completedSets} 组已记录。`);
    if (navigator.vibrate) navigator.vibrate(80);
    render();
  }

  function undoLiveSet() {
    const session = currentLiveSession();
    if (!session || number(session.completedSets) <= 0) return;
    session.completedSets -= 1;
    if (Array.isArray(session.setLog)) session.setLog.pop();
    session.restEndsAt = null;
    updateLiveWorkout(session);
    saveState(`已撤销第 ${session.completedSets + 1} 组。`);
    render();
  }

  function finishLiveSession() {
    const member = activeMember();
    const session = currentLiveSession();
    if (!session || number(session.completedSets) <= 0) {
      toast("至少完成一组后才能保存训练。", true);
      return;
    }
    updateLiveWorkout(session, true);
    if (session.planId) syncPlanCompletion(session.planId);
    state.liveSessions[member.id] = null;
    saveState(`${member.name} 的训练已保存，共 ${session.completedSets} 组。`);
    render();
  }

  function updateRestCountdown() {
    const session = currentLiveSession();
    if (!session?.restEndsAt) return;
    const remaining = Math.ceil((session.restEndsAt - Date.now()) / 1000);
    if (remaining <= 0) {
      session.restEndsAt = null;
      saveState();
      if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
      if (currentView === "dashboard") render();
      toast("休息结束，可以开始下一组。");
      return;
    }
    const output = document.querySelector("#rest-countdown");
    if (output) output.textContent = formatCountdown(remaining);
  }

  function exportData() {
    const payload = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vitb-sport-backup-${dateOffset(0)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("数据备份已导出。请妥善保管敏感信息。");
  }

  async function importData(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.workouts)) throw new Error("Invalid backup");
      const approved = await confirmAction("导入并替换数据？", "导入会替换当前浏览器中的全部 VITB Sport 数据。建议先导出备份。");
      if (!approved) return;
      state = normalizeState(parsed);
      saveState("数据导入成功。");
      render();
    } catch (error) {
      toast("无法导入：请选择有效的 VITB Sport JSON 备份。", true);
      console.error(error);
    }
  }

  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      navigate(nav.dataset.view);
      return;
    }

    const jump = event.target.closest("[data-navigate]");
    if (jump) {
      navigate(jump.dataset.navigate, jump.dataset.open);
      return;
    }

    const openDetails = event.target.closest("[data-open-details]");
    if (openDetails) {
      const details = document.getElementById(openDetails.dataset.openDetails);
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) return;

    if (action.dataset.action === "toggle-plan") {
      const plan = state.plans.find((item) => item.id === action.dataset.id);
      if (plan?.type === "rest") {
        plan.completed = !plan.completed;
        saveState(plan.completed ? "休息计划已完成。" : "休息计划已恢复为未完成。");
        render();
      }
    }

    if (action.dataset.action === "start-plan") {
      const plan = state.plans.find((item) => item.id === action.dataset.id && item.memberId === activeMember().id);
      if (plan) {
        pendingPlanId = plan.id;
        if (plan.type === "training") {
          navigate("dashboard");
          requestAnimationFrame(() => document.querySelector(".live-counter")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        } else if (plan.type === "sport") {
          navigate("activities", "activity-composer");
        }
      }
    }

    if (action.dataset.action === "view-plan-record") {
      const plan = state.plans.find((item) => item.id === action.dataset.id && item.memberId === activeMember().id);
      if (plan) navigate(plan.type === "training" ? "training" : "activities");
    }

    if (action.dataset.action === "delete-record") {
      const collection = action.dataset.collection;
      if (!["workouts", "activities", "plans", "nutrition", "body"].includes(collection)) return;
      const liveSession = currentLiveSession();
      if (collection === "workouts" && liveSession?.recordId === action.dataset.id) {
        toast("这条记录正在实时计数，请先结束或放弃本次计数。", true);
        return;
      }
      const approved = await confirmAction("删除这条记录？", "删除后无法恢复，除非你已导出过数据备份。");
      if (approved) {
        state[collection] = state[collection].filter((item) => item.id !== action.dataset.id);
        if (collection === "plans") {
          [...state.workouts, ...state.activities].forEach((item) => {
            if (item.planId === action.dataset.id) item.planId = null;
          });
          Object.values(state.liveSessions).forEach((session) => {
            if (session?.planId === action.dataset.id) session.planId = null;
          });
        }
        if (["workouts", "activities"].includes(collection)) syncPlanCompletion();
        saveState("记录已从本机删除。");
        render();
      }
    }

    if (action.dataset.action === "select-member") {
      if (fixedMembers.some((member) => member.id === action.dataset.id)) {
        state.settings.activeMemberId = action.dataset.id;
        saveState(`已切换到 ${activeMember().name}。`);
        render();
      }
    }

    if (action.dataset.action === "complete-live-set") completeLiveSet();

    if (action.dataset.action === "undo-live-set") undoLiveSet();

    if (action.dataset.action === "skip-rest") {
      const session = currentLiveSession();
      if (session) {
        session.restEndsAt = null;
        saveState("已跳过休息倒计时。");
        render();
      }
    }

    if (action.dataset.action === "finish-live-session") finishLiveSession();

    if (action.dataset.action === "discard-live-session") {
      const session = currentLiveSession();
      const hasCompletedSets = number(session?.completedSets) > 0;
      const approved = await confirmAction(
        hasCompletedSets ? "结束本次实时计数？" : "放弃本次实时计数？",
        hasCompletedSets ? "已完成的组数会保留在训练记录中，并同步关联计划。" : "尚未完成任何组，本次空白记录将一并移除。"
      );
      if (approved) {
        if (hasCompletedSets) {
          finishLiveSession();
        } else if (session) {
          state.workouts = state.workouts.filter((item) => item.id !== session.recordId);
          state.liveSessions[activeMember().id] = null;
          saveState("本次空白计数已放弃。");
          render();
        }
      }
    }

    if (action.dataset.action === "export-data") exportData();

    if (action.dataset.action === "reset-data") {
      const approved = await confirmAction("清除所有本地数据？", "Betty 与 Stephen 的训练、运动、计划、饮食、身体数据和实时计数都会被永久删除。两个固定界面会保留。此操作不会影响 GitHub 仓库。");
      if (approved) {
        state = makeInitialState();
        saveState("所有本地数据已清除。");
        currentView = "dashboard";
        render();
      }
    }
  });

  document.addEventListener("submit", (event) => {
    event.preventDefault();
    const handlers = {
      "strength-form": addStrength,
      "activity-form": addActivity,
      "plan-form": addPlan,
      "nutrition-form": addNutrition,
      "body-form": addBody,
      "live-session-form": startLiveSession
    };
    const handler = handlers[event.target.id];
    if (handler) handler(event.target);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "sport-type") {
      const container = document.querySelector("#sport-fields");
      if (container) container.innerHTML = activityFields(event.target.value);
    }
    if (event.target.matches("[data-privacy]")) {
      state.privacy[event.target.dataset.privacy] = event.target.value;
      saveState(`${privacyMeta[event.target.dataset.privacy][0]}权限已更新。`);
    }
    if (event.target.id === "import-file") importData(event.target.files?.[0]);
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "strength-rpe") {
      const output = document.querySelector("#strength-rpe-value");
      if (output) output.value = event.target.value;
    }
    if (event.target.id === "sport-intensity") {
      const output = document.querySelector("#sport-intensity-value");
      if (output) output.value = event.target.value;
    }
  });

  menuButton.addEventListener("click", () => sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar());
  scrim.addEventListener("click", closeSidebar);
  confirmCancelButton.addEventListener("click", () => closeConfirmDialog("cancel"));
  confirmOkButton.addEventListener("click", () => closeConfirmDialog("confirm"));
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSidebar(); });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      state = loadState();
      render();
      toast("检测到另一个标签页的数据更新。");
    }
  });

  window.setInterval(updateRestCountdown, 1000);

  render();
})();
