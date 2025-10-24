import "@arco-design/web-react/es/style/index.less";
import ReactDOM from "react-dom";
import type { FC } from "react";
import React, { useEffect, useMemo, type FC } from "react";
import ReactDOM from "react-dom";
import { Provider } from "jotai";
import { ConfigProvider } from "@arco-design/web-react";
import enUS from "@arco-design/web-react/es/locale/en-US";
import { GlobalContext } from "./store/global";
import { atoms } from "./store/atoms";
import { Main } from "./view/main";
import { useDarkTheme } from "./hooks/use-dark-theme";
import { WebRTCService } from "./service/webrtc";
import { TransferService } from "./service/transfer";
import { StoreService } from "./service/store";
import { MessageService } from "./service/message";
import { SupabaseChatService } from "./service/chat";
import { ConnectionManager } from "./service/connection-manager";

const App: FC = () => {
  const context = useMemo(() => {
    const store = new StoreService();
    const chat = new SupabaseChatService(store);
    const rtc = new WebRTCService(chat);
    const transfer = new TransferService(rtc);
    const message = new MessageService(rtc, store, transfer, chat);
    const connectionManager = new ConnectionManager({
      supabaseChatService: chat,
      webrtcService: rtc,
      messageService: message,
      transferService: transfer
    });
    return { rtc, transfer, store, message, chat, connectionManager };
  }, []);

  useDarkTheme();

  useEffect(() => {
    window.context = context;
    return () => {
      window.context = null;
      context.rtc.destroy();
      context.message.destroy();
      context.transfer.destroy();
      context.chat.destroy();
    };
  }, [context]);

  return (
    <ConfigProvider locale={enUS}>
      <Provider store={atoms.store}>
        <GlobalContext.Provider value={context}>
          <Main />
        </GlobalContext.Provider>
      </Provider>
    </ConfigProvider>
  );
};

ReactDOM.render(<App></App>, document.getElementById("root"));
