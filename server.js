import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: false }, pingTimeout: 12000, pingInterval: 10000 });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEAM_NAMES = new Set([
  "南万党支部先锋一队", "南万党支部先锋二队", "南万党支部先锋三队", "南万党支部先锋四队", "南万党支部先锋五队",
  "南万党支部先锋六队", "南万党支部先锋七队", "柳万党支部队", "桂万党支部队",
]);

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache, must-revalidate");
  },
}));

function roomCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
    if (!rooms.has(code)) return code;
  }
  throw new Error("暂时无法创建房间，请重试");
}

const makeToken = () => crypto.randomBytes(24).toString("hex");
const hashPassword = password => crypto.createHash("sha256").update(password).digest("hex");
const channel = code => `room:${code}`;

function state(room) {
  return {
    room: { code: room.code, status: room.status, round: room.round, createdAt: room.createdAt, hostName: room.hostName, hostConnected: room.hostConnected, countdownEndsAt: room.countdownEndsAt || null, countdownSeconds: room.countdownSeconds || null, serverNow: Date.now() },
    participants: [...room.participants.values()].map(({ id, teamName, joinedAt, connected, approvalStatus }) => ({ id, teamName, joinedAt, connected, approvalStatus })),
    buzzes: room.buzzes.map(({ participantId, teamName, buzzedAt }) => ({ participantId, teamName, buzzedAt })),
    history: room.history.map(item => ({ round: item.round, endedAt: item.endedAt, buzzes: item.buzzes.map(buzz => ({ ...buzz })) })),
  };
}

function emitState(room) { room.lastActive = Date.now(); io.to(channel(room.code)).emit("room-state", state(room)); }
function fail(ack, error) { ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
function hostFor(room, token) {
  if (!token) return false;
  const supplied = Buffer.from(String(token).padEnd(room.hostToken.length).slice(0, room.hostToken.length));
  return crypto.timingSafeEqual(Buffer.from(room.hostToken), supplied);
}
function playerFor(room, token) { return [...room.participants.values()].find(player => player.token === token); }
function archiveRound(room) {
  if (room.history.some(item => item.round === room.round)) return;
  room.history.push({ round: room.round, endedAt: Date.now(), buzzes: room.buzzes.map(item => ({ ...item })) });
}
function cancelCountdown(room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null; room.countdownEndsAt = null; room.countdownSeconds = null;
}
function beginCountdown(room, seconds) {
  cancelCountdown(room);
  room.status = "countdown"; room.countdownSeconds = seconds; room.countdownEndsAt = Date.now() + seconds * 1000;
  const expectedEnd = room.countdownEndsAt;
  room.countdownTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.status !== "countdown" || room.countdownEndsAt !== expectedEnd) return;
    room.status = "open"; room.countdownTimer = null; room.countdownEndsAt = null;
    emitState(room);
  }, seconds * 1000);
  room.countdownTimer.unref();
}

io.on("connection", socket => {
  socket.on("create-room", (payload = {}, ack) => {
    try {
      const password = String(payload.password || "");
      const hostName = String(payload.hostName || "").trim().slice(0, 30);
      if (password.length < 4 || password.length > 20) throw new Error("主持密码需为 4–20 位");
      const code = roomCode();
      const room = {
        code, passwordHash: hashPassword(password), hostToken: makeToken(), hostSocketId: socket.id, hostConnected: true, hostName,
        status: "waiting", round: 1, createdAt: Date.now(), lastActive: Date.now(), participants: new Map(), buzzes: [], history: [], nextParticipantId: 1,
        countdownTimer: null, countdownEndsAt: null, countdownSeconds: null,
      };
      rooms.set(code, room); socket.join(channel(code)); socket.data.session = { code, role: "host", token: room.hostToken };
      ack?.({ ok: true, code, hostToken: room.hostToken, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("join-room", (payload = {}, ack) => {
    try {
      const code = String(payload.code || "").trim().toUpperCase();
      const teamName = String(payload.teamName || "").trim();
      const room = rooms.get(code);
      if (!room) throw new Error("找不到这个房间");
      if (!TEAM_NAMES.has(teamName)) throw new Error("请选择有效的队名");
      if ([...room.participants.values()].some(player => player.teamName === teamName)) throw new Error("该队伍已经申请加入房间");
      const participant = {
        id: room.nextParticipantId++, teamName, token: makeToken(), joinedAt: Date.now(), connected: true,
        socketId: socket.id, approvalStatus: "pending",
      };
      room.participants.set(participant.id, participant); socket.join(channel(code));
      socket.data.session = { code, role: "player", token: participant.token, participantId: participant.id };
      ack?.({ ok: true, code, teamName, playerToken: participant.token, participantId: participant.id, state: state(room) });
      emitState(room);
    } catch (error) { fail(ack, error); }
  });

  socket.on("recover-host", (payload = {}, ack) => {
    try {
      const code = String(payload.code || "").trim().toUpperCase();
      const password = String(payload.password || "");
      const room = rooms.get(code);
      if (!room) throw new Error("找不到这个房间");
      if (room.passwordHash !== hashPassword(password)) throw new Error("主持密码不正确");
      room.hostToken = makeToken(); room.hostSocketId = socket.id; room.hostConnected = true;
      socket.join(channel(code)); socket.data.session = { code, role: "host", token: room.hostToken };
      ack?.({ ok: true, code, hostToken: room.hostToken, hostName: room.hostName, state: state(room) });
      emitState(room);
    } catch (error) { fail(ack, error); }
  });

  socket.on("resume", (payload = {}, ack) => {
    try {
      const code = String(payload.code || "").toUpperCase(); const room = rooms.get(code);
      if (!room) throw new Error("房间已结束");
      if (payload.role === "host" && hostFor(room, payload.token)) {
        room.hostSocketId = socket.id; room.hostConnected = true; socket.join(channel(code)); socket.data.session = { code, role: "host", token: room.hostToken };
        return ack?.({ ok: true, state: state(room) });
      }
      const player = playerFor(room, payload.token);
      if (!player) throw new Error("身份已失效，请重新加入");
      player.connected = true; player.socketId = socket.id; socket.join(channel(code));
      socket.data.session = { code, role: "player", token: player.token, participantId: player.id };
      ack?.({ ok: true, state: state(room) }); emitState(room);
    } catch (error) { fail(ack, error); }
  });

  socket.on("host-action", (payload = {}, ack) => {
    try {
      const room = rooms.get(String(payload.code || "").toUpperCase());
      if (!room || !hostFor(room, payload.token)) throw new Error("仅主持人可以执行此操作");
      if (payload.action === "approve" || payload.action === "kick") {
        const participant = room.participants.get(Number(payload.participantId));
        if (!participant) throw new Error("该队伍已离开房间");
        if (payload.action === "approve") participant.approvalStatus = "approved";
        else {
          room.participants.delete(participant.id);
          room.buzzes = room.buzzes.filter(item => item.participantId !== participant.id);
          if (participant.socketId) {
            io.to(participant.socketId).emit("kicked", { message: "主持人已将你的队伍移出房间" });
            io.sockets.sockets.get(participant.socketId)?.leave(channel(room.code));
          }
        }
      } else if (payload.action === "start") {
        const approvedOnline = [...room.participants.values()].some(player => player.approvalStatus === "approved" && player.connected);
        if (!approvedOnline) throw new Error("请先批准至少一支在线队伍");
        const countdownSeconds = Math.max(1, Math.min(60, Number.parseInt(payload.countdownSeconds, 10) || 3));
        if (room.status === "open") archiveRound(room);
        if (room.status !== "waiting") room.round += 1;
        room.buzzes = []; beginCountdown(room, countdownSeconds);
      } else if (payload.action === "close") {
        if (room.status === "open") archiveRound(room);
        cancelCountdown(room); room.status = "closed";
      } else if (payload.action === "reset") {
        if (room.status === "open") archiveRound(room);
        cancelCountdown(room); room.round += 1; room.buzzes = []; room.status = "waiting";
      }
      else throw new Error("未知操作");
      emitState(room); ack?.({ ok: true, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("buzz", (payload = {}, ack) => {
    try {
      const room = rooms.get(String(payload.code || "").toUpperCase());
      const player = room && playerFor(room, payload.token);
      if (!room || !player) throw new Error("身份已失效，请重新加入");
      if (player.approvalStatus !== "approved") throw new Error("请等待主持人批准加入");
      if (room.status !== "open") throw new Error("当前不在抢答时间");
      if (!room.buzzes.some(item => item.participantId === player.id)) {
        room.buzzes.push({ participantId: player.id, teamName: player.teamName, buzzedAt: Date.now() });
      }
      emitState(room); ack?.({ ok: true, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("keepalive", (payload = {}, ack) => {
    const room = rooms.get(String(payload.code || "").toUpperCase());
    if (room) room.lastActive = Date.now();
    ack?.({ ok: true, at: Date.now() });
  });

  socket.on("disconnect", () => {
    const session = socket.data.session; if (!session) return;
    const room = rooms.get(session.code); if (!room) return;
    if (session.role === "player") {
      const player = room.participants.get(session.participantId);
      if (player && player.socketId === socket.id) { player.connected = false; player.socketId = null; emitState(room); }
    } else if (room.hostSocketId === socket.id) {
      room.hostConnected = false; room.hostSocketId = null; emitState(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if ((room.lastActive || room.createdAt) < cutoff) { cancelCountdown(room); rooms.delete(code); }
}, 30 * 60 * 1000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`Quick Buzzer listening on ${port}`));
