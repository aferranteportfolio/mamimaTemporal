import { memo, useCallback, useMemo } from "react";

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * @param {{
 *  conversation: {id:string, customerId:string, lastMessage?:string, lastTimestamp?:string, unread?:number, phone?:string, customerIdRaw?:string, displayName?:string},
 *  isActive: boolean,
 *  onClick: ()=>void
 * }} props
 */
function ChatRow({ conversation, isActive, onClick }) {
  const title = useMemo(() => {
    const raw =
      conversation.phone ??
      conversation.customerId ??
      conversation.customerIdRaw ??
      "";
    const cleaned = String(raw).replace("@c.us", "");
    return conversation.displayName && conversation.displayName.trim()
      ? conversation.displayName
      : cleaned;
  }, [
    conversation.phone,
    conversation.customerId,
    conversation.customerIdRaw,
    conversation.displayName,
  ]);

  const timeLabel = useMemo(() => {
    return formatTime(conversation.lastTimestamp);
  }, [conversation.lastTimestamp]);

  const snippet = conversation.lastMessage || "\u00A0";
  const unread = Number(conversation.unread || 0);

  const handleClick = useCallback(() => {
    // NOTE: console.log can add main-thread cost during INP; keep only if needed
    // console.log("[ChatRow] click", { id: conversation.id, customerId: conversation.customerId });
    onClick?.();
  }, [onClick]);

  return (
    <div
      className={`chat-row ${isActive ? "active" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="chat-meta">
          <span className="chat-phone">{title}</span>
          <span className="small">{timeLabel}</span>
        </div>

        <div className="chat-snippet">{snippet}</div>
      </div>

      {unread > 0 && <span className="badge">{unread}</span>}
    </div>
  );
}

export default memo(
  ChatRow,
  (prev, next) =>
    prev.isActive === next.isActive &&
    prev.onClick === next.onClick &&
    prev.conversation?.id === next.conversation?.id &&
    prev.conversation?.displayName === next.conversation?.displayName &&
    prev.conversation?.customerId === next.conversation?.customerId &&
    prev.conversation?.lastTimestamp === next.conversation?.lastTimestamp &&
    prev.conversation?.lastMessage === next.conversation?.lastMessage &&
    prev.conversation?.unread === next.conversation?.unread
);
