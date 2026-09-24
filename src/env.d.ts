/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * Present only when src/middleware.ts has verified, on the server, that this
     * request is from a writer. Never set from client input.
     */
    admin?: import('./lib/cms/auth.ts').AdminIdentity;
  }
}
