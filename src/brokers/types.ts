import type { Broker, BrokerToken, Instrument, Order, OrderStatus } from '@generated/prisma/client';

export type OrderWithInstrument = Order & { instrument: Instrument };

/**
 * Fields a broker call is allowed to change. Brokers return a delta and the
 * caller persists it via prisma.order.update (Prisma has no active records,
 * so mutate-and-save like hedged's Sequelize models doesn't apply).
 */
export type OrderUpdate = {
  status: OrderStatus;
  brokerOrderId?: string;
  price?: number;
  filledQuantity?: number;
  averageExecutionPrice?: number;
  rejectReason?: string;
  executedAt?: Date;
  cancelledAt?: Date;
};

/**
 * The contract every broker (real or simulated) implements. Consumers never
 * branch on broker type — they resolve an implementation from the registry
 * (src/brokers/index.ts) and call it.
 *
 * Positions/order-book/trade-book are deliberately absent until a consumer
 * exists for them.
 */
export interface BrokerService {
  readonly broker: Broker;
  placeOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate>;
  modifyOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate>;
  cancelOrder(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate>;
  getOrderStatus(token: BrokerToken, order: OrderWithInstrument): Promise<OrderUpdate>;
  getAvailableFunds(token: BrokerToken): Promise<number>;
}
