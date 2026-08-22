# 极速抢答（Quick Buzzer）

适配手机和电脑的多人实时抢答器，使用 Node.js、Express 和 Socket.IO，可直接部署到 Render。

## 功能

- 主持人创建带密码的 6 位房间
- 参与者从预设的 9 支队伍中单选队名
- 加入后进入待机区，由主持人批准后进入正式房间
- 主持人可批准待审核队伍，也可移除待审核或正式队伍
- 自动保存每一轮抢答排名，并在前端按轮次查看
- 浏览器每 5 分钟发送 WebSocket 保活消息，降低免费实例空闲休眠风险
- WebSocket 实时同步开始、结束和抢答结果
- 服务器统一记录抢答顺序与毫秒级时间差
- 手机震动提示、电脑空格键抢答
- 断线后 2 分钟内自动恢复身份

## 技术栈

- **后端**：Node.js（>= 20）+ Express + Socket.IO
- **前端**：原生 HTML / CSS / JavaScript，无需构建步骤
- **部署**：Render（见 `render.yaml`）

## 本地运行

```bash
# 安装依赖
npm install

# 启动服务，默认端口 3000
npm start

# 运行测试
npm test
```

启动后浏览器访问 `http://localhost:3000` 即可使用，也可通过 `PORT` 环境变量指定端口。

## Render 部署

Render 连接 `wjcom9/quick-buzzer`，Build Command 使用 `npm install`，Start Command 使用 `npm start`。推送到 `main` 后会自动部署。

> 房间数据保存在服务内存中，适合临时活动。Render 服务重启后房间会被清空；建议活动开始前提前打开网页。
