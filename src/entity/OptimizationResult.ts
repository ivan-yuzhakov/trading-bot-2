import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('optimization_results')
export class OptimizationResult {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 100 })
  run_name: string;

  @Column({ type: 'varchar', length: 64 })
  run_id: string;

  @Column({ type: 'int' })
  variant_index: number;

  @Column({ type: 'int' })
  total_variants: number;

  @Column({ type: 'varchar', length: 20 })
  pair: string;

  @Column({ type: 'varchar', length: 20 })
  exchange: string;

  @Column({ type: 'json' })
  params: Record<string, unknown>;

  @Column({ type: 'json' })
  strategy_snapshot: Record<string, unknown>;

  @Column({ type: 'bigint' })
  start_date: number;

  @Column({ type: 'bigint' })
  end_date: number;

  @Column({ type: 'varchar', length: 30 })
  initial_balance: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  total_profit: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  total_profit_pct: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  final_balance: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  win_rate: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  max_drawdown: string;

  @Column({ type: 'int' })
  total_trades: number;

  @Column({ type: 'int' })
  winning_trades: number;

  @Column({ type: 'int' })
  losing_trades: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  avg_profit_per_trade: string;

  @Column({ type: 'int', default: 0 })
  avg_trade_duration: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  best_trade_profit: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  worst_trade_profit: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  total_commission: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  profit_factor: string;

  @Column({ type: 'int', default: 0 })
  execution_time_ms: number;

  @Column({ type: 'varchar', length: 255 })
  detail_file: string;

  @Column({ type: 'varchar', length: 20, default: 'completed' })
  status: string;

  @CreateDateColumn()
  created_at: string;
}
