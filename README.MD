# FileTransfer

<p>
<a href="https://github.com">GitHub</a>
<span>｜</span>
<a href="">DEMO</a
<span>｜</span>
<a href="https://github.com">BLOG</a>
<span>｜</span>
<a href="https://github.com">FAQ</a>
</p>

基于`WebRTC/WebSocket`的文件传输：

1. 局域网内可以互相发现，不需要手动输入对方`IP`地址等信息。
2. 多个设备中的任意两个设备之间可以相互传输文本消息与文件数据。
3. 设备间的数据传输采用基于`WebRTC`的`P2P`方案，无需服务器中转数据。
4. 跨局域网传输且`NAT`穿越受限的情况下，基于`WebSocket`服务器中转传输。
5. 基于`ServiceWorker`实现文件数据劫持流式传输方案，可支持大型文件下载。

https://github.com/WindrunnerMax/FileTransfer/assets/33169019/b1d8d455-84e9-47c1-aa22-2fc77ffa10d1


## Development

```bash
$ pnpm install --frozen-lockfile
$ npm run dev:webrtc
$ npm run dev:webrtc-im
$ npm run dev:websocket
```
## Deployment

```bash 
$ pnpm install --frozen-lockfile
$ npm run deploy:webrtc
$ npm run deploy:webrtc-im
$ npm run deploy:websocket
```

### Zeabur

1. **推送代码到 GitHub**
   ```bash
   git add .
   git commit -m "Add Zeabur deployment configuration"
   git push origin main
   ```

2. **在 Zeabur 控制台部署**
   - 访问 [Zeabur](https://zeabur.com)
   - 连接你的 GitHub 仓库
   - 选择 `FileTransfer` 项目
   - Zeabur 会自动检测 `Dockerfile` 并进行容器化部署

3. **配置环境变量**
   在 Zeabur 控制台中设置以下环境变量：
   - `SUPABASE_URL`: 你的 Supabase 项目 URL
   - `SUPABASE_ANON`: Supabase 匿名密钥
   - `SUPABASE_CHANNEL`: WebRTC 信令频道名称
   - `TURN_ICE`: TURN 服务器配置（JSON 字符串）

4. **自定义域名**（可选）
   - 在 Zeabur 控制台中绑定自定义域名
   - 配置 HTTPS 证书（Zeabur 自动提供）

# TURN Server Setup (Coturn)

To enable reliable WebRTC connections across NATs/firewalls, deploy a TURN server.

## Quick Deploy with Docker

1. On a public VM (Ubuntu/Debian), install Docker and Docker Compose.
2. Copy `infra/turn` to the server and set `external-ip` in `turnserver.conf` to your public IP.
3. Choose auth mode:
   - Secret-based (TURN REST): keep `use-auth-secret` and set `static-auth-secret`.
   - Static credentials: comment out `use-auth-secret` lines and use `lt-cred-mech` + `user=ftuser:ftpass`.
4. Open firewall ports: `3478` TCP/UDP and optional `5349` TCP/UDP. If you set relay port range (`min-port`/`max-port`), open that range too.
5. Run: `docker compose up -d` inside `infra/turn`.

## Verify TURN
Use https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ with:
- STUN/TURN URL: `turn:<your-public-ip>:3478` (or `turns:` on 5349)
- Username/Password (if static creds), or generate short-term credentials for REST.

## Configure App
Set `TURN_ICE` in Vercel Environment Variables to a JSON string, for example:
```
[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"turn:<your-public-ip>:3478","username":"ftuser","credential":"ftpass"}
]
```
For TURN REST mode, build ephemeral creds on the server and inject at runtime.
