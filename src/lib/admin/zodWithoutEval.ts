/**
 * Import this first in a browser script that loads zod schemas. Building one,
 * zod probes whether it may compile validators with `new Function`; the
 * Content-Security-Policy forbids that, and the browser reports the probe as a
 * violation even though zod catches it and validates without. `jitless` skips it.
 */
import { z } from 'zod';

z.config({ jitless: true });
