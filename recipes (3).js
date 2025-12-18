export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

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

    // Step 1: Search TheMealDB for real recipes (FREE API - no key needed!)
    const allRecipes = [];
    
    for (const ingredient of ingredients.slice(0, 3)) { // Search first 3 ingredients
      try {
        const searchUrl = `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        
        if (searchData.meals) {
          allRecipes.push(...searchData.meals);
        }
      } catch (e) {
        console.log('Search error for', ingredient, e);
      }
    }

    // Remove duplicates by ID
    const uniqueRecipes = [...new Map(allRecipes.map(r => [r.idMeal, r])).values()];
    
    if (uniqueRecipes.length === 0) {
      return res.status(200).json({ 
        recipes: [],
        message: 'No recipes found with these ingredients'
      });
    }

    // Step 2: Get full details for top 5 recipes
    const detailedRecipes = [];
    for (const recipe of uniqueRecipes.slice(0, 5)) {
      try {
        const detailUrl = `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${recipe.idMeal}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        
        if (detailData.meals && detailData.meals[0]) {
          detailedRecipes.push(detailData.meals[0]);
        }
      } catch (e) {
        console.log('Detail fetch error', e);
      }
    }

    if (detailedRecipes.length === 0) {
      return res.status(200).json({ 
        recipes: [],
        message: 'Could not fetch recipe details'
      });
    }

    // Step 3: Use Claude to analyze recipes and add nutrition info
    const recipeList = detailedRecipes.map(r => {
      // Get all ingredients from the meal
      const mealIngredients = [];
      for (let i = 1; i <= 20; i++) {
        const ing = r[`strIngredient${i}`];
        if (ing && ing.trim()) {
          mealIngredients.push(ing.trim());
        }
      }
      
      return {
        name: r.strMeal,
        category: r.strCategory,
        area: r.strArea,
        ingredients: mealIngredients,
        instructions: r.strInstructions,
        image: r.strMealThumb,
        youtubeUrl: r.strYoutube,
        sourceUrl: r.strSource
      };
    });

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
          content: `The user has these ingredients: ${ingredients.join(', ')}

Here are real recipes from a recipe database:
${JSON.stringify(recipeList, null, 2)}

For each recipe, provide:
1. A brief appetizing description (1-2 sentences)
2. Estimated cooking time
3. Servings (estimate 4 if not clear)
4. Which ingredients from the user's list are used
5. Additional ingredients needed (from the recipe's ingredient list that user doesn't have)
6. Estimated nutrition per serving: calories, protein (g), carbs (g), fat (g)

Respond with ONLY JSON:
{
  "recipes": [
    {
      "name": "Recipe Name",
      "description": "Appetizing description",
      "cookingTime": "30 minutes",
      "servings": 4,
      "category": "Category",
      "cuisine": "Cuisine type",
      "ingredientsUsed": ["user ingredients used"],
      "additionalIngredients": ["other ingredients needed"],
      "calories": 450,
      "protein": 25,
      "carbs": 35,
      "fat": 18,
      "image": "image url",
      "recipeUrl": "source url or null",
      "youtubeUrl": "youtube url or null"
    }
  ]
}`
        }],
        system: 'You are a helpful chef assistant. Analyze the recipes and provide accurate nutrition estimates. Respond with ONLY valid JSON, no markdown.'
      })
    });

    if (!response.ok) {
      // If Claude fails, return basic recipe info without nutrition
      const basicRecipes = recipeList.map(r => ({
        name: r.name,
        description: `A delicious ${r.area || ''} ${r.category || 'dish'} recipe.`,
        cookingTime: "30-45 minutes",
        servings: 4,
        category: r.category,
        cuisine: r.area,
        additionalIngredients: r.ingredients.filter(i => 
          !ingredients.some(ui => i.toLowerCase().includes(ui.toLowerCase()))
        ).slice(0, 6),
        calories: 400,
        protein: 20,
        carbs: 40,
        fat: 15,
        image: r.image,
        recipeUrl: r.sourceUrl,
        youtubeUrl: r.youtubeUrl
      }));
      
      return res.status(200).json({ recipes: basicRecipes });
    }

    const data = await response.json();
    
    let textContent = '';
    for (const item of data.content) {
      if (item.type === 'text') {
        textContent += item.text;
      }
    }

    // Clean response
    textContent = textContent.trim();
    textContent = textContent.replace(/```json\s*/gi, '');
    textContent = textContent.replace(/```\s*/gi, '');
    
    const firstBrace = textContent.indexOf('{');
    const lastBrace = textContent.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      textContent = textContent.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(textContent);
    
    // Merge image URLs from original data (in case Claude didn't include them)
    if (parsed.recipes) {
      parsed.recipes = parsed.recipes.map((r, i) => ({
        ...r,
        image: r.image || (recipeList[i] ? recipeList[i].image : null),
        recipeUrl: r.recipeUrl || (recipeList[i] ? recipeList[i].sourceUrl : null),
        youtubeUrl: r.youtubeUrl || (recipeList[i] ? recipeList[i].youtubeUrl : null)
      }));
    }
    
    return res.status(200).json(parsed);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
