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
    if (!isMatchSearch) return false;
    
    const selfIp = chat.selfIp;
    const myKnown = !!selfIp && selfIp !== "WAN";
    const peerKnown = !!user.ip && user.ip !== "WAN";
    
    let shouldShow = false;
    let reason = "";
    
    if (netType === NET_TYPE.LAN) {
      // LAN：仅在双方已知且相同IP时显示
      if (myKnown && peerKnown && user.ip === selfIp) {
        shouldShow = true;
        reason = "same known IP -> LAN";
      } else {
        shouldShow = false;
        reason = "not same known IP -> not LAN";
      }
    } else {
      // WAN：不同已知IP 或 任一未知IP 时显示
      if (!myKnown || !peerKnown) {
        shouldShow = true;
        reason = "unknown IP -> WAN";
      } else if (user.ip !== selfIp) {
        shouldShow = true;
        reason = "different IP -> WAN";
      } else {
        shouldShow = false;
        reason = "same IP -> not WAN";
      }
    }
    
    // 调试信息
    console.log(`[Filter Debug] User: ${user.id}, selfIp: ${selfIp}, userIp: ${user.ip}, myKnown: ${myKnown}, peerKnown: ${peerKnown}, netType: ${netType}, shouldShow: ${shouldShow}, reason: ${reason}`);
    
    return shouldShow;
  });

  return (
    <div className={styles.container}>
      {/* 调试信息显示 */}
      <div style={{ padding: '8px', fontSize: '12px', color: '#666', borderBottom: '1px solid #eee' }}>
        本地IP: {chat.selfIp || '未获取'} | 当前标签: {netType === NET_TYPE.LAN ? 'LAN' : 'WAN'}
      </div>
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
                 {/* 调试：展示 IP（未知时显示 WAN） */}
                 <div className={styles.ip}>{user.ip || "WAN"}</div>
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
