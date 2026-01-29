import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '8973', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const fastify = Fastify({
    logger: true,
  });

  // Serve static files from the client build
  await fastify.register(fastifyStatic, {
    root: join(__dirname, '../client'),
    prefix: '/',
  });

  // SPA fallback - serve index.html for all non-file routes
  fastify.setNotFoundHandler(async (request, reply) => {
    // Don't serve index.html for API routes
    if (request.url.startsWith('/rest') ||
        request.url.startsWith('/auth') ||
        request.url.startsWith('/storage') ||
        request.url.startsWith('/realtime') ||
        request.url.startsWith('/worker')) {
      return reply.code(404).send({ error: 'Not Found' });
    }

    return reply.sendFile('index.html');
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`Dashboard server running at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
