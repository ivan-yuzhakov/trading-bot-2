import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { Trade } from './Trade.js';

@Entity('trade_steps')
export class TradeStep {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int' })
  trade_id: number;

  @ManyToOne('Trade', 'steps')
  @JoinColumn({ name: 'trade_id' })
  trade: Trade;

  @Column({ type: 'enum', enum: ['BUY', 'SELL'] })
  side: 'BUY' | 'SELL';

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  price: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  quantity: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  order_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  exchange_order_id: string | null;

  @Column({ type: 'enum', enum: ['pending', 'filled', 'cancelled', 'failed'], default: 'pending' })
  status: 'pending' | 'filled' | 'cancelled' | 'failed';

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  commission: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  commission_asset: string | null;

  @Column({ type: 'timestamp', nullable: true })
  filled_at: string | null;

  @Column({ type: 'json', nullable: true })
  raw_response: Record<string, unknown> | null;
}
