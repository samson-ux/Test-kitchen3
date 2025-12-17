export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ingredients } = req.body;

    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Please provide ingredients' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `I have these ingredients: ${ingredients.join(', ')}.

Please suggest exactly 5 creative and delicious recipes I can make. For each recipe, provide:
1. Recipe name
2. Brief description (1 sentence)
3. Estimated cooking time
4. Number of servings
5. Additional ingredients needed (if any, or empty array)

Format your response as JSON only, no other text. Use this exact structure:
{
  "recipes": [
    {
      "name": "Recipe Name",
      "description": "Brief description",
      "cookingTime": "30 minutes",
      "servings": 4,
      "additionalIngredients": ["ingredient1", "ingredient2"]
    }
  ]
}`
        }],
        system: 'You are a creative chef AI. Respond ONLY with valid JSON, no preamble or markdown formatting.'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({ error: 'Failed to get recipes from AI' });
    }

    const data = await response.json();
    const textContent = data.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('');

    // Clean up response
    let cleanedText = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanedText);

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
