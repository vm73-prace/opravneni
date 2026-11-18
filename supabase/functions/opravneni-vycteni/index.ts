// Edge Function opravneni-vycteni – AI vyčtení dokladu (Claude Haiku 5.5). Logika je ve vycteni.js (testy v Node).
// Secrets: OPRAVNENI_ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets); SUPABASE_URL a SUPABASE_ANON_KEY dodá Supabase.
import Anthropic from 'npm:@anthropic-ai/sdk@1.5.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { obsluha } from './vycteni.js';

Deno.serve(obsluha({ env: Deno.env.toObject(), createClient, Anthropic }));
