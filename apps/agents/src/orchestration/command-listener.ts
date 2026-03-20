// src/orchestration/command-listener.ts — Dashboard→Agents command bridge
// Subscribes to Supabase Realtime INSERT on agent_commands, enqueues jobs at priority 10
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Queue } from 'bullmq';
import { log } from '../lib/logger';

type CommandType =
  | 'reassign_driver'
  | 'cancel_order'
  | 'force_escalation'
  | 'retry_intake'
  | 'manual_assign'
  | 'override_status'
  | 'send_manual_wa'
  | 'pause_agent'
  | 'resume_agent';

// Maps each command type to the queue that handles it
const COMMAND_QUEUE_MAP: Record<CommandType, string> = {
  reassign_driver: 'coord.lifecycle',
  cancel_order: 'coord.lifecycle',
  force_escalation: 'coord.lifecycle',
  retry_intake: 'intake.ingest',
  manual_assign: 'assignment.optimize',
  override_status: 'coord.lifecycle',
  send_manual_wa: 'whatsapp.outbound',
  pause_agent: 'coord.lifecycle',
  resume_agent: 'coord.lifecycle',
};

interface AgentCommand {
  id: string;
  operator_id: string;
  command_type: CommandType;
  payload: Record<string, unknown>;
}

export function startCommandListener(
  supabase: SupabaseClient,
  queues: Record<string, Queue>,
): () => void {
  const channel = supabase
    .channel('agent_commands')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'agent_commands' },
      (payload: { new: AgentCommand }) => {
        void handleCommand(payload.new, supabase, queues);
      },
    )
    .subscribe();

  log('info', 'command_listener_started');

  return () => {
    void channel.unsubscribe();
    log('info', 'command_listener_stopped');
  };
}

async function handleCommand(
  cmd: AgentCommand,
  supabase: SupabaseClient,
  queues: Record<string, Queue>,
): Promise<void> {
  const queueName = COMMAND_QUEUE_MAP[cmd.command_type];
  if (!queueName) {
    log('warn', 'unknown_command_type', { commandType: cmd.command_type, commandId: cmd.id });
    return;
  }

  const queue = queues[queueName];
  if (!queue) {
    log('error', 'queue_not_found', { queueName, commandId: cmd.id });
    return;
  }

  try {
    await queue.add(
      cmd.command_type,
      { commandId: cmd.id, operatorId: cmd.operator_id, ...cmd.payload },
      { priority: 10 },
    );

    await supabase
      .from('agent_commands')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', cmd.id);

    log('info', 'command_enqueued', { commandId: cmd.id, commandType: cmd.command_type, queue: queueName });
  } catch (err) {
    log('error', 'command_enqueue_failed', { commandId: cmd.id, error: String(err) });
  }
}
