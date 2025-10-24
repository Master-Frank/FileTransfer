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

const getDefaultDeviceName = () => {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS 设备";
    if (/Android/i.test(ua)) return "Android 设备";
    if (/Mac OS X/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Linux/i.test(ua)) return "Linux 设备";
  } catch (_) {}
  return "未知设备";
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

  constructor(private store: StoreService) {
    this.bus = new EventBus<ChatEventMap>();
    this.stateAtom = atom<ConnectionState>(CONNECTION_STATE.CONNECTING);
    this.readyPromise = createConnectReadyPromise();
    this.selfId = "";
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
      Object.keys(state).forEach(id => {
        const arr = state[id];
        arr.forEach((user: any) => {
          const member = user?.metas?.[0] || {};
          const device = member?.device || DEVICE_TYPE.PC;
          const ip = member?.ip || "WAN";
          const hash = member?.hash || "WAN";
          const name = member?.name;
          users.push({ id, device, ip, hash, name });
        });
      });
      // De-duplicate by id
      const map: Record<string, (typeof users)[number]> = {};
      users.forEach(u => (map[u.id] = u));
      let next = Object.values(map);
      // Filter out current device
      next = next.filter(u => u.id !== this.selfId);
      // Update store
      // @ts-expect-error jotai atoms set
      const { userListAtom } = this.store;
      const { atoms } = require("../store/atoms");
      atoms.set(userListAtom, next);
    });

    // Subscribe
    this.channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        const { atoms } = require("../store/atoms");
        atoms.set(this.stateAtom, CONNECTION_STATE.CONNECTED);
        // Track presence
        const deviceName =
          atoms.get(this.store.deviceNameAtom) ||
          (typeof window !== "undefined" && localStorage.getItem("webrtc-im-device-name")) ||
          getDefaultDeviceName();
        const isProbablyMobile = isMobileLike();
        const presencePayload = {
          id: this.selfId,
          device: isProbablyMobile ? DEVICE_TYPE.MOBILE : DEVICE_TYPE.PC,
          ip: "WAN",
          hash: "WAN",
          name: deviceName,
        };
        this.channel.track(presencePayload);
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
          ip: "WAN",
          hash: "WAN",
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