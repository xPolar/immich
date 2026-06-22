import {
  Column,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
} from '@immich/sql-tools';
import { SharedLinkTable } from 'src/schema/tables/shared-link.table';

@Table('shared_link_view')
@Unique({ columns: ['sharedLinkId', 'visitorHash', 'viewDate'] })
export class SharedLinkViewTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedLinkTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  sharedLinkId!: string;

  @Column({ type: 'bytea' })
  visitorHash!: Buffer;

  @Column({ type: 'date' })
  viewDate!: Timestamp;

  @Column({ type: 'integer', default: 1 })
  viewCount!: Generated<number>;
}
