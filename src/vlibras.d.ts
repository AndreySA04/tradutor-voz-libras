declare module '*/Player.js' {
  export class Player {
    constructor(options: { 
      target: HTMLElement | null; 
      targetPath?: string;
      translator?: string;
    });
    
    // Métodos nativos do Player
    translate(text: string, options?: any): void;
    play(glosa?: string, options?: any): void;
    playWellcome(): void;
    continue(): void;
    repeat(): void;
    pause(): void;
    stop(): void;
    setSpeed(speed: number): void;
    setPersonalization(personalization: string): void;
    applyEmotion(action: string, intensity: number): void;
    changeAvatar(avatarName: string): void;
    toggleSubtitle(force?: boolean): void;
    setRegion(region: string): void;
    load(wrapper: HTMLElement): void;
    
    // Métodos herdados do EventEmitter
    on(event: string, callback: (...args: any[]) => void): void;
    addListener(event: string, callback: (...args: any[]) => void): void;
    removeListener(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
  }
}