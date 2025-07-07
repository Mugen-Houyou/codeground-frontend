import { useState, useEffect } from "react";

const useGameTimer = (
  sendMessage: (msg: string) => void,
  isGamePaused: boolean,
  isGameFinished: boolean,
  initialTime = 930,
) => {
  const [timeLeft, setTimeLeft] = useState(initialTime);

  useEffect(() => {
    if (isGamePaused || isGameFinished) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          sendMessage(
            JSON.stringify({ type: "match_result", reason: "timeout" }),
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sendMessage, isGamePaused, isGameFinished]);

  return { timeLeft, setTimeLeft };
};

export default useGameTimer;
