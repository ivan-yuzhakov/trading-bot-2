import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, JoinColumn } from 'typeorm';
import type { Strategy } from './Strategy.js';
import type { TradeStep } from './TradeStep.js';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int' })
  strategy_id: number;

  @ManyToOne('Strategy', 'trades')
  @JoinColumn({ name: 'strategy_id' })
  strategy: Strategy;

  @Column({ type: 'varchar', length: 20 })
  pair: string;

  @Column({ type: 'varchar', length: 20 })
  exchange: string;

  @Column({ type: 'enum', enum: ['open', 'closed', 'cancelled'], default: 'open' })
  status: 'open' | 'closed' | 'cancelled';

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  entry_price: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  exit_price: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  quantity: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  profit: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  profit_pct: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  stop_loss_price: string | null;

  @Column({ type: 'json', nullable: true })
  signal_snapshot: Record<string, unknown> | null;

  @OneToMany('TradeStep', 'trade')
  steps: TradeStep[];

  @CreateDateColumn()
  created_at: string;

  @Column({ type: 'timestamp', nullable: true })
  closed_at: string | null;
}
