import type { FC } from "react";
import { Fragment, useEffect, useState } from "react";
import styles from "../styles/contacts.m.scss";
import type { ServerSendOfferEvent } from "../../types/signaling";
import { SERVER_EVENT } from "../../types/signaling";
import { Empty, Input } from "@arco-design/web-react";
import { useGlobalContext } from "../store/global";
import { useMemoFn } from "@block-kit/utils/dist/es/hooks";
import { Avatar } from "../component/avatar";
import type { Users } from "../../types/client";
import { DEVICE_TYPE, NET_TYPE } from "../../types/client";
import { PhoneIcon } from "../component/icons/phone";
import { PCIcon } from "../component/icons/pc";
import { IconSearch } from "@arco-design/web-react/icon";
import { useAtom, useAtomValue } from "jotai";
import { cs } from "@block-kit/utils";
import { atoms } from "../store/atoms";
import type { O } from "@block-kit/utils/dist/es/types";
import { CONNECTION_STATE } from "../../types/client";

export const Contacts: FC = () => {
  const { chat, store, message, rtc } = useGlobalContext();
  const [search, setSearch] = useState("");
  const netType = useAtomValue(store.netTypeAtom);
  const [peerId, setPeerId] = useAtom(store.peerIdAtom);
  const [list, setList] = useAtom(store.userListAtom);
  const rtcState = useAtomValue(rtc.stateAtom);

  // Supabase presence 管理用户列表（必要时提供本地去重/合并接口）
  const onJoinRoom = useMemoFn((user: Users[number]) => {
    setList(prev => {
      const userMap: O.Map<Users[number]> = {};
      prev.forEach(u => (userMap[u.id] = u));
      userMap[user.id] = user;
      return Object.values(userMap);
    });
  });

  const connectUser = async (userId: string) => {
    if (peerId === userId) return void 0;
    rtc.disconnect();
    message.clearEntries();
    setPeerId(userId);
    await chat.isConnected();
    rtc.connect(userId);
  };

  const onReceiveOffer = useMemoFn(async (event: ServerSendOfferEvent) => {
    const { from } = event;
    // 事件优先级高于 setRemoteDescription，确保切换到正确 peer
    if (
      peerId === from ||
      rtc.connection.connectionState === "new" ||
      rtc.connection.connectionState === "failed" ||
      rtc.connection.connectionState === "disconnected" ||
      rtc.connection.connectionState === "closed"
    ) {
      rtc.disconnect();
      setPeerId(from);
      peerId !== from && message.clearEntries();
    }
  });

  useEffect(() => {
    // 改为监听 Supabase 信令事件
    chat.bus.on(SERVER_EVENT.SEND_OFFER, onReceiveOffer, 10);
    return () => {
      chat.bus.off(SERVER_EVENT.SEND_OFFER, onReceiveOffer);
    };
  }, [onReceiveOffer, chat]);

  const filteredList = list.filter(user => {
    const keyword = search.trim().toLowerCase();
    const isMatchSearch =
      !keyword ||
      user.id.toLowerCase().includes(keyword) ||
      (user.name && user.name.toLowerCase().includes(keyword));
    // 简化为仅按搜索关键字过滤；LAN/WAN 切换仅影响空态文案
    return isMatchSearch;
  });

  return (
    <div className={styles.container}>
      <Input
        value={search}
        onChange={setSearch}
        className={styles.search}
        prefix={<IconSearch />}
        size="small"
        placeholder="Search"
      ></Input>
      <div className={styles.users}>
        {filteredList.map(user => (
          <Fragment key={user.id}>
            <div
              onClick={() => connectUser(user.id)}
              className={cs(styles.user, peerId === user.id && styles.active)}
            >
              <div className={styles.avatar}>
                <Avatar id={user.id}></Avatar>
              </div>
              <div className={styles.userInfo}>
                <div className={styles.captain}>
                  <span className={styles.name}>
                    {user.name || (user.device === DEVICE_TYPE.MOBILE ? "移动设备" : "桌面设备")}
                   </span>
                  {user.device === DEVICE_TYPE.MOBILE ? PhoneIcon : PCIcon}
                  {peerId === user.id && (
                    <span
                      className={styles.dot}
                      aria-label={
                        rtcState === CONNECTION_STATE.CONNECTED
                          ? "connected"
                          : rtcState === CONNECTION_STATE.CONNECTING
                          ? "connecting"
                          : "ready"
                      }
                      style={{
                        backgroundColor:
                          rtcState === CONNECTION_STATE.CONNECTED
                            ? "rgb(var(--green-6))"
                            : rtcState === CONNECTION_STATE.CONNECTING
                            ? "rgb(var(--arcoblue-6))"
                            : "var(--color-border-2)",
                        marginLeft: 8,
                      }}
                    />
                  )}
                </div>
                {/* 只展示设备名称，不显示随机码/ID */}
                <div className={styles.ip}></div>
              </div>
            </div>
            <div className={styles.divide}></div>
          </Fragment>
        ))}
      </div>
      {!filteredList.length && (
        <Empty
          className={styles.empty}
          description={`No ${netType === NET_TYPE.LAN ? "LAN" : "WAN"} User`}
        ></Empty>
      )}
    </div>
  );
};
