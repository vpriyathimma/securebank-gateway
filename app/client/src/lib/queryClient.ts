import { QueryClient } from '@tanstack/react-query';
import { url as toUrl } from './base-path';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000,   // 30 minutes — prevents demo session logouts
      refetchOnWindowFocus: false,  // never refetch on focus
      refetchOnReconnect: false,    // never refetch on reconnect
      retry: false,
    },
  },
});

// Default fetcher for React Query
// EVERY react-query call goes through here, so this one line covers the whole
// data layer. It was missed on the first pass because the fetch takes a
// VARIABLE — a grep for `fetch("/…")` string literals finds nothing here — and
// the result was /api/auth/me, /api/approvals, /api/dashboard/stats and
// /api/audit-logs/view-with-auth all resolving against the origin instead of
// the app, i.e. "Endpoint not found" on a signed-in dashboard.
export const apiRequest = async (url: string, options: RequestInit = {}) => {
  const targetUrl = toUrl(url);
  console.log('API Request:', targetUrl, options);

  const response = await fetch(targetUrl, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include', // Include cookies for session authentication
    ...options,
  });

  console.log('API Response:', response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('API Error Response:', errorText);
    
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText || 'Network error' };
    }
    
    const error = new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    // Preserve the status code and response data for error handling
    (error as any).status = response.status;
    (error as any).response = {
      status: response.status,
      data: errorData
    };
    throw error;
  }

  const data = await response.json();
  console.log('API Success Data:', data);
  return data;
};

// Set default query function for all queries
queryClient.setQueryDefaults([], {
  queryFn: ({ queryKey }) => apiRequest(queryKey[0] as string),
});