# 极速抢答（Quick Buzzer）

适配手机和电脑的多人实时抢答器，使用 Node.js、Express 和 Socket.IO，可直接部署到 Render。

## 功能

- 主持人创建带密码的 6 位房间
- 参与者以真实姓名加入
- WebSocket 实时同步开始、结束和抢答结果
- 服务器统一记录抢答顺序与毫秒级时间差
- 手机震动提示、电脑空格键抢答
- 断线后 2 分钟内自动恢复身份
- 响应式手机与电脑界面

## Render 部署

1. 在 Render 选择 **New > Web Service**。
2. 连接仓库 `wjcom9/quick-buzzer`。
3. Render 会自动读取根目录的 `render.yaml`；也可以手动填写：
   - Build Command：`npm install`
   - Start Command：`npm start`
4. 选择 Free 套餐并部署。

本项目的房间数据保存在服务内存中，适合临时活动。Render 服务重启后房间会被清空；免费实例休眠后首次访问可能需要等待一段时间，因此建议活动开始前先打开网页。

## 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`。
