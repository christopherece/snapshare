/**
 * The installed guest app should open straight into the event it was installed from, so the
 * manifest's start_url (and id, so each event installs as its own app) comes from ?slug=.
 * Used by the backend in production and by apps/web-guest/serve.ts in development.
 */
export async function guestManifest(templatePath: string, slugParam: string | null | undefined) {
  const manifest = (await Bun.file(templatePath).json()) as Record<string, unknown>;
  const slug = slugParam?.toLowerCase().match(/^[\w-]{1,32}$/)?.[0];
  if (slug) Object.assign(manifest, { id: `/join/${slug}`, start_url: `/join/${slug}` });
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" },
  });
}
