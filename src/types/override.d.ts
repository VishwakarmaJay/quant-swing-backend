import type { Env } from '@config/env';

declare global {
  export namespace NodeJS {
    interface ProcessEnv extends Env {}
  }
}
