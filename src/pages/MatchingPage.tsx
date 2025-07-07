import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import CyberCard from "@/components/CyberCard";
import CyberButton from "@/components/CyberButton";
import { User, Clock, Check, X } from "lucide-react";
import { useUser } from "../context/UserContext";

const MatchingPage = () => {
  const navigate = useNavigate();
  const { user } = useUser(); // Get user from context
  const [matchingTime, setMatchingTime] = useState(0);
  const [foundOpponent, setFoundOpponent] = useState(false);
  const [acceptTimeLeft, setAcceptTimeLeft] = useState(20);
  const [userAccepted, setUserAccepted] = useState(false);
  const [opponentAccepted, setOpponentAccepted] = useState(false);
  const [opponent] = useState({
    name: "CodeWarrior",
    mmr: 1823,
    rank: "Gold II",
    winRate: 58.3,
  });

  const [ws, setWs] = useState<WebSocket | null>(null);
  const matchIdRef = useRef<number | null>(null); // To store match_id

  useEffect(() => {
    if (!user || !user.user_id) {
      // Check if user and user.user_id are available
      console.error("User ID not found. Redirecting to home.");
      navigate("/home"); // Redirect if user ID is not available
      return;
    }

    const websocket = new WebSocket(
      `ws://localhost:8000/api/v1/match/ws/match/${user.user_id}`,
    );
    setWs(websocket);

    websocket.onopen = () => {
      console.log("WebSocket connected");
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received message:", message);

      if (message.type === "match_found") {
        setFoundOpponent(true);
        setUserAccepted(false);
        setOpponentAccepted(false);
        setAcceptTimeLeft(message.time_limit);
        matchIdRef.current = message.match_id;
        localStorage.setItem('currentMatchId', String(message.match_id));
        // You might want to update opponent details here based on message.opponent_ids
      } else if (message.type === "match_accepted") {
        if (message.problem && message.game_id) {
          localStorage.setItem(
            `problem_${message.game_id}`,
            JSON.stringify(message.problem),
          );
        }
        setOpponentAccepted(true);
        localStorage.setItem('currentGameId', message.game_id); // Save game_id to localStorage
        navigate(`/screen-share-setup?gameId=${message.game_id}`);
      } else if (message.type === "opponent_accepted") {
        setOpponentAccepted(true);
      } else if (message.type === "match_cancelled") {
        console.log("Match cancelled:", message.reason);
        setFoundOpponent(false);
        setMatchingTime(0);
        setAcceptTimeLeft(20);
        setUserAccepted(false);
        setOpponentAccepted(false);
        matchIdRef.current = null;
        localStorage.removeItem('currentMatchId');
        if (message.reason === "timeout or rejection") {
          navigate("/home"); // Go back to home or a suitable page
        }
      }
    };

    websocket.onclose = () => {
      console.log("WebSocket disconnected");
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      websocket.close();
    };
  }, [navigate, user]); // Add user to dependency array

  useEffect(() => {
    const timer = setInterval(() => {
      setMatchingTime((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  // 수락 타이머
  useEffect(() => {
    if (foundOpponent) {
      const acceptTimer = setInterval(() => {
        setAcceptTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(acceptTimer);
            // navigate('/'); // 시간 초과시 홈으로 - handled by websocket message
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(acceptTimer);
    }
  }, [foundOpponent]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleAccept = () => {
    console.log("handleAccept called");
    if (ws && matchIdRef.current) {
      setUserAccepted(true);
      const message = { type: "match_accept", match_id: matchIdRef.current };
      console.log("Sending WebSocket message:", message);
      ws.send(JSON.stringify(message));
      localStorage.setItem('currentMatchId', String(matchIdRef.current));
    } else {
      console.warn(
        "WebSocket not connected or matchId not set. ws:",
        ws,
        "matchIdRef.current:",
        matchIdRef.current,
      );
    }
  };

  const handleDecline = () => {
    if (userAccepted) return; // 이미 수락한 경우 거절 불가
    if (ws && matchIdRef.current) {
      ws.send(
        JSON.stringify({ type: "match_reject", match_id: matchIdRef.current }),
      );
    }
    localStorage.removeItem('currentMatchId');
    navigate("/home"); // Navigate away after declining
  };

  const handleCancel = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: "cancel_queue" }));
    }
    localStorage.removeItem('currentMatchId');
    navigate("/home"); // Navigate away after cancelling
  };

  // 원형 진행률 계산 (SVG용)
  const circleProgress = ((20 - acceptTimeLeft) / 20) * 283; // 283은 대략적인 원의 둘레

  return (
    <div className="min-h-screen cyber-grid">
      <Header />

      <main className="container mx-auto px-4 py-8 flex items-center justify-center min-h-[calc(100vh-200px)]">
        <div className="w-full max-w-2xl">
          {!foundOpponent ? (
            <CyberCard className="text-center">
              <div className="space-y-8">
                <h1 className="text-3xl font-bold neon-text">
                  상대방을 찾고 있습니다...
                </h1>

                {/* 매칭 아이콘 */}
                <div className="relative">
                  <div className="w-32 h-32 mx-auto">
                    <div className="absolute inset-0 border-4 border-cyber-blue/30 rounded-full"></div>
                    <div className="absolute inset-4 border-4 border-cyber-purple/30 rounded-full"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <User className="h-12 w-12 text-cyber-blue" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-center space-x-2 text-xl">
                    <Clock className="h-6 w-6 text-cyber-blue" />
                    <span className="text-cyber-blue font-mono">
                      {formatTime(matchingTime)}
                    </span>
                  </div>

                  <div className="text-gray-300">평균 매칭 시간: 30초</div>
                </div>

                <div className="flex justify-center">
                  <CyberButton
                    onClick={handleCancel}
                    variant="secondary"
                    className="w-48"
                  >
                    매칭 취소
                  </CyberButton>
                </div>
              </div>
            </CyberCard>
          ) : (
            <div className="relative">
              {/* 배경 오버레이 */}
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-40"></div>

              {/* 수락창 */}
              <div className="relative z-50 flex items-center justify-center">
                <div className="text-center space-y-8">
                  <h1 className="text-4xl font-bold text-green-400 mb-8">
                    게임을 찾았습니다!
                  </h1>

                  {/* 원형 수락창 */}
                  <div className="relative w-80 h-80 mx-auto">
                    {/* 외부 원형 진행바 */}
                    <svg
                      className="w-full h-full transform -rotate-90"
                      viewBox="0 0 100 100"
                    >
                      {/* 배경 원 */}
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeWidth="2"
                      />
                      {/* 진행 원 */}
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="url(#gradient)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray="283"
                        strokeDashoffset={283 - circleProgress}
                        className="transition-all duration-1000 ease-linear"
                      />
                      <defs>
                        <linearGradient
                          id="gradient"
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop offset="0%" stopColor="#00F6FF" />
                          <stop offset="100%" stopColor="#8B5CF6" />
                        </linearGradient>
                      </defs>
                    </svg>

                    {/* 중앙 컨텐츠 */}
                    <div className="absolute inset-8 bg-gradient-to-br from-cyber-blue/20 to-cyber-purple/20 rounded-full border border-cyber-blue/30 backdrop-blur-sm flex flex-col items-center justify-center">
                      <div className="text-center space-y-4">
                        <div className="text-2xl font-bold text-white">
                          코딩 배틀
                        </div>
                        <div className="text-sm text-gray-300">랭크 매칭</div>
                        {!userAccepted || !opponentAccepted ? (
                          <div className="text-lg text-cyber-blue font-mono">
                            {acceptTimeLeft}초
                          </div>
                        ) : (
                          <div className="text-lg text-green-400 font-mono">
                            수락됨
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 타이머 텍스트 */}
                    {(!userAccepted || !opponentAccepted) && (
                      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-white font-bold text-lg">
                        {acceptTimeLeft}
                      </div>
                    )}
                  </div>

                  {/* 상대방 정보 (간소화) */}
                  <div className="bg-black/40 rounded-lg p-4 border border-cyber-blue/30 backdrop-blur-sm">
                    <div className="flex items-center justify-center space-x-4">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-gradient-to-r from-cyber-blue to-cyber-purple rounded-full mx-auto flex items-center justify-center mb-2">
                          <User className="h-6 w-6 text-white" />
                        </div>
                        <div className="text-sm text-white">CyberCoder</div>
                        <div className="text-xs text-cyber-blue">Gold III</div>
                        {userAccepted && (
                          <div className="text-xs text-green-400 mt-1 flex items-center justify-center">
                            <Check className="h-3 w-3 mr-1" />
                            수락함
                          </div>
                        )}
                      </div>

                      <div className="text-2xl font-bold neon-text">VS</div>

                      <div className="text-center">
                        <div className="w-12 h-12 bg-gradient-to-r from-red-500 to-pink-500 rounded-full mx-auto flex items-center justify-center mb-2">
                          <User className="h-6 w-6 text-white" />
                        </div>
                        <div className="text-sm text-white">
                          {opponent.name}
                        </div>
                        <div className="text-xs text-red-400">
                          {opponent.rank}
                        </div>
                        {opponentAccepted && (
                          <div className="text-xs text-green-400 mt-1 flex items-center justify-center">
                            <Check className="h-3 w-3 mr-1" />
                            수락함
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 수락/거절 버튼 또는 상태 */}
                  {!userAccepted && (
                    <div className="flex justify-center gap-8">
                      <CyberButton
                        onClick={handleAccept}
                        size="lg"
                        className="w-32 h-16 text-lg bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500"
                      >
                        <Check className="h-6 w-6" />
                        수락
                      </CyberButton>
                      <CyberButton
                        onClick={handleDecline}
                        variant="danger"
                        size="lg"
                        className="w-32 h-16 text-lg"
                      >
                        <X className="h-6 w-6" />
                        거절
                      </CyberButton>
                    </div>
                  )}

                  {userAccepted && !opponentAccepted && (
                    <div className="text-center space-y-4">
                      <div className="text-green-400 font-semibold text-lg flex items-center justify-center">
                        <Check className="h-5 w-5 mr-2" />
                        수락 완료! 상대방을 기다리는 중...
                      </div>
                      <div className="animate-pulse text-cyber-blue">
                        상대방이 수락하길 기다리고 있습니다
                      </div>
                    </div>
                  )}

                  {userAccepted && opponentAccepted && (
                    <div className="text-center space-y-4">
                      <div className="text-green-400 font-bold text-xl">
                        매칭 성공!
                      </div>
                      <div className="text-cyber-blue">
                        게임을 시작합니다...
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default MatchingPage;
