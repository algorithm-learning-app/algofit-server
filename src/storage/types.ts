/** 서버에 저장되는 게스트 진행 1건. `data` 는 클라이언트가 보낸 진행 JSON(서버는 불투명 취급). */
export interface ProgressRecord {
  guestId: string;
  /** 클라이언트가 진행을 마지막으로 변경한 시각(epoch ms). LWW 비교 기준. */
  updatedAt: number;
  data: Record<string, unknown>;
}

/** 진행 저장소 추상화. SQLite/메모리/D1 등으로 교체 가능. */
export interface ProgressStore {
  get(guestId: string): ProgressRecord | null;
  put(record: ProgressRecord): void;
  close(): void;
}
