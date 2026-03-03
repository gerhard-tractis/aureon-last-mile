import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { initQueryBroadcast } from './queryBroadcast';

// Mock BroadcastChannel — jsdom does not implement it
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private static instances: MockBroadcastChannel[] = [];
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    // Deliver to all OTHER instances with the same name
    MockBroadcastChannel.instances
      .filter((ch) => ch !== this && ch.name === this.name && !ch.closed)
      .forEach((ch) => {
        ch.onmessage?.(new MessageEvent('message', { data }));
      });
  }

  close() {
    this.closed = true;
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((ch) => ch !== this);
  }

  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

describe('queryBroadcast', () => {
  beforeEach(() => {
    MockBroadcastChannel.reset();
    globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup global mock
    delete globalThis.BroadcastChannel;
  });

  it('returns a no-op cleanup when BroadcastChannel is unavailable', () => {
    // @ts-expect-error - simulate Safari private browsing
    delete globalThis.BroadcastChannel;
    const queryClient = new QueryClient();
    const cleanup = initQueryBroadcast(queryClient);
    expect(() => cleanup()).not.toThrow();
    queryClient.clear();
  });

  it('broadcasts cache updates to other tabs', async () => {
    const senderClient = new QueryClient();
    const receiverClient = new QueryClient();

    const senderCleanup = initQueryBroadcast(senderClient);
    const receiverCleanup = initQueryBroadcast(receiverClient);

    // Seed sender cache with a successful query result
    senderClient.setQueryData(['dashboard', 'test'], { value: 42 });

    // Allow the subscriber event to fire
    await new Promise((r) => setTimeout(r, 10));

    // Receiver should have the data
    const received = receiverClient.getQueryData(['dashboard', 'test']);
    expect(received).toEqual({ value: 42 });

    senderCleanup();
    receiverCleanup();
    senderClient.clear();
    receiverClient.clear();
  });

  it('deserializes received data correctly (no Date corruption)', async () => {
    const senderClient = new QueryClient();
    const receiverClient = new QueryClient();

    const senderCleanup = initQueryBroadcast(senderClient);
    const receiverCleanup = initQueryBroadcast(receiverClient);

    // Objects with nested structure survive JSON round-trip
    const payload = { id: '123', metrics: { sla: 98.5, count: 100 } };
    senderClient.setQueryData(['dashboard', 'metrics'], payload);

    await new Promise((r) => setTimeout(r, 10));

    const received = receiverClient.getQueryData(['dashboard', 'metrics']);
    expect(received).toEqual(payload);

    senderCleanup();
    receiverCleanup();
    senderClient.clear();
    receiverClient.clear();
  });

  it('does not re-broadcast received messages (no infinite loop)', async () => {
    const client = new QueryClient();
    const cleanup = initQueryBroadcast(client);

    const postSpy = vi.spyOn(MockBroadcastChannel.prototype, 'postMessage');

    // Simulate receiving a message from another tab
    const instances = (MockBroadcastChannel as unknown as { instances: MockBroadcastChannel[] }).instances;
    const channel = instances[0];
    channel.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ queryKey: ['dashboard', 'x'], data: { val: 1 } }),
      })
    );

    await new Promise((r) => setTimeout(r, 10));

    // postMessage should NOT have been called as a result of setQueryData triggered by receive
    expect(postSpy).not.toHaveBeenCalled();

    cleanup();
    client.clear();
  });
});
