const socket = io();
const root = document.querySelector("#app");
let tab = "join", session = null, room = null, error = "", loading = false, copied = false;
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const logo = () => '<div class="logo" aria-label="极速抢答"><span>⚡</span> 极速抢答</div>';
const emit = (event, payload) => new Promise((resolve, reject) => socket.emit(event, payload, response => response?.ok ? resolve(response) : reject(new Error(response?.error || "操作失败"))));

function saveSession() { session ? sessionStorage.setItem("buzzer-session", JSON.stringify(session)) : sessionStorage.removeItem("buzzer-session"); }
function showError(message) { error = message; render(); }

function landing() {
  root.innerHTML = `<main class="landing"><div class="topbar">${logo()}<span class="online"><i></i> 服务正常</span></div>
    <section class="hero"><div class="hero-copy"><div class="eyebrow">无需下载 · 即开即用</div><h1>让每一次抢答<br><em>快人一步</em></h1>
    <p>创建房间，分享房间号。主持人一声令下，系统毫秒级记录抢答顺序。</p><div class="features"><span><b>01</b> 公平计时</span><span><b>02</b> 多端同步</span><span><b>03</b> 实名参与</span></div></div>
    <div class="entry-card"><div class="tabs"><button data-tab="join" class="${tab === "join" ? "active" : ""}">加入房间</button><button data-tab="create" class="${tab === "create" ? "active" : ""}">创建房间</button></div>
    <form id="entry-form">${tab === "join" ? '<label>房间号<input name="code" maxlength="6" placeholder="输入 6 位房间号" required autocomplete="off"></label><label>真实姓名<input name="name" maxlength="20" placeholder="请输入你的真实姓名" required autocomplete="name"></label>' : ""}
    <label>房间密码<input name="password" type="password" minlength="4" maxlength="20" placeholder="${tab === "create" ? "设置 4–20 位密码" : "输入房间密码"}" required></label>${error ? `<p class="error">${esc(error)}</p>` : ""}
    <button class="primary" ${loading ? "disabled" : ""}>${loading ? "请稍候…" : tab === "create" ? "创建并成为主持人" : "进入抢答室"}<span>→</span></button></form><p class="privacy">姓名仅在当前房间内展示</p></div></section>
    <footer>适配手机、平板与电脑 · 建议使用稳定网络</footer></main>`;
  root.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => { tab = button.dataset.tab; error = ""; landing(); });
  root.querySelector('input[name="code"]')?.addEventListener("input", event => event.target.value = event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0,6).toUpperCase());
  root.querySelector("#entry-form").onsubmit = submitEntry;
}

async function submitEntry(event) {
  event.preventDefault(); loading = true; error = ""; landing();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    if (tab === "create") {
      const result = await emit("create-room", { password: data.password });
      session = { role: "host", code: result.code, token: result.hostToken }; room = result.state;
    } else {
      const result = await emit("join-room", { code: data.code, name: data.name, password: data.password });
      session = { role: "player", code: result.code, token: result.playerToken, name: result.name, participantId: result.participantId }; room = result.state;
    }
    saveSession(); render();
  } catch (reason) { error = reason.message; landing(); }
  finally { loading = false; }
}

function roomPage() {
  const host = session.role === "host", status = room?.room.status || "waiting";
  const myRank = host ? -1 : room.buzzes.findIndex(item => item.participantId === session.participantId);
  const statusText = status === "open" ? "抢答进行中" : status === "closed" ? "本轮已结束" : "等待主持人开始";
  root.innerHTML = `<main class="room-page"><header>${logo()}<div class="room-meta"><span>房间</span><strong>${esc(session.code)}</strong><button id="copy">${copied ? "已复制" : "复制"}</button><button class="leave" id="leave">退出</button></div></header>
  <div class="status ${status}"><i></i>${statusText}<span>第 ${room?.room.round || 1} 轮</span></div>${error ? `<div class="room-error">${esc(error)}</div>` : ""}
  <section class="room-grid"><div class="stage">${host ? hostStage(status) : playerStage(status, myRank)}</div><aside><div class="panel-head"><h2>实时排名</h2><span>${room?.buzzes.length || 0} 人已抢答</span></div>
  <div class="ranking">${ranking()}</div><div class="participants"><span>在线成员</span><div>${room.participants.filter(p => p.connected).slice(0,5).map(p => `<i title="${esc(p.name)}">${esc(p.name.slice(0,1))}</i>`).join("")}</div><b>${room.participants.filter(p => p.connected).length} 人</b></div></aside></section></main>`;
  root.querySelector("#leave").onclick = () => { session = null; room = null; error = ""; saveSession(); landing(); };
  root.querySelector("#copy").onclick = async () => { await navigator.clipboard.writeText(`房间号：${session.code}`); copied = true; roomPage(); setTimeout(() => { copied = false; if (session) roomPage(); }, 1500); };
  root.querySelectorAll("[data-action]").forEach(button => button.onclick = () => hostAction(button.dataset.action));
  root.querySelector("#buzzer")?.addEventListener("click", buzz);
}

function hostStage(status) {
  const title = status === "open" ? "抢答已经开始" : status === "closed" ? "本轮抢答结束" : "所有人准备好了吗？";
  const online = room.participants.filter(player => player.connected).length;
  return `<div class="host-label">主持人控制台</div><h1>${title}</h1><p>${online} 人已进入房间</p><div class="host-controls">
    ${status !== "open" ? `<button class="start" data-action="start" ${online ? "" : "disabled"}>⚡ 开始抢答</button>` : '<button class="stop" data-action="close">结束本轮</button>'}
    ${room.buzzes.length ? '<button class="secondary" data-action="reset">清空结果</button>' : ""}</div><p class="tip">开始新一轮会自动清空上一轮结果</p>`;
}

function playerStage(status, rank) {
  const title = rank >= 0 ? (rank === 0 ? "恭喜，你抢到了！" : `你是第 ${rank + 1} 名`) : status === "open" ? "现在就抢！" : status === "closed" ? "本轮已结束" : "请做好准备";
  const subtitle = rank >= 0 ? "结果已提交，请等待主持人确认" : status === "open" ? "按钮已亮起，越快越好" : "主持人开始后按钮会自动亮起";
  return `<div class="player-name">${esc(session.name)}</div><h1>${title}</h1><p>${subtitle}</p><button id="buzzer" class="buzzer ${status === "open" ? "ready" : ""} ${rank >= 0 ? "done" : ""}" ${status !== "open" || rank >= 0 ? "disabled" : ""}>
    <span>${rank >= 0 ? `第 ${rank + 1} 名` : status === "open" ? "抢 答" : "等待中"}</span><small>${status === "open" && rank < 0 ? "点击按钮或按空格键" : ""}</small></button>`;
}

function ranking() {
  if (!room.buzzes.length) return '<div class="empty"><div>⚡</div><p>抢答开始后<br>排名将在这里出现</p></div>';
  const first = room.buzzes[0].buzzedAt;
  return room.buzzes.map((item, index) => `<div class="rank ${index === 0 ? "winner" : ""}"><b>${index + 1}</b><span>${esc(item.name)}${item.participantId === session.participantId ? "<small>（我）</small>" : ""}</span><time>${index === 0 ? "最先抢答" : `+${((item.buzzedAt - first)/1000).toFixed(3)}s`}</time></div>`).join("");
}

async function hostAction(action) { try { const result = await emit("host-action", { action, code: session.code, token: session.token }); room = result.state; error = ""; roomPage(); } catch (reason) { showError(reason.message); } }
async function buzz() { try { const result = await emit("buzz", { code: session.code, token: session.token }); room = result.state; error = ""; roomPage(); } catch (reason) { showError(reason.message); } }
function render() { session && room ? roomPage() : landing(); }

socket.on("room-state", next => { const wasOpen = room?.room.status === "open"; room = next; error = ""; if (session?.role === "player" && !wasOpen && next.room.status === "open") navigator.vibrate?.(120); render(); });
socket.on("disconnect", () => { if (session) { error = "正在重新连接…"; render(); } });
socket.on("connect", async () => {
  if (!session) return;
  try { const result = await emit("resume", session); room = result.state; error = ""; render(); }
  catch { session = null; room = null; saveSession(); landing(); }
});
window.addEventListener("keydown", event => { if (event.code === "Space" && session?.role === "player" && room?.room.status === "open" && !["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName)) { event.preventDefault(); buzz(); } });
try { session = JSON.parse(sessionStorage.getItem("buzzer-session")); } catch { session = null; }
render();
if (session && socket.connected) socket.emit("resume", session, result => { if (result?.ok) { room = result.state; error = ""; render(); } else { session = null; saveSession(); landing(); } });
