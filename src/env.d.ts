/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Signed-in visitor on account and checkout pages (set by the middleware). */
    customer?: import('@/lib/server/account').CustomerSession | null;
    /** One-time message left by a form endpoint (error code, email typed, sent). */
    flash?: import('@/lib/server/flash').Flash | null;
  }
}
