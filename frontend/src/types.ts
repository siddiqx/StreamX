export type MetadataStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'MATCHED'
  | 'LOW_CONFIDENCE'
  | 'NOT_FOUND'
  | 'MANUAL'
  | 'FAILED'
  | 'RETRYING';

export interface CanonicalMetadata {
  id: number;
  provider: string;
  provider_id: string;
  media_type: string;
  title: string;
  original_title?: string;
  release_date?: string;
  release_year?: number;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  rating?: number;
  runtime?: number;
  genres: string[];
}

export interface MediaItem {
  id: number;
  drive_file_id: string;
  filename: string;
  size: number;
  mime_type: string;
  category: string;
  poster_url?: string;
  metadata_json?: string;
  metadata_entity_id?: number;
  metadata_status?: MetadataStatus;
  metadata_confidence?: number;
  metadata_locked?: boolean;
  canonical_metadata?: CanonicalMetadata;
  created_at: string;
  updated_at: string;
}

export type TransferStatus =
  | 'QUEUED'
  | 'FETCHING_TELEGRAM'
  | 'UPLOADING_DRIVE'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRYING';

export interface TelegramTransfer {
  id: number;
  telegram_chat_id: number;
  telegram_message_id: number;
  telegram_file_id: string;
  filename: string;
  size: number;
  status: TransferStatus;
  bytes_transferred: number;
  error_message?: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceDownload {
  id: string;
  media_id: number;
  filename: string;
  size: number;
  category: string;
  mime_type: string;
  progress: number;
  bytes_downloaded: number;
  speed_mbps: number;
  status: 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  local_path?: string;
  completed_at?: string;
}

export interface CategorySummary {
  category: string;
  count: number;
}

export interface MetadataCandidate {
  provider: string;
  provider_id: string;
  title: string;
  original_title?: string;
  media_type: string;
  release_year?: number;
  release_date?: string;
  overview?: string;
  poster_url?: string;
  backdrop_url?: string;
  rating?: number;
  confidence: number;
}

export interface MetadataStats {
  total_media: number;
  matched: number;
  manual: number;
  low_confidence: number;
  not_found: number;
  failed: number;
  pending: number;
  processing: number;
  retrying: number;
  match_percentage: number;
}
