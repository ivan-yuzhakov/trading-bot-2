import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('logs')
export class Log {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int' })
  running: number;

  @Column({ type: 'varchar', length: 10 })
  level: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'json', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ type: 'tinyint', default: 0 })
  sent: number;

  @CreateDateColumn()
  created_at: string;
}
