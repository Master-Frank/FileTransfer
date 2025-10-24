export const isMobileLike = (): boolean => {
  try {
    const ua = navigator.userAgent || "";
    const uaDataMobile = (navigator as any)?.userAgentData?.mobile;
    const touchPoints = (navigator as any)?.maxTouchPoints ?? 0;
    const coarsePointer = typeof window !== "undefined" && matchMedia && matchMedia("(pointer: coarse)").matches;
    const smallViewport = typeof window !== "undefined" && (window.innerWidth <= 820 || screen.width <= 820);
    const uaRegexMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return !!(uaDataMobile || coarsePointer || touchPoints > 1 || smallViewport || uaRegexMobile);
  } catch (_) {
    return false;
  }
};

export const getDefaultDeviceName = (): string => {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS 设备";
    if (/Android/i.test(ua)) return "Android 设备";
    if (/Mac OS X/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Linux/i.test(ua)) return "Linux 设备";
    // Fallback by mobile-like
    return isMobileLike() ? "移动设备" : "桌面设备";
  } catch (_) {
    return "未知设备";
  }
};