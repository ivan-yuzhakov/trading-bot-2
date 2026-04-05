import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('candle_sync_state')
export class CandleSyncState {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  pair: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  exchange: string;

  /** Millisecond timestamp. TypeORM returns bigint as string — this is intentional. */
  @Column({ type: 'bigint' })
  last_synced_ts: string;
}
