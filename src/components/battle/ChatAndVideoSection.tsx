import CyberCard from '@/components/CyberCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Monitor, Send } from 'lucide-react';
import { useRef } from 'react';

export interface ChatMessage {
  user: string;
  message: string;
  type: 'chat' | 'system';
}

interface ChatAndVideoSectionProps {
  chatMessages: ChatMessage[];
  newMessage: string;
  onMessageChange: (v: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  isRemoteStreamActive: boolean;
  showRemoteScreenSharePrompt: boolean;
  sharedRemoteStream: MediaStream | null;
}

const ChatAndVideoSection = ({
  chatMessages,
  newMessage,
  onMessageChange,
  onSend,
  chatEndRef,
  remoteVideoRef,
  isRemoteStreamActive,
  showRemoteScreenSharePrompt,
  sharedRemoteStream,
}: ChatAndVideoSectionProps) => {
  return (
    <div className="h-1/3 min-h-[16em] flex gap-2 mr-2">
      <div className="flex-1 min-w-0">
        <CyberCard className="p-3 flex flex-col h-full">
          <h3 className="text-sm font-semibold text-cyber-blue mb-2">채팅</h3>
          <ScrollArea className="flex-1 mb-2">
            <div className="space-y-2 pr-3">
              {chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`text-xs ${msg.type === 'system' ? 'text-red-400' : 'text-gray-400'}`}
                >
                  <div>
                    {msg.user}: {msg.message}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
          <div className="flex">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && onSend()}
              placeholder="메시지 입력..."
              className="flex-1 text-xs bg-black/30 border border-gray-600 rounded-l px-2 py-1 text-white"
            />
            <button onClick={onSend} className="bg-cyber-blue px-2 py-1 rounded-r">
              <Send className="h-3 w-3" />
            </button>
          </div>
        </CyberCard>
      </div>
      <div className="flex-1 min-w-0">
        <CyberCard className="p-3 flex flex-col items-center justify-center h-full">
          {sharedRemoteStream && isRemoteStreamActive ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
          ) : (
            <div className="text-xs text-gray-400 text-center">
              <Monitor className="h-8 w-8 text-gray-400 mb-2 mx-auto" />
              <div>상대방 화면</div>
              {showRemoteScreenSharePrompt ? (
                <div className="mt-1 text-red-400">공유 중지됨. 상대방이 다시 공유해야 합니다.</div>
              ) : (
                <div className="mt-1 text-yellow-400">공유 대기중...</div>
              )}
            </div>
          )}
        </CyberCard>
      </div>
    </div>
  );
};

export default ChatAndVideoSection;
