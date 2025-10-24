import type { FC } from "react";
import styles from "../styles/message.m.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGlobalContext } from "../store/global";
import { IconClose, IconSend, IconDownload, IconUpload, IconLeft } from "@arco-design/web-react/icon";
import { useAtom, useAtomValue } from "jotai";
import { Button, Image, Message as ArcoMessage, Input, Progress } from "@arco-design/web-react";
import { EllipsisTooltip } from "../component/ellipsis";
import { useIsMobile } from "../hooks/use-is-mobile";
import { TRANSFER_TYPE } from "../../types/transfer";
import { CONNECTION_STATE, DEVICE_TYPE } from "../../types/client";
import { cs } from "@block-kit/utils";

export const Message: FC = () => {
  const { message, store, rtc, transfer, connectionManager } = useGlobalContext();
  const { isMobile } = useIsMobile();
  const list = useAtomValue(message.listAtom);
  const rtcState = useAtomValue(rtc.stateAtom);
  const [peerId, setPeerId] = useAtom(store.peerIdAtom);
  const users = useAtomValue(store.userListAtom);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    // 切换会话清空本地列表与预览缓存
    message.clearEntries();
    // 清理旧 URL
    setImageUrls(prev => {
      Object.values(prev).forEach(url => URL.revokeObjectURL(url));
      return {};
    });
  }, [peerId]);

  useEffect(() => {
    // 绑定滚动容器到 MessageService
    if (scrollRef.current) {
      message.scroll = scrollRef.current;
    }
  }, [scrollRef.current]);

  // 简易时间 ID
  const generateTimeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const pickFiles = (): Promise<FileList | null> => {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = () => resolve(input.files);
      input.click();
    });
  };

  const isRTCConnected = rtcState === CONNECTION_STATE.CONNECTED;

  const handleSendText = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    
    // 使用ConnectionManager智能选择传输方式
    if (peerId) {
      await connectionManager.sendTextMessage(value, peerId);
    } else {
      ArcoMessage.info("请先选择联系人！");
    }
  };

  const handleSendFile = async () => {
    const files = await pickFiles();
    if (!files || !files.length) return;
    
    // 使用ConnectionManager智能选择传输方式
    if (peerId) {
      await connectionManager.sendFiles(Array.from(files), peerId);
    } else {
      ArcoMessage.info("请先选择联系人！");
    }
  };

  const handleDownload = async (id: string, name: string) => {
    const blob = await transfer.getFile(id);
    if (!blob) return ArcoMessage.info("文件还未接收完成，请稍后重试！");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download";
    a.click();
    URL.revokeObjectURL(url);
  };

  const isImageName = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || "");

  // 当文件接收完成时，生成图片预览 URL
  useEffect(() => {
    const update = async () => {
      for (const it of list) {
        if (it.key === TRANSFER_TYPE.FILE && (it as any).process === 100 && isImageName((it as any).name)) {
          const id = (it as any).id as string;
          if (!imageUrls[id]) {
            const blob = await transfer.getFile(id);
            if (blob) {
              const url = URL.createObjectURL(blob);
              setImageUrls(prev => ({ ...prev, [id]: url }));
            }
          }
        }
      }
    };
    update();
    // 清理被移除的 URL
    return () => {
      const ids = new Set(list.filter(it => it.key === TRANSFER_TYPE.FILE).map(it => (it as any).id as string));
      setImageUrls(prev => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([id, url]) => {
          if (ids.has(id)) next[id] = url; else URL.revokeObjectURL(url);
        });
        return next;
      });
    };
  }, [list]);

  const stateColor = useMemo(() => {
    if (rtcState === CONNECTION_STATE.CONNECTED) return "rgb(var(--green-6))";
    if (rtcState === CONNECTION_STATE.CONNECTING) return "rgb(var(--arcoblue-6))";
    return "var(--color-border-2)";
  }, [rtcState]);

  const peerName = useMemo(() => {
    const user = users.find(u => u.id === peerId);
    if (!peerId) return "未选择联系人";
    if (user?.name) return user.name;
    if (user) return user.device === DEVICE_TYPE.MOBILE ? "Mobile" : "PC";
    return "未知设备";
  }, [users, peerId]);

  const handleBack = () => {
    // 原生返回体验：返回到联系人列表，不主动断开连接
    if (isMobile) setPeerId("");
  };

  const isActiveMobile = isMobile && !!peerId;

  return (
    <div className={cs(styles.container, isMobile && !peerId && styles.mobileHidden, isActiveMobile && styles.mobileActive)}>
      <div className={styles.captainArea}>
        {/* 移动端返回按钮，48x48 可点击区域 */}
        {isMobile && (
          <button className={styles.back} aria-label="返回" onClick={handleBack}>
            <IconLeft />
          </button>
        )}
        <div className={styles.captain}>
          <div className={styles.dot} style={{ backgroundColor: stateColor }} />
          <div className={styles.captainName}>{peerName}</div>
        </div>
        <div className={styles.disconnect}>
          <IconClose onClick={() => rtc.disconnect()} />
        </div>
      </div>

      <div className={styles.messageArea} ref={scrollRef}>
        {list.map((it, idx) => {
          if (it.key === TRANSFER_TYPE.SYSTEM) return (
            <div className={cs(styles.messageItem, styles.systemMessage)} key={`sys_${idx}_${generateTimeId()}`}>
              {(it as any).data}
            </div>
          );

          if (it.key === TRANSFER_TYPE.TEXT) return (
            <div className={cs(styles.messageItem, (it as any).from !== "SELF" && styles.peerMessage)} key={`tx_${idx}_${generateTimeId()}`}>
              <div className={styles.basicMessage}>{(it as any).data}</div>
            </div>
          );

          if (it.key === TRANSFER_TYPE.FILE) {
            const id = (it as any).id as string;
            const name = (it as any).name as string;
            const process = (it as any).process as number;
            const isImage = isImageName(name);
            const img = imageUrls[id];
            return (
              <div className={cs(styles.messageItem, (it as any).from !== "SELF" && styles.peerMessage)} key={`fl_${idx}_${id}`}>
                <div className={cs(styles.basicMessage, styles.fileMessage)}>
                  <div className={styles.fileName}>
                    <EllipsisTooltip text={name} tooltip={name}></EllipsisTooltip>
                  </div>

                  {/* 文件信息与操作 */}
                  <div className={styles.fileInfo}>
                    <div>
                      {process < 100 ? (
                        <Progress percent={process} size="mini" />
                      ) : (
                        <span>{(Math.min(process, 100)).toFixed(0)}%</span>
                      )}
                    </div>
                    <div
                      className={cs(styles.fileDownload, process !== 100 && "disable")}
                      onClick={() => process === 100 && handleDownload(id, name)}
                    >
                      <IconDownload />
                    </div>
                  </div>

                  {/* 图片预览 */}
                  {isImage && img && (
                    <div style={{ marginTop: 8 }}>
                      <Image
                        src={img}
                        width={180}
                        height={120}
                        fit="cover"
                        preview={{ src: img }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      <div className={styles.inputArea}>
        <div className={styles.operation}>
          <Button
            type="primary"
            size="large"
            shape="round"
            icon={<IconUpload />}
            onClick={handleSendFile}
            disabled={!peerId}
            style={{ marginLeft: 6 }}
          >
            选择文件
          </Button>
        </div>
        <Input.TextArea
          className={styles.textarea}
          placeholder={peerId ? "输入文本..." : "请先选择联系人"}
          value={text}
          onChange={setText}
          autoSize={{ minRows: isMobile ? 2 : 3, maxRows: 4 }}
          disabled={!peerId}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSendText();
            }
          }}
        />
        <div className={cs(styles.send, !peerId && styles.disabled)} onClick={peerId ? handleSendText : undefined}>
          <IconSend />
        </div>
      </div>
    </div>
  );
};
