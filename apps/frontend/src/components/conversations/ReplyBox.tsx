'use client';

import { useState, useRef } from 'react';
import { Send } from 'lucide-react';

interface ReplyBoxProps {
  onSend: (message: string) => void;
  isPending: boolean;
  error: string | null;
}

export function ReplyBox({ onSend, isPending, error }: ReplyBoxProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 && !isPending;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-slate-800 px-4 py-3">
      {isPending && <p className="text-xs text-slate-400 mb-1">Enviando...</p>}
      {error && <p className="text-xs text-red-400 mb-1">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribir respuesta al cliente vía WhatsApp..."
          rows={1}
          className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 max-h-24 overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-500 transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
