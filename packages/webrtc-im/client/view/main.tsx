import type { FC } from "react";
import { Fragment, useState } from "react";
import styles from "../styles/main.m.scss";
import { TabBar } from "./tab-bar";
import { Contacts } from "./contacts";
import { IconGithub, IconEdit } from "@arco-design/web-react/icon";
import { Message } from "./message";
import { cs } from "@block-kit/utils";
import { useIsMobile } from "../hooks/use-is-mobile";
import { useGlobalContext } from "../store/global";
import { useAtomValue } from "jotai";
import { CONNECTION_STATE } from "../../types/client";
import { Button, Input, Modal } from "@arco-design/web-react";

export const Main: FC = () => {
  const { isMobile } = useIsMobile();
  const { chat, store } = useGlobalContext();
  const chatState = useAtomValue(chat.stateAtom);
  const chatConnected = chatState === CONNECTION_STATE.CONNECTED;
  const deviceName = useAtomValue(store.deviceNameAtom);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(deviceName || "");

  const openEdit = () => {
    setName(deviceName || "");
    setEditOpen(true);
  };

  const submitEdit = async () => {
    const value = (name || "").trim();
    if (!value) return setEditOpen(false);
    await chat.updateDeviceName(value);
    setEditOpen(false);
  };

  return (
    <Fragment>
      <a
        className={cs(styles.github, isMobile && styles.hidden)}
        href="https://github.com"
        target="_blank"
      >
        <IconGithub />
      </a>
      {/* 设备名称编辑入口（桌面端显示） */}
      {!isMobile && (
        <Button
          size="mini"
          type="secondary"
          icon={<IconEdit />}
          style={{ position: "fixed", right: 48, top: 6 }}
          onClick={openEdit}
        >
          设备名称
        </Button>
      )}
      <div className={cs(styles.main, isMobile && "webrtc-im-mobile")}
           aria-live="polite">
        {/* Chat 状态横幅 */}
        <div
          className={cs(
            styles.chatBanner,
            chatConnected ? styles.chatConnected : styles.chatDisconnected
          )}
        >
          {chatConnected ? "Chat Connected" : "Chat Connecting..."}
        </div>
        <TabBar></TabBar>
        <Contacts></Contacts>
        <Message></Message>
      </div>
      <Modal
        title="编辑设备名称"
        visible={editOpen}
        onOk={submitEdit}
        onCancel={() => setEditOpen(false)}
        unmountOnExit
      >
        <Input
          value={name}
          onChange={setName}
          placeholder="输入设备名称，如：我的电脑或我的手机"
          maxLength={24}
        />
      </Modal>
    </Fragment>
  );
};
