import { Bot } from 'lucide-react';

interface ChatBubbleProps {
  message: string;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  return (
    <div className="mt-5 bg-emerald-950/30 border border-emerald-500/15 rounded-xl rounded-tl-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">Aureon</span>
        </div>
        <span className="text-xs text-stone-600">14:32</span>
      </div>
      <p className="text-sm text-stone-300 leading-relaxed">{message}</p>
    </div>
  );
}
