'use client';

import { useEffect, useRef } from 'react';

interface Message {
  id: string;
  role: string;
  body: string;
  created_at: string;
}

interface Props {
  messages: unknown[];
}

function parseMessage(raw: unknown): Message {
  const m = raw as Record<string, unknown>;
  return {
    id: String(m.id ?? ''),
    role: String(m.role ?? ''),
    body: String(m.body ?? ''),
    created_at: String(m.created_at ?? ''),
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function ChatPanel({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-sm text-muted-foreground text-center">
          No messages yet — fire a proactive event or type a customer reply.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full">
      {messages.map((raw) => {
        const msg = parseMessage(raw);
        const isUser = msg.role === 'user';
        return (
          <div
            key={msg.id}
            className={`flex flex-col gap-0.5 max-w-[75%] ${isUser ? 'self-end items-end' : 'self-start items-start'}`}
          >
            <span className="text-xs text-muted-foreground">
              {isUser ? 'Customer' : 'Agent'} · {formatTime(msg.created_at)}
            </span>
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                isUser
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.body}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
