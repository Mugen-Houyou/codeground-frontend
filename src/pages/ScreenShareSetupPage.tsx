import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import { Monitor, User, Clock, AlertTriangle, Check } from 'lucide-react';
import { getAbsoluteUrl } from "@/lib/utils";
import { useUser } from '@/context/UserContext';
import { localStream as sharedLocalStream, remoteStream as sharedRemoteStream, 
    setLocalStream, setRemoteStream, setPeerConnection, peerConnection as sharedPC } from '@/utils/webrtcStore';
import useWebSocketStore from '@/stores/websocketStore';
import { useToast } from "@/components/ui/use-toast";

const apiUrl = import.meta.env.VITE_API_URL;
const wsUrl = apiUrl.replace(/^http/, 'ws');

const ScreenShareSetupPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get("gameId");
  const matchType = searchParams.get("matchType");
  /**
   * 아래 skipScreenShare 변수는 디버그 모드에서 화면 공유를 건너뛰기 위한 설정임.
   * 이를 실제로 사용하려면 웹 브라우저의 개발자 콘솔에서 아래와 같이 입력:
   *   localStorage.setItem('debug_skip_screen_share', 'true');
   */
  const skipScreenShare = 
    searchParams.get('debugSkip') === '1' ||
    localStorage.getItem('debug_skip_screen_share') === 'true';

  useEffect(() => {
    if (skipScreenShare) {
      if (gameId) {
        navigate(`/battle?gameId=${gameId}&matchType=${matchType}`);
      } else {
        navigate('/battle');
      }
    }
  }, [skipScreenShare, gameId, navigate, matchType]);  // skipScreenShare가 true인 경우, 화면 공유 설정 페이지를 건너뛰고 바로 전투 페이지로 이동
  const { user } = useUser();
  const { websocket, connect, disconnect, sendMessage } = useWebSocketStore();
  const { toast } = useToast();

  const handleCleanup = useCallback(() => {
    if (sharedPC) {
      sharedPC.close();
      setPeerConnection(null);
      console.log('ScreenShareSetupPage: Closed PeerConnection during navigation cleanup.');
    }
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      console.log('ScreenShareSetupPage: Stopped local stream during navigation cleanup.');
    }
    if (sharedRemoteStream) {
      sharedRemoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
      console.log('ScreenShareSetupPage: Stopped remote stream during navigation cleanup.');
    }
    // Also disconnect websocket if it's a rank match and we are navigating away
    if (websocket && websocket.readyState === WebSocket.OPEN && matchType === 'rank') {
      disconnect();
      console.log('ScreenShareSetupPage: Disconnected WebSocket during navigation cleanup for rank match.');
    }
  }, [websocket, disconnect, matchType]);

  const handlePeerConnectionStateChange = useCallback((pc: RTCPeerConnection) => {
    console.log('ScreenShareSetupPage: sharedPC connectionState changed:', pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      setOpponentScreenShareStatus('disconnected');
      setShowMyScreenShareRestartButton(true);
      setIsWebRTCConnected(false); // WebRTC 연결 상태 업데이트
      setRemoteStream(null); // 상대방 스트림 제거
      setRemoteStreamState(null); // 상대방 스트림 상태 제거

      if (matchType === 'custom') {
        disconnect(); // 웹소켓 연결 끊기
        navigate('/home'); // 홈으로 이동
        toast({
          title: "상대방 연결 끊김",
          description: "상대방이 연결을 끊었습니다. 홈으로 이동합니다.",
          variant: "destructive",
        });
      }
    } else if (pc.connectionState === 'connected') {
      setOpponentScreenShareStatus('connected');
      setShowMyScreenShareRestartButton(false);
      setIsWebRTCConnected(true); // WebRTC 연결 상태 업데이트
    }
  }, [matchType, disconnect, navigate, toast]);

  // effectiveGameId와 userId를 컴포넌트 최상위 레벨에서 정의
  const currentUrlGameId = searchParams.get('gameId');
  const storedGameId = sessionStorage.getItem('currentGameId');
  const effectiveGameId = currentUrlGameId || storedGameId;
  const userId = user?.user_id;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [remoteStreamState, setRemoteStreamState] =
    useState<MediaStream | null>(null);
  const [myShareStatus, setMyShareStatus] = useState<
    "waiting" | "sharing" | "invalid" | "valid"
  >("waiting");
  const [opponentReady, setOpponentReady] = useState(false);
  const [myReady, setMyReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  const [opponentScreenShareStatus, setOpponentScreenShareStatus] = useState<'waiting' | 'connected' | 'disconnected'>('waiting');
  const [showMyScreenShareRestartButton, setShowMyScreenShareRestartButton] = useState(false);
  const [opponentNickname, setOpponentNickname] = useState<string | null>(null);
  const [opponentProfileImageUrl, setOpponentProfileImageUrl] = useState<string | null>(null);

  useEffect(() => {
    // 기존 WebRTC 연결 및 스트림 정리
    if (sharedPC) {
      sharedPC.close();
      setPeerConnection(null);
      console.log('ScreenShareSetupPage: Closed existing PeerConnection.');
    }
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      console.log('ScreenShareSetupPage: Stopped existing local stream.');
    }
    if (sharedRemoteStream) {
      sharedRemoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
      console.log('ScreenShareSetupPage: Stopped existing remote stream.');
    }

    // 상태 초기화
    setMyStream(null);
    setRemoteStreamState(null);
    setMyShareStatus('waiting');
    setOpponentReady(false);
    setMyReady(false);
    setCountdown(0);
    setIsCountingDown(false);
    setIsWebRTCConnected(false);
    setOpponentScreenShareStatus('waiting');
    setShowMyScreenShareRestartButton(false);

  }, []);

  const startScreenShare = async () => {
    try {
      setMyShareStatus("sharing");
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const videoTrack = mediaStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings() as any;

      console.log("Screen share settings:", settings);

      if (settings.displaySurface === "monitor") {
        setMyShareStatus("valid");
        setMyStream(mediaStream);
        setLocalStream(mediaStream);
        // 이미 연결이 존재하면 트랙을 추가하고 재협상
        if (sharedPC) {
            mediaStream.getTracks().forEach((track) => sharedPC.addTrack(track, mediaStream));
            const offer = await sharedPC.createOffer();
            await sharedPC.setLocalDescription(offer);
            sendMessage(
              JSON.stringify({ type: 'webrtc_signal', signal: sharedPC.localDescription })
            );
          }
        // 화면 공유가 종료되었을 때 감지
        videoTrack.addEventListener("ended", () => {
          console.log("Screen share ended");
          setMyShareStatus("waiting");
          setMyStream(null);
          setLocalStream(null);
          setMyReady(false);
          setIsCountingDown(false);
          setCountdown(0);
          sendMessage(JSON.stringify({ type: 'screen_share_stopped' }));
        });
      } else {
        setMyShareStatus("invalid");
        setMyReady(false);
        setIsCountingDown(false);
        setCountdown(0);
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    } catch (error) {
      console.error("Screen share failed:", error);
      setMyShareStatus("waiting");
    }
  };

  const handleRetryShare = () => {
    setMyShareStatus("waiting");
    startScreenShare();
  };

  const handleReady = () => {
    if (myShareStatus === "valid") {
      setMyReady(true);
      sendMessage(JSON.stringify({ type: 'ready' }));
    }
  };

  useEffect(() => {
    if (myReady && opponentReady && isWebRTCConnected && !isCountingDown) {
      console.log('Starting countdown...');
      setIsCountingDown(true);
      setCountdown(3);
    }
}, [myReady, opponentReady, isWebRTCConnected, isCountingDown]);

  useEffect(() => {
    if (isCountingDown && countdown > 0) {
      console.log("Countdown:", countdown);
      const timer = setTimeout(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (isCountingDown && countdown === 0) {
      console.log("Game starting...");
      if (gameId) {
        navigate(`/battle?gameId=${gameId}&matchType=${matchType}`);
      } else {
        navigate("/battle");
      }
    }
  }, [isCountingDown, countdown, myStream, navigate, gameId, matchType]);

  useEffect(() => {
    if (myStream && localVideoRef.current) {
      console.log(
        "Assigning myStream to localVideoRef.current:",
        myStream,
        localVideoRef.current,
      );
      console.log("myStream active:", myStream.active);
      myStream.getVideoTracks().forEach((track) => {
        console.log(
          "Video track readyState:",
          track.readyState,
          "enabled:",
          track.enabled,
        );
      });
      localVideoRef.current.srcObject = myStream;
    }
  }, [myStream]);

  useEffect(() => {
    if (remoteStreamState && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamState;
    }
  }, [remoteStreamState]);

  useEffect(() => {
    const currentUrlGameId = searchParams.get('gameId');
    const storedGameId = sessionStorage.getItem('currentGameId');
    const userId = user?.user_id;

    let effectiveGameId = null;
    if (currentUrlGameId) {
      effectiveGameId = currentUrlGameId;
    } else if (storedGameId) {
      effectiveGameId = storedGameId;
    }

    if (!effectiveGameId || !userId) {
      console.log('ScreenShareSetupPage: Cannot connect WebSocket. Missing effectiveGameId or userId.', { effectiveGameId, userId });
      return;
    }

    let webSocketUrl = '';
    if (matchType === 'custom') {
      webSocketUrl = `${wsUrl}/api/v1/game/ws/custom_match/${effectiveGameId}?user_id=${userId}`;
    } else {
      webSocketUrl = `${wsUrl}/api/v1/game/ws/game/${effectiveGameId}?user_id=${userId}`;
    }
    console.log('ScreenShareSetupPage: Attempting to connect WebSocket to:', webSocketUrl);

    if (!webSocketUrl) { // wsUrl이 없으면 연결 시도 안 함
        console.log('ScreenShareSetupPage: wsUrl is not valid. Skipping connect.');
        return;
    }

    // 웹소켓이 이미 연결되어 있고, 연결하려는 URL과 동일하다면 다시 연결하지 않음
    // 커스텀 매치인 경우, 기존 웹소켓 연결을 재사용
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      if (matchType === 'custom') {
        console.log('ScreenShareSetupPage: Custom match, reusing existing WebSocket connection.');
      } else if (websocket.url === webSocketUrl) {
        console.log('ScreenShareSetupPage: WebSocket already connected to the target URL. Skipping connect.');
        return;
      }
    } else if (matchType !== 'custom') { // 커스텀 매치가 아니면 새로운 웹소켓 연결 시도
      connect(webSocketUrl); // 항상 현재 세션에 맞는 정확한 URL을 connect 함수에 전달
    }

    // PeerConnection이 초기화되지 않았다면 초기화
    if (!sharedPC) {
      console.log('ScreenShareSetupPage: sharedPC is null, creating new PeerConnection.');
      createPeerConnection();
    } else {
      console.log('ScreenShareSetupPage: sharedPC already exists.');
    }

    return () => {
      // Disconnect only if this component is responsible for the connection
      // and if the connection is still active.
      // This prevents disconnecting a shared WebSocket if another component
      // is also using it.
      if (websocket && websocket.readyState === WebSocket.OPEN && matchType !== 'custom') {
        // You might want to add a more sophisticated check here
        // to ensure you only disconnect if this component initiated the connection
        // or if it's the last one using it.
        // For now, we'll rely on the global state.
      }
    };
  }, [effectiveGameId, userId, connect, disconnect, matchType]);

  useEffect(() => {
    if (!websocket) return;

    websocket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "webrtc_signal" && data.sender !== user.user_id) {
          await handleSignal(data.signal);
        } else if (
          data.type === "player_ready" &&
          data.user_id !== user.user_id
        ) {
          setOpponentReady(true);
          if (data.nickname) setOpponentNickname(data.nickname);
          if (data.profile_img_url) setOpponentProfileImageUrl(data.profile_img_url);
        } else if (data.type === "all_ready") {
          setOpponentReady(true);
          setMyReady(true);
          if (data.opponent_nickname) setOpponentNickname(data.opponent_nickname);
          if (data.opponent_profile_img_url) setOpponentProfileImageUrl(data.opponent_profile_img_url);
        } else if (data.type === 'match_result') {
          console.log('ScreenShareSetupPage: Match result received:', data);
          if (matchType === 'custom') {
            disconnect();
            navigate('/home');
            toast({
              title: "상대방 연결 끊김",
              description: "상대방이 연결을 끊었습니다. 홈으로 이동합니다.",
              variant: "destructive",
            });
          } else if (data.reason === 'surrender' && data.winner === user.user_id) {
            toast({
              title: "부전승!",
              description: "상대방이 연결을 종료하여 부전승 처리됩니다.",
              variant: "success",
            });
            handleCleanup();
            navigate('/result', { state: { matchResult: data, matchType: matchType } });
          }
        }
      }catch (e) {
        console.error("ws message parse error", e);
    };

    websocket.onopen = () => {
      console.log('ScreenShareSetupPage WebSocket connected');
      sendMessage(JSON.stringify({ type: 'webrtc_signal', signal: { type: 'join' } }));
    };

    websocket.onclose = () => {
      console.log('ScreenShareSetupPage WebSocket disconnected');
    };
  },[websocket, user, sendMessage]});

  useEffect(() => {
    if (!sharedPC) return;

    sharedPC.addEventListener('connectionstatechange', () => handlePeerConnectionStateChange(sharedPC));

    return () => {
      if (sharedPC) { // sharedPC가 null이 아닌지 확인
        sharedPC.removeEventListener('connectionstatechange', () => handlePeerConnectionStateChange(sharedPC));
      }
    };
  }, [sharedPC, handlePeerConnectionStateChange]);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" },
        {
          urls: [
            'turns:turn.code-ground.com:5349?transport=tcp'  // TLS over TCP
          ],
          username: 'codegrounduser',
          credential: 'codegroundpass'
        },
        {
          urls: [
            'turn:turn.code-ground.com:3478?transport=udp',
            'turn:turn.code-ground.com:3478?transport=tcp'
          ],
          username: 'codegrounduser',
          credential: 'codegroundpass'
        }
      ],
    });
    setPeerConnection(pc); // 여기서 sharedPC를 업데이트

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state changed:', pc.iceConnectionState);
      handlePeerConnectionStateChange(pc);
    };

    const stream = myStream || sharedLocalStream;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        sendMessage(
          JSON.stringify({ type: 'webrtc_signal', signal: { type: 'candidate', candidate } })
        );
      }
    };
    pc.ontrack = ({ streams: [stream] }) => {
      console.log("Received remote stream:", stream);
      stream.getVideoTracks().forEach((track) => {
        console.log(
          "Remote video track readyState:",
          track.readyState,
          "enabled:",
          track.enabled,
        );
      });
      setRemoteStream(stream);
      setRemoteStreamState(stream);
      setOpponentScreenShareStatus('connected'); // 상대방 스트림 수신 시 상태 업데이트
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }

      // 상대방 스트림의 비디오 트랙이 종료될 때 감지
      const remoteVideoTrack = stream.getVideoTracks()[0];
      if (remoteVideoTrack) {
        remoteVideoTrack.onended = () => {
          console.log('Remote screen share track ended.');
          setOpponentScreenShareStatus('disconnected');
          setShowMyScreenShareRestartButton(true);
          setRemoteStream(null); // 상대방 스트림 제거
          setRemoteStreamState(null); // 상대방 스트림 상태 제거
        };
      }
    };
    return pc;
  };

  const handleSignal = async (signal: any) => {
    let pc = sharedPC; // sharedPC를 직접 사용
    if (!pc) {
      pc = createPeerConnection();
    }

    if (signal.type === 'offer') {
      // offer를 받으면, 현재 signalingState가 stable이 아니면 기다림
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
        console.warn('Received answer in unexpected signaling state:', pc.signalingState, 'Signal:', signal);
      }
    } else if (signal.type ===
     'candidate') {
      if (signal.candidate) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          console.error("Error adding ice candidate", err);
        }
      }
    } else if (signal.type === 'join') {
      // 상대방이 방에 들어왔음을 알리는 시그널. 여기서 offer를 생성하지 않음.
      // offer 생성은 startScreenShare 함수에서 담당.
    }
    // pc가 변경되었을 수 있으므로 다시 저장
    setPeerConnection(pc);
  };

  const handleRestartScreenShare = async () => {
    try {
      setMyShareStatus('sharing');
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const videoTrack = mediaStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings() as any;

      console.log('Screen share settings:', settings);

      if (settings.displaySurface === 'monitor') {
        setMyShareStatus('valid');
        setMyStream(mediaStream);
        setLocalStream(mediaStream);
        // 이미 연결이 존재하면 트랙을 추가하고 재협상
        if (sharedPC) {
            mediaStream.getTracks().forEach((track) => sharedPC.addTrack(track, mediaStream));
            const offer = await sharedPC.createOffer();
            await sharedPC.setLocalDescription(offer);
            sendMessage(
              JSON.stringify({ type: 'webrtc_signal', signal: sharedPC.localDescription })
            );
          }
        // 화면 공유가 종료되었을 때 감지
        videoTrack.addEventListener('ended', () => {
            console.log('Screen share ended');
            setMyShareStatus('waiting');
            setMyStream(null);
            setLocalStream(null);
            setMyReady(false);
            setIsCountingDown(false);
            setCountdown(0);
            sendMessage(JSON.stringify({ type: 'screen_share_stopped' }));
        });
      } else {
        setMyShareStatus('invalid');
        setMyReady(false);
        setIsCountingDown(false);
        setCountdown(0);
        mediaStream.getTracks().forEach(track => track.stop());
      }
    } catch (error) {
      console.error('Screen share failed:', error);
      setMyShareStatus('waiting');
    }
  };


  return (
    <div className="min-h-screen">
      <header className="cyber-card border-b border-cyber-blue/20 backdrop-blur-md">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-center">
            <span className="text-xl font-bold neon-text">화면 공유 설정</span>
          </div>
        </div>
      </header>

      {isCountingDown && countdown > 0 && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center animate-fade-in">
          <div className="text-center">
            <div className="text-8xl font-bold neon-text mb-4 animate-bounce">
              <span
                key={countdown}
                className="inline-block animate-pulse"
                style={{
                  animation: "pulse 0.5s ease-in-out, bounce 0.6s ease-in-out",
                  textShadow:
                    "0 0 30px rgba(0, 200, 255, 0.8), 0 0 60px rgba(0, 200, 255, 0.6)",
                }}
              >
                {countdown}
              </span>
            </div>
            <div className="text-2xl text-cyber-blue animate-pulse">
              게임이 곧 시작됩니다!
            </div>
            <div className="mt-6 w-48 h-2 bg-gray-700 rounded-full mx-auto overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyber-blue to-cyber-purple rounded-full transition-all duration-1000 ease-linear"
                style={{
                  width: `${((3 - countdown) / 3) * 100}%`,
                  boxShadow: "0 0 10px rgba(0, 200, 255, 0.5)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <CyberCard className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-cyber-blue to-cyber-purple rounded-full flex items-center justify-center overflow-hidden border-2 border-cyber-blue">
                    {user?.profileImageUrl ? (
                      <img
                        src={getAbsoluteUrl(user.profileImageUrl)}
                        alt={user.nickname || "내 프로필"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-6 w-6 text-white" />
                    )}
                  </div>
                  <div>
                    <div className="text-white font-semibold">나</div>
                    <div className="flex items-center space-x-2">
                      {myShareStatus === "valid" && (
                        <Check className="h-4 w-4 text-green-400" />
                      )}
                      <span
                        className={`text-sm ${
                          myShareStatus === "valid"
                            ? "text-green-400"
                            : myShareStatus === "invalid"
                              ? "text-red-400"
                              : "text-yellow-400"
                        }`}
                      >
                        {myShareStatus === "valid"
                          ? "화면 공유 완료"
                          : myShareStatus === "invalid"
                            ? "전체 화면 필요"
                            : myShareStatus === "sharing"
                              ? "공유 설정 중..."
                              : "화면 공유 대기"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-2xl font-bold neon-text">VS</div>

                <div className="flex items-center space-x-4">
                  <div>
                    <div className="text-white font-semibold text-right">
                      상대방
                    </div>
                    <div className="flex items-center justify-end space-x-2">
                      {opponentReady && (
                        <Check className="h-4 w-4 text-green-400" />
                      )}
                      <span
                        className={`text-sm ${opponentReady ? "text-green-400" : "text-yellow-400"}`}
                      >
                        {opponentReady ? "준비 완료" : "준비 중..."}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      {opponentScreenShareStatus === 'connected' ? (
                        <span className="text-green-400">화면 공유 연결됨</span>
                      ) : opponentScreenShareStatus === 'disconnected' ? (
                        <span className="text-red-400">화면 공유 끊김</span>
                      ) : (
                        <span className="text-yellow-400">화면 공유 대기 중</span>
                      )}
                    </div>
                  </div>
                  <div className="w-12 h-12 bg-gradient-to-r from-red-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden border-2 border-cyber-blue">
                    {opponentProfileImageUrl ? (
                      <img
                        src={getAbsoluteUrl(opponentProfileImageUrl)}
                        alt={opponentNickname || "상대방 프로필"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-6 w-6 text-white" />
                    )}
                  </div>
                </div>
              </div>
            </CyberCard>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8">
            <CyberCard className="p-6">
              <h3 className="text-lg font-semibold text-cyber-blue mb-4 flex items-center">
                <Monitor className="mr-2 h-5 w-5" />내 화면 공유
              </h3>

              <div className="aspect-video bg-black/50 rounded-lg border-2 border-cyber-blue/30 flex items-center justify-center mb-4">
                {myShareStatus === "valid" ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : myShareStatus === "invalid" ? (
                  <div className="text-center">
                    <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-2" />
                    <div className="text-red-400 font-semibold">
                      전체 화면이 아님
                    </div>
                    <div className="text-sm text-gray-400">
                      창이나 탭이 아닌 전체 화면을 선택해주세요
                    </div>
                  </div>
                ) : myShareStatus === "sharing" ? (
                  <div className="text-center">
                    <Clock className="h-12 w-12 text-yellow-400 mx-auto mb-2 animate-spin" />
                    <div className="text-yellow-400 font-semibold">
                      공유 설정 중...
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <Monitor className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <div className="text-gray-400">화면 공유 대기 중</div>
                  </div>
                )}
              </div>

              <div className="flex justify-center space-x-3">
                {(myShareStatus === "invalid" ||
                  myShareStatus === "waiting") && (
                  <CyberButton onClick={handleRetryShare} size="sm">
                    {myShareStatus === "waiting"
                      ? "화면 공유 시작"
                      : "다시 시도"}
                  </CyberButton>
                )}
                {myShareStatus === "valid" && !myReady && (
                  <CyberButton
                    onClick={handleReady}
                    className="bg-gradient-to-r from-green-500 to-emerald-600"
                  >
                    준비 완료
                  </CyberButton>
                )}
                {myReady && (
                  <div className="flex items-center space-x-2 text-green-400">
                    <Check className="h-5 w-5" />
                    <span className="font-semibold">준비됨</span>
                  </div>
                )}
              </div>
            </CyberCard>

            <CyberCard className="p-6">
              <h3 className="text-lg font-semibold text-cyber-blue mb-4 flex items-center">
                <Monitor className="mr-2 h-5 w-5" />
                상대방 화면 공유
              </h3>

              <div className="aspect-video bg-black/50 rounded-lg border-2 border-cyber-blue/30 flex items-center justify-center mb-4">
                {remoteStreamState ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <Clock className="h-12 w-12 text-yellow-400 mx-auto mb-2 animate-pulse" />
                    <div className="text-yellow-400 font-semibold">
                      대기 중...
                    </div>
                    <div className="text-sm text-gray-400">
                      상대방이 화면 공유를 설정하고 있습니다
                    </div>
                  </div>
                )}
              </div>
              {showMyScreenShareRestartButton && (
                <div className="flex justify-center mt-4">
                  <CyberButton onClick={startScreenShare} className="bg-blue-500 hover:bg-blue-600">
                    내 화면 공유 재시작
                  </CyberButton>
                </div>
              )}
            </CyberCard>
          </div>

          <CyberCard className="p-4">
            <div className="text-center">
              {!myReady ? (
                <div className="text-gray-300">
                  전체 화면을 공유하고 준비 버튼을 눌러주세요
                </div>
              ) : isCountingDown ? (
                <div className="text-green-400 font-semibold">
                  게임이 곧 시작됩니다!
                </div>
              ) : (
                <div className="text-green-400 font-semibold">
                  준비 완료! 게임 시작을 기다리고 있습니다.
                </div>
              )}
            </div>
          </CyberCard>
        </div>
      </main>
    </div>
  );
};

export default ScreenShareSetupPage;
