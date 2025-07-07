import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import { Clock, Play, Send, Monitor, Flag, AlertTriangle, HelpCircle } from 'lucide-react';
import { localStream as sharedLocalStream, remoteStream as sharedRemoteStream, setLocalStream, peerConnection as sharedPC, setPeerConnection, setRemoteStream } from '@/utils/webrtcStore';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProgrammingLanguage } from '@/types/codeEditor';
import { getLanguageConfig } from '@/utils/languageConfig';
import { CodeEditorHandler } from '@/utils/codeEditorHandlers';
import usePreventNavigation from '@/hooks/usePreventNavigation';
import GameExitModal from '@/components/GameExitModal';
import useWebSocketStore from '@/stores/websocketStore';
import { authFetch } from '@/utils/api';

const BattlePage = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get('gameId');
  const { websocket, sendMessage, disconnect, connect } = useWebSocketStore();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [timeLeft, setTimeLeft] = useState(930);
  const [code, setCode] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { user: string; message: string }[]
  >([]);
  const [newMessage, setNewMessage] = useState("");
  const [executionResult, setExecutionResult] =
    useState("실행 결과가 여기에 표시됩니다.");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isLocalStreamActive, setIsLocalStreamActive] = useState(true);
  const [showScreenSharePrompt, setShowScreenSharePrompt] = useState(false); // New state for screen share prompt
  const [isRemoteStreamActive, setIsRemoteStreamActive] = useState(true); // New state for remote stream active
  const [showRemoteScreenSharePrompt, setShowRemoteScreenSharePrompt] = useState(false); // New state for remote screen share prompt
  const [isLeavingGame, setIsLeavingGame] = useState(false); // New state to control cleanup
  const isConfirmedExitRef = useRef(false); // New ref to track explicit exit confirmation
  const [problem, setProblem] = useState<any>(null);
  const problemId = problem?.id ?? problem?.problem_id; // 게임 도중 문제 ID가 변경되지는 않으므로 굳이 useState는 안 씀.
  const [currentLanguage] = useState<ProgrammingLanguage>('python'); // 현재는 python 고정, 추후 변경 가능

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    setPeerConnection(pc); // 여기서 sharedPC를 업데이트

    pc.oniceconnectionstatechange = () => {
      console.log('BattlePage: ICE connection state changed:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        setShowScreenSharePrompt(true);
        setRemoteStream(null); // 상대방 스트림 제거
      } else if (pc.iceConnectionState === 'connected') {
        // Do not hide the screen share prompt here. It should only be hidden when the user explicitly starts sharing.
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        sendMessage(
          JSON.stringify({ type: 'webrtc_signal', signal: { type: 'candidate', candidate } })
        );
      }
    };
    pc.ontrack = ({ streams: [stream] }) => {
      console.log('BattlePage: Received remote stream:', stream);
      setRemoteStream(stream);
      setIsRemoteStreamActive(true);
      setShowRemoteScreenSharePrompt(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }

      const remoteVideoTrack = stream.getVideoTracks()[0];
      if (remoteVideoTrack) {
        remoteVideoTrack.onended = () => {
          console.log('BattlePage: Remote screen share track ended.');
          setIsRemoteStreamActive(false);
          setShowRemoteScreenSharePrompt(true);
        };
      }
    };
    return pc;
  }, [sendMessage]);

  const handleSignal = useCallback(async (signal: any) => {
    let pc = sharedPC; // sharedPC를 직접 사용
    if (!pc) {
      pc = createPeerConnection();
    }

    if (signal.type === 'offer') {
      if (pc.signalingState !== 'stable') {
        await Promise.all([
          pc.localDescription ? pc.setLocalDescription(pc.localDescription) : Promise.resolve(),
          pc.remoteDescription ? pc.setRemoteDescription(pc.remoteDescription) : Promise.resolve(),
        ]);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendMessage(JSON.stringify({ type: 'webrtc_signal', signal: pc.localDescription }));
    } else if (signal.type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else {
        console.warn('BattlePage: Received answer in unexpected signaling state:', pc.signalingState, 'Signal:', signal);
      }
    } else if (signal.type === 'candidate') {
      if (signal.candidate) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          console.error('BattlePage: Error adding ice candidate', err);
        }
      }
    } else if (signal.type === 'join') {
      // 상대방이 방에 들어왔음을 알리는 시그널. 여기서 offer를 생성하지 않음.
      // offer 생성은 handleRestartScreenShare 함수에서 담당.
    }
    setPeerConnection(pc);
  }, [createPeerConnection, sendMessage]);

  useEffect(() => {
    if (!websocket) return;

    websocket.onmessage = async (event) => {
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
        } else if (data.type === 'webrtc_signal' && data.sender !== user.user_id) {
          await handleSignal(data.signal);
        }
      } catch (e) {
        console.error('BattlePage: ws message parse error', e);
      }
    };
  }, [websocket, user, handleSignal]);

  // 화면 공유 스트림 정리 함수
  const cleanupScreenShare = useCallback(() => {
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      console.log('Local screen share stream stopped.');
    }
  }, []);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [confirmExitCallback, setConfirmExitCallback] = useState<(() => void) | null>(null);
  const [cancelExitCallback, setCancelExitCallback] = useState<(() => void) | null>(null);

  const { isNavigationBlocked } = usePreventNavigation({
    shouldPrevent: true, // BattlePage에서는 항상 이탈 방지
    onAttemptNavigation: (confirm, cancel) => {
      setIsExitModalOpen(true);
      setConfirmExitCallback(() => confirm);
      setCancelExitCallback(() => cancel);
    },
  });
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const editorHandlerRef = useRef<CodeEditorHandler>(new CodeEditorHandler('python'));

  // 언어 설정
  const languageConfig = getLanguageConfig(currentLanguage);

  

  useEffect(() => {
    console.log('BattlePage: sharedLocalStream', sharedLocalStream);
    console.log('BattlePage: sharedRemoteStream', sharedRemoteStream);
    console.log('BattlePage: sharedPC', sharedPC);

    if (sharedPC) {
      console.log('BattlePage: sharedPC signalingState', sharedPC.signalingState);
      console.log('BattlePage: sharedPC iceConnectionState', sharedPC.iceConnectionState);
    }

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
          setShowScreenSharePrompt(true); // Show prompt when local stream ends
          sendMessage(JSON.stringify({ type: 'screen_share_ended' })); // Notify opponent

          // 내 화면 공유가 중지되면 상대방 화면도 즉시 대기 상태로 변경
          if (sharedRemoteStream) {
            sharedRemoteStream.getTracks().forEach(track => track.stop());
            setRemoteStream(null);
          }
          setIsRemoteStreamActive(false);
          setShowRemoteScreenSharePrompt(true);
        };
      }
    } else {
      setIsLocalStreamActive(false);
      setShowScreenSharePrompt(true); // Show prompt if no local stream initially
    }

    if (sharedRemoteStream) {
      const remoteVideoTrack = sharedRemoteStream.getVideoTracks()[0];
      if (remoteVideoTrack) {
        remoteVideoTrack.onended = () => {
          setIsRemoteStreamActive(false);
          setShowRemoteScreenSharePrompt(true);
        };
      }
    } else {
      setIsRemoteStreamActive(false);
      setShowRemoteScreenSharePrompt(true);
    }
  }, [sharedLocalStream, sharedRemoteStream, sharedPC]);

   // 웹소켓 연결
  useEffect(() => {
    const storedWebsocketUrl = localStorage.getItem('websocketUrl');
    let wsUrl: string | null = null;

    if (storedWebsocketUrl) {
      wsUrl = storedWebsocketUrl;
      console.log('BattlePage: Using stored WebSocket URL from localStorage:', wsUrl);
    } else if (user?.user_id && gameId) {
      wsUrl = `ws://localhost:8000/api/v1/game/ws/game/${gameId}?user_id=${user.user_id}`;
      console.log('BattlePage: Constructing WebSocket URL from gameId and userId:', wsUrl);
    } else {
      console.log('BattlePage: Cannot connect WebSocket. Missing gameId, userId, or stored URL.', { gameId, userId: user?.user_id });
      return;
    }

    if (!websocket || websocket.readyState === WebSocket.CLOSED) {
      console.log('BattlePage: WebSocket not connected or closed. Attempting to connect.');
      connect(wsUrl);
    }

    if (websocket) {
      websocket.onmessage = (event) => {
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
          } else if (data.type === 'webrtc_signal' && data.sender !== user.user_id) {
            handleSignal(data.signal);
          } else if (data.type === 'match_accepted') {
            setProblem(data.problem);
          } else if (data.type === 'screen_share_ended' && data.sender !== user.user_id) {
            console.log('BattlePage: Opponent screen share ended. Stopping local screen share.');
            cleanupScreenShare();
            setShowScreenSharePrompt(true);
            setShowRemoteScreenSharePrompt(true);
          } else if (data.type === 'screen_share_restarted' && data.sender !== user.user_id) {
            console.log('BattlePage: Opponent screen share restarted.');
            setIsRemoteStreamActive(true);
            setShowRemoteScreenSharePrompt(false);
          }
        } catch (e) {
          console.error('BattlePage: ws message parse error', e);
        }
      };
    }
  }, [websocket, user, gameId, connect, handleSignal]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          cleanupScreenShare(); // 타이머 종료 시 화면 공유 중단
          navigate('/result');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      cleanupScreenShare(); // 컴포넌트 언마운트 시 화면 공유 중단
    };
  }, [navigate]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const msgObj = { type: "chat", message: newMessage };

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      sendMessage(JSON.stringify(msgObj));
      setChatMessages((prev) => [...prev, { user: '나', message: newMessage }]);
    }

    setNewMessage("");
  };

  const handleSurrender = useCallback(() => {
    console.log('handleSurrender called. isLeavingGame:', isLeavingGame);
    setIsLeavingGame(true); // 게임을 떠나는 중임을 표시

    // 항복 웹소켓 메시지 전송
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      const surrenderMessage = { type: 'surrender', message: 'User surrendered' };
      sendMessage(JSON.stringify(surrenderMessage));
      console.log('Surrender message sent.');
      disconnect(); // 웹소켓 명시적 종료
    }

    // WebRTC 관련 리소스 정리
    if (sharedPC) {
      sharedPC.close();
      setPeerConnection(null);
    }
    cleanupScreenShare(); // 화면 공유 중단 함수 호출
    if (sharedRemoteStream) {
      sharedRemoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }

    // 결과 페이지로 이동
    navigate('/result');
  }, [navigate]);

  const handleConfirmExit = useCallback(() => {
    console.log('handleConfirmExit called.');
    isConfirmedExitRef.current = true; // 명시적 종료 확정
    setIsExitModalOpen(false);
    if (confirmExitCallback) {
      handleSurrender(); // 항복 처리
      confirmExitCallback();
    }
  }, [confirmExitCallback, handleSurrender]);

  const handleCancelExit = useCallback(() => {
    console.log('handleCancelExit called.');
    setIsExitModalOpen(false);
    if (cancelExitCallback) {
      cancelExitCallback();
    }
  }, [cancelExitCallback]);

  const handleReport = () => {
    alert("신고가 접수되었습니다.");
  };

  const handleRestartScreenShare = async () => {
    try {
      // 기존 스트림이 있다면 중지
      if (sharedLocalStream) {
        sharedLocalStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
      }

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = mediaStream;
      }

      setLocalStream(mediaStream);

      let pc = sharedPC;
      if (!pc) {
        pc = createPeerConnection();
      }

      // 기존 트랙 제거 및 새 트랙 추가
      pc.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          pc.removeTrack(sender);
        }
      });
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

      // Offer 생성 및 전송
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMessage(
        JSON.stringify({ type: 'webrtc_signal', signal: pc.localDescription })
      );

      const videoTrack = mediaStream.getVideoTracks()[0];
      videoTrack.onended = () => {
        setIsLocalStreamActive(false);
        setShowScreenSharePrompt(true);
      };

      setIsLocalStreamActive(true);
      setShowScreenSharePrompt(false); // 화면 공유 시작 시 프롬프트 숨김
      sendMessage(JSON.stringify({ type: 'screen_share_restarted' })); // Notify opponent that screen share has restarted
    } catch (error) {
      console.error('Error restarting screen share:', error);
      setShowScreenSharePrompt(true); // 에러 발생 시 프롬프트 다시 표시
    }
  };

  const timeColor =
    timeLeft <= 60
      ? "text-red-400"
      : timeLeft <= 180
        ? "text-yellow-400"
        : "text-cyber-blue";

  const handleRun = async () => {
    setExecutionResult("코드를 실행하고 있습니다...");
    setRunStatus(null);

    try {
      const matchId = localStorage.getItem('currentMatchId');
      const response = await authFetch(
        "http://localhost:8000/api/v1/game/submit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            language: "python",
            code,
            problem_id: `${problemId}`,
            match_id: matchId,
          }),
        },
      );

      if (!response.ok || !response.body) {
        const text = await response.text();
        setExecutionResult(`실행 실패: ${text}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\r\n\r\n");
        buffer = parts.pop() || "";
        for (const chunk of parts) {
          const line = chunk.trim();
          if (line.startsWith("data:")) {
            const data = JSON.parse(line.slice(5));
            if (data.type === "progress") {
              setExecutionResult(
                (prev) =>
                  `${prev}\n[${data.index + 1}/${data.total}] stdout: ${data.result.stdout}`,
              );
            } else if (data.type === "final") {
              setExecutionResult(
                (prev) =>
                  `${prev}\n채점 완료. All Passed: ${data.allPassed ? "Yes" : "No"}`,
              );
              setRunStatus(data.allPassed ? "성공" : "실패");
            }
          }
        }
      }
    } catch (error) {
      setExecutionResult("실행 중 오류가 발생했습니다.");
    }
  };

  const handleSubmit = () => {
    cleanupScreenShare(); // 코드 제출 시 화면 공유 중단
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

  // 코드 에디터 키 핸들링 함수 - 언어별 핸들러 사용
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    
    if (e.key === 'Tab') {
      e.preventDefault();
      editorHandlerRef.current.handleTabKey(textarea, e.shiftKey);
      setCode(textarea.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      editorHandlerRef.current.handleEnterKey(textarea);
      setCode(textarea.value);
    }
  };

  useEffect(() => {
    const gameId = searchParams.get('gameId');
    console.log("BattlePage: Searching for problem with gameId:", gameId);
    if (gameId) {
      const storedProblem = localStorage.getItem(`problem_${gameId}`);
      console.log("BattlePage: Fetched problem from localStorage:", storedProblem);
      if (storedProblem) {
        try {
          const parsedProblem = JSON.parse(storedProblem);
          console.log("BattlePage: Parsed problem:", parsedProblem);
          setProblem(parsedProblem);
        } catch (error) {
          console.error("BattlePage: Error parsing problem from localStorage:", error);
        }
      } else {
        console.log("BattlePage: No problem found in localStorage for this gameId.");
      }
    }
  }, [searchParams]);

  // 동적으로 줄 번호 생성
  const actualLineCount = code ? code.split("\n").length : 1;
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
              <span
                className={`text-2xl font-bold font-mono ${timeColor} ${timeLeft <= 60 ? "animate-pulse" : ""}`}
              >
                {formatTime(timeLeft)}
              </span>
            </div>

            {/* 우측 - 항복, 신고 */}
            <div className="flex items-center space-x-3">
              <CyberButton
                onClick={handleSurrender}
                size="sm"
                variant="secondary"
              >
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
              <div className="flex-1 mb-2">
                <CyberCard className="h-[calc(100vh-24em)] p-4 mr-2 max-h-[860px]">
                  <ScrollArea className="h-full">
                    {problem ? (
                      <div className="space-y-4 pr-4">
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col">
                            <h1 className="text-xl font-bold neon-text">{problem.title}</h1>
                            {problemId && (
                                <span className="text-[9px] text-gray-400 mt-1">ID: {problemId}</span>
                            )}
                          </div>
                          <CyberButton onClick={toggleHint} size="sm" variant="secondary">
                            <HelpCircle className="mr-1 h-4 w-4" />
                            힌트
                          </CyberButton>
                        </div>

                        {showHint && problem.category && (
                          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                            <h3 className="text-yellow-400 font-semibold mb-2">알고리즘 분류</h3>
                            <div className="flex flex-wrap gap-2">
                              {problem.category.map((tag, index) => (
                                <span key={index} className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-sm">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                      <div>
                        <p className="text-gray-300 leading-relaxed">{problem.description}</p>
                      </div>

                      {problem.description && (
                        <div>
                          <h3 className="text-lg font-semibold text-cyber-blue mb-2">제한 사항</h3>
                          <ul className="text-gray-300 space-y-1">
                            <li>• {problem.description}</li>
                          </ul>
                        </div>
                      )}

                      {problem.examples && (
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
                      )}

                      {problem.testCase && (
                        <div>
                          <h3 className="text-lg font-semibold text-cyber-blue mb-2">입출력 예 설명</h3>
                          <h4 className="text-yellow-400 font-medium mb-1">입출력 예 #1</h4>
                          <p className="text-gray-300 text-sm">{problem.testCase.description}</p>
                        </div>
                      )}
                    </div>
                    ) : (
                      <div className="text-center text-gray-400">문제 로딩 중...</div>
                    )}
                  </ScrollArea>
                </CyberCard>
              </div>

              {/* 좌측 하단 - 채팅 & 화면공유 (고정 높이) */}
              <div className="h-1/3 min-h-[16em] flex gap-2 mr-2">
                {/* 채팅 */}
                <div className="flex-1 min-w-0">
                  <CyberCard className="p-3 flex flex-col h-full">
                    <h3 className="text-sm font-semibold text-cyber-blue mb-2">
                      채팅
                    </h3>
                    <ScrollArea className="flex-1 mb-2">
                      <div className="space-y-2 pr-3">
                        {chatMessages.map((msg, index) => (
                          <div key={index} className="text-xs">
                            <div className="text-gray-400">
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
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) =>
                          e.key === "Enter" && handleSendMessage()
                        }
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
                  {showScreenSharePrompt && (
                    <div className="flex justify-center mt-4">
                      <CyberButton onClick={handleRestartScreenShare} className="bg-blue-500 hover:bg-blue-600" size="sm">
                        내 화면 공유 재시작
                      </CyberButton>
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
                  <div className="text-xs text-gray-400">{languageConfig.name} Code Editor</div>
                  </div>

                  {/* 코드 에디터 영역 */}
                  <div className="flex-1 overflow-hidden">
                    <div className="h-full flex bg-black/30">
                      {/* 줄 번호 */}
                      <div
                        ref={lineNumbersRef}
                        className="flex-shrink-0 w-12 bg-black/20 border-r border-gray-700 overflow-hidden"
                        style={{
                          scrollbarWidth: "none",
                          msOverflowStyle: "none",
                        }}
                      >
                        <div className="text-xs text-gray-500 leading-5 text-right py-3 px-2">
                          {Array.from({ length: displayLineCount }, (_, i) => (
                            <div key={i} className="h-5">
                              {i + 1}
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-hidden relative">
                        <textarea
                          ref={textareaRef}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          onScroll={handleScroll}
                          onKeyDown={handleKeyDown}
                          placeholder={languageConfig.placeholder}
                          className="w-full h-full bg-transparent px-3 py-3 text-green-400 font-mono resize-none focus:outline-none text-sm leading-5 border-none"
                          style={{ 
                            fontFamily: languageConfig.fontFamily,
                            tabSize: languageConfig.indentSize
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
                          className={`ml-2 text-xs ${runStatus === "성공" ? "text-green-400" : "text-red-400"}`}
                        >
                          {runStatus}
                        </span>
                      )}
                    </h3>
                    <div className="flex space-x-1">
                      <CyberButton
                        onClick={handleRun}
                        size="sm"
                        variant="secondary"
                        className="px-6"
                      >
                        <Play className="mr-1 h-3 w-3" />
                        실행
                      </CyberButton>
                      <CyberButton
                        onClick={handleSubmit}
                        size="sm"
                        className="px-6"
                      >
                        제출
                      </CyberButton>
                    </div>
                  </div>

                  <div
                    className="flex-1 p-2"
                    style={{ height: "calc(100% - 40px)" }}
                  >
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

      <GameExitModal
        isOpen={isExitModalOpen}
        onConfirmExit={handleConfirmExit}
        onCancelExit={handleCancelExit}
      />
    </div>
  );
};

export default BattlePage;