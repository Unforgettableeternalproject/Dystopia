// SvelteKit API Route — LLM Proxy
// Proxies LLM requests from the frontend to the local Ollama/LM Studio server.
// This allows remote clients to access the LLM through the Vite server
// without exposing the LLM service directly to the network.
//
// Frontend calls:  /api/llm/chat (relative path)
// This proxies to: http://localhost:11434/v1/chat/completions (or configured URL)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Read LLM backend URL from environment variable
const LLM_BACKEND_URL = process.env.VITE_LLM_BACKEND_URL || 'http://localhost:11434';

export const POST: RequestHandler = async ({ request }) => {
  try {
    // Forward the request body to the LLM backend
    const body = await request.json();
    
    // Make request to local LLM server
    const response = await fetch(`${LLM_BACKEND_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw error(response.status, `LLM backend error: ${response.statusText}`);
    }

    // Check if this is a streaming request
    const isStreaming = body.stream === true;

    if (isStreaming) {
      // For streaming responses, we need to pass through the stream
      // SvelteKit will handle the ReadableStream automatically
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // For non-streaming, parse and return JSON
      const data = await response.json();
      return json(data);
    }
  } catch (e) {
    console.error('LLM proxy error:', e);
    
    // Handle different error types
    if (e && typeof e === 'object' && 'status' in e) {
      throw e; // Already a SvelteKit error
    }
    
    throw error(500, `Failed to connect to LLM backend: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
};
