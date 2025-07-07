import { useState, useEffect, useRef } from "react";

type ChatMessage = { user: string; message: string; type: "chat" | "system" };

type Params = {
  sendMessage: (msg: string) => void;
};

const useChatMessages = ({ sendMessage }: Params) => {
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
