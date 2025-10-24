import type { PrimitiveAtom } from "jotai";
import { atom } from "jotai";
import type { ConnectionState } from "../../types/client";
import { CONNECTION_STATE } from "../../types/client";
import type { PromiseWithResolve } from "../utils/connection";
import { createConnectReadyPromise } from "../utils/connection";
import type { ServerEvent } from "../../types/signaling";
import { SERVER_EVENT } from "../../types/signaling";
import { Bind } from "@block-kit/utils";
import { atoms } from "../store/atoms";
import { EventBus } from "../utils/event-bus";
import type { WebRTCEvent } from "../../types/webrtc";
import { WEBRTC_EVENT } from "../../types/webrtc";
import type { SupabaseChatService } from "./chat";
import type { WebSocketSignalingService } from "./websocket-signaling";

export class WebRTCService {
  /** 连接状态 */
  public readonly stateAtom: PrimitiveAtom<ConnectionState>;
  /** 链接状态 Promise */
  private connectedPromise: PromiseWithResolve<void> | null;
  /** 数据传输信道 */
  public channel: RTCDataChannel;
  /** RTC 连接实例 */
  public connection: RTCPeerConnection;
  /** 事件总线 */
  public bus: EventBus<WebRTCEvent>;
  /** WebSocket信令服务 */
  private websocketSignaling?: WebSocketSignalingService;

  constructor(private chat: SupabaseChatService) {
    const rtc = this.createRTCPeerConnection();
    this.channel = rtc.channel;
    this.connection = rtc.connection;
    this.bus = new EventBus<WebRTCEvent>();
    this.connectedPromise = createConnectReadyPromise();
    this.stateAtom = atom<ConnectionState>(CONNECTION_STATE.READY);
    this.chat.bus.on(SERVER_EVENT.SEND_OFFER, this.onReceiveOffer);
    this.chat.bus.on(SERVER_EVENT.SEND_ICE, this.onReceiveIce);
    this.chat.bus.on(SERVER_EVENT.SEND_ANSWER, this.onReceiveAnswer);
  }

  /**
   * 设置WebSocket信令服务（用于非局域网连接）
   */
  public setWebSocketSignaling(signaling: WebSocketSignalingService) {
    this.websocketSignaling = signaling;
    // 监听WebSocket信令事件
    this.websocketSignaling.bus.on("RECEIVE_OFFER", this.onWebSocketReceiveOffer);
    this.websocketSignaling.bus.on("RECEIVE_ANSWER", this.onWebSocketReceiveAnswer);
    this.websocketSignaling.bus.on("RECEIVE_ICE", this.onWebSocketReceiveIce);
  }

  public destroy() {
    try {
      this.connection?.close?.();
    } catch (_) {}
    atoms.set(this.stateAtom, CONNECTION_STATE.READY);
    this.chat.bus.off(SERVER_EVENT.SEND_OFFER, this.onReceiveOffer);
    this.chat.bus.off(SERVER_EVENT.SEND_ICE, this.onReceiveIce);
    this.chat.bus.off(SERVER_EVENT.SEND_ANSWER, this.onReceiveAnswer);
    
    // 清理WebSocket信令监听器
    if (this.websocketSignaling) {
      this.websocketSignaling.bus.off("RECEIVE_OFFER", this.onWebSocketReceiveOffer);
      this.websocketSignaling.bus.off("RECEIVE_ANSWER", this.onWebSocketReceiveAnswer);
      this.websocketSignaling.bus.off("RECEIVE_ICE", this.onWebSocketReceiveIce);
    }
  }

  /** 连接 Peer */
  public async connect(peerUserId: string) {
    const iceEnv = ((globalThis as any)?.process?.env?.TURN_ICE ?? (import.meta as any)?.env?.TURN_ICE ?? "") as string;
    const iceServers = this.parseIceServers(iceEnv);
    this.ensurePeerConnection(iceServers || undefined);
    const connection = this.connection;
    const offer = await connection.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await connection.setLocalDescription(offer);
    
    // 根据是否有WebSocket信令服务决定使用哪种信令方式
    if (this.websocketSignaling) {
      // 使用WebSocket信令（非局域网）
      await this.websocketSignaling.sendOffer(peerUserId, offer);
      connection.onicecandidate = e => {
        const candidate = e.candidate;
        if (candidate && this.websocketSignaling) {
          this.websocketSignaling.sendIceCandidate(peerUserId, candidate);
        }
      };
    } else {
      // 使用Supabase信令（局域网）
      await this.chat.sendOffer(peerUserId, offer, iceEnv);
      connection.onicecandidate = e => {
        const candidate = e.candidate;
        if (candidate) {
          this.chat.sendIce(peerUserId, candidate);
        }
      };
    }
  }

  @Bind
  public async disconnect() {
    try {
      this.connection?.close?.();
      this.channel && (this.channel.onmessage = null);
    } catch (_) {}
    atoms.set(this.stateAtom, CONNECTION_STATE.READY);
    this.connectedPromise = createConnectReadyPromise();
    this.bus.emit(WEBRTC_EVENT.CLOSE, new Event("close"));
  }

  /** 等待数据通道打开 */
  public isConnected() {
    // 如果数据通道已打开，直接返回已完成的 Promise，避免挂起
    if (this.channel && this.channel.readyState === "open") {
      return Promise.resolve();
    }
    // 否则返回当前的连接准备 Promise（可能在连接中或断开后重置）
    return this.connectedPromise || createConnectReadyPromise();
  }

  private createRTCPeerConnection(ice?: RTCIceServer[]) {
    const defaultIces: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const iceServers = typeof ice === "undefined" ? defaultIces : ice;
    const connection = new RTCPeerConnection({
      iceServers,
    });
    if (!this.connectedPromise) {
      this.connectedPromise = createConnectReadyPromise();
    }
    const channel = connection.createDataChannel("file-transfer", {
      ordered: true,
      maxRetransmits: 50,
    });
    channel.onopen = this.onDataChannelOpen;
    channel.onclose = this.onDataChannelClose;
    channel.onmessage = e => this.bus.emit(WEBRTC_EVENT.MESSAGE, e);
    channel.onerror = e => this.bus.emit(WEBRTC_EVENT.ERROR, e as RTCErrorEvent);
    connection.ondatachannel = event => {
      const incoming = event.channel;
      this.channel = incoming;
      incoming.onopen = this.onDataChannelOpen;
      incoming.onclose = this.onDataChannelClose;
      incoming.onmessage = e => this.bus.emit(WEBRTC_EVENT.MESSAGE, e);
      incoming.onerror = e => this.bus.emit(WEBRTC_EVENT.ERROR, e as RTCErrorEvent);
    };
    connection.onconnectionstatechange = () => {
      if (channel.readyState === "closed") return void 0;
      this.onConnectionStateChange(connection);
    };
    return { connection, channel };
  }

  // 新增：确保在使用前拥有一个可用的 RTCPeerConnection
  private ensurePeerConnection(ice?: RTCIceServer[]) {
    const conn = this.connection;
    if (!conn || conn.signalingState === "closed" || conn.connectionState === "closed") {
      const rtc = this.createRTCPeerConnection(ice);
      this.connection = rtc.connection;
      this.channel = rtc.channel;
    }
  }

  @Bind
  private onDataChannelOpen(e: Event) {
    this.connectedPromise && this.connectedPromise.resolve();
    this.connectedPromise = null;
    this.bus.emit(WEBRTC_EVENT.OPEN, e);
  }

  @Bind
  private onDataChannelClose(e: Event) {
    atoms.set(this.stateAtom, CONNECTION_STATE.READY);
    this.bus.emit(WEBRTC_EVENT.CLOSE, e);
  }

  @Bind
  private onConnectionStateChange(connection: RTCPeerConnection) {
    if (connection.connectionState === "connected") {
      atoms.set(this.stateAtom, CONNECTION_STATE.CONNECTED);
    }
    if (this.connection.connectionState === "connecting") {
      atoms.set(this.stateAtom, CONNECTION_STATE.CONNECTING);
    }
    if (
      connection.connectionState === "disconnected" ||
      connection.connectionState === "failed" ||
      connection.connectionState === "new" ||
      connection.connectionState === "closed"
    ) {
      atoms.set(this.stateAtom, CONNECTION_STATE.READY);
    }
  }

  @Bind
  private async onReceiveOffer(params: ServerEvent["SEND_OFFER"]) {
    const { sdp, from, ice } = params as any;
    console.log("Receive Offer From:", from, sdp);
    const iceServers = this.parseIceServers(ice);
    this.ensurePeerConnection(iceServers || undefined);
    await this.connection.setRemoteDescription(sdp);
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    await this.chat.sendAnswer(from, answer);
  }

  @Bind
  private async onReceiveIce(params: ServerEvent["SEND_ICE"]) {
    const { ice: sdp, from } = params as any;
    console.log("Receive ICE From:", from, sdp);
    await this.connection.addIceCandidate(sdp);
  }

  @Bind
  private async onReceiveAnswer(params: ServerEvent["SEND_ANSWER"]) {
    const { sdp, from } = params;
    console.log("Receive Answer From:", from, sdp);
    if (!this.connection.currentRemoteDescription) {
      this.connection.setRemoteDescription(sdp);
    }
  }

  // WebSocket信令处理方法
  @Bind
  private async onWebSocketReceiveOffer(params: { from: string; offer: RTCSessionDescriptionInit }) {
    const { from, offer } = params;
    console.log("WebSocket: Receive Offer From:", from, offer);
    const iceEnv = ((globalThis as any)?.process?.env?.TURN_ICE ?? (import.meta as any)?.env?.TURN_ICE ?? "") as string;
    const iceServers = this.parseIceServers(iceEnv);
    this.ensurePeerConnection(iceServers || undefined);
    await this.connection.setRemoteDescription(offer);
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    if (this.websocketSignaling) {
      await this.websocketSignaling.sendAnswer(from, answer);
    }
  }

  @Bind
  private async onWebSocketReceiveAnswer(params: { from: string; answer: RTCSessionDescriptionInit }) {
    const { from, answer } = params;
    console.log("WebSocket: Receive Answer From:", from, answer);
    if (!this.connection.currentRemoteDescription) {
      this.connection.setRemoteDescription(answer);
    }
  }

  @Bind
  private async onWebSocketReceiveIce(params: { from: string; candidate: RTCIceCandidateInit }) {
    const { from, candidate } = params;
    console.log("WebSocket: Receive ICE From:", from, candidate);
    await this.connection.addIceCandidate(candidate);
  }

  /** 检查是否有活跃的WebRTC连接 */
  public hasConnection(targetUserId?: string): boolean {
    const currentState = atoms.get(this.stateAtom);
    return currentState === CONNECTION_STATE.CONNECTED;
  }

  private parseIceServers(env?: string): RTCIceServer[] | null {
    if (!env) return null;
    try {
      const parsed: any = JSON.parse(env);
      if (Array.isArray(parsed)) return parsed as RTCIceServer[];
      if (typeof parsed === "object" && parsed.urls) return [parsed as RTCIceServer];
    } catch {
      if (typeof env === "string" && env) return [{ urls: env }];
    }
    return null;
  }
}
