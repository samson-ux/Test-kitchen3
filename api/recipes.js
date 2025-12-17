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
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `I need you to find real recipes online that use these ingredients: ${ingredients.join(', ')}.

Use web search to find up to 5 actual recipes from real cooking websites (AllRecipes, Food Network, BBC Good Food, Serious Eats, Bon Appetit, NYT Cooking, etc.).

For each recipe you find, provide:
1. Recipe name (exact name from the website)
2. Brief description
3. Estimated cooking time
4. Number of servings
5. Additional ingredients needed beyond what I have
6. Estimated calories per serving
7. Protein in grams per serving
8. Carbs in grams per serving
9. Fat in grams per serving
10. The actual URL to the recipe

Important:
- Find as many recipes as you can (up to 5)
- If you can only find 1-4 recipes, that's fine - return what you find
- If you cannot find ANY recipes with these ingredients, return an empty recipes array
- Only include recipes that actually exist online with real URLs
- The URLs must be real and working

CRITICAL: Respond with ONLY valid JSON. No markdown, no explanations, just JSON.

Format:
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
      "recipeUrl": "https://www.actualwebsite.com/recipe/..."
    }
  ]
}`
        }],
        system: 'You are a recipe search assistant with web search capabilities. Search the web for real recipes using the provided ingredients. Only return recipes that actually exist online with real URLs. Respond with ONLY valid JSON, no markdown or extra text.',
        tools: [
          {
            "type": "web_search_20250305",
            "name": "web_search"
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({ error: 'Failed to get recipes from AI' });
    }

    const data = await response.json();
    
    // Extract text content from all content blocks
    let textContent = '';
    for (const item of data.content) {
      if (item.type === 'text') {
        textContent += item.text;
      }
    }

    console.log('Raw response:', textContent.substring(0, 300));

    // Aggressive cleanup
    textContent = textContent.trim();
    textContent = textContent.replace(/```json\s*/g, '');
    textContent = textContent.replace(/```\s*/g, '');
    
    const firstBrace = textContent.indexOf('{');
    if (firstBrace > 0) {
      textContent = textContent.substring(firstBrace);
    }
    
    const lastBrace = textContent.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < textContent.length - 1) {
      textContent = textContent.substring(0, lastBrace + 1);
    }

    console.log('Cleaned response:', textContent.substring(0, 300));

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

    // Validate structure
    if (!parsed.recipes || !Array.isArray(parsed.recipes)) {
      return res.status(500).json({ error: 'Invalid recipe format from AI' });
    }

    // Check if no recipes found
    if (parsed.recipes.length === 0) {
      return res.status(200).json({ 
        recipes: [],
        message: 'No recipes found with these ingredients. Try different ingredients or add more!'
      });
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
