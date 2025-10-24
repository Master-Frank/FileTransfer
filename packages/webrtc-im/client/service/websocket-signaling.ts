import type { SocketClient } from "../../../websocket/client/bridge/socket-server";
import { SERVER_EVENT, CLINT_EVENT } from "../../../websocket/types/websocket";
import { EventBus } from "../utils/event-bus";
import { Bind } from "@block-kit/utils";

export interface WebSocketSignalingEvent {
  RECEIVE_OFFER: { from: string; offer: RTCSessionDescriptionInit };
  RECEIVE_ANSWER: { from: string; answer: RTCSessionDescriptionInit };
  RECEIVE_ICE: { from: string; candidate: RTCIceCandidateInit };
}

/**
 * WebSocket信令服务
 * 用于通过WebSocket服务器进行WebRTC信令交换
 */
export class WebSocketSignalingService {
  public bus: EventBus<WebSocketSignalingEvent>;
  private currentUserId: string;

  constructor(
    private socketClient: SocketClient,
    private userId: string
  ) {
    this.bus = new EventBus<WebSocketSignalingEvent>();
    this.currentUserId = userId;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // 监听来自WebSocket服务器的WebRTC信令
    this.socketClient.on(SERVER_EVENT.FORWARD_WEBRTC_OFFER, this.onReceiveOffer);
    this.socketClient.on(SERVER_EVENT.FORWARD_WEBRTC_ANSWER, this.onReceiveAnswer);
    this.socketClient.on(SERVER_EVENT.FORWARD_WEBRTC_ICE, this.onReceiveIce);
  }

  @Bind
  private onReceiveOffer(params: { origin: string; target: string; offer: RTCSessionDescriptionInit }) {
    const { origin, offer } = params;
    console.log("WebSocket Signaling: Receive Offer From:", origin, offer);
    this.bus.emit("RECEIVE_OFFER", { from: origin, offer });
  }

  @Bind
  private onReceiveAnswer(params: { origin: string; target: string; answer: RTCSessionDescriptionInit }) {
    const { origin, answer } = params;
    console.log("WebSocket Signaling: Receive Answer From:", origin, answer);
    this.bus.emit("RECEIVE_ANSWER", { from: origin, answer });
  }

  @Bind
  private onReceiveIce(params: { origin: string; target: string; candidate: RTCIceCandidateInit }) {
    const { origin, candidate } = params;
    console.log("WebSocket Signaling: Receive ICE From:", origin, candidate);
    this.bus.emit("RECEIVE_ICE", { from: origin, candidate });
  }

  /**
   * 发送WebRTC Offer
   */
  public async sendOffer(targetUserId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socketClient.emit(
        CLINT_EVENT.SEND_WEBRTC_OFFER,
        {
          origin: this.currentUserId,
          target: targetUserId,
          offer
        },
        (state) => {
          if (state.code === 0) {
            resolve();
          } else {
            reject(new Error(state.message));
          }
        }
      );
    });
  }

  /**
   * 发送WebRTC Answer
   */
  public async sendAnswer(targetUserId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socketClient.emit(
        CLINT_EVENT.SEND_WEBRTC_ANSWER,
        {
          origin: this.currentUserId,
          target: targetUserId,
          answer
        },
        (state) => {
          if (state.code === 0) {
            resolve();
          } else {
            reject(new Error(state.message));
          }
        }
      );
    });
  }

  /**
   * 发送ICE Candidate
   */
  public async sendIceCandidate(targetUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socketClient.emit(
        CLINT_EVENT.SEND_WEBRTC_ICE,
        {
          origin: this.currentUserId,
          target: targetUserId,
          candidate
        },
        (state) => {
          if (state.code === 0) {
            resolve();
          } else {
            reject(new Error(state.message));
          }
        }
      );
    });
  }

  /**
   * 销毁服务，清理事件监听器
   */
  public destroy() {
    this.socketClient.off(SERVER_EVENT.FORWARD_WEBRTC_OFFER, this.onReceiveOffer);
    this.socketClient.off(SERVER_EVENT.FORWARD_WEBRTC_ANSWER, this.onReceiveAnswer);
    this.socketClient.off(SERVER_EVENT.FORWARD_WEBRTC_ICE, this.onReceiveIce);
    this.bus.destroy();
  }
}