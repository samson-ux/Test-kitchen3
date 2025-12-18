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

    // Normalize user ingredients for matching
    const userIngredients = ingredients.map(i => i.toLowerCase().trim());

    // Step 1: Search TheMealDB for recipes matching the first ingredient
    const allRecipes = [];
    
    // Search for each ingredient and collect recipes
    for (const ingredient of userIngredients) {
      try {
        const searchUrl = `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        
        if (searchData.meals) {
          for (const meal of searchData.meals) {
            allRecipes.push(meal.idMeal);
          }
        }
      } catch (e) {
        console.log('Search error for', ingredient, e);
      }
    }

    if (allRecipes.length === 0) {
      return res.status(200).json({ 
        recipes: [],
        message: 'No recipes found with these ingredients'
      });
    }

    // Get unique recipe IDs
    const uniqueRecipeIds = [...new Set(allRecipes)];

    // Step 2: Get full details and filter for recipes containing ALL user ingredients
    const matchingRecipes = [];

    for (const id of uniqueRecipeIds) {
      if (matchingRecipes.length >= 5) break; // Stop once we have 5
      
      try {
        const detailUrl = `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        
        if (detailData.meals && detailData.meals[0]) {
          const meal = detailData.meals[0];
          
          // Get all ingredients from the meal
          const mealIngredients = [];
          for (let i = 1; i <= 20; i++) {
            const ing = meal[`strIngredient${i}`];
            if (ing && ing.trim()) {
              mealIngredients.push(ing.trim().toLowerCase());
            }
          }
          
          // Check if ALL user ingredients are in this recipe
          const allMatch = userIngredients.every(userIng => 
            mealIngredients.some(mealIng => 
              mealIng.includes(userIng) || userIng.includes(mealIng)
            )
          );
          
          if (allMatch) {
            matchingRecipes.push({
              ...meal,
              mealIngredients
            });
          }
        }
      } catch (e) {
        console.log('Detail fetch error', e);
      }
    }

    if (matchingRecipes.length === 0) {
      return res.status(200).json({ 
        recipes: [],
        message: 'No recipes found that use ALL of your ingredients. Try fewer ingredients or different combinations!'
      });
    }

    // Step 3: Use Claude to add descriptions and nutrition info
    const recipeList = matchingRecipes.map(r => ({
      name: r.strMeal,
      category: r.strCategory,
      area: r.strArea,
      ingredients: r.mealIngredients,
      instructions: r.strInstructions ? r.strInstructions.substring(0, 500) : '',
      image: r.strMealThumb,
      youtubeUrl: r.strYoutube,
      sourceUrl: r.strSource
    }));

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
          content: `The user has these ingredients: ${userIngredients.join(', ')}

Here are real recipes that contain ALL of their ingredients:
${JSON.stringify(recipeList, null, 2)}

For each recipe, provide:
1. A brief appetizing description (1-2 sentences)
2. Estimated cooking time
3. Servings (estimate 4 if not clear)
4. Additional ingredients needed beyond what the user has (max 6 important ones)
5. Estimated nutrition per serving: calories, protein (g), carbs (g), fat (g)

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
      "additionalIngredients": ["other ingredients needed"],
      "calories": 450,
      "protein": 25,
      "carbs": 35,
      "fat": 18,
      "image": "image url from input",
      "recipeUrl": "source url from input or null",
      "youtubeUrl": "youtube url from input or null"
    }
  ]
}`
        }],
        system: 'You are a helpful chef assistant. Respond with ONLY valid JSON, no markdown.'
      })
    });

    if (!response.ok) {
      // If Claude fails, return basic recipe info
      const basicRecipes = matchingRecipes.map(r => ({
        name: r.strMeal,
        description: `A delicious ${r.strArea || ''} ${r.strCategory || 'dish'}.`,
        cookingTime: "30-45 minutes",
        servings: 4,
        category: r.strCategory,
        cuisine: r.strArea,
        additionalIngredients: r.mealIngredients
          .filter(i => !userIngredients.some(ui => i.includes(ui) || ui.includes(i)))
          .slice(0, 6),
        calories: 400,
        protein: 20,
        carbs: 40,
        fat: 15,
        image: r.strMealThumb,
        recipeUrl: r.strSource,
        youtubeUrl: r.strYoutube
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
    
    // Merge image URLs from original data
    if (parsed.recipes) {
      parsed.recipes = parsed.recipes.map((r, i) => ({
        ...r,
        image: r.image || (matchingRecipes[i] ? matchingRecipes[i].strMealThumb : null),
        recipeUrl: r.recipeUrl || (matchingRecipes[i] ? matchingRecipes[i].strSource : null),
        youtubeUrl: r.youtubeUrl || (matchingRecipes[i] ? matchingRecipes[i].strYoutube : null)
      }));
    }
    
    return res.status(200).json(parsed);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
