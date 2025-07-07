import { useEffect, useState, useMemo } from "react";
import { ProblemWithImages } from "@/types/codeEditor";

const useProblem = (gameId: string | null) => {
  const [problem, setProblem] = useState<ProblemWithImages | null>(null);

  useEffect(() => {
    if (!gameId) return;
    const storedProblem = localStorage.getItem(`problem_${gameId}`);
    if (storedProblem) {
      try {
        setProblem(JSON.parse(storedProblem));
      } catch (error) {
        console.error("Error parsing problem from localStorage:", error);
      }
    }
  }, [gameId]);

  const imageUrlMap = useMemo(() => {
    if (!problem?.problemStatementImages) return new Map();
    return new Map(
      problem.problemStatementImages.map((image) => [image.name, image.url]),
    );
  }, [problem]);

  return { problem, setProblem, imageUrlMap };
};

export default useProblem;
