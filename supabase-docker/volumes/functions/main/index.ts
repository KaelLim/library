// Edge Functions Main Entry Point
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req: Request) => {
  const url = new URL(req.url)
  const pathname = url.pathname

  // Health check
  if (pathname === '/health' || pathname === '/') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Add your function routes here
  // Example:
  // if (pathname === '/my-function') {
  //   const module = await import('../my-function/index.ts')
  //   return await module.default(req)
  // }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
})
