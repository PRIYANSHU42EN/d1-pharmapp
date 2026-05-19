import { Hono, Context, Next } from "hono";
import { cors } from "hono/cors";
import { handleRest } from './rest';

export interface Env {
    DB: D1Database;
    SECRET: SecretsStoreSecret;
}

// # List all users
// GET /rest/users

// # Get filtered and sorted users
// GET /rest/users?age=25&sort_by=name&order=desc

// # Get paginated results
// GET /rest/users?limit=10&offset=20

// # Create a new user
// POST /rest/users
// { "name": "John", "age": 30 }

// # Update a user
// PATCH /rest/users/123
// { "age": 31 }

// # Delete a user
// DELETE /rest/users/123

// Global cached secret to avoid fetching from Secrets Store on every request
let cachedSecret: string | null = null;

const app = new Hono<{ Bindings: Env }>();

// Apply CORS to all routes
app.use('*', async (c, next) => {
    return cors()(c, next);
});

// Authentication middleware that verifies the Authorization header
// is sent in on each request and matches the value of our Secret key.
// If a match is not found we return a 401 and prevent further access.
const authMiddleware = async (c: Context, next: Next) => {
    // Fast path: use cached secret if available
    if (cachedSecret === null) {
        // Fetch and cache the secret on first request
        cachedSecret = await c.env.SECRET.get();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;

    if (token !== cachedSecret) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
};

// CRUD REST endpoints made available to all of our tables
app.all('/rest/*', authMiddleware, handleRest);

// Execute a raw SQL statement with parameters with this route
app.post('/query', authMiddleware, async (c) => {
    try {
        const body = await c.req.json();
        const { query, params } = body;

        if (!query) {
            return c.json({ error: 'Query is required' }, 400);
        }

        // Execute the query against D1 database
        const results = await c.env.DB.prepare(query)
            .bind(...(params || []))
            .all();

        return c.json(results);
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});

export default app satisfies ExportedHandler<Env>;
