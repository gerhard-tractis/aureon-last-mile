// src/orchestration/flow-producer.ts — BullMQ FlowProducer for parent→child job relationships
import { FlowProducer } from 'bullmq';
import { log } from '../lib/logger';

let _flowProducer: FlowProducer | null = null;

export function createFlowProducer(redisUrl: string): FlowProducer {
  _flowProducer = new FlowProducer({ connection: { url: redisUrl } });
  log('info', 'flow_producer_created');
  return _flowProducer;
}

export function getFlowProducer(): FlowProducer {
  if (!_flowProducer) throw new Error('FlowProducer not initialized — call createFlowProducer() first');
  return _flowProducer;
}

export async function closeFlowProducer(): Promise<void> {
  if (!_flowProducer) return;
  await _flowProducer.close();
  _flowProducer = null;
  log('info', 'flow_producer_closed');
}
