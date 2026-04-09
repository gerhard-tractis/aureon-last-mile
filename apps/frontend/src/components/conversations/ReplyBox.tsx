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
    <div className="border-t border-border px-4 py-3 bg-background">
      {isPending && <p className="text-xs text-text-muted mb-1">Enviando...</p>}
      {error && <p className="text-xs text-status-error mb-1">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribir respuesta al cliente vía WhatsApp..."
          rows={1}
          className="flex-1 resize-none bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent max-h-24 overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
