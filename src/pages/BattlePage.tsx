import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import { Clock, Play, Send, Monitor, Flag, AlertTriangle, HelpCircle } from 'lucide-react';
import { authFetch } from '@/utils/api';
import { localStream as sharedLocalStream, remoteStream as sharedRemoteStream, setLocalStream, peerConnection as sharedPC } from '@/utils/webrtcStore';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';

const BattlePage = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get('gameId');
  const wsRef = useRef<WebSocket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [timeLeft, setTimeLeft] = useState(930);
  const [code, setCode] = useState('');
  const [chatMessages, setChatMessages] = useState<{ user: string; message: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [executionResult, setExecutionResult] = useState('실행 결과가 여기에 표시됩니다.');
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isLocalStreamActive, setIsLocalStreamActive] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const problem = {
    title: '문제 설명',
    description: '정수 n을 입력받아 n의 약수를 모두 더한 값을 리턴하는 함수, solution을 완성해주세요.',
    constraints: ['n은 0 이상 3000이하인 정수입니다.'],
    examples: [
      { input: 'n: 12', output: 'return: 28' },
      { input: 'n: 5', output: 'return: 6' }
    ],
    testCase: {
      title: '입출력 예 설명',
      description: '12의 약수는 1, 2, 3, 4, 6, 12입니다. 이를 모두 더하면 28입니다.'
    },
    hint: ['수학', '약수', '반복문', '완전탐색']
  };


  useEffect(() => {
    if (localVideoRef.current && sharedLocalStream) {
      localVideoRef.current.srcObject = sharedLocalStream;
    }
    if (remoteVideoRef.current && sharedRemoteStream) {
      remoteVideoRef.current.srcObject = sharedRemoteStream;
    }

    if (sharedLocalStream) {
      const videoTrack = sharedLocalStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          setIsLocalStreamActive(false);
        };
      }
    }
  }, []);

   // 웹소켓 연결
   useEffect(() => {
    if (!gameId || !user?.user_id) return;

    const ws = new WebSocket(
      `ws://localhost:8000/api/v1/game/ws/game/${gameId}?user_id=${user.user_id}`
    );
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chat' && data.sender !== user.user_id) {
          setChatMessages((prev) => [
            ...prev,
            {
              user: '상대',
              message: data.message,
            },
          ]);
        }
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    };

    return () => {
      ws.close();
    };
  }, [gameId, user]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);


  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/result');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const msgObj = { type: 'chat', message: newMessage };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msgObj));
      setChatMessages((prev) => [...prev, { user: '나', message: newMessage }]);
    }
    
    setNewMessage('');
  };

  const handleSurrender = () => {
    if (confirm('정말 항복하시겠습니까?')) {
      navigate('/result');
    }
  };

  const handleReport = () => {
    alert('신고가 접수되었습니다.');
  };

  const handleRestartScreenShare = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = mediaStream;
      }

      setLocalStream(mediaStream);

      if (sharedPC) {
        const videoTrack = mediaStream.getVideoTracks()[0];
        const sender = sharedPC.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      }

      const videoTrack = mediaStream.getVideoTracks()[0];
      videoTrack.onended = () => {
        setIsLocalStreamActive(false);
      };

      setIsLocalStreamActive(true);
    } catch (error) {
      console.error('Error restarting screen share:', error);
    }
  };

  const timeColor = timeLeft <= 60 ? 'text-red-400' : timeLeft <= 180 ? 'text-yellow-400' : 'text-cyber-blue';

  const handleRun = async () => {
    setExecutionResult('코드를 실행하고 있습니다...');
    setRunStatus(null);

    try {
      const response = await authFetch('http://localhost:8000/api/v1/game/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          language: 'python',
          code,
          problem_id: '3',
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        setExecutionResult(`실행 실패: ${text}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\r\n\r\n');
        buffer = parts.pop() || '';
        for (const chunk of parts) {
          const line = chunk.trim();
          if (line.startsWith('data:')) {
            const data = JSON.parse(line.slice(5));
            if (data.type === 'progress') {
              setExecutionResult(prev =>
                `${prev}\n[${data.index + 1}/${data.total}] stdout: ${data.result.stdout}`,
              );
            } else if (data.type === 'final') {
              setExecutionResult(prev =>
                `${prev}\n채점 완료. All Passed: ${data.allPassed ? 'Yes' : 'No'}`,
              );
              setRunStatus(data.allPassed ? '성공' : '실패');
            }
          }
        }
      }
    } catch (error) {
      setExecutionResult('실행 중 오류가 발생했습니다.');
    }
  };

  const handleSubmit = () => {
    navigate('/result');
  };

  const toggleHint = () => {
    setShowHint(!showHint);
  };

  // 스크롤 동기화 함수
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // 동적으로 줄 번호 생성
  const actualLineCount = code ? code.split('\n').length : 1;
  const displayLineCount = Math.max(actualLineCount, 20);

  return (
    <div className="min-h-screen cyber-grid bg-cyber-darker">
      {/* 배틀 전용 헤더 */}
      <header className="sticky top-0 z-50 cyber-card border-b border-cyber-blue/20 backdrop-blur-md">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* 좌측 - 로고 */}
            <div className="flex items-center space-x-3">
              <span className="text-xl font-bold neon-text">Codeground</span>
            </div>
            
            {/* 중앙 - 타이머 */}
            <div className="flex items-center space-x-2">
              <Clock className={`h-6 w-6 ${timeColor}`} />
              <span className={`text-2xl font-bold font-mono ${timeColor} ${timeLeft <= 60 ? 'animate-pulse' : ''}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
            
            {/* 우측 - 항복, 신고 */}
            <div className="flex items-center space-x-3">
              <CyberButton onClick={handleSurrender} size="sm" variant="secondary">
                <Flag className="mr-1 h-4 w-4" />
                항복
              </CyberButton>
              <CyberButton onClick={handleReport} size="sm" variant="secondary">
                <AlertTriangle className="mr-1 h-4 w-4" />
                신고
              </CyberButton>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 영역 */}
      <main className="h-[calc(100vh-80px)] p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* 좌측 영역 */}
          <ResizablePanel defaultSize={40} minSize={30}>
            <div className="h-full flex flex-col">
              {/* 좌측 상단 - 문제 */}
              <div className="flex-1 mb-2 min-h-0">
                <CyberCard className="h-full p-4 mr-2 max-h-[860px] overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="space-y-4 pr-4">
                      <div className="flex items-start justify-between">
                        <h1 className="text-xl font-bold neon-text">{problem.title}</h1>
                        <CyberButton onClick={toggleHint} size="sm" variant="secondary">
                          <HelpCircle className="mr-1 h-4 w-4" />
                          힌트
                        </CyberButton>
                      </div>

                      {showHint && (
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                          <h3 className="text-yellow-400 font-semibold mb-2">알고리즘 분류</h3>
                          <div className="flex flex-wrap gap-2">
                            {problem.hint.map((tag, index) => (
                              <span key={index} className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-sm">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                    <div style={{ whiteSpace: 'pre-wrap', overflowY: 'auto' }}>
                      <p className="text-gray-300 leading-relaxed">{problem.description}</p>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-cyber-blue mb-2">제한 사항</h3>
                      <ul className="text-gray-300 space-y-1">
                        {problem.constraints.map((constraint, index) => (
                          <li key={index}>• {constraint}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-cyber-blue mb-2">입출력 예</h3>
                      <div className="bg-black/30 p-3 rounded-lg border border-gray-700 space-y-2">
                        {problem.examples.map((example, index) => (
                          <div key={index} className="font-mono text-sm">
                            <div className="text-gray-400">{example.input}</div>
                            <div className="text-green-400">{example.output}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-cyber-blue mb-2">입출력 예 설명</h3>
                      <h4 className="text-yellow-400 font-medium mb-1">입출력 예 #1</h4>
                      <p className="text-gray-300 text-sm">{problem.testCase.description}</p>
                    </div>
                  </div>
                </ScrollArea>
              </CyberCard>
              </div>

              {/* 좌측 하단 - 채팅 & 화면공유 (고정 높이) */}
              <div className="h-48 flex gap-2 mr-2" >
                {/* 채팅 */}
                <div className="flex-1 min-w-0">
                  <CyberCard className="p-3 flex flex-col h-full">
                    <h3 className="text-sm font-semibold text-cyber-blue mb-2">채팅</h3>
                    <ScrollArea className="flex-1 mb-2">
                      <div className="space-y-2 pr-3">
                        {chatMessages.map((msg, index) => (
                          <div key={index} className="text-xs">
                            <div className="text-gray-400">{msg.user}: {msg.message}</div>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    </ScrollArea>
                    <div className="flex">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="메시지 입력..."
                        className="flex-1 text-xs bg-black/30 border border-gray-600 rounded-l px-2 py-1 text-white"
                      />
                      <button
                        onClick={handleSendMessage}
                        className="bg-cyber-blue px-2 py-1 rounded-r"
                      >
                        <Send className="h-3 w-3" />
                      </button>
                    </div>
                  </CyberCard>
                </div>

                {/* 화면공유 */}
                <div className="flex-1 min-w-0">
                  <CyberCard className="p-3 flex flex-col items-center justify-center h-full">
                  {sharedRemoteStream ? (
                      <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-xs text-gray-400 text-center">
                        <Monitor className="h-8 w-8 text-gray-400 mb-2" />
                        <div>상대방 화면</div>
                        <div className="mt-1 text-yellow-400">공유 대기중...</div>
                      </div>
                    )}
                  </CyberCard>
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* 우측 영역 */}
          <ResizablePanel defaultSize={60} minSize={40}>
            <ResizablePanelGroup direction="vertical">
              {/* 우측 상단 - 코드 에디터 */}
              <ResizablePanel defaultSize={75} minSize={50}>
                <CyberCard className="h-full flex flex-col ml-2 mb-1">
                  {/* 최소화된 헤더 */}
                  <div className="flex items-center px-3 py-1 border-b border-gray-700/50 bg-black/20">
                    <div className="text-xs text-gray-400">Code Editor</div>
                  </div>
                  
                  {/* 코드 에디터 영역 */}
                  <div className="flex-1 overflow-hidden">
                    <div className="h-full flex bg-black/30">
                      {/* 줄 번호 */}
                      <div 
                        ref={lineNumbersRef}
                        className="flex-shrink-0 w-12 bg-black/20 border-r border-gray-700 overflow-hidden"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        <div className="text-xs text-gray-500 leading-5 text-right py-3 px-2">
                          {Array.from({length: displayLineCount}, (_, i) => (
                            <div key={i} className="h-5">{i + 1}</div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-hidden">
                        <textarea
                          ref={textareaRef}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          onScroll={handleScroll}
                          placeholder="" // 빈 placeholder로 변경
                          className="w-full h-full bg-transparent px-3 py-3 text-green-400 font-mono resize-none focus:outline-none text-sm leading-5 border-none"
                          style={{ 
                            fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </CyberCard>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* 우측 하단 - 실행 결과 */}
              <ResizablePanel defaultSize={25} minSize={15}>
                <CyberCard className="h-full flex flex-col ml-2 mt-1">
                  <div className="flex items-center justify-between px-3 py-1 border-b border-gray-700/50">
                    <h3 className="text-sm font-semibold text-cyber-blue">
                      실행 결과
                      {runStatus && (
                        <span
                          className={`ml-2 text-xs ${runStatus === '성공' ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {runStatus}
                        </span>
                      )}
                    </h3>
                    <div className="flex space-x-1">
                      <CyberButton onClick={handleRun} size="sm" variant="secondary" className="px-6">
                        <Play className="mr-1 h-3 w-3" />
                        실행
                      </CyberButton>
                      <CyberButton onClick={handleSubmit} size="sm" className="px-6">
                        제출
                      </CyberButton>
                    </div>
                  </div>
                  
                  <div className="flex-1 p-2" style={{ height: 'calc(100% - 40px)' }}>
                    <div className="h-full bg-black/30 border border-gray-700 rounded p-3 overflow-auto">
                      <pre className="font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
                        {executionResult}
                      </pre>
                    </div>
                  </div>
                </CyberCard>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
};

export default BattlePage;
