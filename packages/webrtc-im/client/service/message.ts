import type { PrimitiveAtom } from "jotai";
import { atom } from "jotai";
import type { TransferEntry, TransferEventMap, TransferFrom } from "../../types/transfer";
import { TRANSFER_EVENT, TRANSFER_TYPE, TRANSFER_FROM } from "../../types/transfer";
import type { WebRTCService } from "./webrtc";
import { atoms } from "../store/atoms";
import { Bind, Scroll, sleep } from "@block-kit/utils";
import type { ServerEvent } from "../../types/signaling";
import { SERVER_EVENT } from "../../types/signaling";
import { WEBRTC_EVENT } from "../../types/webrtc";
import type { StoreService } from "./store";
import type { TransferService } from "./transfer";
import type { SupabaseChatService } from "./chat";
import { DEVICE_TYPE } from "../../types/client";

export class MessageService {
  public scroll: HTMLDivElement | null;
  public readonly listAtom: PrimitiveAtom<TransferEntry[]>;

  constructor(
    private rtc: WebRTCService,
    private store: StoreService,
    private transfer: TransferService,
    private chat: SupabaseChatService
  ) {
    this.scroll = null;
    this.listAtom = atom<TransferEntry[]>([]);
    // WebRTC 状态事件
    this.rtc.bus.on(WEBRTC_EVENT.STATE_CHANGE, this.onRTCStateChange);
    this.rtc.bus.on(WEBRTC_EVENT.CONNECTING, this.onRTCConnecting);
    this.rtc.bus.on(WEBRTC_EVENT.CLOSE, this.onRTCClose);
    // 传输事件
    this.transfer.bus.on(TRANSFER_EVENT.TEXT, this.onTextMessage);
    this.transfer.bus.on(TRANSFER_EVENT.FILE_START, this.onFileStart);
    this.transfer.bus.on(TRANSFER_EVENT.FILE_PROCESS, this.onFileProcess);
    // Supabase 聊天与信令事件（仅用于日志显示）
    this.chat.bus.on("TEXT", this.onChatText);
    this.chat.bus.on("SUPABASE_FILE_MESSAGE", this.onSupabaseFileMessage);
    this.chat.bus.on(SERVER_EVENT.SEND_OFFER, this.onReceiveOffer);
    this.chat.bus.on(SERVER_EVENT.SEND_ICE, this.onReceiveIce);
    this.chat.bus.on(SERVER_EVENT.SEND_ANSWER, this.onReceiveAnswer);
  }

  public destroy() {
    this.rtc.bus.off(WEBRTC_EVENT.STATE_CHANGE, this.onRTCStateChange);
    this.rtc.bus.off(WEBRTC_EVENT.CONNECTING, this.onRTCConnecting);
    this.rtc.bus.off(WEBRTC_EVENT.CLOSE, this.onRTCClose);
    this.transfer.bus.off(TRANSFER_EVENT.TEXT, this.onTextMessage);
    this.transfer.bus.off(TRANSFER_EVENT.FILE_START, this.onFileStart);
    this.transfer.bus.off(TRANSFER_EVENT.FILE_PROCESS, this.onFileProcess);
    this.chat.bus.off("TEXT", this.onChatText as any);
    this.chat.bus.off("SUPABASE_FILE_MESSAGE", this.onSupabaseFileMessage as any);
    this.chat.bus.off(SERVER_EVENT.SEND_OFFER, this.onReceiveOffer);
    this.chat.bus.off(SERVER_EVENT.SEND_ICE, this.onReceiveIce);
    this.chat.bus.off(SERVER_EVENT.SEND_ANSWER, this.onReceiveAnswer);
  }

  public addEntry(entry: TransferEntry) {
    const currentList = atoms.get(this.listAtom);
    const newList = [...currentList, entry];
    atoms.set(this.listAtom, newList);
  }

  public addSystemEntry(data: string) {
    this.addEntry({ key: TRANSFER_TYPE.SYSTEM, data });
    this.scroll && Scroll.scrollToBottom(this.scroll);
  }

  public async addTextEntry(text: string, from: TransferFrom) {
    this.addEntry({ key: TRANSFER_TYPE.TEXT, data: text, from: from });
    await sleep(10);
    this.scroll && Scroll.scrollToBottom(this.scroll);
  }

  public clearEntries() {
    atoms.set(this.listAtom, []);
  }

  private getPeerDisplayName(id?: string) {
    const peerId = id || atoms.get(this.store.peerIdAtom);
    const list = atoms.get(this.store.userListAtom) as any[];
    const user = list.find((u: any) => u.id === peerId);
    if (user?.name) return user.name as string;
    if (user?.device) return user.device === DEVICE_TYPE.MOBILE ? "Mobile" : "PC";
    return "未知设备";
  }

  @Bind
  private onRTCConnecting() {
    const name = this.getPeerDisplayName();
    this.addSystemEntry(`WebRTC 正在连接至 ${name}`);
  }

  @Bind
  private onRTCClose() {
    const name = this.getPeerDisplayName();
    this.addSystemEntry(`WebRTC 与 ${name} 连接已关闭`);
  }

  @Bind
  private onRTCStateChange(connection: RTCPeerConnection) {
    const name = this.getPeerDisplayName();
    if (connection.connectionState === "disconnected") {
      this.addSystemEntry(`WebRTC 与 ${name} 连接已断开`);
    }
    if (connection.connectionState === "connected") {
      this.addSystemEntry(`WebRTC 与 ${name} 已连接`);
    }
    if (connection.connectionState === "failed") {
      this.addSystemEntry(`WebRTC 与 ${name} 连接失败`);
    }
    if (connection.connectionState === "closed") {
      this.addSystemEntry(`WebRTC 与 ${name} 连接已关闭`);
    }
  }

  @Bind
  private onReceiveOffer(params: ServerEvent["SEND_OFFER"]) {
    const name = this.getPeerDisplayName(params.from);
    this.addSystemEntry(`收到 ${name} 的 RTC Offer`);
  }

  @Bind
  private onReceiveIce(params: ServerEvent["SEND_ICE"]) {
    const name = this.getPeerDisplayName(params.from);
    this.addSystemEntry(`收到 ${name} 的 RTC ICE`);
  }

  @Bind
  private onReceiveAnswer(params: ServerEvent["SEND_ANSWER"]) {
    const name = this.getPeerDisplayName(params.from);
    this.addSystemEntry(`收到 ${name} 的 RTC Answer`);
  }

  @Bind
  private async onChatText(event: { from: string; to: string; data: string }) {
    const { data } = event;
    // Incoming chat messages are from peer
    this.addTextEntry(data, TRANSFER_FROM.PEER);
  }

  @Bind
  private async onSupabaseFileMessage(event: { from: string; message: any }) {
    const { from, message } = event;
    const name = this.getPeerDisplayName(from);
    
    // 根据消息类型处理不同的Supabase文件消息
    switch (message.type) {
      case 'TEXT':
        this.addTextEntry(message.text, TRANSFER_FROM.PEER);
        break;
      case 'FILE_START':
        this.addEntry({
          key: TRANSFER_TYPE.FILE,
          id: message.fileId,
          name: message.fileName,
          size: message.fileSize,
          process: 0,
          from: TRANSFER_FROM.PEER
        });
        break;
      case 'FILE_CHUNK':
        // 文件块接收处理现在由WebRTC或Supabase直接处理
        break;
      case 'FILE_FINISH':
        this.addSystemEntry(`通过 Supabase 接收文件 ${message.fileName} 完成`);
        break;
      default:
        this.addSystemEntry(`收到 ${name} 的 Supabase 消息: ${message.type}`);
    }
  }

  @Bind
  private async onTextMessage(event: TransferEventMap["TEXT"]) {
    const { data, from } = event;
    this.addTextEntry(data, from);
  }

  @Bind
  private async onFileStart(event: TransferEventMap["FILE_START"]) {
    const { id, name, size, from, process } = event;
    this.addEntry({ key: TRANSFER_TYPE.FILE, id, name, size, process, from });
    await sleep(10);
    this.scroll && Scroll.scrollToBottom(this.scroll);
  }

  @Bind
  private async onFileProcess(event: TransferEventMap["FILE_PROCESS"]) {
    const { id, process } = event;
    const list = [...atoms.get(this.listAtom)];
    const FILE_TYPE = TRANSFER_TYPE.FILE;
    const index = list.findIndex(it => it.key === FILE_TYPE && it.id === id);
    if (index > -1) {
      const node = list[index] as TransferEntry;
      list[index] = { ...node, process } as TransferEntry;
      atoms.set(this.listAtom, list);
    }
  }
}
