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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `I have these ingredients: ${ingredients.join(', ')}.

Please suggest exactly 5 creative and delicious recipes I can make. For each recipe, provide:
1. Recipe name
2. Brief description (1 sentence)
3. Estimated cooking time
4. Number of servings
5. Additional ingredients needed (if any, or empty array)
6. Estimated calories per serving
7. Protein in grams per serving
8. Carbs in grams per serving
9. Fat in grams per serving
10. A real recipe URL from a popular cooking website (AllRecipes, Food Network, BBC Good Food, Serious Eats, Bon Appetit, etc.) that matches this recipe or is very similar

CRITICAL: You must respond with ONLY valid JSON. No explanations, no markdown, no code blocks, no preamble, no extra text. Just pure JSON starting with { and ending with }.

Use this exact structure:
{
  "recipes": [
    {
      "name": "Recipe Name",
      "description": "Brief description",
      "cookingTime": "30 minutes",
      "servings": 4,
      "additionalIngredients": ["ingredient1", "ingredient2"],
      "calories": 450,
      "protein": 25,
      "carbs": 35,
      "fat": 18,
      "recipeUrl": "https://www.allrecipes.com/recipe/..."
    }
  ]
}`
        }],
        system: 'You are a recipe suggestion API. You MUST respond with ONLY valid JSON. Never include markdown code blocks, explanations, or any text outside the JSON object. Start your response with { and end with }. No ```json or ``` markers.'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({ error: 'Failed to get recipes from AI' });
    }

    const data = await response.json();
    let textContent = data.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('');

    console.log('Raw response:', textContent.substring(0, 200));

    // Aggressive cleanup of the response
    textContent = textContent.trim();
    
    // Remove markdown code blocks
    textContent = textContent.replace(/```json\s*/g, '');
    textContent = textContent.replace(/```\s*/g, '');
    
    // Remove any text before the first {
    const firstBrace = textContent.indexOf('{');
    if (firstBrace > 0) {
      textContent = textContent.substring(firstBrace);
    }
    
    // Remove any text after the last }
    const lastBrace = textContent.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < textContent.length - 1) {
      textContent = textContent.substring(0, lastBrace + 1);
    }

    console.log('Cleaned response:', textContent.substring(0, 200));

    let parsed;
    try {
      parsed = JSON.parse(textContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Failed to parse:', textContent);
      return res.status(500).json({ 
        error: 'AI returned invalid response. Please try again.',
        details: parseError.message 
      });
    }

    // Validate the response structure
    if (!parsed.recipes || !Array.isArray(parsed.recipes)) {
      return res.status(500).json({ error: 'Invalid recipe format from AI' });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
