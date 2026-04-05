import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import type { Trade } from './Trade.js';

export interface AnalyzerConfig {
  name: string;
  weight: string;
  config: Record<string, unknown>;
}

export interface MoneyManagementConfig {
  mode: 'fixed' | 'percentage';
  amount: string;
  maxConcurrentTrades: number;
  maxExposurePerPair: string;
  dailyLossLimit: string;
}

@Entity('strategies')
export class Strategy {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 20 })
  pair: string;

  @Column({ type: 'varchar', length: 20 })
  exchange: string;

  @Column({ type: 'json' })
  analyzers: AnalyzerConfig[];

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  buy_threshold: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  sell_threshold: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  stop_loss_pct: string | null;

  @Column({ type: 'json' })
  money_management: MoneyManagementConfig;

  @Column({ type: 'tinyint', default: 1 })
  active: number;

  @OneToMany('Trade', 'strategy')
  trades: Trade[];

  @CreateDateColumn()
  created_at: string;

  @UpdateDateColumn()
  updated_at: string;
}
