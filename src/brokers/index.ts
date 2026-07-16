import { Broker } from '@generated/prisma/enums';

import { Paper } from './paper';
import type { BrokerService } from './types';

/**
 * Broker registry (hedged's brokerHelper pattern): consumers resolve an
 * implementation from the order's broker enum instead of branching on type.
 */
const registry: Record<Broker, BrokerService> = {
  [Broker.PAPER]: Paper.getInstance(),
};

export const getBroker = (broker: Broker): BrokerService => registry[broker];

export type { BrokerService, OrderUpdate, OrderWithInstrument } from './types';
export {
  paperConfigPatchSchema,
  DEFAULT_PAPER_CONFIG,
  resolvePaperConfig,
  type PaperConfig,
} from './paper';
