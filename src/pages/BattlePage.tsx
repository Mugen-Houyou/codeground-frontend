import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import { BattleHeader, ProblemSection, ChatAndVideoSection, CodeEditorSection } from '@/components/battle';
import { localStream as sharedLocalStream, remoteStream as sharedRemoteStream, setLocalStream, peerConnection as sharedPC, setPeerConnection, setRemoteStream } from '@/utils/webrtcStore';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ProgrammingLanguage } from '@/types/codeEditor';
import { getLanguageConfig } from '@/utils/languageConfig';
import { CodeEditorHandler } from '@/utils/codeEditorHandlers';
import usePreventNavigation from '@/hooks/usePreventNavigation';
import GameExitModal from '@/components/GameExitModal';
import SubmitConfirmModal from '@/components/SubmitConfirmModal';
import useWebSocketStore from '@/stores/websocketStore';
import { authFetch } from '@/utils/api';
import useCheatDetection, { ReportPayload } from '@/hooks/useCheatDetection';
import ReportModal from '@/components/ReportModal';
import { OpponentLeftModal } from '@/components/OpponentLeftModal';
import { OpponentSurrenderModal } from '@/components/OpponentSurrenderModal';
import { ScreenShareRequiredModal } from '@/components/ScreenShareRequiredModal';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/vs2015.css';

const apiUrl = import.meta.env.VITE_API_URL;
const wsUrl = apiUrl.replace(/^http/, 'ws');

hljs.registerLanguage('python', python);

const BattlePage = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get('gameId');
  const { websocket, sendMessage, disconnect, connect } = useWebSocketStore();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [timeLeft, setTimeLeft] = useState(930);
  const [code, setCode] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { user: string; message: string; type: 'chat' | 'system' }[]
  >([]);
  const [newMessage, setNewMessage] = useState("");
  const [executionResult, setExecutionResult] =
    useState("실행 결과가 여기에 표시됩니다.");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isLocalStreamActive, setIsLocalStreamActive] = useState(true);
  const [showLocalScreenSharePrompt, setShowLocalScreenSharePrompt] = useState(false);
  const [showScreenSharePrompt, setShowScreenSharePrompt] = useState(false);
  const [isRemoteStreamActive, setIsRemoteStreamActive] = useState(true);
  const [showRemoteScreenSharePrompt, setShowRemoteScreenSharePrompt] = useState(false);
  const [isLeavingGame, setIsLeavingGame] = useState(false);
  const [showOpponentLeftModal, setShowOpponentLeftModal] = useState(false);
  const [showSurrenderModal, setShowSurrenderModal] = useState(false);
  const [showScreenShareRequiredModal, setShowScreenShareRequiredModal] = useState(false);
  const [screenShareCountdown, setScreenShareCountdown] = useState(0);
  const screenShareCountdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [isGamePaused, setIsGamePaused] = useState(false); // 게임 일시 정지 상태 추가
  const [isCheatDetectionActive, setIsCheatDetectionActive] = useState(true);
  const [isSolvingAlone, setIsSolvingAlone] = useState(false);
  const isConfirmedExitRef = useRef(false);
  const [problem, setProblem] = useState<any>(null);
  const problemId = problem?.id ?? problem?.problem_id;
  const [currentLanguage] = useState<ProgrammingLanguage>('python');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const { reportCheating } = useCheatDetection({
    gameId,
    remoteVideoRef,
    containerRef,
    isActive: isCheatDetectionActive,
  });

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    setPeerConnection(pc);

    pc.oniceconnectionstatechange = () => {
      if (isGameFinished) return;
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        setShowScreenSharePrompt(true);
        setRemoteStream(null);
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
      setRemoteStream(stream);
      setIsRemoteStreamActive(true);
      setShowRemoteScreenSharePrompt(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }

      const remoteVideoTrack = stream.getVideoTracks()[0];
      if (remoteVideoTrack) {
        remoteVideoTrack.onended = () => {
          if (isGameFinished) return;
          setIsRemoteStreamActive(false);
          setShowRemoteScreenSharePrompt(true);
          sendMessage(JSON.stringify({ type: 'screen_share_stopped' }));
        };
      }
    };
    return pc;
  }, [sendMessage]);

  const handleSignal = useCallback(async (signal: any) => {
    let pc = sharedPC;
    if (!pc) {
      pc = createPeerConnection();
    }

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendMessage(JSON.stringify({ type: 'webrtc_signal', signal: pc.localDescription }));
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.type === 'candidate' && signal.candidate) {
      await pc.addIceCandidate(signal.candidate);
    } else if (signal.type === 'join') {
      if (sharedLocalStream) {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'video') {
            pc.removeTrack(sender);
          }
        });
        sharedLocalStream.getTracks().forEach((track) => {
          pc.addTrack(track, sharedLocalStream);
        });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendMessage(
          JSON.stringify({ type: 'webrtc_signal', signal: pc.localDescription })
        );
      }
    }
    setPeerConnection(pc);
  }, [createPeerConnection, sendMessage]);

  useEffect(() => {
    if (!websocket) return;

    websocket.onopen = () => {
      console.log('BattlePage WebSocket connected');
      sendMessage(
        JSON.stringify({ type: 'webrtc_signal', signal: { type: 'join' } })
      );
    };

    websocket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chat' && data.sender !== user.user_id) {
          setChatMessages((prev) => [
            ...prev,
            {
              user: '상대',
              message: data.message,
              type: 'chat',
            },
          ]);
        } else if (data.type === 'webrtc_signal' && data.sender !== user.user_id) {
          await handleSignal(data.signal);
        } else if (data.type === 'system_warning') {
          const isMe = data.user_id === user.user_id;
          const subject = isMe ? '나' : '상대방';
          const eventText = data.event === 'tab_hidden' ? '화면을 벗어났습니다' : '마우스가 화면 밖으로 나갔습니다';
          const message = `경고: ${subject}${isMe ? '가' : '이'} ${eventText}. (경고 ${data.count}/5)`;

          setChatMessages((prev) => [
            ...prev,
            {
              user: '시스템',
              message: message,
              type: 'system',
            },
          ]);
        } else if (data.type === 'match_result') {
          console.log('BattlePage: Match result received:', data);
          try {
            localStorage.setItem('matchResult', JSON.stringify(data));
            if (data.reason === 'surrender' && data.winner === user.user_id) {
              setIsGameFinished(true);
              setShowSurrenderModal(true);
            } else {
              navigate('/result', { state: { matchResult: data } });
            }
          } catch (e) {
            console.error('BattlePage: Failed to save match result or navigate:', e);
          }
        } else if (data.type === 'game_over') {
          navigate('/result');
        } else if (data.type === 'opponent_left') {
          setIsGameFinished(true);
          setShowOpponentLeftModal(true);
          setChatMessages((prev) => [
            ...prev,
            {
              user: '시스템',
              message: '상대방이 게임을 떠났습니다.',
              type: 'system',
            },
          ]);
        } else if (data.type === 'opponent_rejoined') {
          setShowOpponentLeftModal(false);
          setIsRemoteStreamActive(false);
          setShowRemoteScreenSharePrompt(true);
          setIsGamePaused(true);
          setChatMessages((prev) => [
            ...prev,
            {
              user: '시스템',
              message: '상대방이 다시 연결되었습니다.',
              type: 'system',
            },
          ]);
        } else if (data.type === 'screen_share_stopped') {
          console.log("Received screen_share_stopped message:", data);
          const isMe = data.user_id === user.user_id;
          console.log("isMe:", isMe, "data.user_id:", data.user_id, "user.user_id:", user.user_id);
          setChatMessages((prev) => [
            ...prev,
            {
              user: '시스템',
              message: isMe ? '내 화면 공유가 중지되었습니다.' : '상대방 화면 공유가 중지되었습니다.',
              type: 'system',
            },
          ]);
          if (!isMe) {
            setIsRemoteStreamActive(false);
            setShowRemoteScreenSharePrompt(true);
            setIsGamePaused(true); // 상대방 화면 공유 중단 시 게임 일시 정지
          } else {
            // 자신이 화면 공유를 중지한 경우
            console.log("Setting showScreenShareRequiredModal to true.");
            setShowScreenShareRequiredModal(true);
            setScreenShareCountdown(60); // 1분 (60초) 카운트다운 시작
            if (screenShareCountdownIntervalRef.current) {
              clearInterval(screenShareCountdownIntervalRef.current);
            }
            screenShareCountdownIntervalRef.current = setInterval(() => {
              setScreenShareCountdown((prev) => {
                if (prev <= 1) {
                  clearInterval(screenShareCountdownIntervalRef.current!); // 카운트다운 종료
                  // 1분 안에 화면 공유를 다시 시작하지 않으면 항복 처리
                  sendMessage(JSON.stringify({ type: "match_result", reason: "surrender" }));
                  navigate('/result'); // 결과 페이지로 이동
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            setIsGamePaused(true); // 자신의 화면 공유 중단 시 게임 일시 정지
          }
        } else if (data.type === 'screen_share_started') {
          console.log("Received screen_share_started message:", data);
          const isMe = data.user_id === user.user_id;
          setChatMessages((prev) => [
            ...prev,
            {
              user: '시스템',
              message: isMe ? '내 화면 공유가 재개되었습니다.' : '상대방 화면 공유가 재개되었습니다.',
              type: 'system',
            },
          ]);
          if (!isMe) {
            setIsRemoteStreamActive(true);
            setShowRemoteScreenSharePrompt(false);
            if (isLocalStreamActive) {
              setIsGamePaused(false); // 두 사용자가 모두 공유 중일 때만 게임 재개
            }
          } else {
            // 자신이 화면 공유를 재개한 경우 (서버로부터의 확인 메시지)
            if (screenShareCountdownIntervalRef.current) {
              clearInterval(screenShareCountdownIntervalRef.current);
            }
            setShowScreenShareRequiredModal(false);
            if (isRemoteStreamActive) {
              setIsGamePaused(false); // 두 사용자가 모두 공유 중일 때만 게임 재개
            }
          }
        }
      } catch (e) {
        console.error('BattlePage: ws message parse error', e);
      }
    };
  }, [websocket, user, handleSignal]);

  const cleanupScreenShare = useCallback(() => {
    const { websocket } = useWebSocketStore.getState(); // 최신 websocket 인스턴스를 직접 가져옴
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      setIsLocalStreamActive(false);
      setShowLocalScreenSharePrompt(true);
      sendMessage(JSON.stringify({ type: 'screen_share_stopped' }));
    }
  }, [sendMessage]);

  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [confirmExitCallback, setConfirmExitCallback] = useState<(() => void) | null>(null);
  const [cancelExitCallback, setCancelExitCallback] = useState<(() => void) | null>(null);

  usePreventNavigation({
    shouldPrevent: true,
    onAttemptNavigation: (confirm, cancel) => {
      setIsExitModalOpen(true);
      setConfirmExitCallback(() => confirm);
      setCancelExitCallback(() => cancel);
    },
  });
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const editorHandlerRef = useRef<CodeEditorHandler>(new CodeEditorHandler('python'));
  const languageConfig = getLanguageConfig(currentLanguage);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.innerHTML = hljs.highlight(code, { language: 'python' }).value + (code.endsWith('\n') ? '\n' : '');
      if (textareaRef.current) {
        highlightRef.current.style.transform = `translateY(-${textareaRef.current.scrollTop}px)`;
      }
    }
  }, [code]);

  useEffect(() => {
    if (localVideoRef.current && sharedLocalStream) {
      localVideoRef.current.srcObject = sharedLocalStream;
    }
    if (remoteVideoRef.current && sharedRemoteStream) {
      remoteVideoRef.current.srcObject = sharedRemoteStream;
    }
  }, [sharedLocalStream, sharedRemoteStream]);

  useEffect(() => {
    if (sharedLocalStream) {
      const videoTrack = sharedLocalStream.getVideoTracks()[0];
      if (videoTrack) {
        const handleEnded = () => {
          cleanupScreenShare();
        };
        videoTrack.onended = handleEnded;
        return () => {
          videoTrack.onended = null;
        };
      }
    }
  }, [sharedLocalStream, cleanupScreenShare]);

  useEffect(() => {
    const storedWebsocketUrl = localStorage.getItem('websocketUrl');
    let wsUrl: string | null = null;

    if (storedWebsocketUrl) {
      wsUrl = storedWebsocketUrl;
      console.log('BattlePage: Using stored WebSocket URL from localStorage:', wsUrl);
    } else if (user?.user_id && gameId) {
      wsUrl = `${wsUrl}/api/v1/game/ws/game/${gameId}?user_id=${user.user_id}`;
      console.log('BattlePage: Constructing WebSocket URL from gameId and userId:', wsUrl);
    } else {
      console.log('BattlePage: Cannot connect WebSocket. Missing gameId, userId, or stored URL.', { gameId, userId: user?.user_id });
      return;
    }

    if (!websocket || websocket.readyState === WebSocket.CLOSED) {
      console.log('BattlePage: WebSocket not connected or closed. Attempting to connect.');
      connect(wsUrl);
    }
  }, [websocket, user, gameId, connect]);

  // If the page was refreshed and the local stream is lost, prompt the user to
  // restart screen sharing.
  useEffect(() => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    if (!sharedLocalStream && !showScreenShareRequiredModal && !isGameFinished) {
      setShowScreenShareRequiredModal(true);
      setScreenShareCountdown(60);
      if (screenShareCountdownIntervalRef.current) {
        clearInterval(screenShareCountdownIntervalRef.current);
      }
      screenShareCountdownIntervalRef.current = setInterval(() => {
        setScreenShareCountdown(prev => {
          if (prev <= 1) {
            clearInterval(screenShareCountdownIntervalRef.current!);
            sendMessage(JSON.stringify({ type: 'match_result', reason: 'surrender' }));
            navigate('/result');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setIsGamePaused(true);
    }
  }, [websocket, showScreenShareRequiredModal, isGameFinished, sendMessage, navigate]);


  useEffect(() => {
    if (isGamePaused || isGameFinished) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          sendMessage(JSON.stringify({ type: "match_result", reason: "timeout" }));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [sendMessage, isGamePaused, isGameFinished]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const msgObj = { type: "chat", message: newMessage };
    sendMessage(JSON.stringify(msgObj));
    setChatMessages((prev) => [...prev, { user: '나', message: newMessage, type: 'chat' }]);
    setNewMessage("");
  };

  const handleReportClick = () => {
    setIsReportModalOpen(true);
  };

  const handleReportSubmit = (payload: ReportPayload) => {
    reportCheating(payload);
    setIsReportModalOpen(false);
  };

  const handleSurrenderButtonClick = useCallback(() => {
    setIsExitModalOpen(true);
    setConfirmExitCallback(() => () => {
      cleanupScreenShare();
      sendMessage(JSON.stringify({ type: "match_result", reason: "surrender" }));
    });
    setCancelExitCallback(() => () => {
      setIsExitModalOpen(false);
    });
  }, [sendMessage, cleanupScreenShare]);

  const handleConfirmExit = useCallback(() => {
    isConfirmedExitRef.current = true;
    setIsExitModalOpen(false);
    if (confirmExitCallback) {
      confirmExitCallback();
    }
  }, [confirmExitCallback]);

  const handleCancelExit = useCallback(() => {
    setIsExitModalOpen(false);
    if (cancelExitCallback) {
      cancelExitCallback();
    }
  }, [cancelExitCallback]);

  const startLocalScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      setLocalStream(stream);
      setIsLocalStreamActive(true);
      setShowLocalScreenSharePrompt(false);
      setShowScreenShareRequiredModal(false); // 화면 공유 재시작 성공 시 모달 닫기
      if (screenShareCountdownIntervalRef.current) {
        clearInterval(screenShareCountdownIntervalRef.current);
      }
      if (isRemoteStreamActive) {
        setIsGamePaused(false); // 두 사용자가 모두 공유 중일 때만 게임 재개
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      let pc = sharedPC;
      if (!pc) {
        pc = createPeerConnection();
      }

      // 기존 트랙 제거
      pc.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          pc.removeTrack(sender);
        }
      });

      // 새 트랙 추가
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMessage(JSON.stringify({ type: 'webrtc_signal', signal: pc.localDescription }));
      sendMessage(JSON.stringify({ type: 'screen_share_started' })); // 화면 공유 재시작 메시지 전송

      stream.getVideoTracks()[0].onended = () => {
        cleanupScreenShare();
      };
    } catch (error) {
      console.error("Error starting screen share:", error);
      setShowLocalScreenSharePrompt(true);
    }
  }, [createPeerConnection, sendMessage, cleanupScreenShare, isRemoteStreamActive]);

  const handleRun = async () => {
    setExecutionResult("코드를 실행하고 있습니다...");
    setRunStatus(null);

    try {
      const matchId = localStorage.getItem('currentMatchId');
      const response = await authFetch(
        `${apiUrl}/api/v1/game/submit`,
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
                  `${prev}\n[${data.index + 1}/${data.total}] duration: ${Number(data.result.duration).toFixed(2)} ms, memoryUsed: ${data.result.memoryUsed} KB, status: ${data.result.status}`,
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
    if (runStatus === '성공') {
      cleanupScreenShare(); // 코드 제출 시 화면 공유 중단
      navigate('/result');
    } else {
      setIsSubmitModalOpen(true);
    }
  };

  const handleConfirmSubmit = () => {
    setIsSubmitModalOpen(false);
    cleanupScreenShare();
    navigate('/result');
  };

      
  const handleCancelSubmit = () => {
    setIsSubmitModalOpen(false);
  };
          
  const handleContinueAlone = () => {
    setIsCheatDetectionActive(false); // 부정행위 감지 끄기
    setIsGamePaused(false); // 게임 일시정지 해제
    setShowScreenShareRequiredModal(false); // 화면공유 요구 모달 끄기
    if (screenShareCountdownIntervalRef.current) {
      clearInterval(screenShareCountdownIntervalRef.current);
    }

    // 내 화면 공유 중지
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setIsLocalStreamActive(false);

    // 상대 화면 공유 중지
    if (sharedRemoteStream) {
      sharedRemoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsRemoteStreamActive(false);

    // 모든 화면 공유 관련 프롬프트 숨기기
    setShowLocalScreenSharePrompt(false);
    setShowRemoteScreenSharePrompt(false);
    setShowScreenSharePrompt(false);

    // WebRTC 연결 종료
    if (sharedPC) {
      sharedPC.close();
      setPeerConnection(null);
    }

    setIsSolvingAlone(true); // 혼자 풀기 모드 활성화
  }

  const handleStay = () => {
    setShowOpponentLeftModal(false);
    handleContinueAlone();
  };

  const handleSurrenderStay = () => {
    setShowSurrenderModal(false);
    handleContinueAlone();
  };

  const handleSurrenderLeave = () => {
    const stored = localStorage.getItem('matchResult');
    if (stored) {
      navigate('/result', { state: { matchResult: JSON.parse(stored) } });
    } else {
      navigate('/result');
    }
  };


  const handleLeave = () => {
    cleanupScreenShare();
    setShowOpponentLeftModal(false);
    navigate('/waiting-room');
  };

  const toggleHint = () => {
    setShowHint(!showHint);
  };

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.style.transform = `translateY(-${textareaRef.current.scrollTop}px)`;
    }
  };

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
    if (gameId) {
      const storedProblem = localStorage.getItem(`problem_${gameId}`);
      if (storedProblem) {
        try {
          const parsedProblem = JSON.parse(storedProblem);
          setProblem(parsedProblem);
        } catch (error) {
          console.error("Error parsing problem from localStorage:", error);
        }
      }
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (screenShareCountdownIntervalRef.current) {
        clearInterval(screenShareCountdownIntervalRef.current);
      }
    };
  }, []);

  const actualLineCount = code ? code.split("\n").length : 1;
  const displayLineCount = Math.max(actualLineCount, 20);

  return (
    <div ref={containerRef} className="min-h-screen cyber-grid bg-cyber-darker">

      <BattleHeader
        timeLeft={timeLeft}
        isSolvingAlone={isSolvingAlone}
        isLocalStreamActive={isLocalStreamActive}
        isRemoteStreamActive={isRemoteStreamActive}
        onSurrender={handleSurrenderButtonClick}
        onReport={handleReportClick}
        onLeave={handleSurrenderLeave}
        onStartScreenShare={startLocalScreenShare}
      />

      <main className="h-[calc(100vh-80px)] p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={40} minSize={30}>
            <div className="h-full flex flex-col">
              <ProblemSection problem={problem} showHint={showHint} toggleHint={toggleHint} />
              <ChatAndVideoSection
                chatMessages={chatMessages}
                newMessage={newMessage}
                onMessageChange={setNewMessage}
                onSend={handleSendMessage}
                chatEndRef={chatEndRef}
                remoteVideoRef={remoteVideoRef}
                isRemoteStreamActive={isRemoteStreamActive}
                showRemoteScreenSharePrompt={showRemoteScreenSharePrompt}
                sharedRemoteStream={sharedRemoteStream}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={60} minSize={40}>
            <CodeEditorSection
              languageConfig={languageConfig}
              code={code}
              onCodeChange={setCode}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              lineNumbersRef={lineNumbersRef}
              textareaRef={textareaRef}
              highlightRef={highlightRef}
              displayLineCount={displayLineCount}
              isGamePaused={isGamePaused}
              onRun={handleRun}
              onSubmit={handleSubmit}
              executionResult={executionResult}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <GameExitModal
        isOpen={isExitModalOpen}
        onConfirmExit={handleConfirmExit}
        onCancelExit={handleCancelExit}
      />
      <SubmitConfirmModal
        isOpen={isSubmitModalOpen}
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleReportSubmit}
      />
      <OpponentLeftModal
        isOpen={showOpponentLeftModal}
        onStay={handleStay}
        onLeave={handleLeave}
      />
      <OpponentSurrenderModal
        isOpen={showSurrenderModal}
        onStay={handleSurrenderStay}
        onLeave={handleSurrenderLeave}
      />
      <ScreenShareRequiredModal
        isOpen={showScreenShareRequiredModal}
        countdown={screenShareCountdown}
        onRestartScreenShare={startLocalScreenShare}
      />
    </div>
  );
};

export default BattlePage;