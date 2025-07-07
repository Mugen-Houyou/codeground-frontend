import { useState, useRef, useEffect, useCallback } from "react";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import { getLanguageConfig } from "@/utils/languageConfig";
import { CodeEditorHandler } from "@/utils/codeEditorHandlers";
import { authFetch } from "@/utils/api";

hljs.registerLanguage("python", python);

const apiUrl = import.meta.env.VITE_API_URL;

const useCodeExecution = (problemId: number | string | undefined) => {
  const [code, setCode] = useState("");
  const [executionResult, setExecutionResult] =
    useState("실행 결과가 여기에 표시됩니다.");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const editorHandlerRef = useRef<CodeEditorHandler>(
    new CodeEditorHandler("python"),
  );
  const languageConfig = getLanguageConfig("python");

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.innerHTML =
        hljs.highlight(code, { language: "python" }).value +
        (code.endsWith("\n") ? "\n" : "");
      if (textareaRef.current) {
        highlightRef.current.style.transform = `translateY(-${textareaRef.current.scrollTop}px)`;
      }
    }
  }, [code]);

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
    if (e.key === "Tab") {
      e.preventDefault();
      editorHandlerRef.current.handleTabKey(textarea, e.shiftKey);
      setCode(textarea.value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      editorHandlerRef.current.handleEnterKey(textarea);
      setCode(textarea.value);
    }
  };

  const handleRun = async () => {
    setExecutionResult("코드를 실행하고 있습니다...");
    setRunStatus(null);
    try {
      const matchId = localStorage.getItem("currentMatchId");
      const response = await authFetch(`${apiUrl}/api/v1/game/submit`, {
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
      });
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

  return {
    code,
    setCode,
    executionResult,
    runStatus,
    handleRun,
    textareaRef,
    lineNumbersRef,
    highlightRef,
    handleScroll,
    handleKeyDown,
    languageConfig,
  };
};

export default useCodeExecution;
