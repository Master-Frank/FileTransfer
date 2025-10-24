import { atom } from "jotai";
import type { PrimitiveAtom } from "jotai";
import { EventBus } from "../utils/event-bus";
import type { ConnectionState } from "../../types/client";
import { CONNECTION_STATE, DEVICE_TYPE } from "../../types/client";
import type { PromiseWithResolve } from "../utils/connection";
import { createConnectReadyPromise, getSessionId } from "../utils/connection";
import type { StoreService } from "./store";
import { getId } from "@block-kit/utils";
import { SERVER_EVENT } from "../../types/signaling";
import type { ICE, SDP, ServerEvent } from "../../types/signaling";
import { isMobileLike, getDefaultDeviceName } from "../utils/device";

// Use dynamic import to avoid hard dependency when building without installation
let createClientFn: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const supabase = require("@supabase/supabase-js");
  // Support both CJS and ESM default interop
  createClientFn = supabase?.createClient || supabase?.default?.createClient || null;
} catch (_) {
  createClientFn = null;
}

export type ChatTextPayload = { from: string; to: string; data: string };
export type ChatEventMap = {
  TEXT: ChatTextPayload;
  [SERVER_EVENT.SEND_OFFER]: ServerEvent[typeof SERVER_EVENT.SEND_OFFER];
  [SERVER_EVENT.SEND_ANSWER]: ServerEvent[typeof SERVER_EVENT.SEND_ANSWER];
  [SERVER_EVENT.SEND_ICE]: ServerEvent[typeof SERVER_EVENT.SEND_ICE];
};


// 公网 IP 缓存配置
const PUBLIC_IP_CACHE_KEY = "webrtc-im-public-ip-cache";
const PUBLIC_IP_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

const withTimeout = async <T>(p: Promise<T>, ms = 1500): Promise<T> => {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)) as Promise<T>,
  ]);
};

const fetchIpEndpoints = async (): Promise<string> => {
  // 顺序尝试多个端点，任一成功即返回
  try {
    // ipify
    const r1 = await withTimeout(fetch("https://api.ipify.org?format=json"));
    const j1 = await r1.json().catch(() => null);
    if (j1 && typeof j1.ip === "string" && j1.ip) return j1.ip;
  } catch (_) {}
  try {
    // ipinfo
    const r2 = await withTimeout(fetch("https://ipinfo.io/json"));
    const j2 = await r2.json().catch(() => null);
    if (j2 && typeof j2.ip === "string" && j2.ip) return j2.ip;
  } catch (_) {}
  try {
    // icanhazip
    const r3 = await withTimeout(fetch("https://ipv4.icanhazip.com"));
    const t3 = (await r3.text()).trim();
    if (t3) return t3;
  } catch (_) {}
  try {
    // ifconfig.me
    const r4 = await withTimeout(fetch("https://ifconfig.me/ip"));
    const t4 = (await r4.text()).trim();
    if (t4) return t4;
  } catch (_) {}
  try {
    // Cloudflare trace
    const r5 = await withTimeout(fetch("https://www.cloudflare.com/cdn-cgi/trace"));
    const t5 = await r5.text();
    const line = t5.split("\n").find(l => l.startsWith("ip="));
    const ip = line ? line.split("=")[1].trim() : "";
    if (ip) return ip;
  } catch (_) {}
  return "WAN";
};

const resolvePublicIpWithCache = async (): Promise<string> => {
  try {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(PUBLIC_IP_CACHE_KEY);
      if (raw) {
        const { ip, ts } = JSON.parse(raw);
        if (typeof ip === "string" && ip && typeof ts === "number" && Date.now() - ts < PUBLIC_IP_CACHE_TTL_MS) {
          return ip;
        }
      }
    }
  } catch (_) {}
  const ip = await fetchIpEndpoints();
  try {
    if (typeof window !== "undefined" && ip && ip !== "WAN") {
      localStorage.setItem(PUBLIC_IP_CACHE_KEY, JSON.stringify({ ip, ts: Date.now() }));
    }
  } catch (_) {}
  return ip;
};

export class SupabaseChatService {
  /** 连接状态 */
  public readonly stateAtom: PrimitiveAtom<ConnectionState>;
  /** 事件总线 */
  public readonly bus: EventBus<ChatEventMap>;
  /** Supabase client */
  private client: any;
  /** Channel instance */
  private channel: any;
  /** Ready promise */
  private readyPromise: PromiseWithResolve<void> | null;
  /** Self ID */
  public selfId: string;
  /** Self public IP for LAN grouping */
  public selfIp: string;

  constructor(private store: StoreService) {
    this.bus = new EventBus<ChatEventMap>();
    this.stateAtom = atom<ConnectionState>(CONNECTION_STATE.CONNECTING);
    this.readyPromise = createConnectReadyPromise();
    this.selfId = "";
    this.selfIp = "";
    this.init();
  }

  private async init() {
    if (!createClientFn) return void 0;
    // 使用 sessionId 或随机 id 作为 presence key
    this.selfId = getSessionId() || getId(12);

    const url = process.env.SUPABASE_URL as string;
    const key = process.env.SUPABASE_ANON as string;
    const channelName = (process.env.SUPABASE_CHANNEL as string) || "webrtc-im";
    if (!url || !key) return void 0;
    this.client = createClientFn(url, key);
    this.channel = this.client.channel(channelName, { config: { presence: { key: this.selfId } } });

    // Broadcast handler: receive TEXT messages
    this.channel.on("broadcast", { event: "TEXT" }, (payload: { payload: ChatTextPayload }) => {
      const data = payload?.payload;
      if (!data) return;
      const toSelf = data.to === this.selfId;
      const peerId = this.getPeerId();
      const fromPeer = data.from === peerId;
      if (toSelf && fromPeer) {
        this.bus.emit("TEXT", data);
      }
    });

    // Broadcast handlers: WebRTC signaling via Supabase
    this.channel.on("broadcast", { event: SERVER_EVENT.SEND_OFFER }, (payload: { payload: ServerEvent["SEND_OFFER"] }) => {
      const data = payload?.payload;
      if (!data) return;
      if (data.to === this.selfId) {
        this.bus.emit(SERVER_EVENT.SEND_OFFER, data);
      }
    });
    this.channel.on("broadcast", { event: SERVER_EVENT.SEND_ANSWER }, (payload: { payload: ServerEvent["SEND_ANSWER"] }) => {
      const data = payload?.payload;
      if (!data) return;
      if (data.to === this.selfId) {
        this.bus.emit(SERVER_EVENT.SEND_ANSWER, data);
      }
    });
    this.channel.on("broadcast", { event: SERVER_EVENT.SEND_ICE }, (payload: { payload: ServerEvent["SEND_ICE"] }) => {
      const data = payload?.payload;
      if (!data) return;
      if (data.to === this.selfId) {
        this.bus.emit(SERVER_EVENT.SEND_ICE, data);
      }
    });

    // Presence sync to users list
    this.channel.on("presence", { event: "sync" }, () => {
      const users: Array<{ id: string; device: string; ip: string; hash: string; name?: string }> = [];
      const state = this.channel.presenceState();
      
      // 调试：输出原始presence状态
      console.log("[Presence Debug] Raw presence state:", state);
      
      Object.keys(state).forEach(id => {
        const arr = state[id];
        arr.forEach((user: any) => {
          const member = user?.metas?.[0] || {};
          
          // 修复：如果member为空，直接从user对象提取数据
          const device = member?.device || user?.device || DEVICE_TYPE.PC;
          const ip = member?.ip || user?.ip || "WAN";
          const hash = member?.hash || user?.hash || "WAN";
          const name = member?.name || user?.name;
          
          // 调试：输出每个用户的原始数据
          console.log(`[Presence Debug] User ${id}:`, { 
            fullUser: user, 
            member, 
            extractedFields: { device, ip, hash, name }
          });
          
          users.push({ id, device, ip, hash, name });
        });
      });
      // De-duplicate by id
      const map: Record<string, (typeof users)[number]> = {};
      users.forEach(u => (map[u.id] = u));
      const next = Object.values(map).filter(u => u.id !== this.selfId);
      
      // 调试：输出最终用户列表
      console.log("[Presence Debug] Final user list:", next);
      
      // Update store
      // @ts-expect-error jotai atoms set
      const { userListAtom } = this.store;
      const { atoms } = require("../store/atoms");
      atoms.set(userListAtom, next);
    });

    // Subscribe
    this.channel.subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") {
        const { atoms } = require("../store/atoms");
        atoms.set(this.stateAtom, CONNECTION_STATE.CONNECTED);
        // Track presence
        const deviceName =
          atoms.get(this.store.deviceNameAtom) ||
          (typeof window !== "undefined" && localStorage.getItem("webrtc-im-device-name")) ||
          getDefaultDeviceName();
        const isProbablyMobile = isMobileLike();
        // 增强公网 IP 获取：多端点 + 超时 + 缓存
        const ip = await resolvePublicIpWithCache();
        this.selfIp = ip || "WAN";
        
        // 调试：输出IP获取结果
        console.log("[IP Debug] Resolved IP:", ip, "selfIp:", this.selfIp);
        
        const presencePayload = {
          id: this.selfId,
          device: isProbablyMobile ? DEVICE_TYPE.MOBILE : DEVICE_TYPE.PC,
          ip: this.selfIp || "WAN",
          hash: this.selfIp || "WAN",
          name: deviceName,
        };
        
        // 调试：输出发送的presence payload
        console.log("[Presence Debug] Sending presence payload:", presencePayload);
        
        await this.channel.track(presencePayload);
        this.readyPromise && this.readyPromise.resolve();
        this.readyPromise = null;
      }
    });
  }

  /** 更新设备名称并同步到对端 */
  public async updateDeviceName(name: string) {
    try {
      const { atoms } = require("../store/atoms");
      atoms.set(this.store.deviceNameAtom, name);
      if (typeof window !== "undefined") {
        localStorage.setItem("webrtc-im-device-name", name);
      }
      if (this.channel) {
        const isProbablyMobile = isMobileLike();
        const payload = {
          id: this.selfId,
          device: isProbablyMobile ? DEVICE_TYPE.MOBILE : DEVICE_TYPE.PC,
          ip: this.selfIp || "WAN",
          hash: this.selfIp || "WAN",
          name,
        };
        await this.channel.track(payload);
      }
    } catch (_) {}
  }

  /** 当前选中 peerId */
  private getPeerId() {
    // Lazy import atoms to avoid circular
    const { atoms } = require("../store/atoms");
    // @ts-expect-error jotai atoms get
    return atoms.get(this.store.peerIdAtom) as string;
  }

  /** 发送文本消息 */
  public async sendText(to: string, data: string) {
    if (!this.channel) return;
    const payload: ChatTextPayload = { from: this.selfId, to, data };
    await this.channel.send({ type: "broadcast", event: "TEXT", payload });
  }

  /** 发送 WebRTC Offer */
  public async sendOffer(to: string, sdp: SDP, ice?: string) {
    if (!this.channel) return;
    const payload: ServerEvent["SEND_OFFER"] = { from: this.selfId, to, sdp } as any;
    // 附带 ice 服务（若存在）
    if (ice) (payload as any).ice = ice;
    await this.channel.send({ type: "broadcast", event: SERVER_EVENT.SEND_OFFER, payload });
  }

  /** 发送 WebRTC Answer */
  public async sendAnswer(to: string, sdp: SDP) {
    if (!this.channel) return;
    const payload: ServerEvent["SEND_ANSWER"] = { from: this.selfId, to, sdp };
    await this.channel.send({ type: "broadcast", event: SERVER_EVENT.SEND_ANSWER, payload });
  }

  /** 发送 WebRTC ICE */
  public async sendIce(to: string, ice: ICE) {
    if (!this.channel) return;
    const payload: ServerEvent["SEND_ICE"] = { from: this.selfId, to, ice };
    await this.channel.send({ type: "broadcast", event: SERVER_EVENT.SEND_ICE, payload });
  }

  /** 等待订阅完成 */
  public isConnected() {
    if (!this.readyPromise) return Promise.resolve();
    return this.readyPromise;
  }

  public destroy() {
    try {
      this.channel && this.channel.unsubscribe();
    } catch (_) {}
    this.bus.clear();
    this.readyPromise = null;
  }
}