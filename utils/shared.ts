export type EngineId = 'yandex'; // luego: 'google'

export type PendingSearch = {
  id: string; // nonce: el panel lo usa para no repetir búsquedas
  engine: EngineId;
  image: string; // data URL PNG
};

export const PENDING_KEY = 'pendingSearch';
export const ACTIVE_ENGINE: EngineId = 'yandex';
