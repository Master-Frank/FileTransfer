import { createContext, useContext } from "react";
import type { WebRTCService } from "../service/webrtc";
import type { TransferService } from "../service/transfer";
import type { StoreService } from "../service/store";
import type { MessageService } from "../service/message";
import type { SupabaseChatService } from "../service/chat";

export type ContextType = {
  rtc: WebRTCService;
  transfer: TransferService;
  store: StoreService;
  message: MessageService;
  chat: SupabaseChatService;
};

export const GlobalContext = createContext<ContextType | null>(null);

export const useGlobalContext = () => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error("useGlobalContext must be used within a GlobalContext.Provider");
  }
  return context;
};
