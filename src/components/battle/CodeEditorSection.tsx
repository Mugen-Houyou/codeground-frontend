import CyberCard from '@/components/CyberCard';
import CyberButton from '@/components/CyberButton';
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable';
import { Play } from 'lucide-react';
import { LanguageConfig } from '@/types/codeEditor';
import { RefObject } from 'react';

interface CodeEditorSectionProps {
  languageConfig: LanguageConfig;
  code: string;
  onCodeChange: (v: string) => void;
  onScroll: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  lineNumbersRef: RefObject<HTMLDivElement>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  highlightRef: RefObject<HTMLPreElement>;
  displayLineCount: number;
  isGamePaused: boolean;
  onRun: () => void;
  onSubmit: () => void;
  executionResult: string;
}

const CodeEditorSection = ({
  languageConfig,
  code,
  onCodeChange,
  onScroll,
  onKeyDown,
  lineNumbersRef,
  textareaRef,
  highlightRef,
  displayLineCount,
  isGamePaused,
  onRun,
  onSubmit,
  executionResult,
}: CodeEditorSectionProps) => {
  return (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel defaultSize={75} minSize={50}>
        <CyberCard className="h-full flex flex-col ml-2 mb-1">
          <div className="flex items-center px-3 py-1 border-b border-gray-700/50 bg-black/20">
            <div className="text-xs text-gray-400">{languageConfig.name} Code Editor</div>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="h-full flex bg-black/30">
              <div ref={lineNumbersRef} className="flex-shrink-0 w-12 bg-black/20 border-r border-gray-700 overflow-hidden">
                <div className="text-xs text-gray-500 leading-5 text-right py-3 px-2">
                  {Array.from({ length: displayLineCount }, (_, i) => (
                    <div key={i} className="h-5">{i + 1}</div>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-hidden relative">
                <pre
                  ref={highlightRef}
                  className="hljs pointer-events-none w-full h-full px-3 py-3 text-sm leading-5 font-mono whitespace-pre-wrap"
                  style={{ fontFamily: languageConfig.fontFamily }}
                />
                <textarea
                  ref={textareaRef}
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  onScroll={onScroll}
                  onKeyDown={onKeyDown}
                  placeholder={languageConfig.placeholder}
                  spellCheck={false}
                  className="w-full h-full absolute top-0 left-0 bg-transparent px-3 py-3 font-mono resize-none focus:outline-none text-sm leading-5 border-none"
                  style={{ fontFamily: languageConfig.fontFamily, tabSize: languageConfig.indentSize, color: 'transparent', caretColor: '#ffffff' }}
                  readOnly={isGamePaused}
                />
              </div>
            </div>
          </div>
        </CyberCard>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={25} minSize={15}>
        <CyberCard className="h-full flex flex-col ml-2 mt-1">
          <div className="flex items-center justify-between px-3 py-1 border-b border-gray-700/50">
            <h3 className="text-sm font-semibold text-cyber-blue">실행 결과</h3>
            <div className="flex space-x-1">
              <CyberButton onClick={onRun} size="sm" variant="secondary" className="px-6" disabled={isGamePaused}>
                <Play className="mr-1 h-3 w-3" />
                실행
              </CyberButton>
              <CyberButton onClick={onSubmit} size="sm" className="px-6" disabled={isGamePaused}>
                제출
              </CyberButton>
            </div>
          </div>
          <div className="flex-1 p-2">
            <div className="h-full bg-black/30 border border-gray-700 rounded p-3 overflow-auto">
              <pre className="font-mono text-xs text-gray-300 whitespace-pre-wrap break-words">
                {executionResult}
              </pre>
            </div>
          </div>
        </CyberCard>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default CodeEditorSection;
