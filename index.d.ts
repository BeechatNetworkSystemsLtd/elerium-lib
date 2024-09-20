
export function urlSignProgram(password: string, url: string): Promise<number[]>;
export function urlSignGetPublicKey(): Promise<number[]>;
export function urlSignReset(password: string): Promise<void>;

