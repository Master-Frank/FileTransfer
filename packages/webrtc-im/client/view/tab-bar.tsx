import type { FC } from "react";
import styles from "../styles/tab-bar.m.scss";
import { Avatar } from "../component/avatar";
import { useGlobalContext } from "../store/global";
import { useAtom, useAtomValue } from "jotai";
import { CONNECT_DOT } from "../utils/connection";
import { IconCloud, IconUser } from "@arco-design/web-react/icon";
import { cs } from "@block-kit/utils";
import { NET_TYPE } from "../../types/client";
import { EllipsisTooltip } from "../component/ellipsis";
import { useIsMobile } from "../hooks/use-is-mobile";
import { getDefaultDeviceName } from "../utils/device";

export const TabBar: FC = () => {
  const { chat, store } = useGlobalContext();
  const { isMobile } = useIsMobile();
  const chatState = useAtomValue(chat.stateAtom);
  const [tab, setTab] = useAtom(store.netTypeAtom);
  const deviceName = useAtomValue(store.deviceNameAtom) || getDefaultDeviceName();

  return (
    <div className={styles.container}>
      <div className={styles.avatar}>
        <Avatar id={chat.selfId} size={isMobile ? 26 : void 0} square={isMobile ? 4 : void 0}>
          <div className={styles.dot} style={{ backgroundColor: CONNECT_DOT[chatState] }}></div>
        </Avatar>
        <div className={styles.name}>
          <EllipsisTooltip
            triggerProps={{ trigger: isMobile ? "click" : void 0, position: "top" }}
            text={deviceName}
            tooltip={deviceName}
          ></EllipsisTooltip>
        </div>
      </div>
      <div
        onClick={() => setTab(NET_TYPE.LAN)}
        className={cs(styles.netTab, tab === NET_TYPE.LAN && styles.active)}
      >
        <IconUser />
      </div>
      <div
        onClick={() => setTab(NET_TYPE.WAN)}
        className={cs(styles.netTab, tab === NET_TYPE.WAN && styles.active)}
      >
        <IconCloud />
      </div>
    </div>
  );
};
