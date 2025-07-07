import { useState, useEffect, useRef } from "react";

type ChatMessage = { user: string; message: string; type: "chat" | "system" };

type Params = {
  websocket: WebSocket | null;
  userId: number | undefined;
  sendMessage: (msg: string) => void;
};

const useChatMessages = ({ websocket, userId, sendMessage }: Params) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    sendMessage(JSON.stringify({ type: "chat", message: newMessage }));
    setChatMessages((prev) => [
      ...prev,
      { user: "나", message: newMessage, type: "chat" },
    ]);
    setNewMessage("");
  };

  useEffect(() => {
    if (!websocket) return;
    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chat" && data.sender !== userId) {
          setChatMessages((prev) => [
            ...prev,
            { user: "상대", message: data.message, type: "chat" },
          ]);
        }
      } catch (e) {
        console.error("Chat message parse error", e);
      }
    };
  }, [websocket, userId]);

  return {
    chatMessages,
    newMessage,
    setNewMessage,
    handleSendMessage,
    chatEndRef,
    setChatMessages,
  };
};

export default useChatMessages;
