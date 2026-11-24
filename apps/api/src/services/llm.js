const MISTRAL_API_URL = 'https://api.mistral.ai/v1';

function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    throw new Error('MISTRAL_API_KEY is not configured');
  }
  return key;
}

async function embedText(input, model = 'mistral-embed') {
  const apiKey = getApiKey();
  const response = await fetch(`${MISTRAL_API_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral embeddings error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function generateAnswer({
  systemPrompt,
  userPrompt,
  model = 'mistral-small-latest',
  temperature = 0.2,
}) {
  const apiKey = getApiKey();
  const response = await fetch(`${MISTRAL_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral chat error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = {
  embedText,
  generateAnswer,
};
