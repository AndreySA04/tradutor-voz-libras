import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface EstadoProcessoMotor {
  rodando: boolean;
  porta_ativa: boolean;
  erro: string | null;
}

export const emTauri = () => isTauri();

/** Consulta o processo do motor gerenciado pelo Rust (null fora do Tauri, ex.: `npm run dev`). */
export async function consultarMotor(): Promise<EstadoProcessoMotor | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<EstadoProcessoMotor>('estado_motor');
  } catch {
    return null;
  }
}

export async function reiniciarMotor(): Promise<void> {
  if (!isTauri()) return;
  await invoke('reiniciar_motor');
}

export function minimizarJanela() {
  if (isTauri()) void getCurrentWindow().minimize();
}

export function fecharJanela() {
  if (isTauri()) void getCurrentWindow().close();
}
