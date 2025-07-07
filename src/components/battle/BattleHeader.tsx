import CyberButton from '@/components/CyberButton';
import { Clock, Flag, AlertTriangle, Monitor, LogOut } from 'lucide-react';

interface BattleHeaderProps {
  timeLeft: number;
  isSolvingAlone: boolean;
  isLocalStreamActive: boolean;
  isRemoteStreamActive: boolean;
  onSurrender: () => void;
  onReport: () => void;
  onLeave: () => void;
  onStartScreenShare: () => void;
}

const BattleHeader = ({
  timeLeft,
  isSolvingAlone,
  isLocalStreamActive,
  isRemoteStreamActive,
  onSurrender,
  onReport,
  onLeave,
  onStartScreenShare,
}: BattleHeaderProps) => {
  return (
    <header className="sticky top-0 z-50 cyber-card border-b border-cyber-blue/20 backdrop-blur-md">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl font-bold neon-text">Codeground</span>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="h-6 w-6 text-cyber-blue" />
            <span className="text-2xl font-bold font-mono text-cyber-blue">
              {`${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            {!isSolvingAlone && (
              <CyberButton onClick={onSurrender} size="sm" variant="secondary">
                <Flag className="mr-1 h-4 w-4" />
                항복
              </CyberButton>
            )}
            <CyberButton onClick={onReport} size="sm" variant="secondary">
              <AlertTriangle className="mr-1 h-4 w-4" />
              신고
            </CyberButton>
            {isSolvingAlone ? (
              <CyberButton onClick={onLeave} size="sm">
                <LogOut className="mr-1 h-4 w-4" />
                나가기
              </CyberButton>
            ) : (
              !isLocalStreamActive && !isRemoteStreamActive && (
                <CyberButton onClick={onStartScreenShare} size="sm">
                  <Monitor className="mr-1 h-4 w-4" />
                  화면 공유 시작
                </CyberButton>
              )
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default BattleHeader;
