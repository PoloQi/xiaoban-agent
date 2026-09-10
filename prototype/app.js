const app = document.querySelector("#app");
const main = document.querySelector("#app-main");
const overlay = document.querySelector("#app-overlay");
const toastRegion = document.querySelector("#toast-region");

const activities = [
  {
    id: "stretch",
    title: "在屋里伸展",
    description: "不用器材，让肩膀、眼睛和脑袋一起休息。",
    type: "move",
    duration: 10,
    place: "室内",
    icon: "stretch",
    steps: ["把手机放在看得见但够不到的地方", "跟着图示伸展肩膀和手臂", "慢慢深呼吸三次，再活动脚踝"],
  },
  {
    id: "colors",
    title: "找出五种颜色",
    description: "看看身边，找出五种不同颜色并画下来。",
    type: "quiet",
    duration: 5,
    place: "室内",
    icon: "draw",
    steps: ["准备一张纸和一支笔", "在房间里找五种不同颜色", "画下你最喜欢的两个小物件"],
  },
  {
    id: "tidy",
    title: "整理一小格",
    description: "只整理书桌的一小格，完成就停，不用一次做完。",
    type: "quiet",
    duration: 10,
    place: "室内",
    icon: "tidy",
    steps: ["选定书桌的一小块地方", "把物品分成留下、放回和丢弃", "擦干净这一小格，然后欣赏成果"],
  },
  {
    id: "steps",
    title: "安全走动挑战",
    description: "在熟悉、安全的地方走动五分钟，数一数步数。",
    type: "move",
    duration: 5,
    place: "熟悉场地",
    icon: "steps",
    steps: ["先确认地面没有杂物和车辆", "把手机收好，抬头慢慢走", "走完后喝几口水，告诉小伴感受"],
  },
];

const initialState = () => ({
  view: "welcome",
  activeTab: "home",
  onboarded: false,
  name: "小禾",
  age: "11—12岁",
  grade: "五年级",
  interests: ["画画", "运动"],
  companion: "sprout",
  mood: null,
  demoOpen: false,
  chatScenario: "generic",
  chatStep: 0,
  messages: [],
  quickReplies: ["我有点无聊", "我想聊聊家里", "我有个安全问题"],
  typing: false,
  activityFilter: "all",
  selectedActivity: null,
  timerSeconds: 600,
  timerRunning: false,
  completedActivities: 2,
  completionFeeling: null,
  goalProgress: 2,
  quizAnswer: null,
  riskNotified: false,
  alertHandled: false,
  adultView: "overview",
});

let state = initialState();
let timerHandle = null;
let toastHandle = null;

function icon(name, label = "") {
  const common = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`}`;
  const paths = {
    sprout: `<path d="M12 22V10"/><path d="M12 13C7.5 13 4 10 4 5c4.6 0 8 2.8 8 8Z"/><path d="M12 10c0-4.6 3.2-7.5 8-7.5 0 4.7-3.2 7.5-8 7.5Z"/>`,
    shield: `<path d="M12 22s8-3.7 8-10V5l-8-3-8 3v7c0 6.3 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/>`,
    people: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    spark: `<path d="m12 3-1.2 4.1L7 9l3.8 1.9L12 15l1.2-4.1L17 9l-3.8-1.9L12 3Z"/><path d="m5 14-.7 2.3L2 17.5l2.3 1.2L5 21l.7-2.3L8 17.5l-2.3-1.2L5 14Z"/>`,
    arrowRight: `<path d="m9 18 6-6-6-6"/>`,
    back: `<path d="m15 18-6-6 6-6"/>`,
    close: `<path d="M18 6 6 18M6 6l12 12"/>`,
    more: `<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>`,
    chat: `<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/>`,
    activity: `<path d="M8 20h8M12 16v4"/><path d="M7 4h10l2 4-2 8H7L5 8l2-4Z"/><path d="M9 8h6"/>`,
    plan: `<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 2v3M16 2v3M8 10h8M8 14h5"/>`,
    user: `<circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/>`,
    mic: `<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M9 22h6"/>`,
    send: `<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>`,
    timer: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>`,
    check: `<path d="m5 12 4 4L19 6"/>`,
    play: `<path d="m8 5 11 7-11 7V5Z"/>`,
    pause: `<path d="M9 5v14M15 5v14"/>`,
    stretch: `<circle cx="12" cy="4" r="2"/><path d="M12 6v7M12 9 7 7M12 9l5-2M12 13l-4 8M12 13l5 8"/>`,
    draw: `<path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/><path d="m14.5 6.5 3 3"/>`,
    tidy: `<path d="M4 7h16M6 7l1 14h10l1-14M9 7V4h6v3M9 11v6M15 11v6"/>`,
    steps: `<path d="M8 3c2 2 2 5 0 7s-5 2-5 0 3-8 5-7ZM16 13c2-1 5 2 5 4s-3 3-5 2-3-4 0-6Z"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M8 7h8M8 11h6"/>`,
    heart: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>`,
    lock: `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>`,
    help: `<circle cx="12" cy="12" r="10"/><path d="M9.6 9a2.7 2.7 0 1 1 4.7 1.8c-1.2.9-2.3 1.4-2.3 3.2M12 18h.01"/>`,
    alert: `<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>`,
    wifiOff: `<path d="m1 1 22 22M16.7 11.7A8 8 0 0 0 5 12.7M19.8 8.7A12.5 12.5 0 0 0 3.2 6.9M8.5 16.4a5 5 0 0 1 6.3.3M12 21h.01"/>`,
    refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8M20 3v5h-5"/>`,
    home: `<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>`,
    report: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
    bell: `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>`,
    settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>`,
    phone: `<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M9 18h6"/>`,
    logout: `<path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
    exit: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>`,
    eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>`,
    eyeOff: `<path d="m3 3 18 18M10.6 10.6A2 2 0 0 0 13.4 13.4M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 8 10 8a16.2 16.2 0 0 1-2.3 3.4M6.6 6.6A16.9 16.9 0 0 0 2 12s3.5 8 10 8a10.4 10.4 0 0 0 4.1-.8"/>`,
    info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
    reset: `<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>`,
    cloud: `<path d="M17.5 19H7a5 5 0 1 1 1.9-9.6A6.5 6.5 0 0 1 21 13a4 4 0 0 1-3.5 6Z"/>`,
    kite: `<path d="m12 3 7 7-7 9-7-9 7-7Z"/><path d="m12 3 0 16M5 10h14M12 19c0 3-4 1-3 4"/>`,
    smile: `<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M8 14c1.8 2 6.2 2 8 0"/>`,
    calm: `<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M9 15h6"/>`,
    bored: `<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M9 15c2-1 4-1 6 0"/>`,
    sad: `<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M8.5 16c2-2 5-2 7 0"/>`,
    angry: `<circle cx="12" cy="12" r="9"/><path d="m7.5 9 2 1M16.5 9l-2 1M9 16h6"/>`,
    worried: `<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M10 16h4M12 13v.01"/>`,
  };
  return `<svg ${common}>${paths[name] || paths.info}</svg>`;
}

function companionSvg(type = "sprout") {
  if (type === "cloud") {
    return `<svg viewBox="0 0 120 120" role="img" aria-label="云朵伙伴小云">
      <path d="M31 80c-16 0-24-10-24-22 0-11 8-20 19-21 4-16 17-26 34-26 19 0 34 13 36 31 11 2 18 10 18 20 0 12-10 22-25 22H31Z" fill="#D8EBE4" stroke="#0F766E" stroke-width="3"/>
      <circle cx="46" cy="56" r="4" fill="#183B3A"/><circle cx="73" cy="56" r="4" fill="#183B3A"/>
      <path d="M47 69c8 6 18 6 26 0" fill="none" stroke="#183B3A" stroke-width="3" stroke-linecap="round"/>
      <path d="M30 87c5 7 13 10 20 7M90 87c-5 7-13 10-20 7" fill="none" stroke="#D6A447" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  if (type === "kite") {
    return `<svg viewBox="0 0 120 120" role="img" aria-label="风筝伙伴小风">
      <path d="m60 9 41 38-41 52-41-52L60 9Z" fill="#F3E4BD" stroke="#9D6D17" stroke-width="3"/>
      <path d="M60 9v90M19 47h82" fill="none" stroke="#9D6D17" stroke-width="2"/>
      <circle cx="47" cy="50" r="4" fill="#183B3A"/><circle cx="73" cy="50" r="4" fill="#183B3A"/>
      <path d="M48 62c7 5 17 5 24 0" fill="none" stroke="#183B3A" stroke-width="3" stroke-linecap="round"/>
      <path d="M60 99c4 8-9 7-4 15" fill="none" stroke="#B95E3F" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 120" role="img" aria-label="小芽伙伴小伴">
    <path d="M60 32C45 17 30 17 17 22c2 18 15 28 40 24" fill="#78A66C" stroke="#416D3A" stroke-width="3"/>
    <path d="M61 33C68 13 85 7 102 10c0 20-15 32-41 33" fill="#D6A447" stroke="#9D6D17" stroke-width="3"/>
    <path d="M60 31v24" fill="none" stroke="#416D3A" stroke-width="4" stroke-linecap="round"/>
    <path d="M17 75c0-24 18-39 43-39s43 15 43 39-17 38-43 38-43-14-43-38Z" fill="#0F766E" stroke="#0A5C56" stroke-width="3"/>
    <circle cx="45" cy="72" r="4" fill="#FFFDF7"/><circle cx="75" cy="72" r="4" fill="#FFFDF7"/>
    <path d="M46 86c8 6 20 6 28 0" fill="none" stroke="#FFFDF7" stroke-width="3" stroke-linecap="round"/>
    <path d="M23 88c-8 3-11 8-8 14M97 88c8 3 11 8 8 14" fill="none" stroke="#0A5C56" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

function statusRow(extra = "") {
  return `<div class="status-row"><span>19:10</span><span class="status-row__right"><span class="status-dot"></span>${extra || "原型演示"}</span></div>`;
}

function aiMark() {
  return `<span class="ai-mark">${icon("spark")}AI生成</span>`;
}

function bottomNav() {
  const items = [
    ["home", "chat", "陪我聊"],
    ["activities", "activity", "去做点事"],
    ["plan", "plan", "成长计划"],
    ["profile", "user", "我的"],
  ];
  return `<nav class="bottom-nav" aria-label="儿童端主导航">${items
    .map(
      ([tab, iconName, label]) => `<button class="nav-button ${state.activeTab === tab ? "is-active" : ""}" type="button" data-action="tab" data-value="${tab}" aria-label="${label}" ${state.activeTab === tab ? 'aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span></button>`,
    )
    .join("")}</nav>`;
}

function demoButton() {
  return `<button class="demo-fab" type="button" data-action="toggle-demo" aria-label="打开演示路线">${icon("spark")}演示</button>`;
}

function demoSheet() {
  if (!state.demoOpen) return "";
  return `<div class="sheet-backdrop" data-action="close-demo" role="presentation">
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="demo-title" data-stop-propagation>
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 id="demo-title">选择演示路线</h2>
      <p>每条路线都可在两分钟内展示一个核心产品价值。</p>
      <div class="demo-list">
        <button type="button" data-demo-route="bored"><span class="demo-list__number">01</span><span><b>从无聊到行动</b><small>想刷视频 → 选择现实活动</small></span></button>
        <button type="button" data-demo-route="lonely"><span class="demo-list__number">02</span><span><b>从想念到连接</b><small>表达情绪 → 联系可信任的人</small></span></button>
        <button type="button" data-demo-route="risk"><span class="demo-list__number">03</span><span><b>从风险到求助</b><small>网友索要地址 → 成人承接</small></span></button>
        <button type="button" data-action="open-adult"><span class="demo-list__number">04</span><span><b>查看监护端</b><small>趋势周报、隐私边界与风险提醒</small></span></button>
      </div>
      <button class="quiet-button full-width" type="button" data-action="close-demo">关闭</button>
    </section>
  </div>`;
}

function renderWelcome() {
  return `<section class="welcome-screen">
    <div class="welcome-brand">
      <div class="welcome-brand__name"><span class="brand-seed">${icon("sprout")}</span>小伴</div>
      <div class="welcome-copy">
        <div class="eyebrow">AI成长伙伴 · 高保真原型</div>
        <h1 class="display-title">陪你聊一会儿，<br />也陪你走回生活里。</h1>
        <p>无聊、想念或遇到难题时，小伴会听你说，并一起找一个现实中能做的小行动。</p>
      </div>
    </div>
    <div class="welcome-visual">${companionSvg("sprout").replace('<svg ', '<svg class="companion-hero" ')}</div>
    <div class="welcome-actions">
      <button class="primary-button full-width" type="button" data-action="navigate" data-view="boundaries">开始认识小伴 ${icon("arrowRight")}</button>
      <button class="quiet-button full-width" type="button" data-action="quick-start">直接进入演示</button>
      <div class="trust-line">${icon("shield")}<span>小伴是AI，不是真人，也可能出错。遇到危险时，请马上找身边可信任的大人。</span></div>
    </div>
  </section>`;
}

function renderBoundaries() {
  return `<section class="screen screen--no-nav">
    ${statusRow("第1/3步")}
    <div class="progress-track"><span style="width:33%"></span></div>
    <div class="eyebrow">在开始之前</div>
    <h1 class="display-title">我们先说好<br />三件重要的事。</h1>
    <div class="boundary-list">
      <article class="boundary-card"><span class="boundary-card__icon">${icon("spark")}</span><div><h3>我是AI，不是真人</h3><p>我会尽力帮助你，但也可能理解错或回答错，你可以随时核实。</p></div></article>
      <article class="boundary-card"><span class="boundary-card__icon">${icon("lock")}</span><div><h3>普通聊天不会全部给大人看</h3><p>但如果你或别人可能遇到危险，我会建议你马上找可信任的大人。</p></div></article>
      <article class="boundary-card"><span class="boundary-card__icon">${icon("people")}</span><div><h3>我不会替代真实的人</h3><p>我更希望陪你找到现实活动、家人、老师或朋友的支持。</p></div></article>
    </div>
    <div class="button-stack">
      <button class="primary-button full-width" type="button" data-action="navigate" data-view="setup">我明白了，继续 ${icon("arrowRight")}</button>
      <button class="quiet-button full-width" type="button" data-action="navigate" data-view="welcome">返回</button>
    </div>
  </section>`;
}

function renderSetup() {
  const gradeOptions = ["四年级", "五年级", "六年级", "初一", "初二"];
  const interestOptions = [
    ["画画", "draw"],
    ["运动", "activity"],
    ["阅读", "book"],
    ["整理", "tidy"],
  ];
  return `<section class="screen screen--no-nav">
    ${statusRow("第2/3步")}
    <div class="progress-track"><span style="width:66%"></span></div>
    <div class="eyebrow">让小伴认识你</div>
    <h1 class="display-title">怎么称呼你<br />会更亲切？</h1>
    <div class="field-group">
      <label class="field-label" for="nickname">昵称</label>
      <input id="nickname" class="text-field" type="text" maxlength="8" value="${escapeHtml(state.name)}" data-field="name" aria-describedby="nickname-help" />
      <p id="nickname-help" class="helper-text">用昵称就好，不需要填写真实姓名。</p>
    </div>
    <fieldset>
      <legend>你现在读几年级？</legend>
      <div class="choice-grid">${gradeOptions.map((item) => `<button class="choice-chip ${state.grade === item ? "is-selected" : ""}" type="button" data-action="select-grade" data-value="${item}">${item}</button>`).join("")}</div>
    </fieldset>
    <fieldset>
      <legend>你平时喜欢做什么？</legend>
      <div class="choice-grid">${interestOptions.map(([item, itemIcon]) => `<button class="choice-chip ${state.interests.includes(item) ? "is-selected" : ""}" type="button" data-action="toggle-interest" data-value="${item}">${icon(itemIcon)}${item}</button>`).join("")}</div>
    </fieldset>
    <div class="button-stack">
      <button class="primary-button full-width" type="button" data-action="navigate" data-view="companion">下一步 ${icon("arrowRight")}</button>
      <button class="quiet-button full-width" type="button" data-action="navigate" data-view="boundaries">返回</button>
    </div>
  </section>`;
}

function renderCompanion() {
  const companions = [
    ["sprout", "小芽", "安静、耐心，喜欢把大问题变成小行动。"],
    ["cloud", "小云", "柔和、轻松，适合陪你说说心里话。"],
    ["kite", "小风", "有活力，喜欢带你到现实里动一动。"],
  ];
  return `<section class="screen screen--no-nav">
    ${statusRow("第3/3步")}
    <div class="progress-track"><span style="width:100%"></span></div>
    <div class="eyebrow">选择你的AI伙伴</div>
    <h1 class="display-title">你想让谁<br />陪你一起成长？</h1>
    <div class="companion-grid">${companions.map(([id, name, desc]) => `<button class="companion-choice ${state.companion === id ? "is-selected" : ""}" type="button" data-action="select-companion" data-value="${id}">${companionSvg(id)}<span class="companion-choice__copy"><b>${name}</b><small>${desc}</small></span><span class="radio-dot" aria-hidden="true"></span></button>`).join("")}</div>
    <div class="button-stack">
      <button class="primary-button full-width" type="button" data-action="finish-onboarding">一起出发 ${icon("arrowRight")}</button>
      <button class="quiet-button full-width" type="button" data-action="navigate" data-view="setup">返回</button>
    </div>
  </section>`;
}

function renderHome() {
  const moodItems = [
    ["开心", "smile"],
    ["平静", "calm"],
    ["无聊", "bored"],
    ["难过", "sad"],
    ["生气", "angry"],
    ["担心", "worried"],
  ];
  return `<section class="screen">
    ${statusRow("状态良好")}
    <article class="home-hero">
      <div class="home-hero__copy">${aiMark()}<h1>晚上好，${escapeHtml(state.name)}</h1><p>${state.mood ? `我记得你今天有点“${state.mood}”。我们可以慢慢来。` : "先看看此刻的心情，再决定要做什么。"}</p></div>
      ${companionSvg(state.companion).replace('<svg ', '<svg class="home-hero__companion" ')}
    </article>
    <div class="section-title"><h2>此刻感觉怎么样？</h2><small>可跳过</small></div>
    <div class="mood-grid">${moodItems.map(([mood, moodIcon]) => `<button class="mood-button ${state.mood === mood ? "is-selected" : ""}" type="button" data-action="select-mood" data-value="${mood}"><span class="mood-face">${icon(moodIcon)}</span><span>${mood}</span></button>`).join("")}</div>
    <div class="section-title"><h2>现在想做什么？</h2></div>
    <div class="quick-grid">
      <button class="quick-card" type="button" data-action="start-chat"><span class="quick-card__icon">${icon("chat")}</span><span><b>聊一聊</b><small>小伴会先听你说</small></span></button>
      <button class="quick-card" type="button" data-action="tab" data-value="activities"><span class="quick-card__icon">${icon("activity")}</span><span><b>找点事做</b><small>离开信息流一会儿</small></span></button>
      <button class="quick-card" type="button" data-action="knowledge"><span class="quick-card__icon">${icon("book")}</span><span><b>学会保护自己</b><small>看一个安全小情景</small></span></button>
      <button class="quick-card" type="button" data-action="trusted"><span class="quick-card__icon">${icon("help")}</span><span><b>我需要帮助</b><small>联系可信任的大人</small></span></button>
    </div>
    <div class="section-title"><h2>今天的小计划</h2></div>
    <button class="goal-strip full-width" type="button" data-action="tab" data-value="plan"><span class="goal-strip__icon">${icon("timer")}</span><span><b>睡前30分钟不刷视频</b><small>替代：听一段故事或整理书包</small></span><span class="goal-strip__progress"><span>${state.goalProgress}/3</span></span></button>
    ${bottomNav()}${demoButton()}${demoSheet()}
  </section>`;
}

function renderChat() {
  const messageHtml = state.messages
    .map((message) => `<div class="message message--${message.role}">${message.role === "ai" ? `<span class="message__avatar">${companionSvg(state.companion)}</span>` : ""}<div><div class="message__bubble">${message.text}</div>${message.role === "ai" ? '<div class="message__meta">AI生成 · 内容可能有误</div>' : ""}</div></div>`)
    .join("");
  return `<section class="screen screen--chat">
    <header class="chat-header">
      <button class="icon-button" type="button" data-action="chat-back" aria-label="返回首页">${icon("back")}</button>
      <div class="chat-person"><span class="chat-person__avatar">${companionSvg(state.companion)}</span><span><b>小伴</b><small>AI成长伙伴 · 在线</small></span></div>
      <button class="icon-button icon-button--danger" type="button" data-action="trusted" aria-label="找人帮助">${icon("help")}</button>
    </header>
    <div id="chat-scroll" class="chat-scroll" aria-live="polite">
      <div class="chat-date">今天 19:10</div>
      ${messageHtml}
      ${state.typing ? `<div class="message message--ai"><span class="message__avatar">${companionSvg(state.companion)}</span><div class="typing-indicator" aria-label="小伴正在回复"><span></span><span></span><span></span></div></div>` : ""}
    </div>
    <form id="chat-form" class="chat-compose">
      ${state.quickReplies.length ? `<div class="quick-replies" aria-label="快捷回复">${state.quickReplies.map((reply) => `<button class="reply-chip" type="button" data-action="quick-reply" data-value="${reply}">${reply}</button>`).join("")}</div>` : ""}
      <div class="compose-row">
        <button class="icon-button" type="button" data-action="voice-demo" aria-label="模拟语音输入">${icon("mic")}</button>
        <label class="sr-only" for="chat-input">输入想说的话</label>
        <textarea id="chat-input" class="compose-input" rows="1" maxlength="120" placeholder="想说点什么……"></textarea>
        <button class="send-button" type="submit" aria-label="发送消息">${icon("send")}</button>
      </div>
      <div class="chat-footnote">小伴是AI，不是真人；遇到危险请立即找可信任的大人。</div>
    </form>
  </section>`;
}

function filteredActivities() {
  if (state.activityFilter === "all") return activities.slice(0, 3);
  if (state.activityFilter === "move" || state.activityFilter === "quiet") return activities.filter((item) => item.type === state.activityFilter).slice(0, 3);
  const duration = Number(state.activityFilter);
  return activities.filter((item) => item.duration === duration).slice(0, 3);
}

function renderActivities() {
  const filters = [["all", "都看看"], ["move", "想动一动"], ["quiet", "安静做点事"], ["5", "5分钟"], ["10", "10分钟"]];
  const list = filteredActivities();
  return `<section class="screen">
    ${statusRow("现实活动")}
    <div class="topbar"><div class="topbar__copy"><div class="eyebrow">离开信息流一会儿</div><h1>去做点真实的事</h1><p>只推荐安全、简单、马上能开始的活动</p></div>${aiMark()}</div>
    <div class="filter-row">${filters.map(([value, label]) => `<button class="filter-pill ${state.activityFilter === value ? "is-active" : ""}" type="button" data-action="filter-activity" data-value="${value}">${label}</button>`).join("")}</div>
    <div class="activity-list">${list.map((item) => `<button class="activity-card" type="button" data-action="select-activity" data-value="${item.id}"><span class="activity-card__visual">${icon(item.icon)}</span><span><h3>${item.title}</h3><p>${item.description}</p><span class="tag-row"><span class="tiny-tag">${item.duration}分钟</span><span class="tiny-tag">${item.place}</span><span class="tiny-tag">低风险</span></span></span></button>`).join("")}</div>
    <div class="prototype-warning">${icon("info")}<span>正式产品会根据年龄、地点和是否有成人陪同进一步过滤活动；当前为审核后的演示活动库。</span></div>
    ${bottomNav()}${demoButton()}${demoSheet()}
  </section>`;
}

function selectedActivity() {
  return activities.find((item) => item.id === state.selectedActivity) || activities[0];
}

function renderActivityDetail() {
  const item = selectedActivity();
  return `<section class="screen screen--no-nav">
    ${statusRow("活动详情")}
    <div class="topbar"><button class="icon-button" type="button" data-action="tab" data-value="activities" aria-label="返回活动列表">${icon("back")}</button><div class="topbar__copy"><h1>${item.title}</h1><p>${item.duration}分钟 · ${item.place}</p></div><span></span></div>
    <div class="activity-detail-visual">${icon(item.icon)}</div>
    <div class="tag-row"><span class="tiny-tag">${item.duration}分钟</span><span class="tiny-tag">无需登录</span><span class="tiny-tag">可随时退出</span></div>
    <div class="section-title"><h2>跟着三步做</h2></div>
    <ol class="step-list">${item.steps.map((step, index) => `<li><span class="step-list__number">${index + 1}</span><span>${step}</span></li>`).join("")}</ol>
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="start-timer">${icon("play")}开始活动</button><button class="quiet-button full-width" type="button" data-action="tab" data-value="activities">换一个活动</button></div>
  </section>`;
}

function timerDisplay() {
  const mins = Math.floor(state.timerSeconds / 60).toString().padStart(2, "0");
  const secs = (state.timerSeconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function renderTimer() {
  const item = selectedActivity();
  return `<section class="timer-screen">
    ${statusRow("专注进行中")}
    <div class="timer-title"><h1>${item.title}</h1><p>手机可以先放在一边，抬头做完这个小行动。</p></div>
    <div class="timer-orbit"><div class="timer-copy"><div id="timer-value" class="timer-value">${timerDisplay()}</div><small>${state.timerRunning ? "正在计时" : "已暂停"}</small></div></div>
    <div><div class="prototype-warning">${icon("info")}<span>原型演示无需等待10分钟，可以直接点击“我完成了”。</span></div><div class="timer-actions"><button class="secondary-button" type="button" data-action="toggle-timer">${icon(state.timerRunning ? "pause" : "play")}${state.timerRunning ? "暂停" : "继续"}</button><button class="primary-button" type="button" data-action="complete-activity">${icon("check")}我完成了</button></div><button class="quiet-button full-width" type="button" data-action="exit-timer" style="color:rgba(255,255,255,.8);margin-top:8px">先退出，不算失败</button></div>
  </section>`;
}

function renderCompletion() {
  const item = selectedActivity();
  const feelings = ["轻松一点", "差不多", "还想休息"];
  return `<section class="screen screen--no-nav">
    ${statusRow("活动完成")}
    <div class="completion-hero"><div class="completion-badge">${icon("check")}</div><h1>你把想法变成了行动</h1><p>完成“${item.title}”，比一直刷下去多了一种选择。</p></div>
    <div class="section-title"><h2>现在感觉怎么样？</h2><small>可跳过</small></div>
    <div class="feeling-grid">${feelings.map((feeling) => `<button class="feeling-button ${state.completionFeeling === feeling ? "is-selected" : ""}" type="button" data-action="select-feeling" data-value="${feeling}">${feeling}</button>`).join("")}</div>
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="finish-activity">记录这次尝试 ${icon("arrowRight")}</button><button class="quiet-button full-width" type="button" data-action="navigate" data-view="home">不记录，直接回首页</button></div>
  </section>`;
}

function renderPlan() {
  const days = [["一", true], ["二", true], ["三", false], ["四", true], ["五", false], ["六", false], ["日", false]];
  return `<section class="screen">
    ${statusRow("第2周")}
    <div class="topbar"><div class="topbar__copy"><div class="eyebrow">成长不是比赛</div><h1>我的小计划</h1><p>一次只改变一点点</p></div><button class="icon-button" type="button" data-action="growth" aria-label="查看成长回顾">${icon("report")}</button></div>
    <article class="plan-hero"><h1>睡前30分钟<br />不刷短视频</h1><p>替代行动：听一段故事、整理书包，或者和外婆聊五分钟。</p><div class="week-strip">${days.map(([day, done]) => `<span class="week-day ${done ? "is-done" : ""}"><small>周</small><b>${day}</b></span>`).join("")}</div></article>
    <div class="section-title"><h2>这周的进度</h2><small>不连续也没关系</small></div>
    <article class="goal-card"><div class="goal-card__head"><div><h3>已经尝试 ${state.goalProgress} 次</h3><p>目标是3次，不要求每天完成。</p></div><span class="goal-card__status">进行中</span></div><div class="progress-track"><span style="width:${Math.min(100, state.goalProgress / 3 * 100)}%"></span></div><button class="secondary-button full-width" type="button" data-action="mark-goal">记录今天的尝试</button></article>
    <div class="section-title"><h2>过程比连续更重要</h2></div>
    <div class="stat-grid"><div class="stat-card"><b>${state.completedActivities}</b><small>现实活动</small></div><div class="stat-card"><b>${state.goalProgress}</b><small>目标尝试</small></div><div class="stat-card"><b>1</b><small>主动求助</small></div></div>
    ${bottomNav()}${demoButton()}${demoSheet()}
  </section>`;
}

function renderGrowth() {
  return `<section class="screen screen--no-nav">
    ${statusRow("本周回顾")}
    <div class="topbar"><button class="icon-button" type="button" data-action="tab" data-value="plan" aria-label="返回成长计划">${icon("back")}</button><div class="topbar__copy"><h1>这一周，你多了几种选择</h1><p>不是给你打分，只是帮你看见自己的尝试</p></div><span></span></div>
    <article class="home-hero" style="background:var(--leaf-wash);border-color:rgba(120,166,108,.2)"><div class="home-hero__copy"><div class="eyebrow">WEEKLY NOTE</div><h1>${state.completedActivities}次<br />走回真实生活</h1><p>你在想刷视频的时候，试过伸展、整理和说出感受。</p></div>${companionSvg(state.companion).replace('<svg ', '<svg class="home-hero__companion" ')}</article>
    <div class="section-title"><h2>你做过的选择</h2></div>
    <div class="knowledge-grid"><article class="knowledge-card"><span class="knowledge-card__icon">${icon("activity")}</span><span><b>用现实活动替代刷视频</b><small>你已经完成${state.completedActivities}次，不连续也没关系。</small></span>${icon("check")}</article><article class="knowledge-card"><span class="knowledge-card__icon">${icon("heart")}</span><span><b>把感受说出来</b><small>你愿意先说“我有点想念”，这是很重要的一步。</small></span>${icon("check")}</article></div>
    <div class="section-title"><h2>下周只选一个小目标</h2></div>
    <button class="choice-chip full-width is-selected" type="button">睡前30分钟不刷短视频</button>
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="tab" data-value="plan">保留这个目标</button><button class="quiet-button full-width" type="button" data-action="tab" data-value="plan">回到计划页</button></div>
  </section>`;
}

function renderKnowledge() {
  return `<section class="screen screen--no-nav">
    ${statusRow("内容经人工审核 · 演示")}
    <div class="topbar"><button class="icon-button" type="button" data-action="navigate" data-view="home" aria-label="返回首页">${icon("back")}</button><div class="topbar__copy"><div class="eyebrow">安全成长小站</div><h1>学会保护自己</h1><p>选择一个今天想了解的话题</p></div>${aiMark()}</div>
    <div class="knowledge-grid"><button class="knowledge-card" type="button" data-action="quiz"><span class="knowledge-card__icon">${icon("heart")}</span><span><b>心情与相处</b><small>孤单、冲突、被排斥时可以怎么做</small></span>${icon("arrowRight")}</button><button class="knowledge-card" type="button" data-action="quiz"><span class="knowledge-card__icon">${icon("shield")}</span><span><b>网络与人身安全</b><small>隐私、诈骗、网友和危险挑战</small></span>${icon("arrowRight")}</button><button class="knowledge-card" type="button" data-action="quiz"><span class="knowledge-card__icon">${icon("user")}</span><span><b>身体与边界保护</b><small>认识身体边界，学会拒绝和求助</small></span>${icon("arrowRight")}</button></div>
    <div class="prototype-warning">${icon("info")}<span>原型中的知识卡为演示内容。正式产品必须标注真实审核人、机构、日期和来源。</span></div>
  </section>`;
}

function renderQuiz() {
  const options = ["把地址发给他，证明自己够朋友", "先不发送，退出聊天并告诉可信任的大人", "只发学校名字，不发家庭地址"];
  return `<section class="screen screen--no-nav">
    ${statusRow("网络安全 · 11—14岁")}
    <div class="topbar"><button class="icon-button" type="button" data-action="knowledge" aria-label="返回知识中心">${icon("back")}</button><div class="topbar__copy"><h1>情景小练习</h1><p>先自己想一想，再看原因</p></div><span></span></div>
    <article class="quiz-scene"><div class="quiz-scene__label">场景 01 / 03</div><h2>刚认识的网友说：“把你家地址发给我，我给你寄礼物。”</h2></article>
    <div class="section-title"><h2>你会怎么做？</h2></div>
    <div class="quiz-options">${options.map((option, index) => `<button class="quiz-option ${state.quizAnswer === index ? (index === 1 ? "is-correct" : "is-wrong") : ""}" type="button" data-action="answer-quiz" data-value="${index}">${option}</button>`).join("")}</div>
    ${state.quizAnswer !== null ? `<div class="quiz-feedback"><b>${state.quizAnswer === 1 ? "这个选择更安全。" : "这个选择仍可能泄露隐私。"}</b><br />地址、学校、电话和证件信息都不要发给陌生网友。可以退出聊天、保存证据，并告诉可信任的大人。</div>` : ""}
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="start-risk-demo" ${state.quizAnswer === null ? "disabled" : ""}>看看遇到风险时小伴怎么做 ${icon("arrowRight")}</button><button class="quiet-button full-width" type="button" data-action="knowledge">返回知识中心</button></div>
  </section>`;
}

function renderProfile() {
  return `<section class="screen">
    ${statusRow("个人空间")}
    <article class="profile-hero"><span class="profile-hero__avatar">${companionSvg(state.companion)}</span><div><div class="eyebrow">${aiMark()}</div><h1>${escapeHtml(state.name)}和小伴</h1><p>${state.grade} · 喜欢${state.interests.join("、") || "发现新事物"}</p></div></article>
    <div class="menu-list">
      <button class="menu-item" type="button" data-action="trusted"><span class="menu-item__icon">${icon("people")}</span><span><b>可信任的大人</b><small>外婆、班主任 · 随时可以求助</small></span>${icon("arrowRight")}</button>
      <button class="menu-item" type="button" data-action="knowledge"><span class="menu-item__icon">${icon("book")}</span><span><b>安全成长小站</b><small>心情、安全与身体保护知识</small></span>${icon("arrowRight")}</button>
      <button class="menu-item" type="button" data-action="offline"><span class="menu-item__icon">${icon("wifiOff")}</span><span><b>模拟无网络状态</b><small>看看弱网时还能做什么</small></span>${icon("arrowRight")}</button>
      <button class="menu-item" type="button" data-action="open-adult"><span class="menu-item__icon">${icon("report")}</span><span><b>预览监护端</b><small>周报、隐私边界与必要风险提醒</small></span>${icon("arrowRight")}</button>
      <button class="menu-item" type="button" data-action="reset-demo"><span class="menu-item__icon">${icon("reset")}</span><span><b>重置原型</b><small>清除本机演示状态并回到欢迎页</small></span>${icon("arrowRight")}</button>
    </div>
    <div class="prototype-warning">${icon("lock")}<span>当前使用的是虚构演示账号。原型不会读取通讯录、定位、相册或其他App数据。</span></div>
    ${bottomNav()}${demoButton()}${demoSheet()}
  </section>`;
}

function renderTrusted() {
  return `<section class="screen screen--no-nav">
    ${statusRow("真人帮助")}
    <div class="topbar"><button class="icon-button" type="button" data-action="navigate" data-view="home" aria-label="返回首页">${icon("back")}</button><div class="topbar__copy"><div class="eyebrow">你不需要一个人扛着</div><h1>找可信任的大人</h1><p>选择你现在愿意联系的人</p></div><span></span></div>
    <div class="knowledge-grid"><article class="trusted-card"><span class="trusted-avatar">外</span><span><b>外婆</b><small>在家 · 可以当面说</small></span><button class="icon-button" type="button" data-action="mock-contact" data-value="外婆" aria-label="联系外婆">${icon("chat")}</button></article><article class="trusted-card"><span class="trusted-avatar" style="background:var(--teal-wash);color:var(--teal-deep)">林</span><span><b>林老师</b><small>班主任 · 工作时间可联系</small></span><button class="icon-button" type="button" data-action="mock-contact" data-value="林老师" aria-label="联系林老师">${icon("phone")}</button></article></div>
    <article class="paper-card paper-card--padded" style="margin-top:18px"><div class="section-title" style="margin-top:0"><h2>不知道怎么开口？</h2></div><p class="helper-text">可以先照着说：“我遇到一件让我不舒服/担心的事，我希望你先听我讲完。”</p><button class="secondary-button full-width" type="button" data-action="copy-help" style="margin-top:12px">${icon("save")}复制这句话</button></article>
    <div class="prototype-warning">${icon("info")}<span>这是原型演示，联系按钮不会真实拨号或发送消息。正式产品只会显示经过验证的联系人。</span></div>
  </section>`;
}

function renderRisk() {
  return `<section class="screen screen--no-nav screen--danger">
    ${statusRow("识别到网络隐私风险")}
    <article class="risk-hero"><span class="risk-hero__mark">${icon("alert")}</span><h1>先不要发送任何信息</h1><p>家庭地址、学校、电话和证件信息都不能发给陌生网友。你没有做错，现在先让自己安全。</p></article>
    <div class="risk-actions"><button class="risk-action" type="button" data-action="risk-exit"><span class="risk-action__icon">${icon("exit")}</span><span><b>1. 退出与网友的聊天</b><small>不继续解释，也不要点击对方发来的链接</small></span>${icon("arrowRight")}</button><button class="risk-action" type="button" data-action="risk-save"><span class="risk-action__icon">${icon("save")}</span><span><b>2. 保存必要证据</b><small>不要转发给同学，可以截图给可信任的大人看</small></span>${icon("arrowRight")}</button><button class="risk-action" type="button" data-action="risk-notify"><span class="risk-action__icon">${icon("people")}</span><span><b>3. 告诉可信任的大人</b><small>请外婆或老师帮你一起处理</small></span>${icon("arrowRight")}</button></div>
    <div class="prototype-warning">${icon("alert")}<span>当前为高保真原型，风险识别和通知均为预设演示，不具备真实救援能力。</span></div>
    <button class="quiet-button full-width" type="button" data-action="navigate" data-view="home">返回首页</button>
  </section>`;
}

function renderRiskSent() {
  return `<section class="screen screen--no-nav">
    ${statusRow("演示通知已生成")}
    <div class="completion-hero"><div class="completion-badge" style="background:var(--teal-wash)">${icon("people")}</div><h1>你已经迈出了求助的一步</h1><p>原型模拟生成了一条给外婆和林老师的必要风险提醒。</p></div>
    <article class="paper-card paper-card--padded"><div class="eyebrow">通知内容预览</div><b>网络隐私风险 · 需要成人关注</b><p class="helper-text">19:10，儿童表示有网友索要家庭地址。建议及时了解情况、保存必要证据并帮助退出联系。</p></article>
    <div class="prototype-warning">${icon("alert")}<span><b>演示通知，未真实发送。</b>正式产品必须在确认送达后，才能向儿童显示“有人正在帮助你”。</span></div>
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="open-adult">查看成人端如何承接 ${icon("arrowRight")}</button><button class="quiet-button full-width" type="button" data-action="navigate" data-view="home">回到儿童端首页</button></div>
  </section>`;
}

function adultNav() {
  const items = [["overview", "home", "概览"], ["report", "report", "周报"], ["alerts", "bell", "提醒"], ["settings", "settings", "设置"]];
  return `<nav class="adult-bottom-nav" aria-label="监护端主导航">${items.map(([tab, itemIcon, label]) => `<button class="adult-nav-button ${state.adultView === tab ? "is-active" : ""}" type="button" data-action="adult-tab" data-value="${tab}" ${state.adultView === tab ? 'aria-current="page"' : ""}>${icon(itemIcon)}<span>${label}</span></button>`).join("")}</nav>`;
}

function renderAdult() {
  if (state.adultView === "alert-detail") return renderAlertDetail();
  if (state.adultView === "report") return renderAdultReport();
  if (state.adultView === "alerts") return renderAdultAlerts();
  if (state.adultView === "settings") return renderAdultSettings();
  const trend = [42, 58, 34, 68, 48, 76, 60];
  return `<section class="adult-shell">
    <header class="adult-brand"><div class="adult-brand__title"><span class="brand-seed">${icon("sprout")}</span><span><b>小伴 · 监护端</b><small>虚构账号 · 外婆</small></span></div><button class="icon-button" type="button" data-action="close-adult" aria-label="返回儿童端">${icon("logout")}</button></header>
    <article class="adult-overview"><div class="adult-overview__head"><div><h1>${escapeHtml(state.name)}本周在尝试新的选择</h1><p>数据只用于支持成长，不作心理诊断。</p></div>${aiMark()}</div><div class="adult-stats"><div class="adult-stat"><b>${state.completedActivities}</b><small>现实活动</small></div><div class="adult-stat"><b>${state.goalProgress}/3</b><small>目标尝试</small></div><div class="adult-stat"><b>18m</b><small>日均使用</small></div></div></article>
    <div class="privacy-shield">${icon("eyeOff")}<span><b>隐私边界：</b>您看到的是活动和目标趋势，不会默认看到孩子的完整聊天内容。</span></div>
    <div class="section-title"><h2>本周现实行动</h2><small>次数，不是得分</small></div>
    <article class="trend-card"><h3>从AI对话进入现实活动</h3><div class="trend-bars">${trend.map((height, index) => `<span class="trend-day"><span class="trend-bar" style="height:${height}%"></span><span>${["一", "二", "三", "四", "五", "六", "日"][index]}</span></span>`).join("")}</div></article>
    ${state.riskNotified ? `<div class="section-title"><h2>需要您处理</h2><small>1条</small></div><button class="adult-alert full-width" type="button" data-action="adult-alert"><span class="adult-alert__icon">${icon("alert")}</span><span><b>网络隐私风险</b><small>19:10 · 有网友索要家庭地址 · ${state.alertHandled ? "已处理" : "待确认"}</small></span>${icon("arrowRight")}</button>` : ""}
    <div class="section-title"><h2>一个亲子小建议</h2></div>
    <article class="paper-card paper-card--padded"><b>先问“你希望我怎么陪你？”</b><p class="helper-text">比起直接没收手机，先听孩子说完，再一起约定今晚可以做的替代活动。</p></article>
    ${adultNav()}
  </section>`;
}

function renderAdultReport() {
  return `<section class="adult-shell">${adultHeader("本周周报", "只展示必要趋势，不作诊断")}<article class="paper-card paper-card--padded"><div class="eyebrow">本周摘要 · AI生成</div><h2 style="font-family:var(--heading-font);margin:0">${escapeHtml(state.name)}更愿意把“无聊”说出来了</h2><p class="helper-text">本周从陪伴对话进入现实活动${state.completedActivities}次，选择过伸展、整理和表达想念。建议成人继续肯定“愿意说”和“愿意尝试”本身。</p></article><div class="section-title"><h2>您能看到什么</h2></div><div class="knowledge-grid"><article class="knowledge-card"><span class="knowledge-card__icon">${icon("eye")}</span><span><b>可见：趋势与必要提醒</b><small>活动次数、目标尝试、使用时长和风险事件</small></span>${icon("check")}</article><article class="knowledge-card"><span class="knowledge-card__icon">${icon("eyeOff")}</span><span><b>不可见：普通聊天全文</b><small>孩子的一般心情与日常表达默认受到保护</small></span>${icon("lock")}</article></div>${adultNav()}</section>`;
}

function renderAdultAlerts() {
  return `<section class="adult-shell">${adultHeader("提醒", "只保留需要成人承接的事件")}${state.riskNotified ? `<button class="adult-alert full-width" type="button" data-action="adult-alert"><span class="adult-alert__icon">${icon("alert")}</span><span><b>网络隐私风险</b><small>19:10 · ${state.alertHandled ? "已处理" : "待确认处理"}</small></span>${icon("arrowRight")}</button>` : `<div class="empty-screen" style="min-height:420px;padding:20px"><div class="empty-visual">${icon("shield")}</div><h1>目前没有风险提醒</h1><p>普通心情不会被当成风险事件发送给成人。</p></div>`}${adultNav()}</section>`;
}

function renderAdultSettings() {
  return `<section class="adult-shell">${adultHeader("设置与边界", "真实产品上线前需完成监护验证")}<div class="menu-list"><article class="menu-item"><span class="menu-item__icon">${icon("people")}</span><span><b>绑定关系</b><small>外婆 · 原型预设，未真实验证</small></span>${icon("lock")}</article><article class="menu-item"><span class="menu-item__icon">${icon("timer")}</span><span><b>使用提醒</b><small>连续使用15分钟时，建议休息和现实行动</small></span>${icon("arrowRight")}</article><article class="menu-item"><span class="menu-item__icon">${icon("eyeOff")}</span><span><b>聊天隐私</b><small>普通聊天全文默认不向成人开放</small></span>${icon("arrowRight")}</article></div><div class="prototype-warning">${icon("info")}<span>正式产品必须记录权限变更，并用儿童能理解的语言告知谁可以看到什么。</span></div>${adultNav()}</section>`;
}

function adultHeader(title, subtitle) {
  return `<header class="adult-brand"><div class="adult-brand__title"><span class="brand-seed">${icon("sprout")}</span><span><b>${title}</b><small>${subtitle}</small></span></div><button class="icon-button" type="button" data-action="close-adult" aria-label="返回儿童端">${icon("logout")}</button></header>`;
}

function renderAlertDetail() {
  return `<section class="adult-shell">
    <header class="adult-brand"><div class="adult-brand__title"><button class="icon-button" type="button" data-action="adult-tab" data-value="alerts" aria-label="返回提醒列表">${icon("back")}</button><span><b>风险事件详情</b><small>只展示处理所需信息</small></span></div><button class="icon-button" type="button" data-action="close-adult" aria-label="返回儿童端">${icon("logout")}</button></header>
    <article class="alert-detail__header"><span>L2 · 高风险</span><h1>陌生网友索要家庭地址</h1><p>发生时间：今天19:10 · 来源：儿童主动向AI描述</p></article>
    <div class="section-title"><h2>建议处理步骤</h2></div>
    <div class="event-timeline"><div class="event-step"><span class="event-step__dot">1</span><span><b>先确认孩子当前安全</b><small>平静询问发生了什么，不责备、不盘问。</small></span></div><div class="event-step"><span class="event-step__dot">2</span><span><b>停止继续联系</b><small>帮助孩子退出聊天，不点击陌生链接。</small></span></div><div class="event-step"><span class="event-step__dot">3</span><span><b>保存必要证据</b><small>如有持续威胁，联系学校或相关专业人员。</small></span></div></div>
    <div class="privacy-shield">${icon("eyeOff")}<span>系统没有展示此前无关的聊天内容，只提供了处理本事件所需的必要上下文。</span></div>
    <div class="button-stack"><button class="primary-button full-width" type="button" data-action="handle-alert">${icon("check")}${state.alertHandled ? "已确认处理" : "我已看到，正在处理"}</button><button class="quiet-button full-width" type="button" data-action="adult-tab" data-value="alerts">返回提醒列表</button></div>
  </section>`;
}

function renderOffline() {
  return `<section class="offline-screen">
    <div class="offline-visual">${icon("wifiOff")}</div><h1>网络暂时走远了</h1><p>不用一直等待。离线时，你仍然可以做一个小活动、看已保存的安全知识，或者找身边的大人。</p>
    <div class="offline-actions"><button class="primary-button full-width" type="button" data-action="select-offline-activity">${icon("activity")}做一个离线活动</button><button class="secondary-button full-width" type="button" data-action="trusted">${icon("people")}查看可信任的大人</button><button class="quiet-button full-width" type="button" data-action="retry-network">${icon("refresh")}重新连接</button></div>
    <div class="prototype-warning">${icon("info")}<span>原型模拟无网络状态。正式PWA会缓存经过审核的活动、知识和联系人信息。</span></div>
  </section>`;
}

function render() {
  clearTimerIfNeeded();
  const views = {
    welcome: renderWelcome,
    boundaries: renderBoundaries,
    setup: renderSetup,
    companion: renderCompanion,
    home: renderHome,
    chat: renderChat,
    activities: renderActivities,
    "activity-detail": renderActivityDetail,
    timer: renderTimer,
    completion: renderCompletion,
    plan: renderPlan,
    growth: renderGrowth,
    knowledge: renderKnowledge,
    quiz: renderQuiz,
    profile: renderProfile,
    trusted: renderTrusted,
    risk: renderRisk,
    "risk-sent": renderRiskSent,
    adult: renderAdult,
    offline: renderOffline,
  };
  main.innerHTML = (views[state.view] || renderWelcome)();
  overlay.replaceChildren(...main.querySelectorAll(".bottom-nav, .adult-bottom-nav, .chat-compose, .demo-fab, .sheet-backdrop"));
  if (state.view === "timer" && state.timerRunning) startTimerInterval();
  if (state.view === "chat") requestAnimationFrame(scrollChatToBottom);
  main.focus({ preventScroll: true });
  persistState();
}

function navigate(view, push = true) {
  state.view = view;
  state.demoOpen = false;
  if (["home", "activities", "plan", "profile"].includes(view)) state.activeTab = view;
  if (push) history.pushState({ view }, "", `#${view}`);
  render();
}

function startDemo(route) {
  ensureDemoProfile();
  state.demoOpen = false;
  if (route === "bored") {
    state.chatScenario = "bored";
    state.chatStep = 1;
    state.messages = [
      { role: "user", text: "我好无聊，想刷视频。" },
      { role: "ai", text: "无聊的时候，手很容易自己去点短视频。我们不急着硬忍。你现在更想动一动，还是安静做点事？" },
    ];
    state.quickReplies = ["想动一动", "安静做点事"];
    navigate("chat");
    return;
  }
  if (route === "lonely") {
    state.chatScenario = "lonely";
    state.chatStep = 1;
    state.messages = [
      { role: "user", text: "爸爸妈妈很久没有回来了。" },
      { role: "ai", text: "听起来，你心里装着很多想念。你现在的感觉更接近“想念”“难过”，还是“有点委屈”？" },
    ];
    state.quickReplies = ["很想念", "有点难过", "有点委屈"];
    navigate("chat");
    return;
  }
  state.chatScenario = "risk";
  state.messages = [
    { role: "user", text: "网友让我把家庭地址发给他，说要寄礼物。" },
    { role: "ai", text: "这件事很重要。先不要发送地址、电话、学校或证件信息，我来陪你一步一步处理。" },
  ];
  state.quickReplies = [];
  navigate("risk");
}

function ensureDemoProfile() {
  state.onboarded = true;
  if (!state.name) state.name = "小禾";
}

function startGenericChat() {
  state.chatScenario = "generic";
  state.chatStep = 0;
  state.messages = [{ role: "ai", text: `晚上好，${escapeHtml(state.name)}。我在这里听你说。现在最想聊哪件事？` }];
  state.quickReplies = ["我有点无聊", "我想聊聊家里", "我有个安全问题"];
  navigate("chat");
}

function handleQuickReply(value) {
  addUserMessage(value);
  if (state.chatScenario === "bored") {
    if (state.chatStep === 1) {
      state.activityFilter = value.includes("安静") ? "quiet" : "move";
      state.chatStep = 2;
      replyAfter(`好，我们不选太多。我找了三个${value.includes("安静") ? "安静、简单" : "能让身体动起来"}的小活动，每个都不超过10分钟。`, ["看看活动"]);
      return;
    }
    if (state.chatStep === 2) {
      navigate("activities");
      return;
    }
  }
  if (state.chatScenario === "lonely") {
    if (state.chatStep === 1) {
      state.chatStep = 2;
      replyAfter("谢谢你告诉我。想念一个人并不丢脸。你愿意先做哪一件小事？", ["录一段话给家人", "把想说的话写下来", "先做一分钟呼吸"]);
      return;
    }
    if (state.chatStep === 2) {
      state.chatStep = 3;
      replyAfter(value.includes("录") ? "我们可以先录一小段，不需要说得很完整。原型不会真的上传声音。你想请谁帮你联系爸爸妈妈？" : "可以。做完以后，你也可以请身边的大人陪你联系家人。", ["请外婆帮我联系", "我想先自己写下来"]);
      return;
    }
    if (state.chatStep === 3) {
      if (value.includes("外婆")) {
        showToast("已准备好一句开口提示，未真实发送");
        setTimeout(() => navigate("trusted"), 450);
      } else {
        replyAfter("好。你可以从这句开始：“我今天很想你，我想告诉你一件小事。”写好以后再决定要不要发出去。", ["先聊到这里"]);
      }
      return;
    }
  }
  handleFreeMessage(value);
}

function handleFreeMessage(text) {
  const risky = /(地址|住址|证件|身份证|陌生链接|网友|寄礼物|自伤|不想活|伤害)/.test(text);
  const lonely = /(爸爸|妈妈|家人|想念|很久没回来)/.test(text);
  const bored = /(无聊|刷视频|短视频|没事做)/.test(text);
  if (risky) {
    state.chatScenario = "risk";
    state.messages.push({ role: "ai", text: "这件事可能关系到你的安全。先不要继续发送信息，我们马上看清楚下一步怎么做。" });
    state.quickReplies = [];
    render();
    setTimeout(() => navigate("risk"), 650);
  } else if (lonely) {
    state.chatScenario = "lonely";
    state.chatStep = 1;
    replyAfter("听起来，你心里装着很多想念。现在更接近“想念”“难过”，还是“有点委屈”？", ["很想念", "有点难过", "有点委屈"]);
  } else if (bored) {
    state.chatScenario = "bored";
    state.chatStep = 1;
    replyAfter("无聊的时候，手很容易自己去点短视频。我们不急着硬忍。你现在更想动一动，还是安静做点事？", ["想动一动", "安静做点事"]);
  } else if (text.includes("先聊到这里")) {
    replyAfter("好，我们先到这里。你可以去喝口水、看看窗外，或者找身边的人说几句话。需要时再回来。", []);
  } else {
    replyAfter("我听见了。我们可以先把这件事分成一小步：你更希望我先听你说，还是一起想个能马上做的办法？", ["先听我说", "一起想办法"]);
  }
}

function addUserMessage(text) {
  state.messages.push({ role: "user", text: escapeHtml(text) });
  state.quickReplies = [];
  render();
}

function replyAfter(text, replies = []) {
  state.typing = true;
  render();
  setTimeout(() => {
    state.typing = false;
    state.messages.push({ role: "ai", text });
    state.quickReplies = replies;
    render();
  }, 520);
}

function scrollChatToBottom() {
  const scroll = document.querySelector("#chat-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function startTimerInterval() {
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (!state.timerRunning || state.view !== "timer") return;
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    const timerValue = document.querySelector("#timer-value");
    if (timerValue) timerValue.textContent = timerDisplay();
    if (state.timerSeconds === 0) {
      state.timerRunning = false;
      clearInterval(timerHandle);
      navigate("completion");
    }
  }, 1000);
}

function clearTimerIfNeeded() {
  if (state.view !== "timer" && timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function showToast(message) {
  clearTimeout(toastHandle);
  toastRegion.innerHTML = `<div class="toast">${icon("check")}<span>${message}</span></div>`;
  toastHandle = setTimeout(() => {
    toastRegion.innerHTML = "";
  }, 3400);
}

function persistState() {
  const safe = {
    onboarded: state.onboarded,
    name: state.name,
    age: state.age,
    grade: state.grade,
    interests: state.interests,
    companion: state.companion,
    completedActivities: state.completedActivities,
    goalProgress: state.goalProgress,
  };
  localStorage.setItem("xiaoban-prototype", JSON.stringify(safe));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("xiaoban-prototype") || "null");
    if (saved) state = { ...state, ...saved };
  } catch {
    localStorage.removeItem("xiaoban-prototype");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resetDemo() {
  localStorage.removeItem("xiaoban-prototype");
  state = initialState();
  history.pushState({ view: "welcome" }, "", "#welcome");
  render();
  showToast("原型已经重置");
}

app.addEventListener("click", (event) => {
  const stopTarget = event.target.closest("[data-stop-propagation]");
  if (stopTarget && !event.target.closest("button")) {
    event.stopPropagation();
    return;
  }
  const demoRoute = event.target.closest("[data-demo-route]");
  if (demoRoute) {
    startDemo(demoRoute.dataset.demoRoute);
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  const view = target.dataset.view;

  const actions = {
    navigate: () => navigate(view),
    "quick-start": () => { ensureDemoProfile(); navigate("home"); },
    "select-grade": () => { state.grade = value; render(); },
    "toggle-interest": () => { state.interests = state.interests.includes(value) ? state.interests.filter((item) => item !== value) : [...state.interests, value]; render(); },
    "select-companion": () => { state.companion = value; render(); },
    "finish-onboarding": () => { ensureDemoProfile(); navigate("home"); showToast("欢迎你，和小伴一起慢慢来"); },
    "select-mood": () => { state.mood = value; render(); if (value === "无聊") setTimeout(() => startDemo("bored"), 320); },
    "start-chat": startGenericChat,
    tab: () => navigate(value),
    knowledge: () => navigate("knowledge"),
    quiz: () => { state.quizAnswer = null; navigate("quiz"); },
    "answer-quiz": () => { state.quizAnswer = Number(value); render(); },
    "start-risk-demo": () => startDemo("risk"),
    trusted: () => navigate("trusted"),
    "toggle-demo": () => { state.demoOpen = !state.demoOpen; render(); },
    "close-demo": () => { state.demoOpen = false; render(); },
    "start-timer": () => { state.timerSeconds = selectedActivity().duration * 60; state.timerRunning = true; navigate("timer"); },
    "toggle-timer": () => { state.timerRunning = !state.timerRunning; render(); },
    "complete-activity": () => { state.timerRunning = false; navigate("completion"); },
    "exit-timer": () => { state.timerRunning = false; navigate("activity-detail"); showToast("退出不算失败，你可以换个时间再试"); },
    "select-feeling": () => { state.completionFeeling = value; render(); },
    "finish-activity": () => { state.completedActivities += 1; state.goalProgress = Math.min(3, state.goalProgress + 1); navigate("plan"); showToast("已记录这次现实行动"); },
    "filter-activity": () => { state.activityFilter = value; render(); },
    "select-activity": () => { state.selectedActivity = value; navigate("activity-detail"); },
    "mark-goal": () => { state.goalProgress = Math.min(3, state.goalProgress + 1); render(); showToast(state.goalProgress === 3 ? "这周的小目标完成了" : "已记录今天的尝试"); },
    growth: () => navigate("growth"),
    "chat-back": () => navigate("home"),
    "quick-reply": () => handleQuickReply(value),
    "voice-demo": () => showToast("语音按钮仅作演示，没有录音或上传"),
    "mock-contact": () => showToast(`已生成联系${value}的演示动作，未真实发送`),
    "copy-help": async () => { try { await navigator.clipboard.writeText("我遇到一件让我不舒服或担心的事，我希望你先听我讲完。"); showToast("开口提示已复制"); } catch { showToast("已准备好开口提示"); } },
    "risk-exit": () => showToast("已模拟退出网友聊天"),
    "risk-save": () => showToast("已模拟保存必要证据"),
    "risk-notify": () => { state.riskNotified = true; navigate("risk-sent"); },
    "open-adult": () => { ensureDemoProfile(); state.demoOpen = false; state.adultView = "overview"; navigate("adult"); },
    "close-adult": () => navigate("profile"),
    "adult-tab": () => { state.adultView = value; render(); },
    "adult-alert": () => { state.adultView = "alert-detail"; render(); },
    "handle-alert": () => { state.alertHandled = true; render(); showToast("已记录成人开始处理"); },
    offline: () => navigate("offline"),
    "retry-network": () => { navigate("profile"); showToast("已恢复演示连接"); },
    "select-offline-activity": () => { state.selectedActivity = "tidy"; navigate("activity-detail"); },
    "reset-demo": resetDemo,
  };
  actions[action]?.();
});

document.addEventListener("click", (event) => {
  const demoRoute = event.target.closest(".story-rail [data-demo-route]");
  if (demoRoute) startDemo(demoRoute.dataset.demoRoute);
});

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (field) state[field] = event.target.value;
});

app.addEventListener("submit", (event) => {
  if (event.target.id !== "chat-form") return;
  event.preventDefault();
  const input = event.target.querySelector("#chat-input");
  const text = input.value.trim();
  if (!text) {
    showToast("可以先输入一句想说的话");
    return;
  }
  addUserMessage(text);
  handleFreeMessage(text);
});

window.addEventListener("popstate", (event) => {
  state.view = event.state?.view || location.hash.slice(1) || (state.onboarded ? "home" : "welcome");
  if (["home", "activities", "plan", "profile"].includes(state.view)) state.activeTab = state.view;
  render();
});

window.__xiaobanPrototype = {
  getState: () => ({ ...state }),
  startDemo,
  resetDemo,
  navigate,
};

loadState();
const initialView = location.hash.slice(1);
if (initialView) state.view = initialView;
else if (state.onboarded) state.view = "home";
if (["home", "activities", "plan", "profile"].includes(state.view)) state.activeTab = state.view;
history.replaceState({ view: state.view }, "", `#${state.view}`);
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // The prototype remains fully usable without service worker support.
  });
}
