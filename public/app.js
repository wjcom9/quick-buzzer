const socket = io();
const root = document.querySelector("#app");
const TEAM_NAMES = ["南万党支部先锋一队","南万党支部先锋二队","南万党支部先锋三队","南万党支部先锋四队","南万党支部先锋五队","南万党支部先锋六队","南万党支部先锋七队","柳万党支部队","桂万党支部队"];
let tab = "join", session = null, room = null, error = "", loading = false, copied = false;
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const logo = () => '<div class="logo" aria-label="极速抢答"><span>⚡</span> 极速抢答</div>';
const emit = (event, payload) => new Promise((resolve, reject) => socket.emit(event, payload, response => response?.ok ? resolve(response) : reject(new Error(response?.error || "操作失败"))));
function saveSession() { session ? sessionStorage.setItem("buzzer-session", JSON.stringify(session)) : sessionStorage.removeItem("buzzer-session"); }
function showError(message) { error = message; render(); }
function historyKey() { return `buzzer-history:${session?.code || "unknown"}`; }
function savedHistory() { try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch { return []; } }
function syncHistory(nextRoom) {
  if (!session || !nextRoom) return;
  const merged = new Map(savedHistory().map(item => [item.round, item]));
  for (const item of nextRoom.history || []) merged.set(item.round, item);
  try { localStorage.setItem(historyKey(), JSON.stringify([...merged.values()].sort((a,b) => a.round - b.round))); } catch {}
}
function teamOptions() { return TEAM_NAMES.map((name, index) => `<label class="team-option"><input type="radio" name="teamName" value="${esc(name)}" ${index === 0 ? "required" : ""}><span>${esc(name)}</span></label>`).join(""); }

function landing() {
  root.innerHTML = `<main class="landing"><div class="topbar">${logo()}<span class="online"><i></i> 服务正常</span></div>
    <section class="hero"><div class="hero-copy"><div class="eyebrow">无需下载 · 即开即用</div><h1>让每一次抢答<br><em>快人一步</em></h1>
    <p>选择队伍，提交加入申请。主持人批准后即可参与实时抢答。</p><div class="features"><span><b>01</b> 公平计时</span><span><b>02</b> 主持审核</span><span><b>03</b> 团队参与</span></div></div>
    <div class="entry-card"><div class="tabs"><button data-tab="join" class="${tab === "join" ? "active" : ""}">加入房间</button><button data-tab="create" class="${tab === "create" ? "active" : ""}">创建房间</button></div>
    <form id="entry-form">${tab === "join" ? '<label>房间号<input name="code" maxlength="6" placeholder="输入 6 位房间号" required autocomplete="off"></label>' : ""}
    <label>房间密码<input name="password" type="password" minlength="4" maxlength="20" placeholder="${tab === "create" ? "设置 4–20 位密码" : "输入房间密码"}" required></label>
    ${tab === "join" ? `<fieldset class="team-field"><legend>选择队名</legend><div class="team-options">${teamOptions()}</div></fieldset>` : ""}
    ${error ? `<p class="error">${esc(error)}</p>` : ""}<button class="primary" ${loading ? "disabled" : ""}>${loading ? "请稍候…" : tab === "create" ? "创建并成为主持人" : "提交加入申请"}<span>→</span></button></form>
    <p class="privacy">加入申请需经主持人批准</p></div></section><footer>适配手机、平板与电脑 · 建议使用稳定网络</footer></main>`;
  root.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => { tab = button.dataset.tab; error = ""; landing(); });
  root.querySelector('input[name="code"]')?.addEventListener("input", event => event.target.value = event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0,6).toUpperCase());
  root.querySelector("#entry-form").onsubmit = submitEntry;
}

async function submitEntry(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target)); loading = true; error = ""; landing();
  try {
    if (tab === "create") {
      const result = await emit("create-room", { password: data.password });
      session = { role: "host", code: result.code, token: result.hostToken, password: data.password }; room = result.state;
    } else {
      const result = await emit("join-room", { code: data.code, teamName: data.teamName, password: data.password });
      session = { role: "player", code: result.code, token: result.playerToken, teamName: result.teamName, participantId: result.participantId }; room = result.state;
    }
    saveSession();
  } catch (reason) {
    error = reason.message;
  } finally {
    loading = false;
    render();
  }
}

function currentPlayer() { return room?.participants.find(item => item.id === session?.participantId); }
function pageHeader() {
  const copyLabel = copied ? "已复制" : session.role === "host" ? "复制邀请信息" : "复制房间号";
  return `<header>${logo()}<div class="room-meta"><span>房间</span><strong>${esc(session.code)}</strong><button id="copy">${copyLabel}</button><button class="leave" id="leave">退出</button></div></header>`;
}
function bindHeader() {
  root.querySelector("#leave").onclick = () => { session = null; room = null; error = ""; saveSession(); landing(); };
  root.querySelector("#copy").onclick = async () => {
    const inviteText = session.role === "host"
      ? `房间号:${session.code}\n密码:${session.password || "（请填写创建时设置的密码）"}\n请访问 https://quick-buzzer.onrender.com/ 加入吧！`
      : `房间号:${session.code}\n请访问 https://quick-buzzer.onrender.com/ 加入吧！`;
    await navigator.clipboard.writeText(inviteText);
    copied = true; render(); setTimeout(() => { copied = false; if (session) render(); }, 1500);
  };
}

function pendingPage() {
  root.innerHTML = `<main class="room-page">${pageHeader()}<div class="status pending"><i></i>等待主持人审核</div>${error ? `<div class="room-error">${esc(error)}</div>` : ""}
  <section class="pending-stage"><div class="waiting-orbit"><span>⏳</span></div><div class="player-name">${esc(session.teamName)}</div><h1>加入申请已提交</h1><p>主持人批准后，你将自动进入正式抢答房间。</p><div class="waiting-note">请保持此页面开启</div></section></main>`;
  bindHeader();
}

function roomPage() {
  const host = session.role === "host", status = room?.room.status || "waiting";
  if (!host && currentPlayer()?.approvalStatus !== "approved") return pendingPage();
  const myRank = host ? -1 : room.buzzes.findIndex(item => item.participantId === session.participantId);
  const statusText = status === "open" ? "抢答进行中" : status === "closed" ? "本轮已结束" : "等待主持人开始";
  root.innerHTML = `<main class="room-page">${pageHeader()}<div class="status ${status}"><i></i>${statusText}<span>第 ${room?.room.round || 1} 轮</span></div>${error ? `<div class="room-error">${esc(error)}</div>` : ""}
  <section class="room-grid"><div class="stage">${host ? hostStage(status) : playerStage(status, myRank)}</div><aside>${host ? managementPanel() : ""}${historyPanel()}<div class="panel-head"><h2>本轮实时排名</h2><span>${room?.buzzes.length || 0} 队已抢答</span></div>
  <div class="ranking">${ranking()}</div><div class="participants"><span>正式队伍</span><div>${approvedPlayers().filter(p => p.connected).slice(0,5).map(p => `<i title="${esc(p.teamName)}">${esc(p.teamName.slice(0,1))}</i>`).join("")}</div><b>${approvedPlayers().filter(p => p.connected).length} 队</b></div></aside></section></main>`;
  bindHeader();
  root.querySelectorAll("[data-action]").forEach(button => button.onclick = () => hostAction(button.dataset.action, button.dataset.participantId));
  root.querySelector("#buzzer")?.addEventListener("click", buzz);
}

const approvedPlayers = () => room.participants.filter(player => player.approvalStatus === "approved");
const pendingPlayers = () => room.participants.filter(player => player.approvalStatus === "pending");

function managementPanel() {
  const pending = pendingPlayers(), approved = approvedPlayers();
  const pendingRows = pending.length ? pending.map(player => `<div class="member-row pending-row"><div><b>${esc(player.teamName)}</b><small>${player.connected ? "在线等待" : "暂时离线"}</small></div><div class="member-actions"><button class="approve" data-action="approve" data-participant-id="${player.id}">批准</button><button class="kick" data-action="kick" data-participant-id="${player.id}">移除</button></div></div>`).join("") : '<p class="no-members">暂无待审核队伍</p>';
  const approvedRows = approved.length ? approved.map(player => `<div class="member-row"><div><b>${esc(player.teamName)}</b><small>${player.connected ? "● 在线" : "○ 离线"}</small></div><button class="kick" data-action="kick" data-participant-id="${player.id}">踢出</button></div>`).join("") : '<p class="no-members">尚未批准队伍</p>';
  return `<section class="manage-panel"><div class="manage-title"><h2>成员审核</h2>${pending.length ? `<span>${pending.length} 个待处理</span>` : ""}</div><h3>待审核</h3>${pendingRows}<h3>正式队伍</h3>${approvedRows}</section>`;
}

function historyPanel() {
  const history = savedHistory();
  const rows = history.length ? [...history].reverse().map(item => {
    const first = item.buzzes[0]?.buzzedAt;
    const results = item.buzzes.length ? item.buzzes.map((buzz, index) => `<li><b>${index + 1}</b><span>${esc(buzz.teamName)}</span><time>${index === 0 ? "第一名" : `+${((buzz.buzzedAt - first)/1000).toFixed(3)}s`}</time></li>`).join("") : '<p class="history-empty">本轮无人抢答</p>';
    return `<details class="history-round" ${item.round === history.at(-1)?.round ? "open" : ""}><summary><span>第 ${item.round} 轮</span><small>${item.buzzes.length} 队抢答</small></summary><ol>${results}</ol></details>`;
  }).join("") : '<p class="no-members">完成第一轮后，结果会保存在这里</p>';
  return `<section class="history-panel"><div class="history-title"><h2>轮次记录</h2><span>${history.length} 轮</span></div>${rows}</section>`;
}

function hostStage(status) {
  const title = status === "open" ? "抢答已经开始" : status === "closed" ? "本轮抢答结束" : "正式队伍准备好了吗？";
  const online = approvedPlayers().filter(player => player.connected).length;
  return `<div class="host-label">主持人控制台</div><h1>${title}</h1><p>${online} 支正式队伍在线</p><div class="host-controls">${status !== "open" ? `<button class="start" data-action="start" ${online ? "" : "disabled"}>⚡ 开始抢答</button>` : '<button class="stop" data-action="close">结束本轮</button>'}${room.buzzes.length ? '<button class="secondary" data-action="reset">清空结果</button>' : ""}</div><p class="tip">请先在右侧审核队伍，再开始抢答</p>`;
}

function playerStage(status, rank) {
  const title = rank >= 0 ? (rank === 0 ? "恭喜，你们抢到了！" : `你们是第 ${rank + 1} 名`) : status === "open" ? "现在就抢！" : status === "closed" ? "本轮已结束" : "请做好准备";
  const subtitle = rank >= 0 ? "结果已提交，请等待主持人确认" : status === "open" ? "按钮已亮起，越快越好" : "主持人开始后按钮会自动亮起";
  return `<div class="player-name">${esc(session.teamName)}</div><h1>${title}</h1><p>${subtitle}</p><button id="buzzer" class="buzzer ${status === "open" ? "ready" : ""} ${rank >= 0 ? "done" : ""}" ${status !== "open" || rank >= 0 ? "disabled" : ""}><span>${rank >= 0 ? `第 ${rank + 1} 名` : status === "open" ? "抢 答" : "等待中"}</span><small>${status === "open" && rank < 0 ? "点击按钮或按空格键" : ""}</small></button>`;
}

function ranking() {
  if (!room.buzzes.length) return '<div class="empty"><div>⚡</div><p>抢答开始后<br>排名将在这里出现</p></div>';
  const first = room.buzzes[0].buzzedAt;
  return room.buzzes.map((item, index) => `<div class="rank ${index === 0 ? "winner" : ""}"><b>${index + 1}</b><span>${esc(item.teamName)}${item.participantId === session.participantId ? "<small>（本队）</small>" : ""}</span><time>${index === 0 ? "最先抢答" : `+${((item.buzzedAt - first)/1000).toFixed(3)}s`}</time></div>`).join("");
}

async function hostAction(action, participantId) { try { const result = await emit("host-action", { action, participantId, code: session.code, token: session.token }); room = result.state; error = ""; roomPage(); } catch (reason) { showError(reason.message); } }
async function buzz() { try { const result = await emit("buzz", { code: session.code, token: session.token }); room = result.state; error = ""; roomPage(); } catch (reason) { showError(reason.message); } }
function render() { if (session && room) { syncHistory(room); roomPage(); } else landing(); }

socket.on("room-state", next => {
  const wasOpen = room?.room.status === "open"; room = next; error = "";
  if (session?.role === "player" && !currentPlayer()) { session = null; room = null; saveSession(); error = "你的队伍已被主持人移出房间"; return landing(); }
  if (session?.role === "player" && !wasOpen && next.room.status === "open" && currentPlayer()?.approvalStatus === "approved") navigator.vibrate?.(120);
  render();
});
socket.on("kicked", payload => { session = null; room = null; saveSession(); error = payload?.message || "你的队伍已被移出房间"; landing(); });
socket.on("disconnect", () => { if (session) { error = "正在重新连接…"; render(); } });
socket.on("connect", async () => { if (!session) return; try { const result = await emit("resume", session); room = result.state; error = ""; render(); } catch { session = null; room = null; saveSession(); landing(); } });
window.addEventListener("keydown", event => { if (event.code === "Space" && session?.role === "player" && currentPlayer()?.approvalStatus === "approved" && room?.room.status === "open" && !["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName)) { event.preventDefault(); buzz(); } });
try { session = JSON.parse(sessionStorage.getItem("buzzer-session")); } catch { session = null; }
render();
if (session && socket.connected) socket.emit("resume", session, result => { if (result?.ok) { room = result.state; error = ""; render(); } else { session = null; saveSession(); landing(); } });
setInterval(() => { if (session && socket.connected) socket.emit("keepalive", { code: session.code }, () => {}); }, 5 * 60 * 1000);
