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

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

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
    room: { code: room.code, status: room.status, round: room.round, createdAt: room.createdAt },
    participants: [...room.participants.values()].map(({ id, name, joinedAt, connected }) => ({ id, name, joinedAt, connected })),
    buzzes: room.buzzes.map(({ participantId, name, buzzedAt }) => ({ participantId, name, buzzedAt })),
  };
}

function emitState(room) { io.to(channel(room.code)).emit("room-state", state(room)); }
function fail(ack, error) { ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
function hostFor(room, token) { return token && crypto.timingSafeEqual(Buffer.from(room.hostToken), Buffer.from(String(token).padEnd(room.hostToken.length).slice(0, room.hostToken.length))); }
function playerFor(room, token) { return [...room.participants.values()].find(player => player.token === token); }

io.on("connection", socket => {
  socket.on("create-room", (payload = {}, ack) => {
    try {
      const password = String(payload.password || "");
      if (password.length < 4 || password.length > 20) throw new Error("密码需为 4–20 位");
      const code = roomCode();
      const room = {
        code, passwordHash: hashPassword(password), hostToken: makeToken(), hostSocketId: socket.id,
        status: "waiting", round: 1, createdAt: Date.now(), participants: new Map(), buzzes: [], nextParticipantId: 1,
      };
      rooms.set(code, room); socket.join(channel(code)); socket.data.session = { code, role: "host", token: room.hostToken };
      ack?.({ ok: true, code, hostToken: room.hostToken, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("join-room", (payload = {}, ack) => {
    try {
      const code = String(payload.code || "").trim().toUpperCase();
      const password = String(payload.password || "");
      const name = String(payload.name || "").trim().replace(/\s+/g, " ");
      const room = rooms.get(code);
      if (!room) throw new Error("找不到这个房间");
      if (room.passwordHash !== hashPassword(password)) throw new Error("房间密码不正确");
      if (name.length < 2 || name.length > 20) throw new Error("请填写 2–20 个字符的真实姓名");
      if ([...room.participants.values()].some(player => player.name === name && player.connected)) throw new Error("该姓名已在房间中");
      const participant = { id: room.nextParticipantId++, name, token: makeToken(), joinedAt: Date.now(), connected: true, socketId: socket.id };
      room.participants.set(participant.id, participant); socket.join(channel(code));
      socket.data.session = { code, role: "player", token: participant.token, participantId: participant.id };
      ack?.({ ok: true, code, name, playerToken: participant.token, participantId: participant.id, state: state(room) });
      emitState(room);
    } catch (error) { fail(ack, error); }
  });

  socket.on("resume", (payload = {}, ack) => {
    try {
      const code = String(payload.code || "").toUpperCase(); const room = rooms.get(code);
      if (!room) throw new Error("房间已结束");
      if (payload.role === "host" && hostFor(room, payload.token)) {
        room.hostSocketId = socket.id; socket.join(channel(code)); socket.data.session = { code, role: "host", token: room.hostToken };
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
      if (payload.action === "start") { if (room.status !== "waiting") room.round += 1; room.buzzes = []; room.status = "open"; }
      else if (payload.action === "close") room.status = "closed";
      else if (payload.action === "reset") { room.round += 1; room.buzzes = []; room.status = "waiting"; }
      else throw new Error("未知操作");
      emitState(room); ack?.({ ok: true, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("buzz", (payload = {}, ack) => {
    try {
      const room = rooms.get(String(payload.code || "").toUpperCase());
      const player = room && playerFor(room, payload.token);
      if (!room || !player) throw new Error("身份已失效，请重新加入");
      if (room.status !== "open") throw new Error("当前不在抢答时间");
      if (!room.buzzes.some(item => item.participantId === player.id)) {
        room.buzzes.push({ participantId: player.id, name: player.name, buzzedAt: Date.now() });
      }
      emitState(room); ack?.({ ok: true, state: state(room) });
    } catch (error) { fail(ack, error); }
  });

  socket.on("disconnect", () => {
    const session = socket.data.session; if (!session) return;
    const room = rooms.get(session.code); if (!room) return;
    if (session.role === "player") {
      const player = room.participants.get(session.participantId);
      if (player && player.socketId === socket.id) { player.connected = false; player.socketId = null; emitState(room); }
    }
    setTimeout(() => {
      const current = rooms.get(session.code); if (!current) return;
      if (session.role === "player") {
        const player = current.participants.get(session.participantId);
        if (player && !player.connected) { current.participants.delete(player.id); emitState(current); }
      } else if (!current.hostSocketId || current.hostSocketId === socket.id) rooms.delete(session.code);
    }, 120000).unref();
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.createdAt < cutoff) rooms.delete(code);
}, 30 * 60 * 1000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`Quick Buzzer listening on ${port}`));
