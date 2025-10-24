import { WebRTCService } from './webrtc';
import { SupabaseChatService } from './chat';
import { MessageService } from './message';
import { TransferService } from './transfer';
import { WebSocketSignalingService } from './websocket-signaling';
import type { SocketClient } from '../../../websocket/client/bridge/socket-server';

export enum ConnectionType {
  WEBRTC_LAN = 'webrtc_lan',      // 局域网WebRTC（使用Supabase信令）
  WEBRTC_WAN = 'webrtc_wan',      // 广域网WebRTC（使用WebSocket信令）
  SUPABASE = 'supabase'           // Supabase传输（备用方案）
}

export interface ConnectionManagerOptions {
  webrtcService: WebRTCService;
  supabaseChatService: SupabaseChatService;
  messageService: MessageService;
  transferService: TransferService;
  socketClient?: SocketClient;
  currentUserId?: string;
}

/**
 * 连接管理器 - 智能选择最优传输方式
 * 1. 局域网设备：WebRTC + Supabase信令
 * 2. 广域网设备：WebRTC + WebSocket信令
 * 3. 备用方案：Supabase传输
 */
export class ConnectionManager {
  private webrtcService: WebRTCService;
  private supabaseChatService: SupabaseChatService;
  private messageService: MessageService;
  private transferService: TransferService;
  private websocketSignaling?: WebSocketSignalingService;

  constructor(options: ConnectionManagerOptions) {
    this.webrtcService = options.webrtcService;
    this.supabaseChatService = options.supabaseChatService;
    this.messageService = options.messageService;
    this.transferService = options.transferService;

    // 如果提供了WebSocket客户端，初始化WebSocket信令服务
    if (options.socketClient && options.currentUserId) {
      this.websocketSignaling = new WebSocketSignalingService(
        options.socketClient,
        options.currentUserId
      );
      // 将WebSocket信令服务设置到WebRTC服务中
      this.webrtcService.setWebSocketSignaling(this.websocketSignaling);
    }
  }

  /**
   * 智能判断连接类型
   * @param isLAN 是否为局域网连接（由调用方判断）
   * @returns 连接类型
   */
  getConnectionType(isLAN: boolean = false): ConnectionType {
    // 检查是否有活跃的WebRTC连接
    const hasWebRTCConnection = this.webrtcService.hasConnection;
    
    if (hasWebRTCConnection) {
      // 已有WebRTC连接，根据信令类型判断
      return this.websocketSignaling ? ConnectionType.WEBRTC_WAN : ConnectionType.WEBRTC_LAN;
    }
    
    // 没有WebRTC连接时，根据网络类型和可用服务选择
    if (isLAN) {
      // 局域网优先使用WebRTC + Supabase信令
      return ConnectionType.WEBRTC_LAN;
    } else if (this.websocketSignaling) {
      // 广域网且有WebSocket信令服务，使用WebRTC + WebSocket信令
      return ConnectionType.WEBRTC_WAN;
    } else {
      // 备用方案：使用Supabase传输
      return ConnectionType.SUPABASE;
    }
  }

  /**
   * 建立连接
   * @param targetUserId 目标用户ID
   * @param isLAN 是否为局域网连接
   */
  async connect(targetUserId: string, isLAN: boolean = false): Promise<void> {
    const connectionType = this.getConnectionType(isLAN);
    
    switch (connectionType) {
      case ConnectionType.WEBRTC_LAN:
        // 使用Supabase信令建立WebRTC连接
        await this.webrtcService.connect(targetUserId);
        break;
      case ConnectionType.WEBRTC_WAN:
        // 使用WebSocket信令建立WebRTC连接
        await this.webrtcService.connect(targetUserId);
        break;
      case ConnectionType.SUPABASE:
        // Supabase连接不需要特殊的连接步骤
        console.log('使用Supabase连接');
        break;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 断开WebRTC连接
    if (this.webrtcService.hasConnection) {
      await this.webrtcService.destroy();
    }
    
    // 清理WebSocket信令
    if (this.websocketSignaling) {
      console.log('清理WebSocket信令服务');
    }
  }

  async sendTextMessage(message: string, targetUserId: string, isLAN: boolean = false): Promise<void> {
    const connectionType = this.getConnectionType(isLAN);
    
    switch (connectionType) {
      case ConnectionType.WEBRTC_LAN:
      case ConnectionType.WEBRTC_WAN:
        // 使用TransferService发送WebRTC消息
        await this.transferService.sendTextMessage(message);
        break;
      case ConnectionType.SUPABASE:
        await this.supabaseChatService.sendMessage(message, targetUserId);
        break;
    }
  }

  async sendFiles(files: File[], targetUserId: string, isLAN: boolean = false): Promise<void> {
    const connectionType = this.getConnectionType(isLAN);
    
    switch (connectionType) {
      case ConnectionType.WEBRTC_LAN:
      case ConnectionType.WEBRTC_WAN:
        // 将File[]转换为FileList并使用TransferService的startSendFileList方法
        const fileList = new DataTransfer();
        files.forEach(file => fileList.items.add(file));
        await this.transferService.startSendFileList(fileList.files);
        break;
      case ConnectionType.SUPABASE:
        // Supabase文件传输已被移除，这里可以添加日志或错误处理
        console.warn('Supabase file transfer has been removed');
        break;
    }
  }
}