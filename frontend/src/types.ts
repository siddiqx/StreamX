export interface MediaItem {
  id: number;
  drive_file_id: string;
  filename: string;
  size: number;
  mime_type: string;
  category: string;
  poster_url?: string;
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
