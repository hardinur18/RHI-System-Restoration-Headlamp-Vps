import { supabaseConfigErrorMessage, supabaseUrl } from '/utils/supabase/info';

const envFunctionsBaseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.trim().replace(/\/+$/, '');

export const makeServerFunctionsBaseUrl =
  envFunctionsBaseUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1/make-server-f781cd00` : '');

export function buildMakeServerUrl(path = '') {
  if (!makeServerFunctionsBaseUrl) {
    throw new Error(supabaseConfigErrorMessage);
  }

  if (!path) {
    return makeServerFunctionsBaseUrl;
  }

  return `${makeServerFunctionsBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
