import CyberButton from '@/components/CyberButton';
import CyberCard from '@/components/CyberCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HelpCircle } from 'lucide-react';

interface ProblemSectionProps {
  problem: any;
  showHint: boolean;
  toggleHint: () => void;
}

const ProblemSection = ({ problem, showHint, toggleHint }: ProblemSectionProps) => {
  return (
    <div className="flex-1 mb-2">
      <CyberCard className="h-[calc(100vh-24em)] p-4 mr-2 max-h-[860px]">
        <ScrollArea className="h-full">
          {problem ? (
            <div className="space-y-4 pr-4">
              <div className="flex items-start justify-between">
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold neon-text">{problem.title}</h1>
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
                    {problem.category.map((tag: string, index: number) => (
                      <span
                        key={index}
                        className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-gray-300 leading-relaxed">{problem.description}</p>
              </div>
              {problem.examples && (
                <div>
                  <h3 className="text-lg font-semibold text-cyber-blue mb-2">입출력 예</h3>
                  <div className="bg-black/30 p-3 rounded-lg border border-gray-700 space-y-2">
                    {problem.examples.map((example: any, index: number) => (
                      <div key={index} className="font-mono text-sm">
                        <div className="text-gray-400">{example.input}</div>
                        <div className="text-green-400">{example.output}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-400">문제 로딩 중...</div>
          )}
        </ScrollArea>
      </CyberCard>
    </div>
  );
};

export default ProblemSection;
