/**
 * test-local.mjs — Ollama / llama-cpp-python smoke test
 *
 * Usage:
 *   node scripts/test-hf.mjs
 *
 * Targets Ollama on localhost:11434 by default.
 * Edit BASE_URL / MODEL below if using llama-cpp-python or LM Studio.
 */

// ── Config ────────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:11434';   // Ollama default
const MODEL    = 'gemma4:e4b-it-q4_K_M';   // Gemma 4 E4B-Instruct Q4

// ── Helper ────────────────────────────────────────────────────────────────
async function chat(systemPrompt, userMessage, stream = false, maxTokens = 600) {
  const url = `${BASE_URL}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      stream,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  if (!stream) {
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  }

  // SSE stream → collect to string and print live
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  process.stdout.write('  ');
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
        // Gemma 4 is a thinking model — reasoning phase first, content phase second.
        // Only output content; skip reasoning (internal chain-of-thought).
        const text = delta.content ?? '';
        if (text) {
          process.stdout.write(text);
          full += text;
        }
      } catch { /* skip */ }
    }
  }
  process.stdout.write('\n');
  return full;

}

// ── Check Ollama is up ────────────────────────────────────────────────────
console.log(`Checking Ollama at ${BASE_URL} ...`);
try {
  const r = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
  const { models } = await r.json();
  const names = models.map(m => m.name);
  console.log('Models available:', names.join(', ') || '(none pulled yet)');
  if (!names.some(n => n.startsWith(MODEL.split(':')[0]))) {
    console.warn(`\nWarning: "${MODEL}" not found. Run: ollama pull ${MODEL}`);
    console.warn('Or change MODEL in this script to one of the listed models.\n');
  }
} catch (e) {
  console.error('Cannot reach Ollama:', e.message);
  console.error('Make sure Ollama is running:  ollama serve');
  process.exit(1);
}

const sep = '─'.repeat(60);

// ── Test 1: Regulator (JSON validation, no stream) ───────────────────────
console.log(`\n${sep}`);
console.log('Test 1 — Regulator: action validation (JSON output)');
console.log(sep);
const t1 = Date.now();
try {
  const raw = await chat(
    `You are an action validator for an RPG.
Respond ONLY with valid JSON — no markdown, no explanation:
{ "allowed": boolean, "reason": string | null, "modifiedInput": string | null }`,
    JSON.stringify({
      action: '跳過三公尺高的圍牆',
      actionType: 'move',
      stats: { strength: 3, knowledge: 5, talent: 4, spirit: 5, luck: 5 },
      stamina: '8/10',
      stress: '2/10',
      conditions: 'none',
    }),
    false,
    400,  // Regulator: small budget, JSON only
  );
  console.log('Raw response:');
  console.log(' ', raw.trim());
  try {
    const parsed = JSON.parse(raw.trim());
    console.log('Parsed OK:', parsed);
  } catch {
    console.warn('JSON parse failed — model did not follow format strictly.');
  }
} catch (e) {
  console.error('Error:', e.message);
}
console.log(`Time: ${Date.now() - t1}ms`);

// ── Test 2: DM (streaming narrative) ─────────────────────────────────────
console.log(`\n${sep}`);
console.log('Test 2 — DM: streaming narrative (Traditional Chinese)');
console.log(sep);
const t2 = Date.now();
try {
  await chat(
    `You are a dystopian RPG narrator. Write immersive, concise prose. Never invent lore not given.`,
    `Player action: 觀察周圍環境
Scene: 公有宿舍，早晨五點半，燈光剛亮起。鐵床架、混凝土牆、配額通知貼在門上。
Narrate the action in 2-3 sentences, in Traditional Chinese.`,
    true,
  );
} catch (e) {
  console.error('Error:', e.message);
}
console.log(`Time: ${Date.now() - t1}ms`);

console.log(`\n${sep}`);
console.log('Done.');
